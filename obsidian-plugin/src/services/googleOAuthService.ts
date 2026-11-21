import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SecretService, type GoogleOAuthTokenBundle } from "./secretService";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";
const GMAIL_IMAP_SCOPES = ["https://mail.google.com/", "email", "profile"].join(" ");

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function openSystemBrowser(url: string): void {
  try {
    const req = (window as unknown as { require?: (id: string) => unknown }).require;
    if (typeof req === "function") {
      const electron = req("electron") as { shell?: { openExternal?: (u: string) => Promise<void> } };
      if (electron?.shell?.openExternal) {
        void electron.shell.openExternal(url);
        return;
      }
    }
  } catch {
    // Fallback below
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Logowanie do konta Google przez przeglądarkę systemową w Obsidian Desktop (RFC 8252 + OAuth 2.0 PKCE):
 * - Uruchamia tymczasowy serwer callback wyłącznie na 127.0.0.1 na losowym porcie.
 * - Otwiera prawdziwą przeglądarkę na accounts.google.com z losowym state i PKCE S256.
 * - Wymienia kod autoryzacyjny na access_token + refresh_token i szyfruje je w SecretService.
 * - Automatycznie odświeża access_token przed wygaśnięciem (XOAUTH2 dla imap.gmail.com i smtp.gmail.com).
 */
export class GoogleOAuthService {
  private secretService: SecretService;

  constructor(secretService: SecretService) {
    this.secretService = secretService;
  }

  async signInViaBrowser(clientId: string, timeoutMs = 120_000): Promise<GoogleOAuthTokenBundle> {
    const trimmedClientId = clientId.trim();
    if (!trimmedClientId) {
      throw new Error(
        "Podaj Google OAuth Client ID (typ: Desktop App w Google Cloud Console), aby uruchomić logowanie przez przeglądarkę, lub użyj 16-znakowego Hasła aplikacji Google."
      );
    }

    const codeVerifier = base64UrlEncode(crypto.randomBytes(48));
    const codeChallenge = base64UrlEncode(
      crypto.createHash("sha256").update(codeVerifier).digest()
    );
    const state = base64UrlEncode(crypto.randomBytes(24));

    const { code, redirectUri } = await this.listenForAuthCode(
      trimmedClientId,
      codeChallenge,
      state,
      timeoutMs
    );

    const tokenBody = new URLSearchParams({
      client_id: trimmedClientId,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    const tokenResp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenBody.toString(),
    });

    const tokenJson = (await tokenResp.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenResp.ok || !tokenJson.access_token) {
      throw new Error(
        tokenJson.error_description ||
          tokenJson.error ||
          "Nie udało się uzyskać tokenu OAuth2 z Google."
      );
    }

    let email = "";
    try {
      const userResp = await fetch(GOOGLE_USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (userResp.ok) {
        const profile = (await userResp.json()) as { email?: string };
        email = profile.email || "";
      }
    } catch {
      // Jeśli profil się nie pobrał, użyjemy adresu wpisanego w ustawieniach
    }

    const bundle: GoogleOAuthTokenBundle = {
      accessToken: tokenJson.access_token,
      refreshToken: tokenJson.refresh_token || "",
      expiresAt: Date.now() + Math.max(60, (tokenJson.expires_in || 3600) - 60) * 1000,
      email,
      scope: tokenJson.scope,
    };

    await this.secretService.setGoogleOAuthTokens(bundle);
    return bundle;
  }

  async getValidAccessToken(clientId: string): Promise<{ accessToken: string; email: string }> {
    const stored = await this.secretService.getGoogleOAuthTokens();
    if (!stored || !stored.accessToken) {
      throw new Error(
        "Brak aktywnej sesji Google OAuth2. Kliknij „Zaloguj przez Google (przeglądarka)” w ustawieniach poczty."
      );
    }

    if (Date.now() < stored.expiresAt) {
      return { accessToken: stored.accessToken, email: stored.email };
    }

    if (!stored.refreshToken || !clientId.trim()) {
      throw new Error(
        "Sesja Google wygasła. Zaloguj się ponownie przez przycisk „Zaloguj przez Google (przeglądarka)”."
      );
    }

    const refreshBody = new URLSearchParams({
      client_id: clientId.trim(),
      grant_type: "refresh_token",
      refresh_token: stored.refreshToken,
    });

    const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: refreshBody.toString(),
    });

    const json = (await resp.json()) as {
      access_token?: string;
      expires_in?: number;
      error_description?: string;
    };

    if (!resp.ok || !json.access_token) {
      throw new Error(
        json.error_description ||
          "Nie udało się odświeżyć tokenu Google OAuth2 — zaloguj się ponownie."
      );
    }

    const updated: GoogleOAuthTokenBundle = {
      ...stored,
      accessToken: json.access_token,
      expiresAt: Date.now() + Math.max(60, (json.expires_in || 3600) - 60) * 1000,
    };
    await this.secretService.setGoogleOAuthTokens(updated);
    return { accessToken: updated.accessToken, email: updated.email };
  }

  async signOut(): Promise<void> {
    await this.secretService.clearGoogleOAuthTokens();
  }

  private listenForAuthCode(
    clientId: string,
    codeChallenge: string,
    expectedState: string,
    timeoutMs: number
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server = http.createServer();

      const cleanup = () => {
        clearTimeout(timer);
        try {
          server.close();
        } catch {
          // ignore
        }
      };

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      };

      const succeed = (result: { code: string; redirectUri: string }) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };

      const timer = setTimeout(() => {
        fail(new Error("Upłynął limit czasu logowania Google w przeglądarce (120 s)."));
      }, timeoutMs);

      server.on("error", (err) => {
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as AddressInfo | null;
        if (!addr || !addr.port) {
          fail(new Error("Nie udało się otworzyć lokalnego portu callback 127.0.0.1."));
          return;
        }
        const redirectUri = `http://127.0.0.1:${addr.port}/oauth/callback`;

        server.on("request", (req, res) => {
          const urlObj = new URL(req.url || "/", `http://127.0.0.1:${addr.port}`);
          if (urlObj.pathname !== "/oauth/callback") {
            res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("Not found");
            return;
          }

          const errParam = urlObj.searchParams.get("error");
          const code = urlObj.searchParams.get("code");
          const state = urlObj.searchParams.get("state");

          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'");

          if (errParam || !code || state !== expectedState) {
            res.writeHead(400);
            res.end(
              "<!doctype html><html><body style='font-family:system-ui;padding:32px;background:#141519;color:#E6E8EF'><h2>Logowanie Google anulowane lub nieprawidłowe</h2><p>Możesz zamknąć tę kartę i wrócić do Obsidian (Thunder Look).</p></body></html>"
            );
            fail(
              new Error(
                errParam
                  ? `Logowanie Google odrzucone: ${errParam}`
                  : "Nieprawidłowy stan OAuth2 (CSRF mismatch) lub brak kodu autoryzacji."
              )
            );
            return;
          }

          res.writeHead(200);
          res.end(
            "<!doctype html><html><body style='font-family:system-ui;padding:32px;background:#141519;color:#E6E8EF'><h2>Połączono z Google (Thunder Look)</h2><p>Autoryzacja zakończona pomyślnie. Możesz zamknąć tę kartę i wrócić do Obsidiana.</p></body></html>"
          );
          succeed({ code, redirectUri });
        });

        const authParams = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: GMAIL_IMAP_SCOPES,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          state: expectedState,
          access_type: "offline",
          prompt: "consent",
        });

        openSystemBrowser(`${GOOGLE_AUTH_ENDPOINT}?${authParams.toString()}`);
      });
    });
  }
}
