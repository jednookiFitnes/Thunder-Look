export const ALLOWED_WEB_IMAP_PORTS = new Set([143, 993]);

/**
 * Ochrona przed SMTP Header Injection: odrzuca wszelkie znaki CR (\r), LF (\n) i NULL (\0)
 * w polach nagłówków (To, Cc, Bcc, Subject, Reply-To, In-Reply-To, References, From name).
 */
export function assertSafeSmtpHeaderValue(fieldName: string, value: string): string {
  const str = String(value ?? "");
  if (/[\r\n\0]/.test(str)) {
    throw new Error(
      `Zablokowano próbę wstrzyknięcia nagłówka SMTP (niedozwolone znaki CR/LF/NULL w polu „${fieldName}”).`
    );
  }
  return str.trim();
}

export function sanitizeSmtpHeader(value: string): string {
  return String(value ?? "")
    .replace(/[\r\n\0]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizuje pole "Serwer / Domena" znane z ekranu logowania Roundcube (np. "trinitec.pl",
 * "ssl://trinitec.pl:993", "https://poczta.trinitec.pl") do czystej nazwy hosta.
 */
export function resolveServerHostFromDomain(rawServer: string): {
  host: string;
  detectedPort: number | null;
  detectedSecure: boolean | null;
} {
  let cleaned = String(rawServer || "").trim();
  let detectedPort: number | null = null;
  let detectedSecure: boolean | null = null;

  if (/^(imaps|ssl|tls):\/\//i.test(cleaned)) {
    detectedSecure = true;
    cleaned = cleaned.replace(/^(imaps|ssl|tls):\/\//i, "");
  } else if (/^(imap|http|https):\/\//i.test(cleaned)) {
    cleaned = cleaned.replace(/^(imap|http|https):\/\//i, "");
  }

  // Usuń ewentualną ścieżkę po ukośniku
  cleaned = cleaned.split("/")[0].trim();

  // Wyodrębnij opcjonalny port host:993
  const colonIdx = cleaned.lastIndexOf(":");
  if (colonIdx > 0 && /^\d+$/.test(cleaned.slice(colonIdx + 1))) {
    const p = Number(cleaned.slice(colonIdx + 1));
    if (p >= 1 && p <= 65535) {
      detectedPort = p;
      if (p === 993) detectedSecure = true;
      if (p === 143) detectedSecure = false;
    }
    cleaned = cleaned.slice(0, colonIdx);
  }

  return {
    host: cleaned.toLowerCase(),
    detectedPort,
    detectedSecure,
  };
}

export function validateImapHostname(host: string): string | null {
  const trimmed = String(host || "").trim().toLowerCase();
  if (!trimmed || trimmed.length > 253) {
    return "Podaj poprawną nazwę hosta lub serwera IMAP (np. trinitec.pl, imap.roundcube.pl lub imap.gmail.com).";
  }
  if (
    trimmed === "localhost" ||
    trimmed.endsWith(".localhost") ||
    trimmed.endsWith(".local") ||
    trimmed.endsWith(".internal") ||
    trimmed.endsWith(".arpa")
  ) {
    return "Adresy lokalne i wewnętrzne są zablokowane ze względów bezpieczeństwa (ochrona SSRF).";
  }
  if (!/^[a-z0-9.-]+$/.test(trimmed) || trimmed.startsWith(".") || trimmed.endsWith(".") || trimmed.includes("..")) {
    return "Nazwa hosta IMAP zawiera niedozwolone znaki.";
  }
  return null;
}

export function validateWebImapPort(port: number): string | null {
  if (!Number.isInteger(port) || !ALLOWED_WEB_IMAP_PORTS.has(port)) {
    return "W teście sieciowym dozwolone są wyłącznie standardowe porty IMAP: 993 (SSL/TLS) lub 143 (STARTTLS).";
  }
  return null;
}

/**
 * Walidacja wyrażeń regularnych chroniąca przed ReDoS (katastrofalny backtracking).
 */
export function validateSafeRegexPattern(pattern: string, maxLen = 160): {
  ok: boolean;
  error?: string;
} {
  const trimmed = String(pattern || "").trim();
  if (!trimmed) return { ok: true };
  if (trimmed.length > maxLen) {
    return {
      ok: false,
      error: `Wyrażenie regularne jest zbyt długie (maks. ${maxLen} znaków).`,
    };
  }

  // Wykryj typowe wzorce zagnieżdżonych kwantyfikatorów powodujące wykładniczy backtracking (ReDoS)
  const dangerousReDoS = [
    /\([^)]*[+*][^)]*\)[+*?{]/, // np. (a+)+, (.*)*, (\w+){2,}
    /\([^)]*\|[^)]*\)[+*]{2,}/, // podwójne kwantyfikatory na alternatywach
    /([+*?])\1/, // np. ++, **
    /\.\*\.\*/, // wielokrotne .*.*
  ];
  for (const rx of dangerousReDoS) {
    if (rx.test(trimmed)) {
      return {
        ok: false,
        error: "Wykryto potencjalnie niebezpieczny wzorzec zagnieżdżonych kwantyfikatorów (ryzyko ReDoS).",
      };
    }
  }

  try {
    // eslint-disable-next-line no-new
    new RegExp(trimmed, "i");
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Niepoprawna składnia wyrażenia regularnego: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function isGmailHostname(host: string): boolean {
  const lower = String(host || "").toLowerCase();
  return lower.includes("gmail.com") || lower.includes("googlemail.com");
}

export function isOutlookHostname(host: string): boolean {
  const lower = String(host || "").toLowerCase();
  return lower.includes("office365.com") || lower.includes("outlook.com") || lower.includes("live.com");
}

export function buildPolishImapErrorHint(
  errorMsg: string,
  host: string,
  port: number,
  secure: boolean
): string {
  const lower = String(errorMsg || "").toLowerCase();
  const isGmail = isGmailHostname(host);
  const isOutlook = isOutlookHostname(host);

  if (
    isGmail &&
    (lower.includes("auth") ||
      lower.includes("credential") ||
      lower.includes("application-specific") ||
      lower.includes("web login") ||
      lower.includes("xoauth2") ||
      lower.includes("no"))
  ) {
    return "Gmail wymaga zalogowania przez przeglądarkę Google (OAuth2) lub 16-znakowego Hasła aplikacji Google (Konto Google → Bezpieczeństwo → Weryfikacja dwuetapowa → Hasła aplikacji). Sprawdź też, czy IMAP jest włączony w Gmailu.";
  }

  if (isOutlook && (lower.includes("auth") || lower.includes("login") || lower.includes("credential"))) {
    return "Outlook / Microsoft 365 odrzucił logowanie. Jeśli masz włączone MFA, użyj Hasła aplikacji Microsoft i upewnij się, że IMAP jest włączony dla konta.";
  }

  if (lower.includes("auth") || lower.includes("login") || lower.includes("credential") || lower.includes("odrzuc")) {
    return "Serwer odrzucił login lub hasło. Upewnij się, że podajesz pełny adres e-mail jako login oraz aktualne hasło skrzynki (nie hasło do panelu hostingu).";
  }

  if (lower.includes("enotfound") || lower.includes("eai_again")) {
    const cleanHost = host.trim();
    const suggestion =
      cleanHost && !cleanHost.startsWith("mail.") && !cleanHost.startsWith("imap.")
        ? ` Spróbuj również „mail.${cleanHost}” lub „imap.${cleanHost}”.`
        : "";
    return `Nie znaleziono hosta „${cleanHost}” w DNS. Sprawdź nazwę serwera pocztowego.${suggestion}`;
  }

  if (lower.includes("cert") || lower.includes("self signed") || lower.includes("unable to verify")) {
    return "Błąd weryfikacji certyfikatu TLS serwera. Sprawdź, czy używasz właściwej nazwy hosta z certyfikatu (np. mail.twojadomena.pl zamiast samej domeny). Wyłączenie ścisłego TLS jest zalecane wyłącznie dla zaufanych serwerów lokalnych.";
  }

  if (lower.includes("wrong version") || lower.includes("ssl") || lower.includes("tls")) {
    return port === 143 && secure
      ? "Port 143 korzysta z STARTTLS — wyłącz opcję „Bezpośredni SSL/TLS” lub zmień port na 993."
      : "Błąd uzgadniania TLS/SSL. Dla portu 993 włącz SSL/TLS, a dla portu 143 użyj STARTTLS (wyłączony SSL/TLS).";
  }

  if (lower.includes("locked") || lower.includes("mailbox") || lower.includes("busy")) {
    return "Folder skrzynki jest chwilowo zablokowany przez inną sesję IMAP. Poczekaj kilka sekund i ponów próbę.";
  }

  if (lower.includes("timeout") || lower.includes("econnrefused") || lower.includes("econnreset")) {
    const altHint =
      host && !host.startsWith("mail.") && !host.startsWith("imap.")
        ? ` Jeśli wpisałeś samą domenę (${host}), spróbuj „mail.${host}” lub „imap.${host}”.`
        : "";
    return `Przekroczono limit czasu lub port ${port} nie odpowiada (sprawdź zaporę i port 993 SSL/TLS).${altHint}`;
  }

  return "Zweryfikuj nazwę serwera (np. trinitec.pl / mail.trinitec.pl / imap.gmail.com), port (993 SSL/TLS lub 143 STARTTLS) oraz poświadczenia.";
}
