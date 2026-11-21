import { useMemo, useState } from 'react';
import { Check, Copy, ShieldCheck } from 'lucide-react';

interface SetupGuideViewProps {
  onNotify: (msg: string) => void;
}

const AGENTS_MD_CHECKLIST = [
  {
    id: 'pnpm-longpaths',
    title: 'Długie ścieżki Windows / OneDrive i lokalny bufor',
    detail:
      'Uruchom git config --global core.longpaths true. Do kompilacji ze źródeł używaj scripts/build.ps1 (kompiluje w %USERPROFILE%\\.obsidian-builds\\, omijając blokady OneDrive).',
  },
  {
    id: 'zero-hardcoded-path',
    title: 'Zero ścieżek sejfu na sztywno',
    detail:
      'Ścieżka sejfu (np. OneDrive) przekazywana jest wyłącznie przez zmienną środowiskową OBSIDIAN_VAULT_PATH lub wybór w oknie install-to-vault.ps1.',
  },
  {
    id: 'vault-api',
    title: 'Obsidian Vault API + CRLF-safe',
    detail:
      'Zapisy odbywają się przez app.vault.process() z zachowaniem oryginalnych końców linii, aktualizacje YAML przez app.fileManager.processFrontMatter(), a indeksacja przez app.metadataCache.',
  },
  {
    id: 'lifecycle',
    title: 'Bezpieczny cykl życia widoku',
    detail:
      'onunload() zatrzymuje jedynie połączenie IMAP IDLE i zamyka IndexedDB — nigdy nie wywołuje detachLeavesOfType(), dzięki czemu układ paneli użytkownika jest zachowany.',
  },
  {
    id: 'css-modals',
    title: 'Izolacja CSS i przestronne modale',
    detail:
      'Wszystkie selektory mają prefiks .tl-* i korzystają wyłącznie ze zmiennych motywu Obsidian. Reguły kategorii mają podgląd dopasowań na żywo i ochronę przed ReDoS.',
  },
  {
    id: 'readonly-mcp',
    title: 'Bezpieczeństwo MCP Read-Only i zero kluczy API',
    detail:
      'ai-policy.json domyślnie blokuje allowImapMove, allowSmtpSend i allowVaultWrite (zwraca dryRun), izoluje treść maila w tagach XML i wymaga jawnego userExplicitlyConfirmed.',
  },
];

