import type {
  AiApplyMode,
  MailAuthMethod,
  MailProviderPreset,
  SaveDestinationMode,
  SaveScopeMode,
  SharedCategoryRule,
  TaskPriority,
} from "../../shared/types";
import type { ClientMailRule, SpecialFolderRole } from "../../shared/folderMapper";

export type {
  AiApplyMode,
  ClientMailRule,
  MailAuthMethod,
  MailProviderPreset,
  SaveDestinationMode,
  SaveScopeMode,
  SpecialFolderRole,
  TaskPriority,
};

export type AiCategoryConfig = SharedCategoryRule;
export type WorkspaceLayoutMode = "three-column" | "classic-split";
export type MessageListMode = "threads" | "list";
export type ReaderViewTheme = "original-light" | "force-dark" | "markdown";

export interface MailAccountConfig {
  id: string;
  label: string;
  color: string;
  enabled: boolean;
  mailProvider: MailProviderPreset;
  mailAuthMethod: MailAuthMethod;
  serverDomain: string;
  googleOAuthClientId: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  senderName: string;
  emailSignature: string;
  inboxFolder: string;
  sentFolder: string;
  draftsFolder: string;
  archiveFolder: string;
  spamFolder: string;
  trashFolder: string;
  allowlistFolder: string;
  appendSentToImap: boolean;
  strictTlsVerification: boolean;
}

export const ACCOUNT_COLOR_PALETTE = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#06b6d4",
  "#8b5cf6",
];

export interface TrinitecPluginSettings {
  settingsVersion: number;

  // Struktura wewnętrzna sejfu Obsidian (ścieżki względne, np. OneDrive)
  activeProjectsDir: string;
  archiveProjectsDir: string;
  contactsDir: string;
  baseFilePath: string;
  globalAssetsDir: string;
  replyTemplatesDir: string;
  projectCodeRegex: string;
  masterNotePrefix: string;
  projectSubfolders: string[];

  // Wielokontowość (Multi-Account + Unified Inbox)
  accounts: MailAccountConfig[];
  activeAccountId: string;
  unifiedInboxEnabled: boolean;

  // Pola aktywnego konta (utrzymywane w pełnej synchronizacji z activeAccount dla kompatybilności wstecznej)
  mailProvider: MailProviderPreset;
  mailAuthMethod: MailAuthMethod;
  serverDomain: string;
  googleOAuthClientId: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  senderName: string;
  emailSignature: string;
  inboxFolder: string;
  sentFolder: string;
  draftsFolder: string;
  archiveFolder: string;
  spamFolder: string;
  trashFolder: string;
  allowlistFolder: string;
  quotaWarnPercent: number;

  // Bezpieczeństwo, wydajność i zachowanie klienta poczty
  enableImapIdle: boolean;
  desktopNotifications: boolean;
  nonIntrusivePeek: boolean;
  autoMarkReadDelaySec: number;
  appendSentToImap: boolean;
  stripQuotesAndSignatures: boolean;
  blockRemoteImagesByDefault: boolean;
  trustedImageSenders: string[];
  saveRawEmlCopy: boolean;
  strictTlsVerification: boolean;
  maxAttachmentSizeMb: number;

  // Układ interfejsu
  layoutMode: WorkspaceLayoutMode;
  foldersCollapsed: boolean;
  messageListMode: MessageListMode;
  readerThemeMode: ReaderViewTheme;

