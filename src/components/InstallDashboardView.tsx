import {
  CheckCircle2,
  Download,
  FileArchive,
  FolderOpen,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-react';
import { BuildStatusResponse } from '../types/generator';
import { formatBytes } from '../utils/parserSimulator';

interface InstallDashboardViewProps {
  status: BuildStatusResponse | null;
  loadingStatus: boolean;
  statusError: string | null;
  onRefreshStatus: () => void;
  onDownloadReadyZip: () => void;
  onDownloadFullZip: () => void;
  downloadingReady: boolean;
  downloadingFull: boolean;
  onNavigateCode: () => void;
  onNavigateSetup: () => void;
}

const BENCHMARK_FEATURES = [
  {
    area: 'Bezpieczeństwo haseł i chmury',
    implementation:
      'Hasła i tokeny OAuth2 zapisywane są lokalnie przez app.secretStorage → Electron safeStorage → AES-256-GCM (per urządzenie) — nigdy nie trafiają do data.json w OneDrive/Google Drive.',
  },
  {
    area: 'Nieinwazyjny IMAP + Google OAuth2',
    implementation:
      'Obsługa Roundcube (własna domena np. trinitec.pl), Gmail (logowanie przez przeglądarkę Google OAuth2 PKCE + Hasło aplikacji) oraz Outlook. Tryb EXAMINE / BODY.PEEK[] nie zmienia flagi nieprzeczytanych.',
  },
  {
    area: 'Wątkowanie, Opt-in i deduplikacja',
    implementation:
      'Zapis wyłącznie jawnie wskazanych maili, fragmentów i bezpiecznych załączników (ostrzeżenie przed .exe/.ps1 + deduplikacja SHA-256). Automatyczne wikilinki wątków po Message-ID / In-Reply-To / thread_id.',
  },
  {
    area: 'Ochrona XSS i blokada trackerów',
    implementation:
      'Renderowanie HTML wyłącznie po rygorystycznej sanityzacji (DOMPurify + shared sanitizer) w izolowanym <iframe sandbox=""> z CSP (img-src \'none\' domyślnie).',
  },
  {
    area: 'Zero kluczy API AI (MCP + CLI)',
    implementation:
      'Skompilowany serwer MCP (stdio) oraz CLI dla agentów AI. Domyślna polityka Read-Only (ai-policy.json), izolacja Prompt Injection w tagach XML i wymagane potwierdzenie userExplicitlyConfirmed.',
  },
  {
    area: 'Zgodność z Obsidian Guidelines',
    implementation:
      'Atomowe aktualizacje YAML przez app.fileManager.processFrontMatter(), zapis CRLF-safe przez app.vault.process(), prefiks CSS .tl-* ze zmiennymi motywu Obsidian, brak detachLeavesOfType() w onunload().',
  },
];

export function InstallDashboardView({
  status,
  loadingStatus,
  statusError,
  onRefreshStatus,
  onDownloadReadyZip,
  onDownloadFullZip,
  downloadingReady,
  downloadingFull,
  onNavigateCode,
  onNavigateSetup,
}: InstallDashboardViewProps) {
  return (
    <div className="max-w-5xl mx-auto px-8 py-8 space-y-10">
      {/* Nagłówek */}
      <div className="border-b border-[#2B2E3B] pb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-semibold text-[#E6E8EF]">
            Thunder Look — Zbudowana wtyczka Obsidian i pakiet MCP (autor: Piotr Świerk)
          </h1>
          <p className="text-sm text-[#9499AD] max-w-3xl">
            Kod TypeScript wtyczki Obsidian (z odchudzonym bundlem produkcyjnym), wspólnej warstwy <code className="font-mono text-[#E6E8EF]">shared/</code> oraz serwera MCP / CLI został skompilowany bezpośrednio na serwerze. Pobierz gotowy pakiet ZIP i zainstaluj w swoim sejfie bez Node.js.
          </p>
        </div>

        <button
          type="button"
          onClick={onRefreshStatus}
          disabled={loadingStatus}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#9499AD] hover:text-[#E6E8EF] bg-[#1E2028] hover:bg-[#232631] border border-[#2B2E3B] rounded-md transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingStatus ? 'animate-spin' : ''}`} />
          <span>Odśwież stan kompilacji</span>
        </button>
      </div>

      {/* Błąd odczytu statusu */}
      {statusError && (
        <div className="p-4 bg-[#1E2028] border border-[#DC2626]/60 rounded-md text-xs text-[#E6E8EF] flex items-center justify-between gap-4">
          <span>Nie udało się odczytać stanu artefaktów z serwera: {statusError}</span>
          <button
            type="button"
            onClick={onRefreshStatus}
            className="px-3 py-1 bg-[#232631] border border-[#393D4F] rounded cursor-pointer shrink-0"
          >
            Ponów
          </button>
        </div>
      )}

      {/* Pasek zweryfikowanych artefaktów z dysku */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#9499AD]">
            <span>Wtyczka Obsidian (main.js)</span>
            <CheckCircle2
              className={`w-4 h-4 ${
                status?.plugin.mainJs.exists ? 'text-[#16A34A]' : 'text-[#6D7285]'
              }`}
            />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#E6E8EF]">
            {loadingStatus
              ? 'Sprawdzanie...'
              : status?.plugin.mainJs.exists
              ? formatBytes(status.plugin.mainJs.sizeBytes)
              : 'Brak pliku'}
          </div>
          <div className="text-xs text-[#9499AD] flex items-center justify-between font-mono tabular-nums">
            <span>v{status?.plugin.version || '1.0.0'}</span>
            <span>{status?.plugin.author || 'Piotr Świerk'}</span>
          </div>
        </div>

        <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#9499AD]">
            <span>Serwer MCP (dist/mcpServer.js)</span>
            <CheckCircle2
              className={`w-4 h-4 ${
                status?.mcpCli.mcpServerJs.exists ? 'text-[#16A34A]' : 'text-[#6D7285]'
              }`}
            />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#E6E8EF]">
            {loadingStatus
              ? 'Sprawdzanie...'
              : status?.mcpCli.mcpServerJs.exists
              ? formatBytes(status.mcpCli.mcpServerJs.sizeBytes)
              : 'Brak pliku'}
          </div>
          <div className="text-xs text-[#9499AD]">
            11 narzędzi Zod · stdio · Zero API keys
          </div>
        </div>

        <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-4 space-y-2">
          <div className="flex items-center justify-between text-xs text-[#9499AD]">
            <span>Narzędzie CLI (dist/cli.js)</span>
            <CheckCircle2
              className={`w-4 h-4 ${
                status?.mcpCli.cliJs.exists ? 'text-[#16A34A]' : 'text-[#6D7285]'
              }`}
            />
          </div>
          <div className="text-xl font-semibold font-mono tabular-nums text-[#E6E8EF]">
            {loadingStatus
              ? 'Sprawdzanie...'
              : status?.mcpCli.cliJs.exists
              ? formatBytes(status.mcpCli.cliJs.sizeBytes)
              : 'Brak pliku'}
          </div>
          <div className="text-xs text-[#9499AD] font-mono tabular-nums">
            {status ? `${status.totals.fileCount} plików w repozytorium` : '—'}
          </div>
        </div>
      </section>

      {/* Dwie opcje pobrania */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#1E2028] border border-[#8B5CF6]/60 rounded-md p-6 flex flex-col justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 text-[#E6E8EF]">
              <PackageCheck className="w-5 h-5 text-[#8B5CF6] shrink-0" />
              <h2 className="text-base font-semibold">
                1. Gotowa wtyczka do Obsidian (bez kompilacji)
              </h2>
            </div>
            <p className="text-xs text-[#9499AD] leading-relaxed">
              Zawiera wyłącznie gotowe pliki produkcyjne (<code className="font-mono text-[#E6E8EF]">main.js</code>,{' '}
              <code className="font-mono text-[#E6E8EF]">manifest.json</code>,{' '}
              <code className="font-mono text-[#E6E8EF]">styles.css</code>), instalator Windows{' '}
              <code className="font-mono text-[#E6E8EF]">install-to-vault.ps1</code> z oknem wyboru folderu sejfu oraz krótką instrukcję.
            </p>
            <div className="text-xs text-[#9499AD] font-mono bg-[#141519] border border-[#2B2E3B] rounded p-3 space-y-1">
              <div>thunder-look/main.js</div>
              <div>thunder-look/manifest.json</div>
              <div>thunder-look/styles.css</div>
              <div>install-to-vault.ps1</div>
            </div>
          </div>

          <button
            type="button"
            onClick={onDownloadReadyZip}
            disabled={downloadingReady || !status?.totals.readyForInstall}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-50 rounded-md transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {downloadingReady
                ? 'Przygotowywanie archiwum...'
                : 'Pobierz gotową wtyczkę ZIP'}
            </span>
          </button>
        </div>

        <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 flex flex-col justify-between gap-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2.5 text-[#E6E8EF]">
              <FileArchive className="w-5 h-5 text-[#9499AD] shrink-0" />
              <h2 className="text-base font-semibold">
                2. Pełny pakiet: Źródła wtyczki + MCP Server &amp; CLI
              </h2>
            </div>
            <p className="text-xs text-[#9499AD] leading-relaxed">
              Zawiera pełny kod źródłowy TypeScript wtyczki (z już skompilowanym <code className="font-mono text-[#E6E8EF]">main.js</code> i buforem <code className="font-mono text-[#E6E8EF]">build.ps1</code> pod OneDrive) oraz skompilowany serwer MCP i CLI dla Antigravity (<code className="font-mono text-[#E6E8EF]">mcp-cli/dist/</code>).
            </p>
            <div className="text-xs text-[#9499AD] font-mono bg-[#141519] border border-[#2B2E3B] rounded p-3 space-y-1">
              <div>obsidian-plugin/ (src/*.ts + main.js + scripts/)</div>
              <div>shared/ (sanityzacja HTML, ścieżki, sieć, wątki)</div>
              <div>mcp-cli/ (src/*.ts + dist/ + ai-policy.example.json)</div>
              <div>README.md</div>
            </div>
          </div>

          <button
            type="button"
            onClick={onDownloadFullZip}
            disabled={downloadingFull}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] disabled:opacity-50 rounded-md transition-colors cursor-pointer"
          >
            <Download className="w-4 h-4 shrink-0" />
            <span>
              {downloadingFull
                ? 'Pakowanie repozytorium...'
                : 'Pobierz pełny pakiet Źródła + MCP/CLI ZIP'}
            </span>
          </button>
        </div>
      </section>

      {/* Instrukcja instalacji w 3 krokach dla sejfu w OneDrive */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#2B2E3B] pb-4">
          <div className="flex items-center gap-2.5">
            <FolderOpen className="w-4 h-4 text-[#8B5CF6]" />
            <h2 className="text-base font-semibold text-[#E6E8EF]">
              Jak zainstalować wtyczkę w Twoim sejfie Obsidian (np. w OneDrive) w 30 sekund
            </h2>
          </div>
          <span className="text-xs text-[#9499AD]">
            Brak ścieżek zaszytych na sztywno — działa z każdym położeniem sejfu
          </span>
        </div>

        <ol className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
          <li className="space-y-2">
            <div className="font-mono text-[#8B5CF6] font-semibold">KROK 01</div>
            <h3 className="text-sm font-medium text-[#E6E8EF]">Otwórz katalog wtyczek w Obsidianie</h3>
            <p className="text-[#9499AD] leading-relaxed">
              W Obsidianie wejdź w <strong className="text-[#E6E8EF]">Ustawienia → Wtyczki społeczności</strong> (upewnij się, że tryb ograniczony jest wyłączony) i kliknij <strong className="text-[#E6E8EF]">ikonę folderu</strong> przy sekcji „Zainstalowane wtyczki”. Otworzy to dokładnie katalog <code className="font-mono text-[#E6E8EF]">.obsidian/plugins/</code> w Twoim OneDrive.
            </p>
          </li>

          <li className="space-y-2">
            <div className="font-mono text-[#8B5CF6] font-semibold">KROK 02</div>
            <h3 className="text-sm font-medium text-[#E6E8EF]">Skopiuj folder lub uruchom skrypt</h3>
            <p className="text-[#9499AD] leading-relaxed">
              Rozpakuj pobrany ZIP i skopiuj folder <code className="font-mono text-[#E6E8EF]">thunder-look</code> do otwartego katalogu — <strong className="text-[#E6E8EF]">albo</strong> kliknij prawym na <code className="font-mono text-[#E6E8EF]">install-to-vault.ps1</code> → „Uruchom w PowerShell” i wskaż swój sejf w oknie Windows.
            </p>
          </li>

          <li className="space-y-2">
            <div className="font-mono text-[#8B5CF6] font-semibold">KROK 03</div>
            <h3 className="text-sm font-medium text-[#E6E8EF]">Odśwież, włącz i połącz skrzynkę</h3>
            <p className="text-[#9499AD] leading-relaxed">
              Kliknij przycisk <strong className="text-[#E6E8EF]">Odśwież</strong> na liście wtyczek, włącz <strong className="text-[#E6E8EF]">Thunder Look</strong> i w zakładce ustawień wtyczki wybierz preset (Roundcube np. <code className="font-mono text-[#E6E8EF]">trinitec.pl</code>, Gmail OAuth2/App Password lub Outlook) i uruchom „Przetestuj pełną konfigurację”.
            </p>
          </li>
        </ol>

        <div className="pt-3 border-t border-[#2B2E3B] flex flex-wrap items-center justify-between gap-3 text-xs text-[#9499AD]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span>
              Pliki wtyczki nie nadpisują globalnych ustawień <code className="font-mono text-[#E6E8EF]">.obsidian/</code> i bezpiecznie współpracują z synchronizacją OneDrive.
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onNavigateCode}
              className="text-[#E6E8EF] hover:text-[#8B5CF6] font-medium cursor-pointer"
            >
              Przejrzyj prawdziwy kod →
            </button>
            <button
              type="button"
              onClick={onNavigateSetup}
              className="inline-flex items-center gap-1.5 text-[#E6E8EF] hover:text-[#8B5CF6] font-medium cursor-pointer"
            >
              <TerminalSquare className="w-3.5 h-3.5" />
              <span>Konfiguracja Antigravity MCP →</span>
            </button>
          </div>
        </div>
      </section>

      {/* Tabela wdrożonych rozwiązań z publicznych repozytoriów i AGENTS.md */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B]">
          <h2 className="text-sm font-semibold text-[#E6E8EF]">
            Zaimplementowana architektura (wzorce open-source + zasady AGENTS.md)
          </h2>
        </div>
        <div className="divide-y divide-[#2B2E3B]">
          {BENCHMARK_FEATURES.map((row) => (
            <div
              key={row.area}
              className="px-5 py-3.5 grid grid-cols-1 md:grid-cols-[240px_1fr] gap-2 md:gap-6 text-xs"
            >
              <div className="font-medium text-[#E6E8EF]">{row.area}</div>
              <div className="text-[#9499AD] leading-relaxed">{row.implementation}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
