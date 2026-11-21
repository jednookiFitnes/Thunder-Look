import { MailProviderPreset } from '../../types/generator';

export interface ImapTestApiResult {
  ok: boolean;
  providerDetected: 'gmail' | 'roundcube' | 'outlook' | 'imap';
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

export interface PresetConfig {
  id: MailProviderPreset;
  label: string;
  serverDomain: string;
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

export const MAIL_PRESETS: Record<MailProviderPreset, PresetConfig> = {
  roundcube: {
    id: 'roundcube',
    label: 'Roundcube / Domena',
    serverDomain: 'trinitec.pl',
    imapHost: 'trinitec.pl',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'trinitec.pl',
    smtpPort: 465,
    smtpSecure: true,
    userPlaceholder: 'imie.nazwisko@trinitec.pl',
    passwordLabel: 'Hasło skrzynki pocztowej',
    passwordPlaceholder: 'Hasło do skrzynki IMAP/SMTP',
    note: 'Profil Roundcube / własny serwer pocztowy. Wpisz w polu „Serwer / Domena” dokładnie to, co podawałeś na stronie logowania Roundcube (np. trinitec.pl, mail.trinitec.pl lub imap.roundcube.pl) — hosty IMAP i SMTP zsynchronizują się automatycznie.',
  },
  gmail: {
    id: 'gmail',
    label: 'Gmail (Google / App Password)',
    serverDomain: 'imap.gmail.com',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    userPlaceholder: 'twoj.adres@gmail.com',
    passwordLabel: 'Hasło aplikacji Google (16 znaków)',
    passwordPlaceholder: 'xxxx xxxx xxxx xxxx',
    note: 'Możesz zalogować się bezpośrednio przez przeglądarkę Google (przycisk poniżej) lub użyć 16-znakowego Hasła aplikacji Google (Konto Google → Bezpieczeństwo → Weryfikacja dwuetapowa → Hasła aplikacji). Wtyczka Obsidian obsługuje obie metody (w tym OAuth2 PKCE + XOAUTH2).',
  },
  outlook: {
    id: 'outlook',
    label: 'Outlook / Office 365',
    serverDomain: 'outlook.office365.com',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecure: false,
    userPlaceholder: 'twoj.adres@outlook.com',
    passwordLabel: 'Hasło / Hasło aplikacji Microsoft',
    passwordPlaceholder: 'Hasło konta Microsoft',
    note: 'Standardowy profil Microsoft 365 / Outlook.com (IMAP SSL/TLS 993 oraz SMTP STARTTLS 587). Przy aktywnym MFA użyj Hasła aplikacji Microsoft.',
  },
  custom: {
    id: 'custom',
    label: 'Własny serwer IMAP',
    serverDomain: '',
    imapHost: '',
    imapPort: 993,
    imapSecure: true,
    smtpHost: '',
    smtpPort: 465,
    smtpSecure: true,
    userPlaceholder: 'uzytkownik@domena.pl',
    passwordLabel: 'Hasło skrzynki IMAP',
    passwordPlaceholder: 'Hasło konta pocztowego',
    note: 'Dowolny serwer IMAP/SMTP zgodny z RFC 3501 (Dovecot, Cyrus, Home.pl, OVH, nazwa.pl, LH.pl). Obsługuje bezpośredni SSL/TLS (993) oraz STARTTLS (143).',
  },
};
