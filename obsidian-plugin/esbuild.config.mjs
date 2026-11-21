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
 * Odchudzenie bundla Obsidian Desktop (redukcja z ~2.49 MB -> ~1.0 MB):
 * - Deduplikacja `iconv-lite` (4 kopie w node_modules -> 1 wspólna kopia v0.7.3) oraz pominięcie ciężkich tablic CJK DBCS
 *   (`dbcs-data.js` — cp936/cp949/cp950/shiftjis/eucjp/gb18030), przy pełnym zachowaniu UTF-8, UTF-7 (IMAP), UTF-16,
 *   ISO-8859-2, Windows-1250 i wszystkich kodowań jedno-bajtowych (SBCS).
 * - Deduplikacja `libmime` (5.x), `libbase64` (1.x) i `@zone-eu/mailsplit` (5.4.x).
 * - `@mixmark-io/domino` (546 KB): zastąpiony natywnym `window.DOMParser` dostarczanym przez Electron/Obsidian.
 * - `pino` (75 KB): zastąpiony noop loggerem (`imapflow` uruchamiamy zawsze z `logger: false`).
 * - `encoding-japanese` (302 KB): zastąpiony lekkim wrapperem `TextDecoder`.
 * - `html-to-text`, `linkify-it`, `tlds`, `socks` (~750 KB): nieużywane dzięki `skipHtmlToText/skipTextToHtml/skipTextLinks` w `simpleParser` i brakowi proxy SOCKS.
 */
function pickFirstExisting(candidates) {
  for (const rel of candidates) {
    const abs = path.resolve(process.cwd(), rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

const canonicalIconvLite = pickFirstExisting([
  "node_modules/imapflow/node_modules/iconv-lite/lib/index.js",
  "node_modules/iconv-lite/lib/index.js",
]);
const canonicalLibmime = pickFirstExisting([
  "node_modules/mailparser/node_modules/libmime/lib/libmime.js",
  "node_modules/libmime/lib/libmime.js",
]);
const canonicalLibbase64 = pickFirstExisting([
  "node_modules/mailparser/node_modules/libbase64/lib/libbase64.js",
  "node_modules/libbase64/lib/libbase64.js",
]);
const canonicalMailsplit = pickFirstExisting([
  "node_modules/mailparser/node_modules/@zone-eu/mailsplit/lib/mailsplit.js",
  "node_modules/@zone-eu/mailsplit/lib/mailsplit.js",
]);

const bundleSlimmingPlugin = {
  name: "thunder-look-slim-shims",
  setup(build) {
    if (canonicalIconvLite) {
      build.onResolve({ filter: /^iconv-lite$/ }, () => ({
        path: canonicalIconvLite,
      }));
    }
    if (canonicalLibmime) {
      build.onResolve({ filter: /^libmime$/ }, () => ({
        path: canonicalLibmime,
      }));
    }
    if (canonicalLibbase64) {
      build.onResolve({ filter: /^libbase64$/ }, () => ({
        path: canonicalLibbase64,
      }));
    }
    if (canonicalMailsplit) {
      build.onResolve({ filter: /^@zone-eu\/mailsplit$/ }, () => ({
        path: canonicalMailsplit,
      }));
    }

    // Pomijamy wielkie tablice CJK DBCS (cp936/cp949/cp950/shiftjis/eucjp/gb18030) w iconv-lite;
    // zachowujemy w pełni UTF-8, UTF-7 (IMAP), UTF-16, UTF-32, Windows-1250 i ISO-8859-2.
    build.onResolve({ filter: /^\.\/dbcs-data$/ }, (args) => {
      if (args.importer && args.importer.includes("iconv-lite")) {
        return { path: "iconv-dbcs-empty", namespace: "tl-shim" };
      }
      return null;
    });
    build.onLoad({ filter: /^iconv-dbcs-empty$/, namespace: "tl-shim" }, () => ({
      contents: `module.exports = {};`,
      loader: "js",
    }));

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
    build.onResolve({ filter: /^linkify-it$/ }, () => ({
      path: "linkify-it-shim",
      namespace: "tl-shim",
    }));
    build.onResolve({ filter: /^html-to-text$/ }, () => ({
      path: "html-to-text-shim",
      namespace: "tl-shim",
    }));
    build.onResolve({ filter: /^tlds$/ }, () => ({
      path: "tlds-shim",
      namespace: "tl-shim",
    }));
    build.onResolve({ filter: /^socks$/ }, () => ({
      path: "socks-shim",
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

    build.onLoad({ filter: /^linkify-it-shim$/, namespace: "tl-shim" }, () => ({
      contents: `
        class REBuilder {
          constructor() {}
          build() { return {}; }
        }
        class LinkifyIt {
          constructor() {
            this.re = { src_ZPCc: "" };
          }
          tlds() { return this; }
          add() { return this; }
          set() { return this; }
          normalize(match) { return match; }
          match() { return null; }
          test() { return false; }
          pretest() { return false; }
          testSchemaAt() { return 0; }
        }
        function createLinkifyIt(schemas, options) {
          return new LinkifyIt(schemas, options);
        }
        createLinkifyIt.LinkifyIt = LinkifyIt;
        createLinkifyIt.REBuilder = REBuilder;
        createLinkifyIt.default = createLinkifyIt;
        module.exports = createLinkifyIt;
      `,
      loader: "js",
    }));

    build.onLoad({ filter: /^html-to-text-shim$/, namespace: "tl-shim" }, () => ({
      contents: `
        function htmlToText(html) {
          return String(html || "")
            .replace(/<style[\\s\\S]*?<\\/style>/gi, " ")
            .replace(/<script[\\s\\S]*?<\\/script>/gi, " ")
            .replace(/<br\\s*\\/?>/gi, "\\n")
            .replace(/<\\/(p|div|li|tr|h[1-6])>/gi, "\\n")
            .replace(/<[^>]+>/g, " ")
            .replace(/[ \\t]+/g, " ")
            .replace(/\\n{3,}/g, "\\n\\n")
            .trim();
        }
        module.exports = { htmlToText, convert: htmlToText, default: { htmlToText, convert: htmlToText } };
      `,
      loader: "js",
    }));

    build.onLoad({ filter: /^tlds-shim$/, namespace: "tl-shim" }, () => ({
      contents: `module.exports = [];`,
      loader: "js",
    }));

    build.onLoad({ filter: /^socks-shim$/, namespace: "tl-shim" }, () => ({
      contents: `
        module.exports = {
          SocksClient: {
            createConnection: async () => {
              throw new Error("SOCKS proxy disabled in Obsidian Desktop build");
            }
          }
        };
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
