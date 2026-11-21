import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { runLiveImapProbe, type ImapProbeRequest } from './serverImapTest.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_DIR = path.resolve(__dirname, 'obsidian-plugin');
const MCP_DIR = path.resolve(__dirname, 'mcp-cli');
const DIST_DIR = path.resolve(__dirname, 'dist');
const PLUGIN_ID = 'trinitec-mail-project-manager';

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian']);
const SKIP_FILES = new Set(['package-lock.json', 'pnpm-lock.yaml', 'bun.lock']);

interface RealFileEntry {
  path: string;
  group: 'obsidian-plugin' | 'mcp-cli';
  language: string;
  sizeBytes: number;
  lineCount: number;
  isCompiledArtifact: boolean;
  content: string;
}

function detectLanguage(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.json':
      return 'json';
    case '.css':
      return 'css';
    case '.ps1':
      return 'powershell';
    case '.md':
      return 'markdown';
    default:
      return 'text';
  }
}

function safeStat(fullPath: string): { exists: boolean; sizeBytes: number; mtime: string | null } {
  try {
    const st = fs.statSync(fullPath);
    if (!st.isFile()) return { exists: false, sizeBytes: 0, mtime: null };
    return {
      exists: true,
      sizeBytes: st.size,
      mtime: st.mtime.toISOString(),
    };
  } catch {
    return { exists: false, sizeBytes: 0, mtime: null };
  }
}

function collectFiles(
  baseDir: string,
  prefix: 'obsidian-plugin' | 'mcp-cli',
  includeFullCompiledMain: boolean
): RealFileEntry[] {
  const entries: RealFileEntry[] = [];
  if (!fs.existsSync(baseDir)) return entries;

  const walk = (dir: string) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    items.sort((a, b) => a.name.localeCompare(b.name, 'pl', { numeric: true }));

    for (const item of items) {
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue;
        walk(path.join(dir, item.name));
      } else if (item.isFile()) {
        if (SKIP_FILES.has(item.name)) continue;
        const full = path.join(dir, item.name);
        const relInside = path.relative(baseDir, full).replace(/\\/g, '/');
        const logicalPath = `${prefix}/${relInside}`;
        const st = fs.statSync(full);
        const isCompiledArtifact =
          logicalPath === 'obsidian-plugin/main.js' ||
          logicalPath.startsWith('mcp-cli/dist/');

        let content: string;
        let lineCount = 0;

        if (logicalPath === 'obsidian-plugin/main.js' && !includeFullCompiledMain) {
          const previewBytes = Math.min(st.size, 1400);
          const fd = fs.openSync(full, 'r');
          try {
            const buf = Buffer.alloc(previewBytes);
            fs.readSync(fd, buf, 0, previewBytes, 0);
            const snippet = buf.toString('utf8');
            content =
              `// Skompilowany pakiet produkcyjny esbuild (CommonJS dla Obsidian Electron)\n` +
              `// Plik: obsidian-plugin/main.js\n` +
              `// Rozmiar na dysku: ${(st.size / (1024 * 1024)).toFixed(2)} MB (${st.size.toLocaleString('pl-PL')} B)\n` +
              `// Zawiera zintegrowane biblioteki: imapflow, mailparser, nodemailer, turndown.\n` +
              `// Pobierz gotowy plik ZIP, aby zainstalować go bezpośrednio w sejfie bez kompilacji.\n\n` +
              `${snippet}\n\n// ... [podgląd skrócony dla wydajności przeglądarki] ...`;
            lineCount = 1;
          } finally {
            fs.closeSync(fd);
          }
        } else {
          content = fs.readFileSync(full, 'utf8');
          lineCount = content.split('\n').length;
        }

        entries.push({
          path: logicalPath,
          group: prefix,
          language: detectLanguage(logicalPath),
          sizeBytes: st.size,
          lineCount,
          isCompiledArtifact,
          content,
        });
      }
    }
  };

  walk(baseDir);
  return entries;
}

