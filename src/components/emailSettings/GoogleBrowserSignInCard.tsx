import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, LogOut, MailCheck, ShieldCheck, AlertCircle } from 'lucide-react';
import {
  fetchGmailLiveDiagnostics,
  signInWithGoogleGmail,
  signOutGoogle,
  subscribeGoogleAuth,
  type GmailLiveDiagnostics,
  type GoogleSessionState,
} from '../../services/googleAuth';

interface GoogleBrowserSignInCardProps {
  onAccountLinked?: (email: string) => void;
  onNotify: (msg: string) => void;
}

function GoogleLogoSvg() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" className="shrink-0">
      <path
        fill="#4285F4"
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  );
}

export function GoogleBrowserSignInCard({ onAccountLinked, onNotify }: GoogleBrowserSignInCardProps) {
  const [session, setSession] = useState<GoogleSessionState>({
    signedIn: false,
    email: null,
    displayName: null,
    photoURL: null,
    hasGmailToken: false,
  });
  const [signingIn, setSigningIn] = useState(false);
  const [checkingGmail, setCheckingGmail] = useState(false);
  const [gmailDiag, setGmailDiag] = useState<GmailLiveDiagnostics | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeGoogleAuth((next) => {
      setSession(next);
      if (!next.signedIn) {
        setGmailDiag(null);
      }
    });
    return unsubscribe;
  }, []);

  const handleGoogleSignIn = async () => {
    if (signingIn) return;
    setSigningIn(true);
    setAuthError(null);
    try {
      const next = await signInWithGoogleGmail();
      setSession(next);
      if (next.email) {
        onAccountLinked?.(next.email);
      }
      onNotify(`Zalogowano przez Google jako ${next.email || 'użytkownik Google'}.`);

      if (next.hasGmailToken) {
        setCheckingGmail(true);
        const diag = await fetchGmailLiveDiagnostics();
        setGmailDiag(diag);
        setCheckingGmail(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Nie udało się zalogować przez Google.';
      setAuthError(msg);
      onNotify(`Błąd logowania Google: ${msg}`);
    } finally {
      setSigningIn(false);
    }
  };

  const handleCheckGmail = async () => {
    if (checkingGmail) return;
    setCheckingGmail(true);
    setAuthError(null);
    try {
      const diag = await fetchGmailLiveDiagnostics();
      setGmailDiag(diag);
      if (diag.ok) {
        onNotify(`Zweryfikowano skrzynkę Gmail (${diag.emailAddress}, ${diag.latencyMs} ms).`);
      } else if (diag.error) {
        setAuthError(diag.error);
      }
    } finally {
      setCheckingGmail(false);
    }
  };

  const handleSignOut = async () => {
    await signOutGoogle();
    setGmailDiag(null);
    setAuthError(null);
    onNotify('Wylogowano z konta Google i wyczyszczono token z pamięci.');
  };

  return (
    <div className="bg-[#1E2028] border border-[#2B2E3B] rounded-md p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-semibold text-[#E6E8EF]">
            Logowanie do Google przez przeglądarkę (OAuth 2.0)
          </h2>
          <p className="text-xs text-[#9499AD] max-w-2xl">
            Autoryzuj dostęp do Gmaila bezpiecznym oknem logowania Google (<code className="font-mono text-[#E6E8EF]">gmail.readonly</code>). Token sesji pozostaje wyłącznie w pamięci przeglądarki (nigdy w <code className="font-mono text-[#E6E8EF]">localStorage</code>).
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {!session.signedIn ? (
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={signingIn}
              className="inline-flex items-center gap-3 px-4 py-2 text-sm font-medium bg-white hover:bg-[#F8FAFC] text-[#1F1F1F] border border-[#747775] rounded-md shadow-xs transition-colors cursor-pointer disabled:opacity-60"
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin text-[#4285F4]" />
              ) : (
                <GoogleLogoSvg />
              )}
              <span>{signingIn ? 'Otwieranie okna Google...' : 'Zaloguj się przez Google'}</span>
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void (session.hasGmailToken ? handleCheckGmail() : handleGoogleSignIn())}
                disabled={checkingGmail || signingIn}
                className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-white bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 rounded-md cursor-pointer"
              >
                {checkingGmail ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <MailCheck className="w-3.5 h-3.5" />
                )}
                <span>
                  {session.hasGmailToken ? 'Sprawdź skrzynkę Gmail' : 'Odśwież zgodę Gmail'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#E6E8EF] bg-[#232631] hover:bg-[#2B2F3D] border border-[#393D4F] rounded-md cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Wyloguj</span>
              </button>
            </>
          )}
        </div>
      </div>

      {session.signedIn && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-[#141519] border border-[#2B2E3B] rounded text-xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
            <span className="text-[#E6E8EF] font-medium truncate">
              {session.displayName ? `${session.displayName} · ` : ''}
              <span className="font-mono">{session.email}</span>
            </span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[#9499AD]">
            <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A]" />
            <span>{session.hasGmailToken ? 'Aktywny token w pamięci RAM' : 'Wymaga ponownej autoryzacji po odświeżeniu'}</span>
          </span>
        </div>
      )}

      {authError && (
        <div className="flex items-start gap-2.5 px-3.5 py-2.5 bg-[#141519] border border-[#DC2626]/60 rounded text-xs text-[#E6E8EF]">
          <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0 mt-0.5" />
          <span>{authError}</span>
        </div>
      )}

      {gmailDiag && gmailDiag.ok && (
        <div className="border-t border-[#2B2E3B] pt-4 space-y-3 text-xs">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <dt className="text-[#9499AD]">Konto Gmail</dt>
              <dd className="font-mono text-[#E6E8EF] mt-0.5 truncate">{gmailDiag.emailAddress}</dd>
            </div>
            <div>
              <dt className="text-[#9499AD]">Wiadomości / Wątki</dt>
              <dd className="font-mono text-[#E6E8EF] mt-0.5 tabular-nums">
                {gmailDiag.messagesTotal.toLocaleString('pl-PL')} / {gmailDiag.threadsTotal.toLocaleString('pl-PL')}
              </dd>
            </div>
            <div>
              <dt className="text-[#9499AD]">Etykiety Gmail</dt>
              <dd className="font-mono text-[#E6E8EF] mt-0.5 tabular-nums">
                {gmailDiag.labelCount} ({gmailDiag.sentLabelDetected || 'SENT'})
              </dd>
            </div>
            <div>
              <dt className="text-[#9499AD]">Opóźnienie API</dt>
              <dd className="font-mono text-[#16A34A] mt-0.5 tabular-nums">{gmailDiag.latencyMs} ms</dd>
            </div>
          </dl>

          {gmailDiag.recentMessages.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[#9499AD]">Ostatnie wiadomości w INBOX (podgląd read-only):</div>
              <div className="bg-[#141519] border border-[#2B2E3B] rounded divide-y divide-[#2B2E3B]">
                {gmailDiag.recentMessages.map((msg) => (
                  <div key={msg.id} className="px-3 py-2 flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-[#E6E8EF] font-medium truncate">{msg.subject}</div>
                      <div className="text-[#6D7285] font-mono text-[11px] truncate">{msg.from}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
