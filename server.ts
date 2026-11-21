import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { runLiveImapProbe, type ImapProbeRequest } from './serverImapTest.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PLUGIN_DIR = path.resolve(__dirname, 'obsidian-plugin');
const MCP_DIR = path.resolve(__dirname, 'mcp-cli');
const SHARED_DIR = path.resolve(__dirname, 'shared');
const DIST_DIR = path.resolve(__dirname, 'dist');
const PLUGIN_ID = 'thunder-look';

// Losowy token Bearer generowany przy każdym uruchomieniu serwera — wstrzykiwany do HTML
const API_AUTH_TOKEN = process.env.TL_API_TOKEN || crypto.randomBytes(32).toString('hex');

const SKIP_DIRS = new Set(['node_modules', '.git', '.obsidian']);
const SKIP_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'bun.lock',
  '.env',
  'firebase-applet-config.json',
]);

interface RealFileEntry {
  path: string;
  group: 'obsidian-plugin' | 'mcp-cli' | 'shared';
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

function findFirstExistingStat(candidates: string[]): { exists: boolean; sizeBytes: number; mtime: string | null } {
  for (const candidate of candidates) {
    const st = safeStat(candidate);
    if (st.exists) return st;
  }
  return { exists: false, sizeBytes: 0, mtime: null };
}

function collectFiles(
  baseDir: string,
  prefix: 'obsidian-plugin' | 'mcp-cli' | 'shared',
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
          logicalPath === 'obsidian-plugin/main.js' || logicalPath.startsWith('mcp-cli/dist/');

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
              `// Skompilowany, zminifikowany pakiet produkcyjny esbuild (CommonJS dla Obsidian Electron)\n` +
              `// Wtyczka: Thunder Look (autor: Piotr Świerk)\n` +
              `// Plik: obsidian-plugin/main.js\n` +
              `// Rozmiar na dysku: ${(st.size / 1024).toFixed(1)} KB (${st.size.toLocaleString('pl-PL')} B)\n` +
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

function isOriginAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
  if (!origin) return true; // same-origin / curl bez nagłówka Origin
  try {
    const parsed = new URL(origin);
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]'
    ) {
      return true;
    }
    if (hostHeader && parsed.host === hostHeader) {
      return true;
    }
    const configuredAppUrl = process.env.APP_URL;
    if (configuredAppUrl) {
      const appOrigin = new URL(configuredAppUrl).origin;
      if (parsed.origin === appOrigin) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function safeTokenEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function createSlidingWindowRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((ts) => now - ts < windowMs);

    if (recent.length >= maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        ok: false,
        error: `Przekroczono limit prób testu połączenia IMAP (${maxRequests}/min). Spróbuj ponownie za ${retryAfterSec} s.`,
      });
      return;
    }

    recent.push(now);
    hits.set(ip, recent);

    // Okresowe sprzątanie starych wpisów
    if (hits.size > 500) {
      for (const [k, list] of hits.entries()) {
        const filtered = list.filter((ts) => now - ts < windowMs);
        if (filtered.length === 0) hits.delete(k);
        else hits.set(k, filtered);
      }
    }

    next();
  };
}

function injectApiTokenMeta(html: string): string {
  const metaTag = `<meta name="tl-api-token" content="${API_AUTH_TOKEN}" />`;
  if (html.includes('</head>')) {
    return html.replace('</head>', `    ${metaTag}\n  </head>`);
  }
  return `${metaTag}\n${html}`;
}