export function SetupGuideView({ onNotify }: SetupGuideViewProps) {
  const [vaultPathInput, setVaultPathInput] = useState('');
  const [mcpFolderInput, setMcpFolderInput] = useState('');
  const [imapHostInput, setImapHostInput] = useState('trinitec.pl');
  const [smtpHostInput, setSmtpHostInput] = useState('trinitec.pl');
  const [mailUserInput, setMailUserInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const effectiveVaultPath =
    vaultPathInput.trim() || '<SCIEZKA_DO_TWOJEGO_SEJFU_OBSIDIAN_NP_ONEDRIVE>';
  const effectiveMcpDir =
    mcpFolderInput.trim() || '<SCIEZKA_DO_ROZPAKOWANEGO_FOLDERU_MCP_CLI>';
  const effectiveServerJs = `${effectiveMcpDir.replace(/[/\\]+$/, '')}/dist/mcp-cli/src/mcpServer.js`;

  const mcpConfigJson = useMemo(() => {
    const obj = {
      mcpServers: {
        'thunder-look': {
          command: 'node',
          args: [effectiveServerJs],
          env: {
            OBSIDIAN_VAULT_PATH: effectiveVaultPath,
            MAIL_SERVER: imapHostInput.trim() || 'trinitec.pl',
            IMAP_HOST: imapHostInput.trim() || 'trinitec.pl',
            IMAP_PORT: '993',
            IMAP_SECURE: 'true',
            IMAP_STRICT_TLS: 'true',
            SMTP_HOST: smtpHostInput.trim() || 'trinitec.pl',
            SMTP_PORT: '465',
            SMTP_SECURE: 'true',
            MAIL_USER: mailUserInput.trim() || 'twoj.adres@domena.pl',
            MAIL_PASSWORD: '<WSTAW_HASLO_SKRZYNKI_LUB_UZYJ_PLIKU_.env>',
          },
        },
      },
    };
    return JSON.stringify(obj, null, 2);
  }, [effectiveServerJs, effectiveVaultPath, imapHostInput, smtpHostInput, mailUserInput]);

  const envSnippet = useMemo(
    () => `OBSIDIAN_VAULT_PATH="${effectiveVaultPath}"
MAIL_SERVER="${imapHostInput.trim() || 'trinitec.pl'}"
IMAP_HOST="${imapHostInput.trim() || 'trinitec.pl'}"
IMAP_PORT="993"
IMAP_SECURE="true"
IMAP_STRICT_TLS="true"
SMTP_HOST="${smtpHostInput.trim() || 'trinitec.pl'}"
SMTP_PORT="465"
SMTP_SECURE="true"
MAIL_USER="${mailUserInput.trim() || 'twoj.adres@domena.pl'}"
MAIL_PASSWORD=""`,
    [effectiveVaultPath, imapHostInput, smtpHostInput, mailUserInput]
  );

  const agentPrompt = `Jesteś asystentem inżynierskim zarządzającym pocztą IMAP (Roundcube.pl / Gmail) oraz sejfem Obsidian „Praca Vault” poprzez serwer MCP \`trinitec-mail\`.

ZASADY KRYTYCZNE:
1. Przed jakąkolwiek akcją sprawdź \`get_ai_analysis_policy\` i przestrzegaj aktywnych trybów (suggest vs auto) oraz flag bezpieczeństwa Read-Only.
2. NIGDY nie zapisuj automatycznie wszystkich przychodzących wiadomości do sejfu Obsidian. Narzędzie \`save_email_to_vault\` wolno wywołać WYŁĄCZNIE na wyraźne polecenie użytkownika dla konkretnego UID (z \`userExplicitlyConfirmed: true\`).
3. Przeglądaj skrzynkę przez \`list_emails\` i \`read_email_by_uid\` (działają w nieinwazyjnym trybie EXAMINE / BODY.PEEK[], więc nie oznaczają maili jako przeczytanych).
4. Dla każdej analizowanej wiadomości określ:
   - dopasowany projekt z \`11 - Notes - Trinitec Projekty/\` (kod YY-XXX lub kontakt w \`kontakty/\`),
   - kategorię (Zlecenie / Pytanie / Raport / Oferta) i sugerowany folder IMAP,
   - priorytet (high ⏫ / medium 🔼 / low 🔽),
   - listę konkretnych zadań w formacie Obsidian Tasks: \`- [ ] Opis zadania 📅 YYYY-MM-DD ⏫\`.
5. Przed przeniesieniem maila (\`move_email_folder\`), dodaniem zadania (\`create_obsidian_task\`) lub wysłaniem odpowiedzi (\`send_email\`) pokaż użytkownikowi zwięzłe podsumowanie planu, jeśli polityka jest w trybie \`suggest\` lub Read-Only.`;

  const copyBlock = async (id: string, text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      onNotify(`Skopiowano: ${label}`);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      onNotify('Nie udało się skopiować do schowka.');
    }
  };

  const cliCommands = [
    {
      cmd: 'node dist/cli.js quota --top 20',
      desc: 'Sprawdza całkowitą zajętość skrzynki (IMAP QUOTA + RFC822.SIZE), rozbicie na foldery i 20 największych maili.',
    },
    {
      cmd: 'node dist/cli.js list --folder INBOX --unseen --limit 25',
      desc: 'Pobiera nieprzeczytane wiadomości w trybie read-only EXAMINE (nie zmienia flagi \\Seen).',
    },
    {
      cmd: 'node dist/cli.js read <UID> --folder INBOX',
      desc: 'Odczytuje pełną wiadomość (BODY.PEEK[]) z usunięciem cytatów, dopasowaniem do projektu i analizą heurystyczną.',
    },
    {
      cmd: 'node dist/cli.js triage --folder INBOX --limit 10',
      desc: 'Analizuje 10 najnowszych wiadomości pod kątem kategorii, priorytetu i zadań Obsidian Tasks (zero kluczy API).',
    },
    {
      cmd: 'node dist/cli.js projects',
      desc: 'Skanuje aktywne projekty w 11 - Notes - Trinitec Projekty/ z Twojego OBSIDIAN_VAULT_PATH.',
    },
    {
      cmd: 'node dist/cli.js save <UID> -p "11 - Notes - Trinitec Projekty/26-125 - ..." --attachments',
      desc: 'Zapisuje jawnie wskazany mail + załączniki do folderu projektu (ścisły Opt-in).',
    },
    {
      cmd: 'node dist/cli.js to-task -n "11 - Notes - Trinitec Projekty/.../_26-125....md" -t "Odesłać BOM" -d 2026-11-25 --priority high',
      desc: 'Dopisuje zadanie Obsidian Tasks (- [ ] ... 📅 2026-11-25 ⏫) CRLF-safe do notatki projektu.',
    },
    {
      cmd: 'node dist/cli.js policy --allow-imap-move true --allow-vault-write true',
      desc: 'Opcjonalnie odblokowuje wybrane operacje zapisu w pliku trinitec-ai-policy.json.',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-8 py-8 space-y-10">
      <div className="border-b border-[#2B2E3B] pb-6 space-y-1.5">
        <h1 className="text-2xl font-semibold text-[#E6E8EF]">
          Integracja z Antigravity (MCP stdio) i narzędziem CLI — bez kluczy API
        </h1>
        <p className="text-sm text-[#9499AD] max-w-3xl">
          Wpisz poniżej własną ścieżkę sejfu (np. w OneDrive) oraz katalog, w którym rozpakujesz <code className="font-mono text-[#E6E8EF]">mcp-cli/</code> z pełnego archiwum ZIP. Wygenerujemy gotowy wpis JSON dla Antigravity oraz plik <code className="font-mono text-[#E6E8EF]">.env</code>.
        </p>
      </div>

      {/* Personalizacja ścieżek użytkownika (zero wartości zaszytych na sztywno) */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[#E6E8EF]">
            01. Podaj swoje lokalne ścieżki i dostawcę poczty (Roundcube.pl / Gmail)
          </h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setImapHostInput('trinitec.pl');
                setSmtpHostInput('trinitec.pl');
                onNotify('Ustawiono domenę Roundcube (trinitec.pl) dla MCP.');
              }}
              className="px-2.5 py-1 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded cursor-pointer"
            >
              Preset Roundcube (trinitec.pl)
            </button>
            <button
              type="button"
              onClick={() => {
                setImapHostInput('imap.gmail.com');
                setSmtpHostInput('smtp.gmail.com');
                onNotify('Ustawiono hosty Gmail IMAP/SMTP (pamiętaj o Haśle aplikacji Google).');
              }}
              className="px-2.5 py-1 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded cursor-pointer"
            >
              Preset Gmail
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">
              Ścieżka do Twojego sejfu Obsidian (OBSIDIAN_VAULT_PATH)
            </span>
            <input
              type="text"
              value={vaultPathInput}
              onChange={(e) => setVaultPathInput(e.target.value)}
              placeholder="np. C:\Users\TwojaNazwa\OneDrive\Praca Vault"
              className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">
              Ścieżka do rozpakowanego katalogu mcp-cli
            </span>
            <input
              type="text"
              value={mcpFolderInput}
              onChange={(e) => setMcpFolderInput(e.target.value)}
              placeholder="np. C:\Tools\trinitec-mail\mcp-cli"
              className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Host IMAP / SMTP</span>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={imapHostInput}
                onChange={(e) => setImapHostInput(e.target.value)}
                placeholder="imap.roundcube.pl"
                className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
              />
              <input
                type="text"
                value={smtpHostInput}
                onChange={(e) => setSmtpHostInput(e.target.value)}
                placeholder="smtp.roundcube.pl"
                className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
              />
            </div>
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Adres skrzynki (MAIL_USER)</span>
            <input
              type="email"
              value={mailUserInput}
              onChange={(e) => setMailUserInput(e.target.value)}
              placeholder="twoj.adres@domena.pl"
              className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>
        </div>
      </section>

      {/* Konfiguracja MCP + .env */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#E6E8EF]">
              02. Konfiguracja MCP (stdio) dla Antigravity / Claude Desktop / Cursor
            </h2>
            <p className="text-xs text-[#9499AD] mt-0.5">
              W katalogu <code className="font-mono text-[#E6E8EF]">mcp-cli/</code> wykonaj jednorazowo{' '}
              <code className="font-mono text-[#E6E8EF]">npm install --omit=dev</code> (pliki <code className="font-mono text-[#E6E8EF]">dist/*.js</code> są już skompilowane), a następnie wklej poniższy wpis do ustawień MCP.
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyBlock('mcp-json', mcpConfigJson, 'antigravity-mcp-config.json')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded cursor-pointer"
          >
            {copiedId === 'mcp-json' ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                <span>Skopiowano JSON</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Kopiuj JSON</span>
              </>
            )}
          </button>
        </div>
        <pre className="p-5 text-xs font-mono text-[#E6E8EF] overflow-x-auto leading-relaxed">
          {mcpConfigJson}
        </pre>
      </section>

      {/* Plik .env */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#E6E8EF]">
              03. Plik .env dla uruchamiania z terminala (CLI)
            </h2>
            <p className="text-xs text-[#9499AD] mt-0.5">
              Zapisz jako <code className="font-mono text-[#E6E8EF]">mcp-cli/.env</code> i uzupełnij lokalnie <code className="font-mono text-[#E6E8EF]">MAIL_PASSWORD</code>.
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyBlock('env-file', envSnippet, 'szablon .env')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded cursor-pointer"
          >
            {copiedId === 'env-file' ? (
              <Check className="w-3.5 h-3.5 text-[#16A34A]" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>Kopiuj .env</span>
          </button>
        </div>
        <pre className="p-5 text-xs font-mono text-[#E6E8EF] overflow-x-auto leading-relaxed">
          {envSnippet}
        </pre>
      </section>

      {/* Ściąga CLI */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B]">
          <h2 className="text-sm font-semibold text-[#E6E8EF]">
            04. Ściąga poleceń CLI (mcp-cli/dist/cli.js)
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#2B2E3B] text-left text-[#9499AD]">
                <th className="py-2.5 px-5 font-medium">Polecenie</th>
                <th className="py-2.5 px-5 font-medium">Działanie</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2B2E3B]">
              {cliCommands.map((row) => (
                <tr key={row.cmd} className="hover:bg-[#232631]/50">
                  <td className="py-2.5 px-5 font-mono text-[#E6E8EF] whitespace-nowrap">
                    {row.cmd}
                  </td>
                  <td className="py-2.5 px-5 text-[#9499AD]">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Prompt dla Antigravity */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[#E6E8EF]">
              05. Prompt operacyjny dla agenta AI (Antigravity)
            </h2>
            <p className="text-xs text-[#9499AD] mt-0.5">
              Egzekwuje politykę Read-Only, nieinwazyjne skanowanie, kategoryzację, ekstrakcję zadań Obsidian Tasks i zakaz masowego zapisu maili.
            </p>
          </div>
          <button
            type="button"
            onClick={() => copyBlock('agent-prompt', agentPrompt, 'prompt dla agenta Antigravity')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded cursor-pointer"
          >
            {copiedId === 'agent-prompt' ? (
              <>
                <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                <span>Skopiowano prompt</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Kopiuj prompt</span>
              </>
            )}
          </button>
        </div>
        <pre className="p-5 text-xs font-mono text-[#E6E8EF] overflow-x-auto leading-relaxed whitespace-pre-wrap">
          {agentPrompt}
        </pre>
      </section>

      {/* Checklista AGENTS.md */}
      <section className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#16A34A]" />
          <h2 className="text-sm font-semibold text-[#E6E8EF]">
            06. Lista kontrolna zgodności z Twoim standardem AGENTS.md
          </h2>
        </div>
        <div className="divide-y divide-[#2B2E3B]">
          {AGENTS_MD_CHECKLIST.map((item) => (
            <div key={item.id} className="px-5 py-3 grid grid-cols-1 md:grid-cols-[260px_1fr] gap-2 text-xs">
              <div className="font-medium text-[#E6E8EF]">{item.title}</div>
              <div className="text-[#9499AD] leading-relaxed">{item.detail}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
