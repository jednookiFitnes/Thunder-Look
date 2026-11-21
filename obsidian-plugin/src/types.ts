export type SaveDestinationMode = "new-file" | "append-note";
export type SaveScopeMode = "full" | "selection" | "attachments-only";
export type AiApplyMode = "suggest" | "auto";
export type TaskPriority = "high" | "medium" | "low";
export type MailProviderPreset = "roundcube" | "gmail" | "custom";

export interface AiCategoryConfig {
  id: string;
  label: string;
  imapFolder: string;
  vaultTopic: string;
  keywords: string[];
}

export interface TrinitecPluginSettings {
  // Struktura wewnętrzna Praca Vault (ścieżki względne wewnątrz dowolnego sejfu, np. OneDrive)
  activeProjectsDir: string;
  archiveProjectsDir: string;
  contactsDir: string;
  baseFilePath: string;
  globalAssetsDir: string;
  projectCodeRegex: string;
  masterNotePrefix: string;
  projectSubfolders: string[];

  // Serwer poczty IMAP / SMTP (Roundcube.pl / Gmail / własny hosting)
  // Uwaga: hasło NIE jest trzymane w data.json — trafia do SecretStorage / localStorage
  mailProvider: MailProviderPreset;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  senderName: string;
  inboxFolder: string;
  sentFolder: string;
  archiveFolder: string;
  trashFolder: string;
  allowlistFolder: string;
  quotaWarnPercent: number;

  // Ulepszenia architektury IMAP (wzorce z Oxill Mail / Mailstone / Himalaya)
  enableImapIdle: boolean;
  nonIntrusivePeek: boolean;
  appendSentToImap: boolean;
  stripQuotesAndSignatures: boolean;
  blockRemoteImagesByDefault: boolean;
  saveRawEmlCopy: boolean;
  strictTlsVerification: boolean;

  // Polityka ręcznego zapisu Opt-in
  optInStrictMode: boolean;
  defaultSaveMode: SaveDestinationMode;
  attachmentsTarget: "project-attachments" | "global-assets";
  fileNamePattern: string;
  defaultElectricalTopic: string;
  autoDetectTasks: boolean;

  // Moduł analizy AI (MCP / CLI — bez kluczy API)
  cliExecutablePath: string;
  aiAnalyzeIncomingImap: boolean;
  aiAnalyzeVaultNotes: boolean;
  aiCategorizationEnabled: boolean;
  aiCategorizationMode: AiApplyMode;
  aiFolderRoutingEnabled: boolean;
  aiFolderRoutingMode: AiApplyMode;
  aiTaskExtractionEnabled: boolean;
  aiTaskExtractionMode: AiApplyMode;
  aiPrioritizationEnabled: boolean;
  aiPrioritizationMode: AiApplyMode;
  aiCategories: AiCategoryConfig[];
}

