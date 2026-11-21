import { initializeApp, getApps, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

// Token dostępu Google OAuth2 przechowywany WYŁĄCZNIE w pamięci operacyjnej (nigdy w localStorage/sessionStorage)
let inMemoryGmailAccessToken: string | null = null;

// Opcjonalne ładowanie lokalnego pliku firebase-applet-config.json (ignorowanego przez Git)
// z bezpiecznym fallbackiem na zmienne środowiskowe VITE_FIREBASE_*.
const localFirebaseConfigModules = import.meta.glob<Record<string, unknown>>(
  '../../firebase-applet-config.json',
  { eager: true, import: 'default' }
);

function resolveFirebaseConfig(): FirebaseOptions | null {
  const fromFile = Object.values(localFirebaseConfigModules)[0];
  if (fromFile && typeof fromFile.apiKey === 'string' && fromFile.apiKey.trim()) {
    return {
      apiKey: String(fromFile.apiKey),
      authDomain: typeof fromFile.authDomain === 'string' ? fromFile.authDomain : undefined,
      projectId: typeof fromFile.projectId === 'string' ? fromFile.projectId : undefined,
      storageBucket: typeof fromFile.storageBucket === 'string' ? fromFile.storageBucket : undefined,
      messagingSenderId:
        typeof fromFile.messagingSenderId === 'string' ? fromFile.messagingSenderId : undefined,
      appId: typeof fromFile.appId === 'string' ? fromFile.appId : undefined,
    };
  }

  const envApiKey = (import.meta.env.VITE_FIREBASE_API_KEY as string | undefined)?.trim();
  if (envApiKey) {
    return {
      apiKey: envApiKey,
      authDomain: (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined)?.trim() || undefined,
      projectId: (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim() || undefined,
      storageBucket:
        (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined)?.trim() || undefined,
      messagingSenderId:
        (import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined)?.trim() || undefined,
      appId: (import.meta.env.VITE_FIREBASE_APP_ID as string | undefined)?.trim() || undefined,
    };
  }

  return null;
}

export function isGoogleAuthConfigured(): boolean {
  return resolveFirebaseConfig() !== null;
}

function getFirebaseAuth(): Auth | null {
  const config = resolveFirebaseConfig();
  if (!config) {
    return null;
  }
  if (!firebaseApp) {
    const existing = getApps();
    firebaseApp = existing.length > 0 ? existing[0] : initializeApp(config);
  }
  if (!firebaseAuth) {
    firebaseAuth = getAuth(firebaseApp);
  }
  return firebaseAuth;
}

export interface GoogleSessionState {
  signedIn: boolean;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  hasGmailToken: boolean;
}

export interface GmailDiagnosticMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
}

export interface GmailLiveDiagnostics {
  ok: boolean;
  emailAddress: string | null;
  messagesTotal: number;
  threadsTotal: number;
  labelCount: number;
  sentLabelDetected: string | null;
  recentMessages: GmailDiagnosticMessage[];
  latencyMs: number;
  error?: string;
}

export function subscribeGoogleAuth(callback: (state: GoogleSessionState) => void): () => void {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback({
      signedIn: false,
      email: null,
      displayName: null,
      photoURL: null,
      hasGmailToken: false,
    });
    return () => {};
  }
  return onAuthStateChanged(auth, (user: User | null) => {
    if (!user) {
      inMemoryGmailAccessToken = null;
      callback({
        signedIn: false,
        email: null,
        displayName: null,
        photoURL: null,
        hasGmailToken: false,
      });
      return;
    }

    callback({
      signedIn: true,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      hasGmailToken: Boolean(inMemoryGmailAccessToken),
    });
  });
}

export async function signInWithGoogleGmail(): Promise<GoogleSessionState> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error(
      'Logowanie Google w przeglądarce wymaga lokalnego pliku firebase-applet-config.json (skopiuj z firebase-applet-config.example.json) lub zmiennych VITE_FIREBASE_* w .env.'
    );
  }
  const provider = new GoogleAuthProvider();
  provider.addScope(GMAIL_READONLY_SCOPE);
  provider.setCustomParameters({
    prompt: 'select_account',
  });

  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  inMemoryGmailAccessToken = credential?.accessToken || null;

  return {
    signedIn: true,
    email: result.user.email,
    displayName: result.user.displayName,
    photoURL: result.user.photoURL,
    hasGmailToken: Boolean(inMemoryGmailAccessToken),
  };
}

