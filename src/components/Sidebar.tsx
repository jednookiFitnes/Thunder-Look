import {
  Download,
  FileCode2,
  FlaskConical,
  Mail,
  PackageCheck,
  TerminalSquare,
} from 'lucide-react';
import { BuildStatusResponse, StudioTab } from '../types/generator';
import { formatBytes } from '../utils/parserSimulator';

interface SidebarProps {
  activeTab: StudioTab;
  onSelectTab: (tab: StudioTab) => void;
  status: BuildStatusResponse | null;
  onDownloadFullZip: () => void;
  downloadingFull: boolean;
}

export function Sidebar({
  activeTab,
  onSelectTab,
  status,
  onDownloadFullZip,
  downloadingFull,
}: SidebarProps) {
  const sections: Array<{
    id: StudioTab;
    label: string;
    detail: string;
    icon: typeof PackageCheck;
  }> = [
    {
      id: 'install',
      label: 'Instalacja i pobieranie',
      detail: 'Gotowy ZIP pod OneDrive',
      icon: PackageCheck,
    },
    {
      id: 'email-settings',
      label: 'Ustawienia poczty',
      detail: 'Roundcube, Gmail OAuth2, Outlook',
      icon: Mail,
    },
    {
      id: 'code',
      label: 'Kod źródłowy',
      detail: status ? `${status.totals.fileCount} plików na dysku` : 'Pliki TS / JSON / CSS',
      icon: FileCode2,
    },
    {
      id: 'simulator',
      label: 'Symulator i zajętość',
      detail: 'Opt-in, Sandbox i IMAP Quota',
      icon: FlaskConical,
    },
    {
      id: 'setup',
      label: 'Antigravity MCP i CLI',
      detail: 'Konfiguracja bez kluczy API',
      icon: TerminalSquare,
    },
  ];

  return (
    <aside className="w-64 shrink-0 border-r border-[#2B2E3B] bg-[#181A20] flex flex-col justify-between overflow-y-auto">
      <div className="p-4 space-y-6">
        <div>
          <p className="px-2 mb-2 text-xs font-medium text-[#9499AD]">
            Obszar roboczy
          </p>
          <div className="space-y-1">
            {sections.map((section) => {
              const Icon = section.icon;
              const active = activeTab === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelectTab(section.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-start gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] ${
                    active
                      ? 'bg-[#232631] text-[#E6E8EF]'
                      : 'text-[#9499AD] hover:bg-[#1E2028] hover:text-[#E6E8EF]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 mt-0.5 shrink-0 ${
                      active ? 'text-[#8B5CF6]' : 'text-[#6D7285]'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium leading-tight truncate">
                      {section.label}
                    </div>
                    <div className="text-xs text-[#6D7285] mt-0.5 truncate tabular-nums">
                      {section.detail}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="border-t border-[#2B2E3B] pt-5 px-2 space-y-3">
          <p className="text-xs font-medium text-[#9499AD]">
            Skompilowane artefakty
          </p>
          <dl className="space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#9499AD]">obsidian/main.js</dt>
              <dd className="font-mono text-[#E6E8EF] tabular-nums">
                {status?.plugin.mainJs.exists
                  ? formatBytes(status.plugin.mainJs.sizeBytes)
                  : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#9499AD]">mcpServer.js</dt>
              <dd className="font-mono text-[#E6E8EF] tabular-nums">
                {status?.mcpCli.mcpServerJs.exists
                  ? formatBytes(status.mcpCli.mcpServerJs.sizeBytes)
                  : '—'}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-[#9499AD]">cli.js</dt>
              <dd className="font-mono text-[#E6E8EF] tabular-nums">
                {status?.mcpCli.cliJs.exists
                  ? formatBytes(status.mcpCli.cliJs.sizeBytes)
                  : '—'}
              </dd>
            </div>
          </dl>
        </div>

        <div className="border-t border-[#2B2E3B] pt-5 px-2 space-y-2.5 text-xs">
          <p className="font-medium text-[#9499AD]">Zabezpieczenia</p>
          <div className="space-y-1.5 text-[#9499AD]">
            <div className="flex items-center justify-between gap-2">
              <span>Zapis do Vaulta</span>
              <span className="text-[#E6E8EF] font-medium">Tylko Opt-in</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Polityka MCP</span>
              <span className="text-[#E6E8EF] font-medium">Read-Only</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Klucze API LLM</span>
              <span className="text-[#16A34A] font-medium">Niewymagane</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>Autor manifestu</span>
              <span className="text-[#E6E8EF] truncate">
                {status?.plugin.author || 'Piotr Świerk'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 border-t border-[#2B2E3B]">
        <button
          type="button"
          onClick={onDownloadFullZip}
          disabled={downloadingFull}
          className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-[#9499AD] hover:text-[#E6E8EF] bg-[#1E2028] hover:bg-[#232631] border border-[#2B2E3B] rounded-md transition-colors cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{downloadingFull ? 'Pakowanie...' : 'Pełne źródła + MCP (ZIP)'}</span>
        </button>
      </div>
    </aside>
  );
}
