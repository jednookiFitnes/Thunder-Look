import { FormEvent, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  PlugZap,
  ShieldCheck,
} from 'lucide-react';
import { MailProviderPreset } from '../types/generator';
import { formatBytes } from '../utils/parserSimulator';

interface EmailSettingsViewProps {
  onNotify: (msg: string) => void;
}

interface ImapTestApiResult {
  ok: boolean;
  providerDetected: 'gmail' | 'roundcube' | 'imap';
  latencyMs: number;
  host: string;
  port: number;
  secure: boolean;
  tlsProtocol: string | null;
  greeting: string | null;
  capabilities: string[];
  folderCount: number;
  inboxMessages: number | null;
  inboxUnseen: number | null;
  sentFolderDetected: string | null;
  quotaUsedBytes: number | null;
  quotaLimitBytes: number | null;
  error?: string;
  hint?: string;
}

interface PresetConfig {
  id: MailProviderPreset;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  userPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  note: string;
}

const PRESETS: Record<MailProviderPreset, PresetConfig> = {
  roundcube: {
    id: 'roundcube',
    label: 'Roundcube.pl (SSL 993)',
    imapHost: 'imap.roundcube.pl',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.roundcube.pl',
    smtpPort: 465,
    smtpSecure: true,
    userPlaceholder: 'imie.nazwisko@twojadomena.pl',
    passwordLabel: 'Hasło skrzynki IMAP',
    passwordPlaceholder: 'Hasło do skrzynki pocztowej',
    note: 'Domyślny profil dla serwerów kompatybilnych z Roundcube.pl (IMAP SSL/TLS 993, SMTP 465). Wtyczka używa nieinwazyjnego trybu EXAMINE / BODY.PEEK[] oraz automatycznie zapisuje wysłane maile w folderze Sent.',
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail (Hasło aplikacji)',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    userPlaceholder: 'twoj.adres@gmail.com',
    passwordLabel: 'Hasło aplikacji Google (16 znaków)',
    passwordPlaceholder: 'xxxx xxxx xxxx xxxx',
    note: 'Obsługa Gmail bez kluczy API ani konfiguracji OAuth: włącz weryfikację dwuetapową na koncie Google i wygeneruj 16-znakowe Hasło aplikacji (Konto Google → Bezpieczeństwo → Hasła aplikacji). Spacje są usuwane automatycznie, a wtyczka rozpoznaje polskie i angielskie foldery ([Gmail]/Wysłane) bez dublowania wysłanych wiadomości.',
  },
  custom: {
    id: 'custom',
    label: 'Własny serwer IMAP',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    userPlaceholder: 'uzytkownik@domena.pl',
    passwordLabel: 'Hasło skrzynki IMAP',
    passwordPlaceholder: 'Hasło konta pocztowego',
    note: 'Dowolny serwer IMAP zgodny z RFC 3501 (Dovecot, Cyrus, Roundcube na własnym hostingu, Home.pl, OVH, nazwa.pl). Obsługuje bezpośredni SSL/TLS (993) oraz STARTTLS (143).',
  },
};

