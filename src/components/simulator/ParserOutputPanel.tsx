import { useState } from 'react';
import { AlertTriangle, Check, Copy, ShieldAlert } from 'lucide-react';
import { SampleEmail } from '../../types/generator';
import { type SimulationOutput } from '../../utils/parserSimulator';

interface ParserOutputPanelProps {
  activeEmail: SampleEmail;
  simResult: SimulationOutput;
  blockRemoteImages: boolean;
  onBlockRemoteImagesChange: (checked: boolean) => void;
  onNotify: (msg: string) => void;
}

type PreviewMode = 'markdown' | 'html-sandbox';

export function ParserOutputPanel({
  activeEmail,
  simResult,
  blockRemoteImages,
  onBlockRemoteImagesChange,
  onNotify,
}: ParserOutputPanelProps) {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('markdown');
  const [copiedMd, setCopiedMd] = useState(false);

  const handleCopyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(simResult.markdownPreview);
      setCopiedMd(true);
      onNotify('Skopiowano wygenerowaną notatkę Markdown.');
      window.setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      onNotify('Nie udało się skopiować do schowka.');
    }
  };

  return (
    <div className="space-y-5">
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
          Wynik dopasowania do Vaulta i kategoryzacji
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
              HTML Sandbox (CSP + blokada trackerów)
            </button>
          </div>

          {previewMode === 'markdown' ? (
            <button
              type="button"
              onClick={() => void handleCopyMarkdown()}
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
                onChange={(e) => onBlockRemoteImagesChange(e.target.checked)}
                className="accent-[#8B5CF6]"
              />
              <span>Blokuj zdalne obrazy (img-src &apos;none&apos;)</span>
            </label>
          )}
        </div>

        {previewMode === 'markdown' ? (
          <pre className="p-4 text-xs font-mono text-[#E6E8EF] overflow-x-auto leading-relaxed whitespace-pre-wrap">
            {simResult.markdownPreview}
          </pre>
        ) : (
          <div className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#9499AD] bg-[#141519] border border-[#2B2E3B] rounded px-3 py-2">
              <span className="inline-flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-[#8B5CF6] shrink-0" />
                <span>
                  Izolowany <code className="font-mono text-[#E6E8EF]">iframe sandbox=&quot;&quot;</code> (bez allow-scripts i bez allow-same-origin) + CSP
                </span>
              </span>
              <span className="font-mono tabular-nums text-[#E6E8EF]">
                Zablokowano obrazów: {simResult.sanitizedHtml.blockedRemoteImages}
              </span>
            </div>
            <iframe
              title="Podgląd wiadomości HTML w piaskownicy"
              sandbox=""
              srcDoc={simResult.sanitizedHtml.html}
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
  );
}
