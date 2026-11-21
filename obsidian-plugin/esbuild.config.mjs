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

/**
 * Odchudzenie bundla Obsidian Desktop (redukcja z 3.32 MB -> ~1.1 MB):
 * - `@mixmark-io/domino` (546 KB): zastąpiony natywnym `window.DOMParser` dostarczanym przez Electron/Obsidian.
 * - `pino` (75 KB): zastąpiony noop loggerem (`imapflow` uruchamiamy zawsze z `logger: false`).
 * - `encoding-japanese` (302 KB): zastąpiony lekkim wrapperem `TextDecoder`.
 * - `html-to-text`, `linkify-it`, `tlds`, `socks` (~750 KB): nieużywane dzięki `skipHtmlToText/skipTextToHtml/skipTextLinks` w `simpleParser` i brakowi proxy SOCKS.
 */
const bundleSlimmingPlugin = {
  name: "thunder-look-slim-shims",
  setup(build) {
    build.onResolve({ filter: /^@mixmark-io\/domino$/ }, () => ({
      path: "domino-shim",
      namespace: "tl-shim",
    }));
    build.onResolve({ filter: /^pino$/ }, () => ({
      path: "pino-shim",
      namespace: "tl-shim",
    }));
    build.onResolve({ filter: /^encoding-japanese$/ }, () => ({
      path: "encoding-jp-shim",
      namespace: "tl-shim",
    }));
    build.onResolve({ filter: /^(html-to-text|linkify-it|tlds|socks)$/ }, (args) => ({
      path: `noop-${args.path}`,
      namespace: "tl-shim",
    }));

    build.onLoad({ filter: /^domino-shim$/, namespace: "tl-shim" }, () => ({
      contents: `
        module.exports = {
          createDocument(html) {
            if (typeof window !== "undefined" && typeof window.DOMParser === "function") {
              return new window.DOMParser().parseFromString(html || "", "text/html");
            }
            return { body: { childNodes: [] } };
          }
        };
      `,
      loader: "js",
    }));

    build.onLoad({ filter: /^pino-shim$/, namespace: "tl-shim" }, () => ({
      contents: `
        const noop = () => {};
        const logger = {
          level: "silent",
          trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
          child() { return logger; }
        };
        function pino() { return logger; }
        pino.destination = () => ({ write: noop });
        module.exports = pino;
      `,
      loader: "js",
    }));

    build.onLoad({ filter: /^encoding-jp-shim$/, namespace: "tl-shim" }, () => ({
      contents: `
        module.exports = {
          convert(buf) {
            try {
              return new TextDecoder("utf-8", { fatal: false }).decode(buf);
            } catch {
              return Buffer.from(buf).toString("utf8");
            }
          }
        };
      `,
      loader: "js",
    }));

    build.onLoad({ filter: /^noop-/, namespace: "tl-shim" }, () => ({
      contents: `
        function Noop() {
          this.tlds = () => this;
          this.match = () => null;
          this.test = () => false;
        }
        Noop.convert = (html) => String(html || "").replace(/<[^>]+>/g, " ");
        Noop.htmlToText = Noop.convert;
        Noop.SocksClient = { createConnection: async () => { throw new Error("SOCKS proxy disabled"); } };
        module.exports = Noop;
      `,
      loader: "js",
    }));
  },
};

function copyArtifactsToVault() {
  const vaultRoot = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!vaultRoot) {
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
  legalComments: "none",
  drop: prod ? ["debugger"] : [],
  outfile: "main.js",
  plugins: [bundleSlimmingPlugin, copyToVaultPlugin],
});

if (prod) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
} else {
  await context.watch();
}
