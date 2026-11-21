import { useMemo, useState } from 'react';
import { ArrowUpDown } from 'lucide-react';
import {
  MOCK_LARGEST_MESSAGES,
  MOCK_STORAGE_FOLDERS,
  MOCK_STORAGE_QUOTA,
} from '../../data/defaults';
import { formatBytes } from '../../utils/parserSimulator';

interface QuotaSimulatorPanelProps {
  quotaWarnPercent: number;
  onNotify: (msg: string) => void;
}

type QuotaSortKey = 'sizeBytes' | 'date' | 'folder';

export function QuotaSimulatorPanel({ quotaWarnPercent, onNotify }: QuotaSimulatorPanelProps) {
  const [quotaSortKey, setQuotaSortKey] = useState<QuotaSortKey>('sizeBytes');
  const [quotaSortDesc, setQuotaSortDesc] = useState<boolean>(true);
  const [quotaFolderFilter, setQuotaFolderFilter] = useState<string>('ALL');

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

  return (
    <div className="space-y-6">
      <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-[#E6E8EF]">
              Całkowita zajętość skrzynki (IMAP QUOTA / RFC822.SIZE)
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
                : quotaPercent >= quotaWarnPercent
                ? 'bg-[#D97706]'
                : 'bg-[#8B5CF6]'
            }`}
            style={{ width: `${Math.min(100, quotaPercent)}%` }}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between text-xs text-[#9499AD]">
          <span>
            Próg ostrzegawczy:{' '}
            <strong className="font-mono text-[#E6E8EF]">{quotaWarnPercent}%</strong>
          </span>
          <span>
            Skanowanie w trybie read-only nie zmienia flagi \Seen (nieprzeczytane pozostają nieprzeczytane).
          </span>
        </div>
      </div>

      <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#2B2E3B] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#E6E8EF]">Rozmiar według folderów IMAP</h3>
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
                    quotaFolderFilter === f.folder ? 'bg-[#232631]' : 'hover:bg-[#232631]/50'
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
  );
}