async function createServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // Podstawowe nagłówki bezpieczeństwa i ścisły CORS dla /api/*
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');

    const origin = req.headers.origin;
    if (origin) {
      if (!isOriginAllowed(origin, req.headers.host)) {
        if (req.path.startsWith('/api/')) {
          res.status(403).json({ error: 'Niedozwolone źródło żądania (CORS).' });
          return;
        }
      } else {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      }
    }

    if (req.method === 'OPTIONS' && req.path.startsWith('/api/')) {
      res.status(204).end();
      return;
    }

    next();
  });

  // Wymagane uwierzytelnienie Bearer dla wszystkich endpointów /api/*
  app.use('/api', (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !safeTokenEquals(match[1].trim(), API_AUTH_TOKEN)) {
      res.status(401).json({
        ok: false,
        error: 'Brak lub nieprawidłowy token uwierzytelniający API (Bearer).',
      });
      return;
    }
    next();
  });

  const imapTestRateLimiter = createSlidingWindowRateLimiter(10, 60_000);

  app.post('/api/imap/test', imapTestRateLimiter, async (req, res) => {
    try {
      const body = (req.body || {}) as Partial<ImapProbeRequest>;
      const result = await runLiveImapProbe({
        host: String(body.host || ''),
        serverDomain: body.serverDomain ? String(body.serverDomain) : undefined,
        port: Number(body.port || 993),
        secure: body.secure !== false,
        strictTls: body.strictTls !== false,
        user: String(body.user || ''),
        password: String(body.password || ''),
      });
      res.status(result.validationError ? 400 : 200).json(result);
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
    const mcpServerStat = findFirstExistingStat([
      path.join(MCP_DIR, 'dist', 'mcp-cli', 'src', 'mcpServer.js'),
      path.join(MCP_DIR, 'dist', 'mcpServer.js'),
    ]);
    const cliStat = findFirstExistingStat([
      path.join(MCP_DIR, 'dist', 'mcp-cli', 'src', 'cli.js'),
      path.join(MCP_DIR, 'dist', 'cli.js'),
    ]);

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
    const sharedFiles = collectFiles(SHARED_DIR, 'shared', false);

    res.json({
      plugin: {
        id: manifest.id || PLUGIN_ID,
        name: manifest.name || 'Thunder Look',
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
        fileCount: pluginFiles.length + mcpFiles.length + sharedFiles.length,
        readyForInstall: pluginMain.exists && pluginManifestStat.exists && pluginStylesStat.exists,
        mcpCompiled: mcpServerStat.exists && cliStat.exists,
      },
    });
  });

  app.get('/api/files', (_req, res) => {
    try {
      const pluginFiles = collectFiles(PLUGIN_DIR, 'obsidian-plugin', false);
      const mcpFiles = collectFiles(MCP_DIR, 'mcp-cli', false);
      const sharedFiles = collectFiles(SHARED_DIR, 'shared', false);
      res.json({
        files: [...pluginFiles, ...mcpFiles, ...sharedFiles],
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
        'THUNDER LOOK — GOTOWA WTYCZKA OBSIDIAN (AUTOR: PIOTR ŚWIERK)',
        '==============================================================',
        '',
        'SPOSÓB 1 — Ręcznie w 30 sekund (zalecany dla sejfu w OneDrive / Google Drive):',
        '1. Otwórz Obsidian -> Ustawienia -> Wtyczki społeczności -> Zainstalowane wtyczki.',
        '2. Kliknij ikonę folderu obok nagłówka "Zainstalowane wtyczki" (otworzy .obsidian/plugins/).',
        `3. Skopiuj cały folder "${PLUGIN_ID}" z tego archiwum ZIP do otwartego katalogu.`,
        '4. Wróć do Obsidian, kliknij przycisk "Odśwież" i włącz wtyczkę "Thunder Look".',
        '',
        'SPOSÓB 2 — Skrypt PowerShell (Windows):',
        '1. Rozpakuj to archiwum ZIP w dowolnym folderze.',
        '2. Kliknij prawym przyciskiem na "install-to-vault.ps1" -> "Uruchom w programie PowerShell".',
        '3. Wskaż w oknie Windows główny katalog swojego sejfu (np. w OneDrive).',
        '   Skrypt skopiuje WYŁĄCZNIE main.js, manifest.json i styles.css.',
        '',
        'KONFIGURACJA POCZTY:',
        '- Roundcube / własna domena: wpisz serwer (np. trinitec.pl), login i hasło.',
        '- Gmail: zaloguj się przez przeglądarkę Google (OAuth2 PKCE) lub użyj 16-znakowego Hasła aplikacji.',
        '- Outlook / Office 365: wybierz gotowy preset w ustawieniach wtyczki.',
        '',
        'BEZPIECZEŃSTWO:',
        '- Hasła i tokeny zapisywane są wyłącznie lokalnie (Obsidian secretStorage / Electron safeStorage / AES-256-GCM)',
        '  i NIGDY nie trafiają do pliku data.json synchronizowanego w chmurze.',
        '- Wtyczka działa w ścisłym trybie Opt-in: zapisuje wyłącznie wskazane wiadomości i załączniki.',
        '',
      ].join('\r\n');

      zip.file('INSTRUKCJA-INSTALACJI.txt', quickInstructions);

      const buffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="thunder-look-obsidian-plugin.zip"');
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
      addDirectoryToZip(zip, SHARED_DIR, 'shared');

      const rootReadme = [
        '# Thunder Look — Pełne Repozytorium (Wtyczka Obsidian + Wspólny Rdzeń + MCP Server & CLI)',
        '',
        'Autor: **Piotr Świerk**',
        '',
        '## Zawartość paczki',
        '',
        '- `obsidian-plugin/` — Kod TypeScript + **skompilowany** `main.js`, `manifest.json`, `styles.css`, `scripts/install-to-vault.ps1` i `scripts/build.ps1`.',
        '- `mcp-cli/` — Kod TypeScript + **skompilowany** serwer MCP (`dist/mcp-cli/src/mcpServer.js`) i CLI (`dist/mcp-cli/src/cli.js`) wraz z przykładową polityką Read-Only (`ai-policy.example.json`).',
        '- `shared/` — Wspólna warstwa bezpieczeństwa (sanityzacja HTML/ścieżek/SMTP, wykrywanie domen Roundcube, izolacja Prompt Injection).',
        '',
        '## Szybki start',
        '',
        '1. **Wtyczka Obsidian**: skopiuj `obsidian-plugin/{main.js,manifest.json,styles.css}` do `.obsidian/plugins/thunder-look/` w swoim sejfie (lub uruchom `obsidian-plugin/scripts/install-to-vault.ps1`).',
        '2. **Serwer MCP / CLI**: w katalogu `mcp-cli/` uruchom `npm install --omit=dev`, skopiuj `.env.example` do `.env` oraz `ai-policy.example.json` do `ai-policy.json`, wpisz `OBSIDIAN_VAULT_PATH` oraz dane IMAP/SMTP i dodaj serwer MCP do konfiguracji klienta AI.',
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
        'attachment; filename="thunder-look-full-repo-and-mcp.zip"'
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
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.use('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/assets/')) {
        res.status(404).end();
        return;
      }
      try {
        const templatePath = path.resolve(__dirname, 'index.html');
        let html = fs.readFileSync(templatePath, 'utf8');
        html = await vite.transformIndexHtml(req.originalUrl, html);
        html = injectApiTokenMeta(html);
        res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').end(html);
      } catch (err) {
        next(err);
      }
    });
  } else {
    app.use(express.static(DIST_DIR, { index: false }));
    app.get('*', (req, res) => {
      if (req.originalUrl.startsWith('/api/') || req.originalUrl.startsWith('/assets/')) {
        res.status(404).end();
        return;
      }
      const htmlPath = path.join(DIST_DIR, 'index.html');
      const html = injectApiTokenMeta(fs.readFileSync(htmlPath, 'utf8'));
      res.status(200).setHeader('Content-Type', 'text/html; charset=utf-8').end(html);
    });
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || (process.env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');
  app.listen(port, host, () => {
    console.log(`[thunder-look-portal] Serwer uruchomiony na http://${host}:${port}`);
  });
}

createServer().catch((err) => {
  console.error('[thunder-look-portal] Błąd uruchomienia serwera:', err);
  process.exit(1);
});