  // Reguły klienckie
  mailRules: ClientMailRule[];

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

export const DEFAULT_ACCOUNT: MailAccountConfig = {
  id: "default",
  label: "Główna skrzynka",
  color: "#6366f1",
  enabled: true,
  mailProvider: "roundcube",
  mailAuthMethod: "password",
  serverDomain: "trinitec.pl",
  googleOAuthClientId: "",
  imapHost: "trinitec.pl",
  imapPort: 993,
  imapSecure: true,
  imapUser: "",
  smtpHost: "trinitec.pl",
  smtpPort: 465,
  smtpSecure: true,
  senderName: "Piotr Świerk",
  emailSignature: "Pozdrawiam,\nPiotr Świerk",
  inboxFolder: "INBOX",
  sentFolder: "Sent",
  draftsFolder: "Drafts",
  archiveFolder: "Archive",
  spamFolder: "Junk",
  trashFolder: "Trash",
  allowlistFolder: "INBOX/Do-Vaulta",
  appendSentToImap: true,
  strictTlsVerification: true,
};

export const DEFAULT_SETTINGS: TrinitecPluginSettings = {
  settingsVersion: 3,

  activeProjectsDir: "11 - Notes - Trinitec Projekty",
  archiveProjectsDir: "12 - Notes - Trinitec Archiwum",
  contactsDir: "11 - Notes - Trinitec Projekty/kontakty",
  baseFilePath: "1 - Trinitec MOC/_base_trinitec_projekty.base",
  globalAssetsDir: "_Assets",
  replyTemplatesDir: "_Templates/Mail",
  projectCodeRegex: "\\b\\d{2}-\\d{3}\\b",
  masterNotePrefix: "_",
  projectSubfolders: ["Zamówienia", "Rysunki", "Attachments"],

  accounts: [{ ...DEFAULT_ACCOUNT }],
  activeAccountId: "default",
  unifiedInboxEnabled: false,

  mailProvider: DEFAULT_ACCOUNT.mailProvider,
  mailAuthMethod: DEFAULT_ACCOUNT.mailAuthMethod,
  serverDomain: DEFAULT_ACCOUNT.serverDomain,
  googleOAuthClientId: DEFAULT_ACCOUNT.googleOAuthClientId,
  imapHost: DEFAULT_ACCOUNT.imapHost,
  imapPort: DEFAULT_ACCOUNT.imapPort,
  imapSecure: DEFAULT_ACCOUNT.imapSecure,
  imapUser: DEFAULT_ACCOUNT.imapUser,
  smtpHost: DEFAULT_ACCOUNT.smtpHost,
  smtpPort: DEFAULT_ACCOUNT.smtpPort,
  smtpSecure: DEFAULT_ACCOUNT.smtpSecure,
  senderName: DEFAULT_ACCOUNT.senderName,
  emailSignature: DEFAULT_ACCOUNT.emailSignature,
  inboxFolder: DEFAULT_ACCOUNT.inboxFolder,
  sentFolder: DEFAULT_ACCOUNT.sentFolder,
  draftsFolder: DEFAULT_ACCOUNT.draftsFolder,
  archiveFolder: DEFAULT_ACCOUNT.archiveFolder,
  spamFolder: DEFAULT_ACCOUNT.spamFolder,
  trashFolder: DEFAULT_ACCOUNT.trashFolder,
  allowlistFolder: DEFAULT_ACCOUNT.allowlistFolder,
  quotaWarnPercent: 80,

  enableImapIdle: true,
  desktopNotifications: true,
  nonIntrusivePeek: true,
  autoMarkReadDelaySec: 0,
  appendSentToImap: true,
  stripQuotesAndSignatures: true,
  blockRemoteImagesByDefault: true,
  trustedImageSenders: [],
  saveRawEmlCopy: false,
  strictTlsVerification: true,
  maxAttachmentSizeMb: 25,

  layoutMode: "three-column",
  foldersCollapsed: false,
  messageListMode: "threads",
  readerThemeMode: "original-light",

  mailRules: [],

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

export interface LazyAttachmentMeta {
  partId: string;
  filename: string;
  contentType: string;
  size: number;
  encoding?: string;
}

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
  partId?: string;
  lazy?: boolean;
}

export interface ParsedEmailMessage {
  uid?: number;
  folder?: string;
  accountId?: string;
  accountLabel?: string;
  accountColor?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  threadId: string;
  contentHash: string;
  date: string; // YYYY-MM-DD
  dateTimeIso: string;
  fromName: string;
  fromEmail: string;
  fromRaw: string;
  toRaw: string;
  ccRaw?: string;
  replyToRaw?: string;
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
  uidNext?: number;
  specialUse?: string;
  delimiter?: string;
  role?: SpecialFolderRole;
  accountId?: string;
}

export interface ImapMessageHeader {
  uid: number;
  folder: string;
  accountId?: string;
  accountLabel?: string;
  accountColor?: string;
  uidValidity: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  date: string;
  internalDateIso?: string;
  fromName: string;
  fromEmail: string;
  toEmail?: string;
  subject: string;
  snippet?: string;
  hasAttachments?: boolean;
  attachmentParts?: LazyAttachmentMeta[];
  sizeBytes: number;
  seen: boolean;
  flagged: boolean;
  detectedProjectCode: string | null;
}

export interface EmailThreadGroup {
  threadKey: string;
  subject: string;
  latestDate: string;
  latestDateIso?: string;
  totalSizeBytes: number;
  unreadCount: number;
  flagged: boolean;
  hasAttachments?: boolean;
  projectCode: string | null;
  messages: ImapMessageHeader[];
}

export interface FolderStorageInfo {
  path: string;
  messages: number;
  unseen: number;
  totalBytes: number;
  largestMessageBytes: number;
  isAggregate?: boolean;
  role?: SpecialFolderRole;
}

export interface LargeMessageInfo {
  uid: number;
  folder: string;
  messageId?: string;
  alsoInFolders?: string[];
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
  aggregateFolderPath?: string | null;
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
  accountId?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  strictTls?: boolean;
  authMethod?: MailAuthMethod;
}

export interface ImapConnectionTestResult {
  ok: boolean;
  providerDetected: "gmail" | "outlook" | "roundcube" | "imap";
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

export interface DiagnosticStepResult {
  step: "imap" | "smtp" | "vault";
  label: string;
  ok: boolean;
  summary: string;
  details?: string;
  hint?: string;
}

export interface FullDiagnosticsReport {
  ok: boolean;
  ranAt: string;
  steps: DiagnosticStepResult[];
  imapResult: ImapConnectionTestResult;
}

export type ConnectionHealthState = "idle" | "syncing" | "connected" | "offline" | "error";

export interface PluginRuntimeStatus {
  state: ConnectionHealthState;
  lastSyncAt: Date | null;
  unreadCount: number;
  lastError: string | null;
}
