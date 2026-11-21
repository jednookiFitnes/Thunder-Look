export type SaveDestinationMode = "new-file" | "append-note";
export type SaveScopeMode = "full" | "selection" | "attachments-only";
export type AiApplyMode = "suggest" | "auto";
export type TaskPriority = "high" | "medium" | "low";
export type MailProviderPreset = "roundcube" | "gmail" | "outlook" | "custom";
export type MailAuthMethod = "password" | "google-oauth";

export interface ProviderPresetSpec {
  id: MailProviderPreset;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  sentFolder: string;
  archiveFolder: string;
  trashFolder: string;
  appendSentToImap: boolean;
  supportsServerField: boolean;
  supportsGoogleBrowserLogin: boolean;
  userPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  description: string;
}

export const PROVIDER_PRESETS: Record<MailProviderPreset, ProviderPresetSpec> = {
  roundcube: {
    id: "roundcube",
    label: "Roundcube / Hosting",
    imapHost: "trinitec.pl",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "trinitec.pl",
    smtpPort: 465,
    smtpSecure: true,
    sentFolder: "Sent",
    archiveFolder: "Archive",
    trashFolder: "Trash",
    appendSentToImap: true,
    supportsServerField: true,
    supportsGoogleBrowserLogin: false,
    userPlaceholder: "imie.nazwisko@trinitec.pl",
    passwordLabel: "Hasło skrzynki pocztowej",
    passwordPlaceholder: "Hasło do konta Roundcube / IMAP",
    description:
      "Profil dla poczty Roundcube i własnego hostingu: wpisz adres serwera/domeny (dokładnie tak jak na stronie logowania Roundcube, np. trinitec.pl lub mail.trinitec.pl) — pola IMAP (993 SSL/TLS) i SMTP (465 SSL/TLS) uzupełnią się automatycznie.",
  },
  gmail: {
    id: "gmail",
    label: "Gmail (Google / Hasło aplikacji)",
    imapHost: "imap.gmail.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    sentFolder: "[Gmail]/Sent Mail",
    archiveFolder: "[Gmail]/All Mail",
    trashFolder: "[Gmail]/Trash",
    appendSentToImap: false,
    supportsServerField: false,
    supportsGoogleBrowserLogin: true,
    userPlaceholder: "twoj.adres@gmail.com",
    passwordLabel: "Hasło aplikacji Google (16 znaków)",
    passwordPlaceholder: "xxxx xxxx xxxx xxxx",
    description:
      "Obsługuje zarówno logowanie do Google przez przeglądarkę (OAuth2 / XOAUTH2), jak i 16-znakowe Hasło aplikacji Google. Automatycznie wykrywa polskie i angielskie foldery ([Gmail]/Wysłane) oraz pomija dublowanie wysłanych wiadomości.",
  },
  outlook: {
    id: "outlook",
    label: "Outlook / Office 365",
    imapHost: "outlook.office365.com",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    sentFolder: "Sent Items",
    archiveFolder: "Archive",
    trashFolder: "Deleted Items",
    appendSentToImap: true,
    supportsServerField: false,
    supportsGoogleBrowserLogin: false,
    userPlaceholder: "imie.nazwisko@firma.pl",
    passwordLabel: "Hasło lub Hasło aplikacji Microsoft",
    passwordPlaceholder: "Hasło konta Microsoft / App Password",
    description:
      "Profil dla skrzynek Outlook.com oraz Microsoft 365 (IMAP SSL/TLS 993 + SMTP STARTTLS 587). Jeśli organizacja wymaga MFA, wygeneruj Hasło aplikacji w ustawieniach konta Microsoft.",
  },
  custom: {
    id: "custom",
    label: "Własny serwer IMAP/SMTP",
    imapHost: "",
    imapPort: 993,
    imapSecure: true,
    smtpHost: "",
    smtpPort: 465,
    smtpSecure: true,
    sentFolder: "Sent",
    archiveFolder: "Archive",
    trashFolder: "Trash",
    appendSentToImap: true,
    supportsServerField: true,
    supportsGoogleBrowserLogin: false,
    userPlaceholder: "uzytkownik@domena.pl",
    passwordLabel: "Hasło skrzynki IMAP",
    passwordPlaceholder: "Hasło konta pocztowego",
    description:
      "Dowolny serwer zgodny z RFC 3501 (Dovecot, Cyrus, Home.pl, OVH, LH.pl, nazwa.pl). Obsługuje bezpośredni SSL/TLS (993) oraz STARTTLS (143).",
  },
};

export interface SharedCategoryRule {
  id: string;
  label: string;
  imapFolder: string;
  vaultTopic: string;
  keywords: string[];
  regexPattern?: string;
}
