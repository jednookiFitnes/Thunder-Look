import {
  MockProject,
  SampleEmail,
  SaveDestinationMode,
  SaveScopeMode,
} from '../../types/generator';
import {
  formatBytes,
  isDangerousAttachmentFilename,
  type SimulationOutput,
} from '../../utils/parserSimulator';

interface ParserControlsPanelProps {
  samples: SampleEmail[];
  sampleId: string;
  activeEmail: SampleEmail;
  customSubject: string;
  customBody: string;
  manualProjectCode: string;
  projects: MockProject[];
  saveScope: SaveScopeMode;
  selectedExcerpt: string;
  saveDestination: SaveDestinationMode;
  appendNoteFilename: string;
  existingNotesForProject: string[];
  stripQuotes: boolean;
  saveEmlCopy: boolean;
  includeTasks: boolean;
  selectedAttachments: string[];
  simResult: SimulationOutput;
  onSelectSample: (id: string) => void;
  onSubjectChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onSaveScopeChange: (v: SaveScopeMode) => void;
  onSaveDestinationChange: (v: SaveDestinationMode) => void;
  onSelectedExcerptChange: (v: string) => void;
  onAppendNoteChange: (v: string) => void;
  onManualProjectChange: (v: string) => void;
  onStripQuotesChange: (v: boolean) => void;
  onSaveEmlCopyChange: (v: boolean) => void;
  onIncludeTasksChange: (v: boolean) => void;
  onToggleAttachment: (filename: string) => void;
}

export function ParserControlsPanel({
  samples,
  sampleId,
  activeEmail,
  customSubject,
  customBody,
  manualProjectCode,
  projects,
  saveScope,
  selectedExcerpt,
  saveDestination,
  appendNoteFilename,
  existingNotesForProject,
  stripQuotes,
  saveEmlCopy,
  includeTasks,
  selectedAttachments,
  simResult,
  onSelectSample,
  onSubjectChange,
  onBodyChange,
  onSaveScopeChange,
  onSaveDestinationChange,
  onSelectedExcerptChange,
  onAppendNoteChange,
  onManualProjectChange,
  onStripQuotesChange,
  onSaveEmlCopyChange,
  onIncludeTasksChange,
  onToggleAttachment,
}: ParserControlsPanelProps) {
  return (
    <div className="space-y-5 bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[#9499AD]" htmlFor="sample-select">
          Próbka wiadomości testowej
        </label>
        <select
          id="sample-select"
          value={sampleId}
          onChange={(e) => onSelectSample(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
        >
          {samples.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="text-xs text-[#9499AD] flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#2B2E3B] pb-3">
        <span>
          Od: {activeEmail.fromName} &lt;{activeEmail.fromEmail}&gt;
        </span>
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
          onChange={(e) => onSubjectChange(e.target.value)}
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
          onChange={(e) => onBodyChange(e.target.value)}
          className="w-full px-3 py-2 text-xs font-mono leading-relaxed bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
        />
      </div>

      <div className="border-t border-[#2B2E3B] pt-4 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-[#9499AD]">Zakres zapisu (Opt-in)</span>
            <select
              value={saveScope}
              onChange={(e) => onSaveScopeChange(e.target.value as SaveScopeMode)}
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
              onChange={(e) => onSaveDestinationChange(e.target.value as SaveDestinationMode)}
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
              onChange={(e) => onSelectedExcerptChange(e.target.value)}
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
              onChange={(e) => onAppendNoteChange(e.target.value)}
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
          <span className="text-xs font-medium text-[#9499AD]">Ręczne nadpisanie projektu</span>
          <select
            value={manualProjectCode}
            onChange={(e) => onManualProjectChange(e.target.value)}
            className="w-full px-2.5 py-2 text-xs bg-[#141519] border border-[#2B2E3B] rounded text-[#E6E8EF] focus:outline-none focus:border-[#8B5CF6]"
          >
            <option value="">Automatyczne dopasowanie (regex → kontakty/)</option>
            {projects.map((p) => (
              <option key={p.code} value={p.code}>
                {p.folderName}
              </option>
            ))}
          </select>
        </label>

        <div className="space-y-2 pt-1 border-t border-[#2B2E3B]">
          <label className="flex items-center justify-between gap-2 text-xs text-[#E6E8EF] cursor-pointer py-1">
            <span className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={stripQuotes}
                onChange={(e) => onStripQuotesChange(e.target.checked)}
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
              onChange={(e) => onSaveEmlCopyChange(e.target.checked)}
              className="accent-[#8B5CF6]"
            />
            <span>Dołącz źródłowy plik .eml w Attachments/ (kopia dowodowa)</span>
          </label>

          <label className="flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer py-1">
            <input
              type="checkbox"
              checked={includeTasks}
              onChange={(e) => onIncludeTasksChange(e.target.checked)}
              className="accent-[#8B5CF6]"
            />
            <span>
              Dołącz wyodrębnione zadania Obsidian Tasks ({simResult.extractedTasks.length})
            </span>
          </label>
        </div>

        <div className="space-y-2 pt-1 border-t border-[#2B2E3B]">
          <span className="text-xs font-medium text-[#9499AD]">
            Załączniki do zapisania w Attachments/ projektu (z ochroną rozszerzeń i SHA-256)
          </span>
          <div className="space-y-1.5">
            {activeEmail.attachments.map((att) => {
              const dangerous = isDangerousAttachmentFilename(att.filename);
              return (
                <label
                  key={att.filename}
                  className="flex items-center justify-between gap-2 text-xs text-[#E6E8EF] py-1 cursor-pointer"
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <input
                      type="checkbox"
                      checked={selectedAttachments.includes(att.filename)}
                      onChange={() => onToggleAttachment(att.filename)}
                      className="accent-[#8B5CF6]"
                    />
                    <span className="font-mono truncate">{att.filename}</span>
                    {dangerous && (
                      <span className="text-[11px] font-medium text-[#DC2626] shrink-0">
                        [Niebezpieczne rozszerzenie]
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[#6D7285] tabular-nums shrink-0">
                    {formatBytes(att.sizeBytes)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
