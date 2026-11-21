import { Download } from 'lucide-react';
import { StudioTab } from '../types/generator';

interface TopBarProps {
  activeTab: StudioTab;
  onSelectTab: (tab: StudioTab) => void;
  onDownloadReadyZip: () => void;
  isDownloading: boolean;
}

const NAV_ITEMS: Array<{ id: StudioTab; label: string }> = [
  { id: 'install', label: 'Instalacja' },
  { id: 'email-settings', label: 'Ustawienia poczty' },
  { id: 'code', label: 'Kod źródłowy' },
  { id: 'simulator', label: 'Symulator' },
  { id: 'setup', label: 'Antigravity MCP' },
];

export function TopBar({
  activeTab,
  onSelectTab,
  onDownloadReadyZip,
  isDownloading,
}: TopBarProps) {
  return (
    <header className="h-14 border-b border-[#2B2E3B] bg-[#141519] px-6 flex items-center justify-between gap-8 shrink-0">
      {/* Strefa 1: Jednoelementowy znak marki */}
      <button
        type="button"
        onClick={() => onSelectTab('install')}
        className="text-base font-semibold tracking-tight text-[#E6E8EF] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8B5CF6] rounded cursor-pointer"
      >
        Thunder Look
      </button>

      {/* Strefa 2: 4 jedno-liniowe zakładki nawigacji */}
      <nav className="flex items-center gap-6 overflow-x-auto" aria-label="Nawigacja główna">
        {NAV_ITEMS.map((item) => {
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative py-4 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:text-white ${
                active
                  ? 'text-[#E6E8EF]'
                  : 'text-[#9499AD] hover:text-[#E6E8EF]'
              }`}
            >
              {item.label}
              {active && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[#8B5CF6]" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Strefa 3: Główna akcja pobrania gotowej wtyczki */}
      <div className="flex items-center shrink-0">
        <button
          type="button"
          onClick={onDownloadReadyZip}
          disabled={isDownloading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141519] focus-visible:ring-[#8B5CF6]"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{isDownloading ? 'Pobieranie...' : 'Pobierz gotową wtyczkę ZIP'}</span>
        </button>
      </div>
    </header>
  );
}
