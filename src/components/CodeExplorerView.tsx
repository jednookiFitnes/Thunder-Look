import { useMemo, useState } from 'react';
import { Check, Copy, FileCode2, RefreshCw, Search } from 'lucide-react';
import { PackageGroup, RealSourceFile } from '../types/generator';
import { formatBytes } from '../utils/parserSimulator';

interface CodeExplorerViewProps {
  files: RealSourceFile[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNotify: (msg: string) => void;
}

type GroupFilter = 'all' | PackageGroup;

export function CodeExplorerView({
  files,
  loading,
  error,
  onRetry,
  onNotify,
}: CodeExplorerViewProps) {
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPath, setSelectedPath] = useState<string>('obsidian-plugin/src/main.ts');
  const [copiedPath, setCopiedPath] = useState<string | null>(null);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return files.filter((file) => {
      if (groupFilter !== 'all' && file.group !== groupFilter) return false;
      if (!q) return true;
      return (
        file.path.toLowerCase().includes(q) ||
        file.content.toLowerCase().includes(q)
      );
    });
  }, [files, groupFilter, searchQuery]);

  const activeFile =
    filteredFiles.find((f) => f.path === selectedPath) ||
    filteredFiles[0] ||
    null;

  const lines = useMemo(() => {
    if (!activeFile) return [];
    return activeFile.content.split('\n');
  }, [activeFile]);

  const handleCopy = async () => {
    if (!activeFile) return;
    try {
      await navigator.clipboard.writeText(activeFile.content);
      setCopiedPath(activeFile.path);
      onNotify(`Skopiowano zawartość pliku ${activeFile.path.split('/').pop()}`);
      setTimeout(() => setCopiedPath(null), 1800);
    } catch {
      onNotify('Nie udało się skopiować do schowka.');
    }
  };

  const groupLabels: Record<GroupFilter, string> = {
    all: `Wszystkie (${files.length})`,
    'obsidian-plugin': `Wtyczka Obsidian (${files.filter((f) => f.group === 'obsidian-plugin').length})`,
    shared: `Wspólny rdzeń (${files.filter((f) => f.group === 'shared').length})`,
    'mcp-cli': `Serwer MCP + CLI (${files.filter((f) => f.group === 'mcp-cli').length})`,
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[#9499AD] gap-2">
        <RefreshCw className="w-4 h-4 animate-spin text-[#8B5CF6]" />
        <span>Wczytywanie prawdziwych plików źródłowych z dysku...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-[#9499AD] p-8">
        <p className="text-[#E6E8EF] font-medium">Nie udało się odczytać plików źródłowych</p>
        <p className="text-xs font-mono text-[#DC2626]">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-xs font-medium text-[#E6E8EF] bg-[#232631] border border-[#393D4F] rounded-md cursor-pointer"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Pasek filtrów */}
      <div className="px-6 py-3.5 border-b border-[#2B2E3B] bg-[#181A20] flex flex-wrap items-center justify-between gap-4 shrink-0">
        <div className="flex items-center gap-1 p-1 bg-[#141519] border border-[#2B2E3B] rounded-md">
          {(['all', 'obsidian-plugin', 'shared', 'mcp-cli'] as GroupFilter[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGroupFilter(g)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer tabular-nums ${
                groupFilter === g
                  ? 'bg-[#232631] text-[#E6E8EF]'
                  : 'text-[#9499AD] hover:text-[#E6E8EF]'
              }`}
            >
              {groupLabels[g]}
            </button>
          ))}
        </div>

        <div className="relative w-72">
          <Search
            className="w-4 h-4 text-[#6D7285] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Szukaj pliku lub symbolu w kodzie..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
          />
        </div>
      </div>

      {/* Główny podział 2-kolumnowy: lista plików + podgląd kodu */}
      <div className="flex-1 min-h-0 flex">
        <div className="w-80 shrink-0 border-r border-[#2B2E3B] bg-[#141519] overflow-y-auto">
          {filteredFiles.length === 0 ? (
            <div className="p-6 text-xs text-[#9499AD] space-y-2">
              <p className="font-medium text-[#E6E8EF]">Brak pasujących plików</p>
              <p>Zmień frazę wyszukiwania lub przełącz filtr pakietu na „Wszystkie”.</p>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setGroupFilter('all');
                }}
                className="mt-2 px-3 py-1.5 text-xs bg-[#232631] text-[#E6E8EF] rounded border border-[#393D4F] cursor-pointer"
              >
                Wyczyść filtry
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[#2B2E3B]/60">
              {filteredFiles.map((file) => {
                const isSelected = activeFile?.path === file.path;
                const shortName = file.path.split('/').pop() || file.path;
                const dirPart = file.path.includes('/')
                  ? file.path.slice(0, file.path.lastIndexOf('/'))
                  : 'root';
                return (
                  <li key={file.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(file.path)}
                      className={`w-full text-left px-4 py-2.5 transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#232631] text-[#E6E8EF]'
                          : 'text-[#9499AD] hover:bg-[#1E2028] hover:text-[#E6E8EF]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileCode2
                            className={`w-3.5 h-3.5 shrink-0 ${
                              isSelected ? 'text-[#8B5CF6]' : 'text-[#6D7285]'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="text-xs font-mono font-medium truncate">
                            {shortName}
                          </span>
                        </div>
                        <span className="text-[11px] font-mono text-[#6D7285] tabular-nums shrink-0">
                          {formatBytes(file.sizeBytes)}
                        </span>
                      </div>
                      <div className="text-[11px] font-mono text-[#6D7285] truncate mt-0.5 pl-5">
                        {dirPart}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Panel kodu */}
        <div className="flex-1 min-w-0 flex flex-col bg-[#181A20]">
          {activeFile ? (
            <>
              <div className="px-6 py-3 border-b border-[#2B2E3B] bg-[#1E2028] flex flex-wrap items-center justify-between gap-4 shrink-0">
                <div className="min-w-0">
                  <div className="text-xs font-mono text-[#E6E8EF] truncate">
                    {activeFile.path}
                  </div>
                  <div className="text-xs text-[#9499AD] mt-0.5 flex items-center gap-2 font-mono tabular-nums">
                    <span>{formatBytes(activeFile.sizeBytes)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{lines.length} linii</span>
                    {activeFile.isCompiledArtifact && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-[#16A34A] font-sans">Skompilowany artefakt</span>
                      </>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded-md whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {copiedPath === activeFile.path ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                      <span>Skopiowano</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Kopiuj plik</span>
                    </>
                  )}
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-6">
                <table className="w-full border-collapse">
                  <tbody>
                    {lines.map((line, index) => (
                      <tr key={index} className="hover:bg-[#1E2028]/70">
                        <td className="select-none pr-4 text-right text-[#6D7285] tabular-nums w-10 align-top">
                          {index + 1}
                        </td>
                        <td className="text-[#E6E8EF] whitespace-pre">{line || ' '}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-[#9499AD]">
              Wybierz plik z drzewa po lewej stronie, aby zobaczyć prawdziwy kod źródłowy.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