export async function signOutGoogle(): Promise<void> {
  const auth = getFirebaseAuth();
  inMemoryGmailAccessToken = null;
  if (!auth) return;
  await signOut(auth);
}

export function hasGmailAccessToken(): boolean {
  return Boolean(inMemoryGmailAccessToken);
}

export async function fetchGmailLiveDiagnostics(): Promise<GmailLiveDiagnostics> {
  const started = Date.now();
  if (!inMemoryGmailAccessToken) {
    return {
      ok: false,
      emailAddress: null,
      messagesTotal: 0,
      threadsTotal: 0,
      labelCount: 0,
      sentLabelDetected: null,
      recentMessages: [],
      latencyMs: Date.now() - started,
      error:
        'Brak aktywnego tokenu sesji Gmail w pamięci przeglądarki. Kliknij ponownie „Zaloguj się przez Google”, aby odświeżyć uprawnienie gmail.readonly.',
    };
  }

  const headers = {
    Authorization: `Bearer ${inMemoryGmailAccessToken}`,
  };

  try {
    const [profileRes, labelsRes, listRes] = await Promise.all([
      fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers }),
      fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels', { headers }),
      fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX', {
        headers,
      }),
    ]);

    if (profileRes.status === 401 || profileRes.status === 403) {
      inMemoryGmailAccessToken = null;
      return {
        ok: false,
        emailAddress: null,
        messagesTotal: 0,
        threadsTotal: 0,
        labelCount: 0,
        sentLabelDetected: null,
        recentMessages: [],
        latencyMs: Date.now() - started,
        error:
          'Token Google wygasł lub nie udzielono zgody na odczyt Gmaila (gmail.readonly). Zaloguj się ponownie.',
      };
    }

    if (!profileRes.ok) {
      const txt = await profileRes.text();
      throw new Error(`Gmail API HTTP ${profileRes.status}: ${txt.slice(0, 180)}`);
    }

    const profile = (await profileRes.json()) as {
      emailAddress?: string;
      messagesTotal?: number;
      threadsTotal?: number;
    };

    let labelCount = 0;
    let sentLabelDetected: string | null = null;
    if (labelsRes.ok) {
      const labelsJson = (await labelsRes.json()) as {
        labels?: Array<{ id: string; name: string }>;
      };
      const labels = labelsJson.labels || [];
      labelCount = labels.length;
      const sent = labels.find((l) => l.id === 'SENT');
      sentLabelDetected = sent ? sent.name : 'SENT';
    }

    const recentMessages: GmailDiagnosticMessage[] = [];
    if (listRes.ok) {
      const listJson = (await listRes.json()) as {
        messages?: Array<{ id: string }>;
      };
      const ids = (listJson.messages || []).slice(0, 5).map((m) => m.id);
      const details = await Promise.all(
        ids.map(async (id) => {
          const r = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
              id
            )}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers }
          );
          if (!r.ok) return null;
          const json = (await r.json()) as {
            id: string;
            payload?: { headers?: Array<{ name: string; value: string }> };
          };
          const hdrs = json.payload?.headers || [];
          const findHdr = (name: string) =>
            hdrs.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';
          return {
            id: json.id,
            subject: findHdr('Subject') || '(bez tematu)',
            from: findHdr('From') || 'Nieznany nadawca',
            date: findHdr('Date') || '',
          };
        })
      );
      for (const item of details) {
        if (item) recentMessages.push(item);
      }
    }

    return {
      ok: true,
      emailAddress: profile.emailAddress || null,
      messagesTotal: Number(profile.messagesTotal || 0),
      threadsTotal: Number(profile.threadsTotal || 0),
      labelCount,
      sentLabelDetected,
      recentMessages,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      ok: false,
      emailAddress: null,
      messagesTotal: 0,
      threadsTotal: 0,
      labelCount: 0,
      sentLabelDetected: null,
      recentMessages: [],
      latencyMs: Date.now() - started,
      error: err instanceof Error ? err.message : 'Błąd połączenia z Gmail API.',
    };
  }
}
