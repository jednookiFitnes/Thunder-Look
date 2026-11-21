import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import process from "process";
import builtins from "module";

// Opcjonalne załadowanie lokalnego .env (bez hardkodowania ścieżki sejfu — działa z OneDrive i dowolnym dyskiem)
if (fs.existsSync(".env")) {
  const lines = fs.readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const prod = process.argv[2] === "production";
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const pluginId = manifest.id;

const nodeBuiltins = [
  ...builtins.builtinModules,
  ...builtins.builtinModules.map((m) => `node:${m}`),
];

function copyArtifactsToVault() {
  const vaultRoot = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultRoot) {
    console.log("[copyToVault] Zmienna OBSIDIAN_VAULT_PATH nie jest ustawiona — zbudowano main.js lokalnie.");
    return;
  }

  // Ścisła izolacja: operujemy wyłącznie w podfolderze tej wtyczki
  const targetDir = path.join(vaultRoot, ".obsidian", "plugins", pluginId);
  fs.mkdirSync(targetDir, { recursive: true });

  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, path.join(targetDir, file));
    }
  }

  if (!prod) {
    fs.writeFileSync(path.join(targetDir, ".hotreload"), "");
  }

  console.log(`[copyToVault] Zsynchronizowano artefakty do: ${targetDir}`);
}

const copyToVaultPlugin = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length === 0) {
        copyArtifactsToVault();
      }
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...nodeBuiltins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: prod,
  treeShaking: true,
  outfile: "main.js",
  plugins: [copyToVaultPlugin],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
