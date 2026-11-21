import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, Check, Copy, ShieldAlert } from 'lucide-react';
import {
  SampleEmail,
  SaveDestinationMode,
  SaveScopeMode,
} from '../types/generator';
import {
  DEFAULT_SIMULATOR_CONFIG,
  MOCK_CONTACTS,
  MOCK_LARGEST_MESSAGES,
  MOCK_PROJECTS,
  MOCK_STORAGE_FOLDERS,
  MOCK_STORAGE_QUOTA,
  SAMPLE_EMAILS,
} from '../data/defaults';
import { buildSimulationOutput, formatBytes } from '../utils/parserSimulator';

interface SimulatorViewProps {
  onNotify: (msg: string) => void;
}

type SimSubTab = 'parser' | 'quota';
type PreviewMode = 'markdown' | 'html-sandbox';
type QuotaSortKey = 'sizeBytes' | 'date' | 'folder';

export function SimulatorView({ onNotify }: SimulatorViewProps) {
  const config = DEFAULT_SIMULATOR_CONFIG;
  const [subTab, setSubTab] = useState<SimSubTab>('parser');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('markdown');

  // Stan symulatora parsera
  const [sampleId, setSampleId] = useState<string>(SAMPLE_EMAILS[0].id);
  const [customSubject, setCustomSubject] = useState<string>(SAMPLE_EMAILS[0].subject);
  const [customBody, setCustomBody] = useState<string>(SAMPLE_EMAILS[0].body);
  const [manualProjectCode, setManualProjectCode] = useState<string>('');
  const [saveScope, setSaveScope] = useState<SaveScopeMode>('full');
  const [selectedExcerpt, setSelectedExcerpt] = useState<string>(
    '1. Proszę odesłać zaktualizowaną listę materiałową BOM do 2026-11-25 — musimy zamknąć zakupy PLC.'
  );
  const [saveDestination, setSaveDestination] = useState<SaveDestinationMode>('new-file');
  const [selectedAttachments, setSelectedAttachments] = useState<string[]>(
    SAMPLE_EMAILS[0].attachments.map((a) => a.filename)
  );
  const [appendNoteFilename, setAppendNoteFilename] = useState<string>('Mails - 11.2026.md');
  const [includeTasks, setIncludeTasks] = useState<boolean>(true);
  const [stripQuotes, setStripQuotes] = useState<boolean>(true);
  const [saveEmlCopy, setSaveEmlCopy] = useState<boolean>(false);
  const [blockRemoteImages, setBlockRemoteImages] = useState<boolean>(true);
  const [copiedMd, setCopiedMd] = useState(false);

  // Stan symulatora zajętości skrzynki
  const [quotaSortKey, setQuotaSortKey] = useState<QuotaSortKey>('sizeBytes');
  const [quotaSortDesc, setQuotaSortDesc] = useState<boolean>(true);
  const [quotaFolderFilter, setQuotaFolderFilter] = useState<string>('ALL');

  const baseSample = SAMPLE_EMAILS.find((s) => s.id === sampleId) || SAMPLE_EMAILS[0];

  const handleSelectSample = (id: string) => {
    const found = SAMPLE_EMAILS.find((s) => s.id === id) || SAMPLE_EMAILS[0];
    setSampleId(found.id);
    setCustomSubject(found.subject);
    setCustomBody(found.body);
    setManualProjectCode('');
    setSelectedAttachments(found.attachments.map((a) => a.filename));
  };

  const activeEmail: SampleEmail = useMemo(
    () => ({
      ...baseSample,
      subject: customSubject,
      body: customBody,
    }),
    [baseSample, customSubject, customBody]
  );

  const simResult = useMemo(
    () =>
      buildSimulationOutput({
        email: activeEmail,
        config,
        projects: MOCK_PROJECTS,
        contacts: MOCK_CONTACTS,
        manualProjectCode: manualProjectCode || null,
        saveScope,
        saveDestination,
        selectedExcerpt,
        selectedAttachments,
        appendNoteFilename,
        includeTasks,
        stripQuotes,
        saveEmlCopy,
        blockRemoteImages,
      }),
    [
      activeEmail,
      config,
      manualProjectCode,
      saveScope,
      saveDestination,
      selectedExcerpt,
      selectedAttachments,
      appendNoteFilename,
      includeTasks,
      stripQuotes,
      saveEmlCopy,
      blockRemoteImages,
    ]
  );

  const toggleAttachment = (filename: string) => {
    setSelectedAttachments((prev) =>
      prev.includes(filename) ? prev.filter((f) => f !== filename) : [...prev, filename]
    );
  };

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(simResult.markdownPreview);
      setCopiedMd(true);
      onNotify('Skopiowano wygenerowaną notatkę Markdown.');
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      onNotify('Nie udało się skopiować do schowka.');
    }
  };

  const quotaPercent =
    Math.round((MOCK_STORAGE_QUOTA.usedBytes / MOCK_STORAGE_QUOTA.limitBytes) * 1000) / 10;

  const sortedLargestMessages = useMemo(() => {
    const filtered =
      quotaFolderFilter === 'ALL'
        ? MOCK_LARGEST_MESSAGES
        : MOCK_LARGEST_MESSAGES.filter((m) => m.folder === quotaFolderFilter);
    return [...filtered].sort((a, b) => {
      const dir = quotaSortDesc ? -1 : 1;
      if (quotaSortKey === 'sizeBytes') return (a.sizeBytes - b.sizeBytes) * dir;
      if (quotaSortKey === 'date') return a.date.localeCompare(b.date) * dir;
      return a.folder.localeCompare(b.folder) * dir;
    });
  }, [quotaFolderFilter, quotaSortKey, quotaSortDesc]);

  const handleToggleSort = (key: QuotaSortKey) => {
    if (quotaSortKey === key) setQuotaSortDesc((d) => !d);
    else {
      setQuotaSortKey(key);
      setQuotaSortDesc(true);
    }
  };

  const existingNotesForProject =
    simResult.matchedProject?.existingNotes || ['Mails - 11.2026.md', 'Notatki.md'];

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#2B2E3B] pb-5">
        <div>
          <h1 className="text-2xl font-semibold text-[#E6E8EF]">
            Symulator parsera Opt-in, HTML Sandbox i zajętości skrzynki
          </h1>
          <p className="text-sm text-[#9499AD] mt-1">
            Sprawdź na żywo działanie Quote Stripping, wykrywania duplikatów po Message-ID, blokady pikseli śledzących oraz tabeli rozmiarów IMAP (EXAMINE / RFC822.SIZE).
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#141519] border border-[#2B2E3B] rounded-md">
          <button
            type="button"
            onClick={() => setSubTab('parser')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'parser'
                ? 'bg-[#232631] text-[#E6E8EF]'
                : 'text-[#9499AD] hover:text-[#E6E8EF]'
            }`}
          >
            Parser maila i zapis Opt-in
          </button>
          <button
            type="button"
            onClick={() => setSubTab('quota')}
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              subTab === 'quota'
                ? 'bg-[#232631] text-[#E6E8EF]'
                : 'text-[#9499AD] hover:text-[#E6E8EF]'
            }`}
          >
            Podgląd zajętości skrzynki (IMAP)
          </button>
        </div>
      </div>

      {subTab === 'parser' ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Lewa kolumna */}
          <div className="space-y-5 bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9499AD]" htmlFor="sample-select">
                Próbka wiadomości testowej
              </label>
              <select
                id="sample-select"
                value={sampleId}
                onChange={(e) => handleSelectSample(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
              >
                {SAMPLE_EMAILS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-xs text-[#9499AD] flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#2B2E3B] pb-3">
              <span>Od: {activeEmail.fromName} &lt;{activeEmail.fromEmail}&gt;</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{activeEmail.date}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{formatBytes(activeEmail.sizeBytes)}</span>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9499AD]" htmlFor="sim-subject">
                Temat wiadomości
              </label>
              <input
                id="sim-subject"
                type="text"
                value={customSubject}
                onChange={(e) => setCustomSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[#9499AD]" htmlFor="sim-body">
                Surowa treść wiadomości (z cytatami i stopką do testu Quote Stripping)
              </label>
              <textarea
                id="sim-body"
                rows={8}
                value={customBody}
                onChange={(e) => setCustomBody(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
              />
            </div>

            {/* Kontrolki Opt-in */}
            <div className="border-t border-[#2B2E3B] pt-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-[#9499AD]">Zakres zapisu (Opt-in)</span>
                  <select
                    value={saveScope}
                    onChange={(e) => setSaveScope(e.target.value as SaveScopeMode)}
                    className="w-full px-2.5 py-2 text-xs bg-[#141519] border border-[#2B2E3B] rounded text-[#E6E8EF] focus:outline-none focus:border-[#8B5CF6]"
                  >
                    <option value="full">Cała wiadomość</option>
                    <option value="selection">Tylko zaznaczony fragment</option>
                    <option value="attachments-only">Wyłącznie wybrane załączniki</option>
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-[#9499AD]">Tryb docelowy w Vaulcie</span>
                  <select
                    value={saveDestination}
                    onChange={(e) => setSaveDestination(e.target.value as SaveDestinationMode)}
                    className="w-full px-2.5 py-2 text-xs bg-[#141519] border border-[#2B2E3B] rounded text-[#E6E8EF] focus:outline-none focus:border-[#8B5CF6]"
                  >
                    <option value="new-file">Nowy osobny plik (.md)</option>
                    <option value="append-note">Dopisz do istniejącej notatki</option>
                  </select>
                </label>
              </div>

              {saveScope === 'selection' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-[#9499AD]">
                    Zaznaczony fragment tekstu do zapisania
                  </span>
                  <textarea
                    rows={3}
                    value={selectedExcerpt}
                    onChange={(e) => setSelectedExcerpt(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] rounded text-[#E6E8EF] focus:outline-none focus:border-[#8B5CF6]"
                  />
                </label>
              )}

              {saveDestination === 'append-note' && (
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-[#9499AD]">
                    Istniejąca notatka docelowa (MRU + sortowanie naturalne)
                  </span>
                  <select
                    value={appendNoteFilename}
                    onChange={(e) => setAppendNoteFilename(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] rounded text-[#E6E8EF] focus:outline-none focus:border-[#8B5CF6]"
                  >
                    {existingNotesForProject.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block space-y-1">
                <span className="text-xs font-medium text-[#9499AD]">
                  Ręczne nadpisanie projektu
                </span>
                <select
                  value={manualProjectCode}
                  onChange={(e) => setManualProjectCode(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs bg-[#141519] border border-[#2B2E3B] rounded text-[#E6E8EF] focus:outline-none focus:border-[#8B5CF6]"
                >
                  <option value="">Automatyczne dopasowanie (regex → kontakty/)</option>
                  {MOCK_PROJECTS.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.folderName}
                    </option>
                  ))}
                </select>
              </label>

              {/* Przełączniki wzorców open-source */}
              <div className="space-y-2 pt-1 border-t border-[#2B2E3B]">
                <label className="flex items-center justify-between gap-2 text-xs text-[#E6E8EF] cursor-pointer py-1">
                  <span className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={stripQuotes}
                      onChange={(e) => setStripQuotes(e.target.checked)}
                      className="accent-[#8B5CF6]"
                    />
                    <span>Quote &amp; Signature Stripping (oczyszczaj cytaty i stopki)</span>
                  </span>
                  <span className="font-mono text-[#16A34A] tabular-nums shrink-0">
                    -{simResult.quoteStripStats.savedPercent}% ({simResult.quoteStripStats.savedChars} zn.)
                  </span>
                </label>

                <label className="flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={saveEmlCopy}
                    onChange={(e) => setSaveEmlCopy(e.target.checked)}
                    className="accent-[#8B5CF6]"
                  />
                  <span>Dołącz źródłowy plik .eml w Attachments/ (kopia dowodowa)</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={includeTasks}
                    onChange={(e) => setIncludeTasks(e.target.checked)}
                    className="accent-[#8B5CF6]"
                  />
                  <span>Dołącz wyodrębnione zadania Obsidian Tasks ({simResult.extractedTasks.length})</span>
                </label>
              </div>

              {/* Załączniki */}
              <div className="space-y-2 pt-1 border-t border-[#2B2E3B]">
                <span className="text-xs font-medium text-[#9499AD]">
                  Załączniki do zapisania w Attachments/ projektu
                </span>
                <div className="space-y-1.5">
                  {activeEmail.attachments.map((att) => (
                    <label
                      key={att.filename}
                      className="flex items-center justify-between gap-2 text-xs text-[#E6E8EF] py-1 cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedAttachments.includes(att.filename)}
                          onChange={() => toggleAttachment(att.filename)}
                          className="accent-[#8B5CF6]"
                        />
                        <span className="font-mono truncate">{att.filename}</span>
                      </span>
                      <span className="font-mono text-[#6D7285] tabular-nums shrink-0">
                        {formatBytes(att.sizeBytes)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Prawa kolumna */}
          <div className="space-y-5">
            {/* Ostrzeżenie o duplikacie Message-ID */}
            {simResult.duplicateNotePath && (
              <div className="p-4 bg-[#1E2028] border border-[#D97706]/60 rounded-md flex items-start gap-3 text-xs">
                <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <div className="font-medium text-[#E6E8EF]">
                    Wykryto duplikat po nagłówku Message-ID (metadataCache)
                  </div>
                  <div className="text-[#9499AD]">
                    Ta wiadomość (<code className="font-mono">{activeEmail.messageId}</code>) jest już zapisana w:
                  </div>
                  <div className="font-mono text-[#E6E8EF] break-all">
                    {simResult.duplicateNotePath}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[#E6E8EF]">
                Wynik dopasowania do Praca Vault i analizy AI
              </h2>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-[#9499AD]">Dopasowany projekt</dt>
                  <dd className="text-[#E6E8EF] font-medium mt-0.5">
                    {simResult.matchedProject
                      ? `${simResult.matchedProject.code} · ${simResult.matchedProject.client}`
                      : 'Nie wykryto — wybór w SaveEmailModal'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#9499AD]">Metoda wykrycia</dt>
                  <dd className="text-[#E6E8EF] font-mono mt-0.5">
                    {simResult.matchMethod === 'regex'
                      ? 'Regex w temacie/treści'
                      : simResult.matchMethod === 'contact'
                      ? 'Dziedziczenie z kontakty/'
                      : simResult.matchMethod === 'manual'
                      ? 'Wybór ręczny'
                      : 'Wymaga wyboru'}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#9499AD]">Kategoria i folder IMAP</dt>
                  <dd className="text-[#E6E8EF] mt-0.5">
                    {simResult.detectedCategory}{' '}
                    <span className="text-[#6D7285] font-mono">→ {simResult.suggestedImapFolder}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-[#9499AD]">Priorytet</dt>
                  <dd className="mt-0.5 font-medium">
                    {simResult.priorityLevel === 'high' ? (
                      <span className="text-[#DC2626]">Wysoki (⏫)</span>
                    ) : simResult.priorityLevel === 'medium' ? (
                      <span className="text-[#D97706]">Średni (🔼)</span>
                    ) : (
                      <span className="text-[#9499AD]">Niski (🔽)</span>
                    )}
                  </dd>
                </div>
              </dl>

              <div className="border-t border-[#2B2E3B] pt-3 space-y-1 text-xs">
                <div className="text-[#9499AD]">Docelowa ścieżka notatki (UTF-8 bez BOM):</div>
                <div className="font-mono text-[#E6E8EF] break-all">{simResult.targetNotePath}</div>
                {simResult.emlTargetPath && (
                  <div className="font-mono text-[#9499AD] break-all pt-1">
                    Kopia .eml: {simResult.emlTargetPath}
                  </div>
                )}
              </div>
            </div>

            {/* Przełącznik Podgląd Markdown vs HTML Sandbox */}
            <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
              <div className="px-4 py-2.5 border-b border-[#2B2E3B] flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1 bg-[#141519] p-0.5 rounded border border-[#2B2E3B]">
                  <button
                    type="button"
                    onClick={() => setPreviewMode('markdown')}
                    className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer ${
                      previewMode === 'markdown'
                        ? 'bg-[#232631] text-[#E6E8EF]'
                        : 'text-[#9499AD] hover:text-[#E6E8EF]'
                    }`}
                  >
                    Wyjściowy Markdown (.md)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreviewMode('html-sandbox')}
                    className={`px-2.5 py-1 text-xs font-medium rounded cursor-pointer ${
                      previewMode === 'html-sandbox'
                        ? 'bg-[#232631] text-[#E6E8EF]'
                        : 'text-[#9499AD] hover:text-[#E6E8EF]'
                    }`}
                  >
                    HTML Sandbox (Blokada trackerów)
                  </button>
                </div>

                {previewMode === 'markdown' ? (
                  <button
                    type="button"
                    onClick={handleCopyMarkdown}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded cursor-pointer"
                  >
                    {copiedMd ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                        <span>Skopiowano</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Kopiuj .md</span>
                      </>
                    )}
                  </button>
                ) : (
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#9499AD] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={blockRemoteImages}
                      onChange={(e) => setBlockRemoteImages(e.target.checked)}
                      className="accent-[#8B5CF6]"
                    />
                    <span>Blokuj zdalne obrazy</span>
                  </label>
                )}
              </div>

              {previewMode === 'markdown' ? (
                <pre className="p-4 text-xs font-mono text-[#E6E8EF] overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {simResult.markdownPreview}
                </pre>
              ) : (
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs text-[#9499AD] bg-[#141519] border border-[#2B2E3B] rounded px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      <ShieldAlert className="w-3.5 h-3.5 text-[#8B5CF6]" />
                      <span>Izolowany iframe sandbox=&quot;allow-same-origin&quot; (skrypty wyłączone)</span>
                    </span>
                    <span className="font-mono tabular-nums text-[#E6E8EF]">
                      Zablokowano obrazów: {simResult.sanitizedHtml.blockedRemoteImages}
                    </span>
                  </div>
                  <iframe
                    title="Podgląd wiadomości HTML w piaskownicy"
                    sandbox=""
                    srcDoc={`<!doctype html><html><head><style>body{margin:0;padding:12px;background:#181A20;color:#E6E8EF;font-family:system-ui,sans-serif;font-size:13px;line-height:1.55;}code{background:#232631;padding:1px 4px;border-radius:3px;}ol,ul{padding-left:20px;}</style></head><body>${simResult.sanitizedHtml.html}</body></html>`}
                    className="w-full h-64 rounded border border-[#2B2E3B] bg-[#181A20]"
                  />
                </div>
              )}
            </div>

            {simResult.newContactPreview && (
              <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[#2B2E3B]">
                  <span className="text-xs font-medium text-[#D97706]">
                    Brak nadawcy w kontakty/ — podgląd 1-click Auto-Contact
                  </span>
                </div>
                <pre className="p-4 text-xs font-mono text-[#9499AD] overflow-x-auto leading-relaxed whitespace-pre-wrap">
                  {simResult.newContactPreview}
                </pre>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Podgląd działania modułu StorageQuotaView */
        <div className="space-y-6">
          <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-4">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-[#E6E8EF]">
                  Całkowita zajętość skrzynki (roundcube.pl / IMAP)
                </h2>
                <p className="text-xs text-[#9499AD] mt-0.5">
                  Podgląd widoku StorageQuotaView wykorzystującego nieinwazyjne IMAP EXAMINE, GETQUOTAROOT, STATUS oraz RFC822.SIZE.
                </p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <span className="text-lg font-semibold text-[#E6E8EF]">
                  {formatBytes(MOCK_STORAGE_QUOTA.usedBytes)}
                </span>
                <span className="text-sm text-[#9499AD]">
                  {' '}
                  / {formatBytes(MOCK_STORAGE_QUOTA.limitBytes)} ({quotaPercent}%)
                </span>
              </div>
            </div>

            <div className="w-full h-2.5 bg-[#141519] rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  quotaPercent >= 90
                    ? 'bg-[#DC2626]'
                    : quotaPercent >= config.quotaWarnPercent
                    ? 'bg-[#D97706]'
                    : 'bg-[#8B5CF6]'
                }`}
                style={{ width: `${Math.min(100, quotaPercent)}%` }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between text-xs text-[#9499AD]">
              <span>
                Próg ostrzegawczy: <strong className="font-mono text-[#E6E8EF]">{config.quotaWarnPercent}%</strong>
              </span>
              <span>
                Skanowanie w trybie read-only nie zmienia flagi \Seen (nieprzeczytane pozostają nieprzeczytane).
              </span>
            </div>
          </div>

          <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#E6E8EF]">
                Rozmiar według folderów IMAP
              </h3>
              <span className="text-xs text-[#9499AD] tabular-nums">
                {MOCK_STORAGE_FOLDERS.length} folderów · 2 636 wiadomości
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-[#2B2E3B] text-left text-xs text-[#9499AD]">
                    <th className="py-2.5 px-5 font-medium">Folder IMAP</th>
                    <th className="py-2.5 px-5 font-medium text-right">Wiadomości</th>
                    <th className="py-2.5 px-5 font-medium text-right">Nieprzeczytane</th>
                    <th className="py-2.5 px-5 font-medium text-right">Łączny rozmiar</th>
                    <th className="py-2.5 px-5 font-medium text-right">Największy mail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2B2E3B]">
                  {MOCK_STORAGE_FOLDERS.map((f) => (
                    <tr
                      key={f.folder}
                      onClick={() =>
                        setQuotaFolderFilter(quotaFolderFilter === f.folder ? 'ALL' : f.folder)
                      }
                      className={`cursor-pointer transition-colors ${
                        quotaFolderFilter === f.folder
                          ? 'bg-[#232631]'
                          : 'hover:bg-[#232631]/50'
                      }`}
                    >
                      <td className="py-2.5 px-5 font-mono text-xs text-[#E6E8EF]">{f.folder}</td>
                      <td className="py-2.5 px-5 font-mono text-xs text-right text-[#E6E8EF]">
                        {f.messages}
                      </td>
                      <td className="py-2.5 px-5 font-mono text-xs text-right text-[#9499AD]">
                        {f.unread}
                      </td>
                      <td className="py-2.5 px-5 font-mono text-xs text-right text-[#E6E8EF]">
                        {formatBytes(f.sizeBytes)}
                      </td>
                      <td className="py-2.5 px-5 font-mono text-xs text-right text-[#9499AD]">
                        {formatBytes(f.largestMessageBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#E6E8EF]">
                  Największe wiadomości w skrzynce
                </h3>
                <p className="text-xs text-[#9499AD]">
                  Sortuj po rozmiarze, dacie lub folderze, aby szybko odciążyć skrzynkę i przenieść załączniki do projektu.
                </p>
              </div>
              {quotaFolderFilter !== 'ALL' && (
                <button
                  type="button"
                  onClick={() => setQuotaFolderFilter('ALL')}
                  className="px-2.5 py-1 text-xs text-[#E6E8EF] bg-[#232631] border border-[#393D4F] rounded cursor-pointer"
                >
                  Pokaż wszystkie foldery (filtr: {quotaFolderFilter})
                </button>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-[#2B2E3B] text-left text-xs text-[#9499AD]">
                    <th className="py-2.5 px-5 font-medium">
                      <button
                        type="button"
                        onClick={() => handleToggleSort('folder')}
                        className="inline-flex items-center gap-1 hover:text-[#E6E8EF] cursor-pointer"
                      >
                        <span>Folder</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-5 font-medium">
                      <button
                        type="button"
                        onClick={() => handleToggleSort('date')}
                        className="inline-flex items-center gap-1 hover:text-[#E6E8EF] cursor-pointer"
                      >
                        <span>Data</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-5 font-medium">Temat i nadawca</th>
                    <th className="py-2.5 px-5 font-medium text-right">Załączniki</th>
                    <th className="py-2.5 px-5 font-medium text-right">
                      <button
                        type="button"
                        onClick={() => handleToggleSort('sizeBytes')}
                        className="inline-flex items-center gap-1 hover:text-[#E6E8EF] cursor-pointer"
                      >
                        <span>Rozmiar</span>
                        <ArrowUpDown className="w-3 h-3" />
                      </button>
                    </th>
                    <th className="py-2.5 px-5 font-medium text-right">Akcja</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2B2E3B]">
                  {sortedLargestMessages.map((msg) => (
                    <tr key={msg.uid} className="hover:bg-[#232631]/50">
                      <td className="py-2.5 px-5 font-mono text-xs text-[#9499AD]">{msg.folder}</td>
                      <td className="py-2.5 px-5 font-mono text-xs text-[#9499AD]">{msg.date}</td>
                      <td className="py-2.5 px-5">
                        <div className="text-xs font-medium text-[#E6E8EF]">{msg.subject}</div>
                        <div className="text-xs text-[#6D7285] mt-0.5">
                          {msg.from}
                          {msg.projectCode ? ` · Projekt ${msg.projectCode}` : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-5 font-mono text-xs text-right text-[#9499AD]">
                        {msg.attachmentCount}
                      </td>
                      <td className="py-2.5 px-5 font-mono text-xs text-right font-medium text-[#E6E8EF]">
                        {formatBytes(msg.sizeBytes)}
                      </td>
                      <td className="py-2.5 px-5 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            onNotify(
                              `Symulacja: otwarto SaveEmailModal (tylko załączniki) dla UID ${msg.uid} (${msg.projectCode || 'wybór projektu'}).`
                            )
                          }
                          className="px-2.5 py-1 text-xs text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded whitespace-nowrap cursor-pointer"
                        >
                          Zapisz załączniki
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