function addDirectoryToZip(zip: JSZip, sourceDir: string, zipPrefix: string): void {
  if (!fs.existsSync(sourceDir)) return;
  const walk = (dir: string) => {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name)) continue;
        walk(path.join(dir, item.name));
      } else if (item.isFile()) {
        if (SKIP_FILES.has(item.name)) continue;
        const full = path.join(dir, item.name);
        const rel = path.relative(sourceDir, full).replace(/\\/g, '/');
        const targetZipPath = zipPrefix ? `${zipPrefix}/${rel}` : rel;
        zip.file(targetZipPath, fs.readFileSync(full));
      }
    }
  };
  walk(sourceDir);
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  app.post('/api/imap/test', async (req, res) => {
    try {
      const body = (req.body || {}) as Partial<ImapProbeRequest>;
      const result = await runLiveImapProbe({
        host: String(body.host || ''),
        port: Number(body.port || 993),
        secure: body.secure !== false,
        strictTls: body.strictTls !== false,
        user: String(body.user || ''),
        password: String(body.password || ''),
      });
      res.status(200).json(result);
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Wewnętrzny błąd testu połączenia IMAP.',
      });
    }
  });

  app.get('/api/status', (_req, res) => {
    const pluginMain = safeStat(path.join(PLUGIN_DIR, 'main.js'));
    const pluginManifestStat = safeStat(path.join(PLUGIN_DIR, 'manifest.json'));
    const pluginStylesStat = safeStat(path.join(PLUGIN_DIR, 'styles.css'));
    const mcpServerStat = safeStat(path.join(MCP_DIR, 'dist', 'mcpServer.js'));
    const cliStat = safeStat(path.join(MCP_DIR, 'dist', 'cli.js'));

    let manifest: { id?: string; name?: string; version?: string; author?: string; minAppVersion?: string } = {};
    if (pluginManifestStat.exists) {
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_DIR, 'manifest.json'), 'utf8'));
      } catch {
        manifest = {};
      }
    }

    const pluginFiles = collectFiles(PLUGIN_DIR, 'obsidian-plugin', false);
    const mcpFiles = collectFiles(MCP_DIR, 'mcp-cli', false);

    res.json({
      plugin: {
        id: manifest.id || PLUGIN_ID,
        name: manifest.name || 'Trinitec Mail & Project Manager',
        version: manifest.version || '1.0.0',
        author: manifest.author || 'Piotr Świerk',
        minAppVersion: manifest.minAppVersion || '1.6.0',
        mainJs: pluginMain,
        manifestJson: pluginManifestStat,
        stylesCss: pluginStylesStat,
        fileCount: pluginFiles.length,
      },
      mcpCli: {
        mcpServerJs: mcpServerStat,
        cliJs: cliStat,
        fileCount: mcpFiles.length,
      },
      totals: {
        fileCount: pluginFiles.length + mcpFiles.length,
        readyForInstall: pluginMain.exists && pluginManifestStat.exists && pluginStylesStat.exists,
        mcpCompiled: mcpServerStat.exists && cliStat.exists,
      },
    });
  });

  app.get('/api/files', (_req, res) => {
    try {
      const pluginFiles = collectFiles(PLUGIN_DIR, 'obsidian-plugin', false);
      const mcpFiles = collectFiles(MCP_DIR, 'mcp-cli', false);
      res.json({
        files: [...pluginFiles, ...mcpFiles],
      });
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Nie udało się odczytać plików źródłowych z dysku.',
      });
    }
  });

  app.get('/api/download/plugin-ready', async (_req, res) => {
    try {
      const requiredFiles = ['main.js', 'manifest.json', 'styles.css'];
      for (const f of requiredFiles) {
        if (!fs.existsSync(path.join(PLUGIN_DIR, f))) {
          res.status(503).json({
            error: `Brak skompilowanego pliku ${f} w katalogu obsidian-plugin/.`,
          });
          return;
        }
      }

      const zip = new JSZip();
      for (const f of requiredFiles) {
        zip.file(`${PLUGIN_ID}/${f}`, fs.readFileSync(path.join(PLUGIN_DIR, f)));
      }

      const ps1Path = path.join(PLUGIN_DIR, 'scripts', 'install-to-vault.ps1');
      if (fs.existsSync(ps1Path)) {
        zip.file('install-to-vault.ps1', fs.readFileSync(ps1Path));
      }

      const quickInstructions = [
        'TRINITEC MAIL & PROJECT MANAGER — GOTOWA WTYCZKA OBSIDIAN (BEZ KOMPILACJI)',
        '=========================================================================',
        '',
        'SPOSÓB 1 — Ręcznie w 30 sekund (zalecany dla sejfu w OneDrive):',
        '1. Otwórz Obsidian -> Ustawienia -> Wtyczki społeczności -> Zainstalowane wtyczki.',
        '2. Kliknij ikonę folderu obok nagłówka "Zainstalowane wtyczki" (otworzy .obsidian/plugins/).',
        `3. Skopiuj cały folder "${PLUGIN_ID}" z tego archiwum ZIP do otwartego katalogu.`,
        '4. Wróć do Obsidian, kliknij przycisk "Odśwież" i włącz wtyczkę "Trinitec Mail & Project Manager".',
        '',
        'SPOSÓB 2 — Skrypt PowerShell (Windows):',
        '1. Rozpakuj to archiwum ZIP w dowolnym folderze.',
        '2. Kliknij prawym przyciskiem na "install-to-vault.ps1" -> "Uruchom w programie PowerShell".',
        '3. Wskaż w oknie Windows główny katalog swojego sejfu (np. w OneDrive).',
        '   Skrypt skopiuje WYŁĄCZNIE main.js, manifest.json i styles.css.',
        '',
        'BEZPIECZEŃSTWO:',
        '- Hasło do skrzynki (roundcube.pl / IMAP) zapisywane jest wyłącznie lokalnie na komputerze',
        '  (app.secretStorage / localStorage) i NIGDY nie trafia do pliku data.json w OneDrive.',
        '- Wtyczka działa w ścisłym trybie Opt-in: zapisuje wyłącznie maile i fragmenty, które wskażesz.',
        '',
      ].join('\r\n');

      zip.file('INSTRUKCJA-INSTALACJI.txt', quickInstructions);

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="trinitec-mail-project-manager-ready.zip"'
      );
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Błąd tworzenia gotowej paczki ZIP.',
      });
    }
  });

  app.get('/api/download/full-bundle', async (_req, res) => {
    try {
      const zip = new JSZip();
      addDirectoryToZip(zip, PLUGIN_DIR, 'obsidian-plugin');
      addDirectoryToZip(zip, MCP_DIR, 'mcp-cli');

      const rootReadme = [
        '# Trinitec Mail & Project Manager — Pełne Repozytorium (Wtyczka Obsidian + MCP Server & CLI)',
        '',
        '## Zawartość paczki',
        '',
        '- `obsidian-plugin/` — Kompletny kod TypeScript + **już skompilowany** `main.js`, `manifest.json`, `styles.css`, `scripts/install-to-vault.ps1` oraz `scripts/build.ps1`.',
        '- `mcp-cli/` — Kompletny kod TypeScript + **już skompilowany** serwer MCP (`dist/mcpServer.js`) i narzędzie CLI (`dist/cli.js`) wraz z bezpieczną polityką Read-Only (`trinitec-ai-policy.json`).',
        '',
        '## Szybki start',
        '',
        '1. **Wtyczka Obsidian**: skopiuj `obsidian-plugin/{main.js,manifest.json,styles.css}` do `.obsidian/plugins/trinitec-mail-project-manager/` w swoim sejfie (lub uruchom `obsidian-plugin/scripts/install-to-vault.ps1`).',
        '2. **Serwer MCP / CLI (Antigravity)**: w katalogu `mcp-cli/` uruchom `npm install --omit=dev` (albo `pnpm install`), skopiuj `.env.example` do `.env`, wpisz ścieżkę do swojego sejfu w `OBSIDIAN_VAULT_PATH` oraz dane IMAP/SMTP, a następnie dodaj `mcp-cli/dist/mcpServer.js` do konfiguracji MCP w Antigravity.',
        '',
      ].join('\n');

      zip.file('README.md', rootReadme);

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="trinitec-mail-full-repo-and-mcp.zip"'
      );
      res.setHeader('Content-Length', String(buffer.length));
      res.send(buffer);
    } catch (err) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Błąd tworzenia pełnego archiwum ZIP.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(DIST_DIR));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`[trinitec-portal] Serwer dystrybucji uruchomiony na http://0.0.0.0:${port}`);
  });
}

createServer().catch((err) => {
  console.error('[trinitec-portal] Błąd uruchomienia serwera:', err);
  process.exit(1);
});