export const DEFAULT_SETTINGS: TrinitecPluginSettings = {
  activeProjectsDir: "11 - Notes - Trinitec Projekty",
  archiveProjectsDir: "12 - Notes - Trinitec Archiwum",
  contactsDir: "11 - Notes - Trinitec Projekty/kontakty",
  baseFilePath: "1 - Trinitec MOC/_base_trinitec_projekty.base",
  globalAssetsDir: "_Assets",
  projectCodeRegex: "\\b\\d{2}-\\d{3}\\b",
  masterNotePrefix: "_",
  projectSubfolders: ["Zamówienia", "Rysunki", "Attachments"],

  mailProvider: "roundcube",
  imapHost: "imap.roundcube.pl",
  imapPort: 993,
  imapSecure: true,
  imapUser: "",
  smtpHost: "smtp.roundcube.pl",
  smtpPort: 465,
  smtpSecure: true,
  senderName: "Piotr Świerk",
  inboxFolder: "INBOX",
  sentFolder: "Sent",
  archiveFolder: "Archive",
  trashFolder: "Trash",
  allowlistFolder: "INBOX/Do-Vaulta",
  quotaWarnPercent: 80,

  enableImapIdle: true,
  nonIntrusivePeek: true,
  appendSentToImap: true,
  stripQuotesAndSignatures: true,
  blockRemoteImagesByDefault: true,
  saveRawEmlCopy: false,
  strictTlsVerification: true,

  optInStrictMode: true,
  defaultSaveMode: "new-file",
  attachmentsTarget: "project-attachments",
  fileNamePattern: "Mail - {YYYY-MM-DD} - {Subject}.md",
  defaultElectricalTopic: "Korespondencja",
  autoDetectTasks: true,

  cliExecutablePath: "trinitec-mail",
  aiAnalyzeIncomingImap: true,
  aiAnalyzeVaultNotes: true,
  aiCategorizationEnabled: true,
  aiCategorizationMode: "suggest",
  aiFolderRoutingEnabled: true,
  aiFolderRoutingMode: "suggest",
  aiTaskExtractionEnabled: true,
  aiTaskExtractionMode: "suggest",
  aiPrioritizationEnabled: true,
  aiPrioritizationMode: "auto",
  aiCategories: [
    {
      id: "cat-zlecenie",
      label: "Zlecenie",
      imapFolder: "INBOX/Zlecenia",
      vaultTopic: "Zamówienia",
      keywords: ["zamówienie", "zlecenie", "po", "uruchomienie", "realizacja", "harmonogram"],
    },
    {
      id: "cat-pytanie",
      label: "Pytanie",
      imapFolder: "INBOX/Pytania",
      vaultTopic: "Korespondencja",
      keywords: ["pytanie", "prośba o wyjaśnienie", "czy możemy", "wątpliwość", "konsultacja"],
    },
    {
      id: "cat-raport",
      label: "Raport",
      imapFolder: "INBOX/Raporty",
      vaultTopic: "Pomiary",
      keywords: ["raport", "protokół", "pomiary", "test szczelności", "fat", "sat", "wyniki"],
    },
    {
      id: "cat-oferta",
      label: "Oferta",
      imapFolder: "INBOX/Oferty",
      vaultTopic: "Zamówienia",
      keywords: ["wycena", "oferta", "rfq", "zapytanie ofertowe", "kosztorys", "bom"],
    },
  ],
};

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface ParsedEmailMessage {
  uid?: number;
  folder?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  date: string; // YYYY-MM-DD
  dateTimeIso: string;
  fromName: string;
  fromEmail: string;
  fromRaw: string;
  toRaw: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
  markdownBody: string;
  strippedMarkdownBody: string;
  rawEmlBuffer?: Buffer;
  sizeBytes: number;
  attachments: ParsedAttachment[];
  seen?: boolean;
  flagged?: boolean;
}

export interface ImapFolderSummary {
  path: string;
  messages: number;
  unseen: number;
  uidValidity: string;
}

export interface ImapMessageHeader {
  uid: number;
  folder: string;
  uidValidity: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  date: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  sizeBytes: number;
  seen: boolean;
  flagged: boolean;
  detectedProjectCode: string | null;
}

export interface EmailThreadGroup {
  threadKey: string;
  subject: string;
  latestDate: string;
  totalSizeBytes: number;
  unreadCount: number;
  flagged: boolean;
  projectCode: string | null;
  messages: ImapMessageHeader[];
}

export interface FolderStorageInfo {
  path: string;
  messages: number;
  unseen: number;
  totalBytes: number;
  largestMessageBytes: number;
}

export interface LargeMessageInfo {
  uid: number;
  folder: string;
  date: string;
  from: string;
  subject: string;
  sizeBytes: number;
}

export interface MailboxQuotaReport {
  quotaSupported: boolean;
  usedBytes: number;
  limitBytes: number | null;
  usagePercent: number | null;
  totalCalculatedBytes: number;
  totalMessages: number;
  folders: FolderStorageInfo[];
  largestMessages: LargeMessageInfo[];
}

export interface VaultProjectMatch {
  folderPath: string;
  folderName: string;
  masterNoteName: string;
  projectCode: string | null;
  matchMethod: "regex" | "contact" | "manual";
}

export interface VaultContactMatch {
  filePath: string;
  contactName: string;
  emails: string[];
  linkedProjects: string[];
}

export interface AiAnalysisProposal {
  category: string;
  suggestedImapFolder: string;
  suggestedVaultTopic: string;
  priority: TaskPriority;
  extractedTasks: string[];
  rationale: string;
}

export interface ImapConnectionTestOverride {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  strictTls?: boolean;
}

export interface ImapConnectionTestResult {
  ok: boolean;
  providerDetected: "gmail" | "roundcube" | "imap";
  latencyMs: number;
  host: string;
  port: number;
  secure: boolean;
  capabilities: string[];
  folderCount: number;
  inboxMessages: number;
  inboxUnseen: number;
  sentFolderDetected: string | null;
  quotaUsedBytes: number | null;
  quotaLimitBytes: number | null;
  smtpChecked?: boolean;
  smtpOk?: boolean;
  smtpMessage?: string;
  error?: string;
  hint?: string;
}