export function EmailSettingsView({ onNotify }: EmailSettingsViewProps) {
  const [provider, setProvider] = useState<MailProviderPreset>('roundcube');
  const [imapHost, setImapHost] = useState(PRESETS.roundcube.imapHost);
  const [imapPort, setImapPort] = useState(String(PRESETS.roundcube.imapPort));
  const [imapSecure, setImapSecure] = useState(PRESETS.roundcube.imapSecure);
  const [strictTls, setStrictTls] = useState(true);

  const [smtpHost, setSmtpHost] = useState(PRESETS.roundcube.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(PRESETS.roundcube.smtpPort));
  const [smtpSecure, setSmtpSecure] = useState(PRESETS.roundcube.smtpSecure);

  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<ImapTestApiResult | null>(null);
  const [copiedEnv, setCopiedEnv] = useState(false);

  const activePreset = PRESETS[provider];

  const handleSelectProvider = (next: MailProviderPreset) => {
    const spec = PRESETS[next];
    setProvider(next);
    if (next !== 'custom') {
      setImapHost(spec.imapHost);
      setImapPort(String(spec.imapPort));
      setImapSecure(spec.imapSecure);
      setSmtpHost(spec.smtpHost);
      setSmtpPort(String(spec.smtpPort));
      setSmtpSecure(spec.smtpSecure);
    }
    setResult(null);
  };

  const handleToggleImapSecure = (checked: boolean) => {
    setImapSecure(checked);
    if (checked && imapPort === '143') setImapPort('993');
    if (!checked && imapPort === '993') setImapPort('143');
  };

  const handleTestConnection = async (e: FormEvent) => {
    e.preventDefault();
    if (isTesting) return;

    setIsTesting(true);
    setResult(null);
    try {
      const res = await fetch('/api/imap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: imapHost.trim(),
          port: Number(imapPort) || 993,
          secure: imapSecure,
          strictTls,
          user: user.trim(),
          password: provider === 'gmail' ? password.replace(/\s+/g, '') : password,
        }),
      });
      const data = (await res.json()) as ImapTestApiResult;
      setResult(data);
      if (data.ok) {
        onNotify(`Połączenie zweryfikowane (${data.host}:${data.port}, ${data.latencyMs} ms).`);
      } else {
        onNotify(`Test połączenia nie powiódł się: ${data.error || 'błąd'}`);
      }
    } catch (err) {
      setResult({
        ok: false,
        providerDetected: provider === 'gmail' ? 'gmail' : provider === 'roundcube' ? 'roundcube' : 'imap',
        latencyMs: 0,
        host: imapHost.trim(),
        port: Number(imapPort) || 993,
        secure: imapSecure,
        tlsProtocol: null,
        greeting: null,
        capabilities: [],
        folderCount: 0,
        inboxMessages: null,
        inboxUnseen: null,
        sentFolderDetected: null,
        quotaUsedBytes: null,
        quotaLimitBytes: null,
        error: err instanceof Error ? err.message : 'Błąd komunikacji z backendem testującym.',
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopyEnvSnippet = async () => {
    const snippet = [
      `IMAP_HOST="${imapHost.trim() || 'imap.roundcube.pl'}"`,
      `IMAP_PORT="${Number(imapPort) || 993}"`,
      `IMAP_SECURE="${imapSecure ? 'true' : 'false'}"`,
      `SMTP_HOST="${smtpHost.trim() || 'smtp.roundcube.pl'}"`,
      `SMTP_PORT="${Number(smtpPort) || 465}"`,
      `SMTP_SECURE="${smtpSecure ? 'true' : 'false'}"`,
      `MAIL_USER="${user.trim() || 'twoj.adres@domena.pl'}"`,
      `MAIL_PASSWORD=""`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedEnv(true);
      onNotify('Skopiowano bezpieczny blok .env (bez hasła).');
      setTimeout(() => setCopiedEnv(false), 1800);
    } catch {
      onNotify('Nie udało się skopiować do schowka.');
    }
  };

  const quotaPercent =
    result?.quotaLimitBytes && result.quotaUsedBytes !== null && result.quotaLimitBytes > 0
      ? Math.min(100, Math.round((result.quotaUsedBytes / result.quotaLimitBytes) * 1000) / 10)
      : null;

  const highlightedCapabilities = result
    ? ['IDLE', 'QUOTA', 'MOVE', 'UIDPLUS', 'CONDSTORE', 'SPECIAL-USE', 'X-GM-EXT-1'].filter((cap) =>
        result.capabilities.includes(cap)
      )
    : [];

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
      {/* Nagłówek */}
      <div className="border-b border-[#2B2E3B] pb-5 space-y-1.5">
        <h1 className="text-2xl font-semibold text-[#E6E8EF]">
          Ustawienia poczty (Email Settings) i test połączenia IMAP
        </h1>
        <p className="text-sm text-[#9499AD] max-w-3xl">
          Identyczny komponent ustawień (Roundcube.pl, Gmail z Hasłem aplikacji oraz własny serwer IMAP) został wbudowany bezpośrednio we wtyczce Obsidian. Tutaj możesz od razu zweryfikować parametry serwera na żywo.
        </p>
      </div>

      {/* Presety dostawcy */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#141519] border border-[#2B2E3B] rounded-md w-fit">
          {(['roundcube', 'gmail', 'custom'] as MailProviderPreset[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => handleSelectProvider(id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                provider === id
                  ? 'bg-[#232631] text-[#E6E8EF]'
                  : 'text-[#9499AD] hover:text-[#E6E8EF]'
              }`}
            >
              {PRESETS[id].label}
            </button>
          ))}
        </div>

        <div className="px-4 py-3 bg-[#1E2028] border border-[#2B2E3B] rounded-md text-xs text-[#9499AD] leading-relaxed">
          {activePreset.note}
        </div>
      </div>

      {/* Układ 2-kolumnowy: Formularz ustawień | Wynik testu połączenia */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
        <form
          onSubmit={handleTestConnection}
          className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-5"
        >
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
                  onChange={(e) => {
                    const next = e.target.value;
                    setImapHost(next);
                    if (next.toLowerCase().includes('gmail.com')) setProvider('gmail');
                  }}
                  placeholder="imap.roundcube.pl lub imap.gmail.com"
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
                  onChange={(e) => {
                    setImapPort(e.target.value);
                    if (e.target.value === '993') setImapSecure(true);
                    if (e.target.value === '143') setImapSecure(false);
                  }}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={imapSecure}
                  onChange={(e) => handleToggleImapSecure(e.target.checked)}
                  className="accent-[#8B5CF6]"
                />
                <span>Bezpośredni SSL/TLS (port 993; odznacz dla STARTTLS 143)</span>
              </label>

              <label className="inline-flex items-center gap-2 text-xs text-[#E6E8EF] cursor-pointer">
                <input
                  type="checkbox"
                  checked={strictTls}
                  onChange={(e) => setStrictTls(e.target.checked)}
                  className="accent-[#8B5CF6]"
                />
                <span>Ścisła weryfikacja certyfikatu TLS</span>
              </label>
            </div>
          </div>

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
                  onChange={(e) => setSmtpHost(e.target.value)}
                  placeholder="smtp.roundcube.pl lub smtp.gmail.com"
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
                  onChange={(e) => {
                    setSmtpPort(e.target.value);
                    setSmtpSecure(e.target.value === '465');
                  }}
                  className="w-full px-3 py-2 text-xs font-mono tabular-nums bg-[#141519] border border-[#2B2E3B] focus:border-[#8B5CF6] rounded-md text-[#E6E8EF] focus:outline-none"
                />
              </label>
            </div>
          </div>

          <div className="border-t border-[#2B2E3B] pt-5 space-y-4">
            <h2 className="text-sm font-semibold text-[#E6E8EF]">Poświadczenia konta</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[#9499AD]">Login / adres e-mail</span>
                <input
                  type="email"
                  required
                  autoComplete="username"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
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
                    onChange={(e) => setPassword(e.target.value)}
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
                Hasło służy wyłącznie do jednorazowego testu połączenia — nie jest zapisywane w przeglądarce ani w logach. W samej wtyczce Obsidian trafia wyłącznie do lokalnego magazynu <code className="font-mono text-[#E6E8EF]">app.secretStorage</code> poza OneDrive.
              </span>
            </div>
          </div>

          <div className="border-t border-[#2B2E3B] pt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleCopyEnvSnippet}
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

        {/* Prawa kolumna: Wynik diagnostyki połączenia */}
        <div className="space-y-4">
          {!result && !isTesting && (
            <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-4">
              <h2 className="text-sm font-semibold text-[#E6E8EF]">
                Co sprawdza test połączenia?
              </h2>
              <ul className="space-y-2.5 text-xs text-[#9499AD] leading-relaxed">
                <li>1. Rozwiązanie DNS oraz szyfrowany handshake TLS / STARTTLS.</li>
                <li>2. Poprawność poświadczeń IMAP (LOGIN) wobec serwera Roundcube.pl, Gmail lub własnego hostingu.</li>
                <li>3. Obsługiwane rozszerzenia serwera: <code className="font-mono text-[#E6E8EF]">IDLE</code> (push), <code className="font-mono text-[#E6E8EF]">QUOTA</code> (rozmiar skrzynki), <code className="font-mono text-[#E6E8EF]">MOVE</code> oraz <code className="font-mono text-[#E6E8EF]">X-GM-EXT-1</code>.</li>
                <li>4. Nieinwazyjny odczyt liczby folderów, wykrycie folderu <code className="font-mono text-[#E6E8EF]">\Sent</code> (np. <code className="font-mono text-[#E6E8EF]">Sent</code>, <code className="font-mono text-[#E6E8EF]">INBOX.Sent</code> lub <code className="font-mono text-[#E6E8EF]">[Gmail]/Wysłane</code>) oraz statusu <code className="font-mono text-[#E6E8EF]">INBOX</code> bez oznaczania maili jako przeczytanych.</li>
              </ul>
            </div>
          )}

          {isTesting && (
            <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 flex items-center gap-3 text-sm text-[#9499AD]">
              <Loader2 className="w-5 h-5 text-[#8B5CF6] animate-spin shrink-0" />
              <div>
                <div className="font-medium text-[#E6E8EF]">
                  Weryfikacja połączenia z {imapHost}:{imapPort}
                </div>
                <div className="text-xs mt-0.5">
                  Handshake {imapSecure ? 'SSL/TLS' : 'STARTTLS'} → CAPABILITY → LOGIN → LIST / STATUS...
                </div>
              </div>
            </div>
          )}

          {result && (
            <div
              className={`bg-[#1E2028] border rounded-md p-6 space-y-4 ${
                result.ok ? 'border-[#16A34A]/70' : 'border-[#DC2626]/70'
              }`}
            >
              <div className="flex items-start gap-3">
                {result.ok ? (
                  <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
                )}
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-[#E6E8EF]">
                    {result.ok
                      ? `Połączenie zweryfikowane (${
                          result.providerDetected === 'gmail'
                            ? 'Gmail IMAP'
                            : result.providerDetected === 'roundcube'
                            ? 'Roundcube IMAP'
                            : 'Serwer IMAP'
                        })`
                      : 'Połączenie nie powiodło się'}
                  </h2>
                  <p className="text-xs font-mono text-[#9499AD] tabular-nums mt-0.5">
                    {result.host}:{result.port} · {result.latencyMs} ms
                    {result.tlsProtocol ? ` · ${result.tlsProtocol}` : ''}
                  </p>
                </div>
              </div>

              {result.ok ? (
                <>
                  <dl className="grid grid-cols-2 gap-3 pt-2 border-t border-[#2B2E3B] text-xs">
                    <div>
                      <dt className="text-[#9499AD]">Foldery IMAP</dt>
                      <dd className="font-mono text-[#E6E8EF] font-medium mt-0.5 tabular-nums">
                        {result.folderCount}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-[#9499AD]">Wiadomości w INBOX</dt>
                      <dd className="font-mono text-[#E6E8EF] font-medium mt-0.5 tabular-nums">
                        {result.inboxMessages !== null
                          ? `${result.inboxMessages} (${result.inboxUnseen ?? 0} nieprzecz.)`
                          : '—'}
                      </dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="text-[#9499AD]">Wykryty folder Wysłane (\Sent)</dt>
                      <dd className="font-mono text-[#E6E8EF] mt-0.5">
                        {result.sentFolderDetected || 'Domyślny (Sent)'}
                        {result.providerDetected === 'gmail'
                          ? ' · auto-zapis przez Gmail SMTP'
                          : ' · obsługuje IMAP APPEND'}
                      </dd>
                    </div>
                  </dl>

                  {quotaPercent !== null && result.quotaUsedBytes !== null && result.quotaLimitBytes && (
                    <div className="pt-2 border-t border-[#2B2E3B] space-y-2 text-xs">
                      <div className="flex items-center justify-between font-mono tabular-nums">
                        <span className="text-[#9499AD] font-sans">Zajętość skrzynki (QUOTA)</span>
                        <span className="text-[#E6E8EF]">
                          {formatBytes(result.quotaUsedBytes)} / {formatBytes(result.quotaLimitBytes)} ({quotaPercent}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-[#141519] rounded-full overflow-hidden">
                        <div
                          className={`h-full ${
                            quotaPercent >= 90
                              ? 'bg-[#DC2626]'
                              : quotaPercent >= 80
                              ? 'bg-[#D97706]'
                              : 'bg-[#8B5CF6]'
                          }`}
                          style={{ width: `${quotaPercent}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {highlightedCapabilities.length > 0 && (
                    <div className="pt-2 border-t border-[#2B2E3B] space-y-1 text-xs">
                      <div className="text-[#9499AD]">Kluczowe rozszerzenia serwera:</div>
                      <div className="font-mono text-[#E6E8EF]">
                        {highlightedCapabilities.join(' · ')}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="pt-2 border-t border-[#2B2E3B] space-y-2.5 text-xs">
                  {result.error && (
                    <div className="font-mono text-[#DC2626] bg-[#141519] border border-[#2B2E3B] rounded p-3 break-words">
                      {result.error}
                    </div>
                  )}
                  {result.hint && (
                    <div className="text-[#E6E8EF] leading-relaxed">
                      <strong className="text-[#D97706]">Wskazówka:</strong> {result.hint}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Instrukcja skrócona dla Gmaila */}
          {provider === 'gmail' && (
            <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5 space-y-2.5 text-xs">
              <h3 className="text-sm font-semibold text-[#E6E8EF]">
                Szybka konfiguracja Gmail (Hasło aplikacji)
              </h3>
              <ol className="list-decimal list-inside space-y-1.5 text-[#9499AD] leading-relaxed">
                <li>
                  Włącz <strong className="text-[#E6E8EF]">Weryfikację dwuetapową</strong> na swoim koncie Google.
                </li>
                <li>
                  Przejdź do <strong className="text-[#E6E8EF]">Konto Google → Bezpieczeństwo → Hasła aplikacji</strong> i utwórz hasło np. o nazwie <code className="font-mono text-[#E6E8EF]">Obsidian Trinitec</code>.
                </li>
                <li>
                  Wklej wygenerowany 16-znakowy kod w polu hasła (we wtyczce Obsidian oraz opcjonalnie w <code className="font-mono text-[#E6E8EF]">mcp-cli/.env</code>).
                </li>
                <li>
                  W Gmailu sprawdź <strong className="text-[#E6E8EF]">Ustawienia → Przekazywanie i POP/IMAP → Włącz IMAP</strong>.
                </li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
