import { useMemo, useState } from 'react';
import { SampleEmail, SaveDestinationMode, SaveScopeMode } from '../types/generator';
import {
  DEFAULT_SIMULATOR_CONFIG,
  MOCK_CONTACTS,
  MOCK_PROJECTS,
  SAMPLE_EMAILS,
} from '../data/defaults';
import { buildSimulationOutput, isDangerousAttachmentFilename } from '../utils/parserSimulator';
import { ParserControlsPanel } from './simulator/ParserControlsPanel';
import { ParserOutputPanel } from './simulator/ParserOutputPanel';
import { QuotaSimulatorPanel } from './simulator/QuotaSimulatorPanel';

interface SimulatorViewProps {
  onNotify: (msg: string) => void;
}

type SimSubTab = 'parser' | 'quota';

export function SimulatorView({ onNotify }: SimulatorViewProps) {
  const config = DEFAULT_SIMULATOR_CONFIG;
  const [subTab, setSubTab] = useState<SimSubTab>('parser');

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
    SAMPLE_EMAILS[0].attachments
      .filter((a) => !isDangerousAttachmentFilename(a.filename))
      .map((a) => a.filename)
  );
  const [appendNoteFilename, setAppendNoteFilename] = useState<string>('Mails - 11.2026.md');
  const [includeTasks, setIncludeTasks] = useState<boolean>(true);
  const [stripQuotes, setStripQuotes] = useState<boolean>(true);
  const [saveEmlCopy, setSaveEmlCopy] = useState<boolean>(false);
  const [blockRemoteImages, setBlockRemoteImages] = useState<boolean>(true);

  const baseSample = SAMPLE_EMAILS.find((s) => s.id === sampleId) || SAMPLE_EMAILS[0];

  const handleSelectSample = (id: string) => {
    const found = SAMPLE_EMAILS.find((s) => s.id === id) || SAMPLE_EMAILS[0];
    setSampleId(found.id);
    setCustomSubject(found.subject);
    setCustomBody(found.body);
    setManualProjectCode('');
    setSelectedAttachments(
      found.attachments
        .filter((a) => !isDangerousAttachmentFilename(a.filename))
        .map((a) => a.filename)
    );
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
            Sprawdź na żywo działanie Quote Stripping, wykrywania duplikatów po Message-ID, blokady pikseli śledzących (CSP + iframe sandbox=&quot;&quot;) oraz monitora rozmiarów IMAP.
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
          <ParserControlsPanel
            samples={SAMPLE_EMAILS}
            sampleId={sampleId}
            activeEmail={activeEmail}
            customSubject={customSubject}
            customBody={customBody}
            manualProjectCode={manualProjectCode}
            projects={MOCK_PROJECTS}
            saveScope={saveScope}
            selectedExcerpt={selectedExcerpt}
            saveDestination={saveDestination}
            appendNoteFilename={appendNoteFilename}
            existingNotesForProject={existingNotesForProject}
            stripQuotes={stripQuotes}
            saveEmlCopy={saveEmlCopy}
            includeTasks={includeTasks}
            selectedAttachments={selectedAttachments}
            simResult={simResult}
            onSelectSample={handleSelectSample}
            onSubjectChange={setCustomSubject}
            onBodyChange={setCustomBody}
            onSaveScopeChange={setSaveScope}
            onSaveDestinationChange={setSaveDestination}
            onSelectedExcerptChange={setSelectedExcerpt}
            onAppendNoteChange={setAppendNoteFilename}
            onManualProjectChange={setManualProjectCode}
            onStripQuotesChange={setStripQuotes}
            onSaveEmlCopyChange={setSaveEmlCopy}
            onIncludeTasksChange={setIncludeTasks}
            onToggleAttachment={toggleAttachment}
          />
          <ParserOutputPanel
            activeEmail={activeEmail}
            simResult={simResult}
            blockRemoteImages={blockRemoteImages}
            onBlockRemoteImagesChange={setBlockRemoteImages}
            onNotify={onNotify}
          />
        </div>
      ) : (
        <QuotaSimulatorPanel
          quotaWarnPercent={config.quotaWarnPercent}
          onNotify={onNotify}
        />
      )}
    </div>
  );
}
