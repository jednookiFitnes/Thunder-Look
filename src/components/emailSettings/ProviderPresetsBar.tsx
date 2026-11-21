import { MailProviderPreset } from '../../types/generator';
import { MAIL_PRESETS } from './presets';

interface ProviderPresetsBarProps {
  provider: MailProviderPreset;
  onSelectProvider: (preset: MailProviderPreset) => void;
}

const PRESET_ORDER: MailProviderPreset[] = ['roundcube', 'gmail', 'outlook', 'custom'];

export function ProviderPresetsBar({ provider, onSelectProvider }: ProviderPresetsBarProps) {
  const activePreset = MAIL_PRESETS[provider];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#141519] border border-[#2B2E3B] rounded-md w-fit">
        {PRESET_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onSelectProvider(id)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              provider === id
                ? 'bg-[#232631] text-[#E6E8EF]'
                : 'text-[#9499AD] hover:text-[#E6E8EF]'
            }`}
          >
            {MAIL_PRESETS[id].label}
          </button>
        ))}
      </div>

      <div className="px-4 py-3 bg-[#1E2028] border border-[#2B2E3B] rounded-md text-xs text-[#9499AD] leading-relaxed">
        {activePreset.note}
      </div>
    </div>
  );
}
