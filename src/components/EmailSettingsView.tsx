import { FormEvent, useState } from 'react';
import { MailProviderPreset } from '../types/generator';
import { apiFetch } from '../utils/apiClient';
import { resolveServerHostFromDomain } from '../../shared/networkSecurity';
import { MAIL_PRESETS, type ImapTestApiResult } from './emailSettings/presets';
import { ProviderPresetsBar } from './emailSettings/ProviderPresetsBar';
import { GoogleBrowserSignInCard } from './emailSettings/GoogleBrowserSignInCard';
import { ImapSmtpForm } from './emailSettings/ImapSmtpForm';
import { ConnectionDiagnosticsPanel } from './emailSettings/ConnectionDiagnosticsPanel';

interface EmailSettingsViewProps {
  onNotify: (msg: string) => void;
}

export function EmailSettingsView({ onNotify }: EmailSettingsViewProps) {
  const [provider, setProvider] = useState<MailProviderPreset>('roundcube');
  const [serverDomain, setServerDomain] = useState(MAIL_PRESETS.roundcube.serverDomain);
  const [imapHost, setImapHost] = useState(MAIL_PRESETS.roundcube.imapHost);
  const [imapPort, setImapPort] = useState(String(MAIL_PRESETS.roundcube.imapPort));
  const [imapSecure, setImapSecure] = useState(MAIL_PRESETS.roundcube.imapSecure);
  const [strictTls, setStrictTls] = useState(true);

  const [smtpHost, setSmtpHost] = useState(MAIL_PRESETS.roundcube.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(MAIL_PRESETS.roundcube.smtpPort));
  const [smtpSecure, setSmtpSecure] = useState(MAIL_PRESETS.roundcube.smtpSecure);

  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');

  const [isTesting, setIsTesting] = useState(false);
  const [result, setResult] = useState<ImapTestApiResult | null>(null);

  const handleSelectProvider = (next: MailProviderPreset) => {
    const spec = MAIL_PRESETS[next];
    setProvider(next);
    if (next !== 'custom') {
      setServerDomain(spec.serverDomain);
      setImapHost(spec.imapHost);
      setImapPort(String(spec.imapPort));
      setImapSecure(spec.imapSecure);
      setSmtpHost(spec.smtpHost);
      setSmtpPort(String(spec.smtpPort));
      setSmtpSecure(spec.smtpSecure);
    }
    setResult(null);
  };

  const handleServerDomainChange = (raw: string) => {
    setServerDomain(raw);
    const parsed = resolveServerHostFromDomain(raw);
    if (parsed.host) {
      setImapHost(parsed.host);
      setSmtpHost(parsed.host);
      if (parsed.host.includes('gmail.com')) setProvider('gmail');
      else if (parsed.host.includes('office365.com') || parsed.host.includes('outlook.com')) {
        setProvider('outlook');
      }
    }
    if (parsed.detectedPort) {
      setImapPort(String(parsed.detectedPort));
    }
    if (parsed.detectedSecure !== null) {
      setImapSecure(parsed.detectedSecure);
    }
  };

  const handleImapHostChange = (next: string) => {
    setImapHost(next);
    if (next.toLowerCase().includes('gmail.com')) setProvider('gmail');
  };

  const handleImapPortChange = (next: string) => {
    setImapPort(next);
    if (next === '993') setImapSecure(true);
    if (next === '143') setImapSecure(false);
  };

  const handleImapSecureChange = (checked: boolean) => {
    setImapSecure(checked);
    if (checked && imapPort === '143') setImapPort('993');
    if (!checked && imapPort === '993') setImapPort('143');
  };

  const handleSmtpPortChange = (next: string) => {
    setSmtpPort(next);
    setSmtpSecure(next === '465');
  };

  const handleTestConnection = async (e: FormEvent) => {
    e.preventDefault();
    if (isTesting) return;

    setIsTesting(true);
    setResult(null);
    try {
      const res = await apiFetch('/api/imap/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverDomain: serverDomain.trim(),
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
        providerDetected:
          provider === 'gmail'
            ? 'gmail'
            : provider === 'outlook'
            ? 'outlook'
            : provider === 'roundcube'
            ? 'roundcube'
            : 'imap',
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
      `MAIL_SERVER="${serverDomain.trim() || imapHost.trim() || 'trinitec.pl'}"`,
      `IMAP_HOST="${imapHost.trim() || 'trinitec.pl'}"`,
      `IMAP_PORT="${Number(imapPort) || 993}"`,
      `IMAP_SECURE="${imapSecure ? 'true' : 'false'}"`,
      `IMAP_STRICT_TLS="${strictTls ? 'true' : 'false'}"`,
      `SMTP_HOST="${smtpHost.trim() || 'trinitec.pl'}"`,
      `SMTP_PORT="${Number(smtpPort) || 465}"`,
      `SMTP_SECURE="${smtpSecure ? 'true' : 'false'}"`,
      `MAIL_USER="${user.trim() || 'twoj.adres@domena.pl'}"`,
      `MAIL_PASSWORD=""`,
    ].join('\n');

    try {
      await navigator.clipboard.writeText(snippet);
      onNotify('Skopiowano bezpieczny blok .env (bez hasła).');
    } catch {
      onNotify('Nie udało się skopiować do schowka.');
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-8 py-8 space-y-6">
      <div className="border-b border-[#2B2E3B] pb-5 space-y-1.5">
        <h1 className="text-2xl font-semibold text-[#E6E8EF]">
          Ustawienia poczty (Thunder Look) — Roundcube, Google OAuth2 i diagnostyka IMAP
        </h1>
        <p className="text-sm text-[#9499AD] max-w-3xl">
          Skonfiguruj serwer pocztowy (np. domenę Roundcube <code className="font-mono text-[#E6E8EF]">trinitec.pl</code>), zaloguj się przez przeglądarkę Google albo zweryfikuj parametry IMAP/SMTP na żywo.
        </p>
      </div>

      {/* Logowanie przez przeglądarkę Google (OAuth 2.0) */}
      <GoogleBrowserSignInCard
        onAccountLinked={(email) => {
          setUser(email);
          handleSelectProvider('gmail');
        }}
        onNotify={onNotify}
      />

      {/* Presety dostawców */}
      <ProviderPresetsBar provider={provider} onSelectProvider={handleSelectProvider} />

      {/* Układ 2-kolumnowy: Formularz | Wynik diagnostyki */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6 items-start">
        <ImapSmtpForm
          provider={provider}
          serverDomain={serverDomain}
          imapHost={imapHost}
          imapPort={imapPort}
          imapSecure={imapSecure}
          strictTls={strictTls}
          smtpHost={smtpHost}
          smtpPort={smtpPort}
          smtpSecure={smtpSecure}
          user={user}
          password={password}
          isTesting={isTesting}
          onServerDomainChange={handleServerDomainChange}
          onImapHostChange={handleImapHostChange}
          onImapPortChange={handleImapPortChange}
          onImapSecureChange={handleImapSecureChange}
          onStrictTlsChange={setStrictTls}
          onSmtpHostChange={setSmtpHost}
          onSmtpPortChange={handleSmtpPortChange}
          onUserChange={setUser}
          onPasswordChange={setPassword}
          onSubmit={handleTestConnection}
          onCopyEnv={handleCopyEnvSnippet}
        />

        <ConnectionDiagnosticsPanel
          provider={provider}
          imapHost={imapHost}
          imapPort={imapPort}
          imapSecure={imapSecure}
          isTesting={isTesting}
          result={result}
        />
      </div>
    </div>
  );
}
