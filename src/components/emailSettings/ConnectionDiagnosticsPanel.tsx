import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { MailProviderPreset } from '../../types/generator';
import { formatBytes } from '../../utils/parserSimulator';
import { type ImapTestApiResult } from './presets';

interface ConnectionDiagnosticsPanelProps {
  provider: MailProviderPreset;
  imapHost: string;
  imapPort: string;
  imapSecure: boolean;
  isTesting: boolean;
  result: ImapTestApiResult | null;
}

export function ConnectionDiagnosticsPanel({
  provider,
  imapHost,
  imapPort,
  imapSecure,
  isTesting,
  result,
}: ConnectionDiagnosticsPanelProps) {
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
    <div className="space-y-4">
      {!result && !isTesting && (
        <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-6 space-y-4">
          <h2 className="text-sm font-semibold text-[#E6E8EF]">
            Co sprawdza diagnostyka połączenia IMAP?
          </h2>
          <ul className="space-y-2.5 text-xs text-[#9499AD] leading-relaxed">
            <li>1. Rozwiązanie DNS, weryfikacja SSRF i szyfrowany handshake TLS / STARTTLS (porty 993 / 143).</li>
            <li>2. Uwierzytelnienie IMAP wobec serwera Roundcube (np. <code className="font-mono text-[#E6E8EF]">trinitec.pl</code>), Gmaila, Outlooka lub własnego hostingu.</li>
            <li>
              3. Obsługiwane rozszerzenia serwera: <code className="font-mono text-[#E6E8EF]">IDLE</code>,{' '}
              <code className="font-mono text-[#E6E8EF]">QUOTA</code>,{' '}
              <code className="font-mono text-[#E6E8EF]">MOVE</code>,{' '}
              <code className="font-mono text-[#E6E8EF]">X-GM-EXT-1</code>.
            </li>
            <li>
              4. Nieinwazyjny odczyt liczby folderów, wykrycie folderu <code className="font-mono text-[#E6E8EF]">\Sent</code> oraz statusu <code className="font-mono text-[#E6E8EF]">INBOX</code> bez zmiany flagi nieprzeczytanych.
            </li>
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
                        : result.providerDetected === 'outlook'
                        ? 'Outlook / M365 IMAP'
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

      {provider === 'gmail' && (
        <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5 space-y-2.5 text-xs">
          <h3 className="text-sm font-semibold text-[#E6E8EF]">
            Gmail w Thunder Look — dwie metody logowania
          </h3>
          <ol className="list-decimal list-inside space-y-1.5 text-[#9499AD] leading-relaxed">
            <li>
              <strong className="text-[#E6E8EF]">Logowanie przez przeglądarkę Google (OAuth 2.0):</strong> kliknij przycisk Google powyżej (w portalu) lub użyj przycisku <em>Zaloguj przez Google (przeglądarka)</em> w ustawieniach wtyczki Obsidian (OAuth2 PKCE + XOAUTH2).
            </li>
            <li>
              <strong className="text-[#E6E8EF]">Hasło aplikacji Google (IMAP/SMTP):</strong> włącz Weryfikację dwuetapową, wejdź w <em>Konto Google → Bezpieczeństwo → Hasła aplikacji</em>, utwórz hasło <code className="font-mono text-[#E6E8EF]">Thunder Look</code> i wklej 16-znakowy kod.
            </li>
            <li>
              Sprawdź w Gmailu: <strong className="text-[#E6E8EF]">Ustawienia → Przekazywanie i POP/IMAP → Włącz IMAP</strong>.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
