import { FormEvent, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  Server,
  ShieldCheck,
} from 'lucide-react';
import { MailProviderPreset } from '../../types/generator';
import { MAIL_PRESETS } from './presets';
import { resolveServerHostFromDomain } from '../../../shared/networkSecurity';

interface ImapSmtpFormProps {
  provider: MailProviderPreset;
  serverDomain: string;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  strictTls: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  user: string;
  password: string;
  isTesting: boolean;
  onServerDomainChange: (value: string) => void;
  onImapHostChange: (value: string) => void;
  onImapPortChange: (value: string) => void;
  onImapSecureChange: (checked: boolean) => void;
  onStrictTlsChange: (checked: boolean) => void;
  onSmtpHostChange: (value: string) => void;
  onSmtpPortChange: (value: string) => void;
  onUserChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
  onCopyEnv: () => Promise<void>;
}

export function ImapSmtpForm({
  provider,
  serverDomain,
  imapHost,
  imapPort,
  imapSecure,
  strictTls,
  smtpHost,
  smtpPort,
  user,
  password,
  isTesting,
  onServerDomainChange,
  onImapHostChange,
  onImapPortChange,
  onImapSecureChange,
  onStrictTlsChange,
  onSmtpHostChange,
  onSmtpPortChange,
  onUserChange,
  onPasswordChange,
  onSubmit,
  onCopyEnv,
}: ImapSmtpFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedEnv, setCopiedEnv] = useState(false);
  const activePreset = MAIL_PRESETS[provider];

  const resolvedPreview = serverDomain.trim() ? resolveServerHostFromDomain(serverDomain) : null;

  const handleCopy = async () => {
    await onCopyEnv();
    setCopiedEnv(true);
    window.setTimeout(() => setCopiedEnv(false), 1800);
  };

  return (
    <form
      onSubmit={onSubmit}
      className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-5"
    >
      {/* Pole Serwer / Domena znane z ekranu logowania Roundcube */}
      <div className="space-y-2 pb-4 border-b border-[#2B2E3B]">
        <label className="block space-y-1.5">
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#E6E8EF]">
            <Server className="w-3.5 h-3.5 text-[#8B5CF6]" />
            <span>Serwer / Domena (jak w Roundcube, np. trinitec.pl)</span>
          </span>
          <input
            type="text"
            value={serverDomain}
            onChange={(e) => onServerDomainChange(e.target.value)}
            placeholder="np. trinitec.pl, mail.trinitec.pl lub imap.gmail.com"
            className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#8B5CF6]/50 focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
          />
        </label>
        <p className="text-[11px] text-[#9499AD]">
          Wpisanie domeny serwera (np. <code className="font-mono text-[#E6E8EF]">trinitec.pl</code> lub{' '}
          <code className="font-mono text-[#E6E8EF]">ssl://trinitec.pl:993</code>) automatycznie wypełnia host IMAP i SMTP poniżej.
          {resolvedPreview && resolvedPreview.host && (
            <>
              {' '}
              Rozpoznany host: <code className="font-mono text-[#E6E8EF]">{resolvedPreview.host}</code>
            </>
          )}
        </p>
      </div>

      {/* IMAP */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-[#E6E8EF]">
          Parametry serwera odbiorczego (IMAP)
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Host IMAP</span>
            <input
              type="text"
              required
              value={imapHost}
              onChange={(e) => onImapHostChange(e.target.value)}
              placeholder="trinitec.pl, imap.roundcube.pl lub imap.gmail.com"
              className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Port IMAP</span>
            <input
              type="number"
              required
              min={1}
              max={65535}
              value={imapPort}
              onChange={(e) => onImapPortChange(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer">
            <input
              type="checkbox"
              checked={imapSecure}
              onChange={(e) => onImapSecureChange(e.target.checked)}
              className="accent-[#8B5CF6]"
            />
            <span>Bezpośredni SSL/TLS (port 993; odznacz dla STARTTLS 143)</span>
          </label>

          <label className="inline-flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer">
            <input
              type="checkbox"
              checked={strictTls}
              onChange={(e) => onStrictTlsChange(e.target.checked)}
              className="accent-[#8B5CF6]"
            />
            <span>Ścisła weryfikacja certyfikatu TLS (zalecane)</span>
          </label>
        </div>

        {!strictTls && (
          <div className="flex items-start gap-2 p-3 bg-[#141519] border border-[#D97706]/60 rounded text-xs text-[#E6E8EF]">
            <AlertTriangle className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
            <span>
              <strong>Ostrzeżenie bezpieczeństwa:</strong> wyłączenie weryfikacji certyfikatu TLS osłabia ochronę przed atakiem MITM. Używaj wyłącznie dla zaufanych serwerów z certyfikatem self-signed.
            </span>
          </div>
        )}
      </div>

      {/* SMTP */}
      <div className="border-t border-[#2B2E3B] pt-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#E6E8EF]">
          Parametry serwera wysyłkowego (SMTP — do odpowiedzi z Obsidiana)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Host SMTP</span>
            <input
              type="text"
              value={smtpHost}
              onChange={(e) => onSmtpHostChange(e.target.value)}
              placeholder="trinitec.pl, smtp.roundcube.pl lub smtp.gmail.com"
              className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Port SMTP</span>
            <input
              type="number"
              min={1}
              max={65535}
              value={smtpPort}
              onChange={(e) => onSmtpPortChange(e.target.value)}
              className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>
        </div>
      </div>

      {/* Poświadczenia */}
      <div className="border-t border-[#2B2E3B] pt-5 space-y-4">
        <h2 className="text-sm font-semibold text-[#E6E8EF]">Poświadczenia konta IMAP / SMTP</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">Login / adres e-mail</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={user}
              onChange={(e) => onUserChange(e.target.value)}
              placeholder={activePreset.userPlaceholder}
              className="w-full px-3 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-[#9499AD]">
              {activePreset.passwordLabel}
            </span>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => onPasswordChange(e.target.value)}
                placeholder={activePreset.passwordPlaceholder}
                className="w-full pl-3 pr-9 py-2 text-xs font-mono bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#6D7285] hover:text-[#E6E8EF] cursor-pointer"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </label>
        </div>

        <div className="flex items-start gap-2 text-xs text-[#9499AD]">
          <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
          <span>
            Hasło służy wyłącznie do jednorazowego testu połączenia — nie jest zapisywane w przeglądarce ani w logach. We wtyczce Obsidian Thunder Look trafia do lokalnego szyfrowanego magazynu (<code className="font-mono text-[#E6E8EF]">secretStorage / Electron safeStorage</code>) poza synchronizacją w chmurze.
          </span>
        </div>
      </div>

      <div className="border-t border-[#2B2E3B] pt-5 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded-md cursor-pointer"
        >
          {copiedEnv ? (
            <>
              <Check className="w-3.5 h-3.5 text-[#16A34A]" />
              <span>Skopiowano .env</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Kopiuj konfigurację .env</span>
            </>
          )}
        </button>

        <button
          type="submit"
          disabled={isTesting}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 rounded-md transition-colors cursor-pointer"
        >
          {isTesting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
              <span>Łączenie z serwerem...</span>
            </>
          ) : (
            <>
              <PlugZap className="w-4 h-4 shrink-0" />
              <span>Testuj połączenie IMAP</span>
            </>
          )}
        </button>
      </div>
    </form>
  );
}
