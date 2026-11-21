import {
  ACCOUNT_COLOR_PALETTE,
  DEFAULT_ACCOUNT,
  DEFAULT_SETTINGS,
  MailAccountConfig,
  TrinitecPluginSettings,
} from "../types";
import type { ClientMailRule, MailRuleCondition } from "../../../shared/folderMapper";
import { validateSafeRegexPattern } from "../../../shared/networkSecurity";

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asPort(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : fallback;
}

function asRangeNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

const VALID_PROVIDERS = new Set(["roundcube", "gmail", "outlook", "custom"]);

function sanitizeAccount(
  raw: Record<string, unknown>,
  index: number,
  fallback: MailAccountConfig = DEFAULT_ACCOUNT
): MailAccountConfig {
  const mailProvider =
    typeof raw.mailProvider === "string" && VALID_PROVIDERS.has(raw.mailProvider)
      ? (raw.mailProvider as MailAccountConfig["mailProvider"])
      : fallback.mailProvider;

  const mailAuthMethod =
    raw.mailAuthMethod === "google-oauth" || raw.mailAuthMethod === "password"
      ? raw.mailAuthMethod
      : fallback.mailAuthMethod;

  const imapHost = asString(raw.imapHost, fallback.imapHost).trim();
  const serverDomain =
    asString(raw.serverDomain, "").trim() ||
    (mailProvider === "roundcube" ? imapHost || fallback.serverDomain : "");

  const imapUser = asString(raw.imapUser, fallback.imapUser).trim();
  const defaultLabel =
    imapUser ||
    (mailProvider === "gmail"
      ? "Gmail"
      : mailProvider === "outlook"
      ? "Outlook"
      : index === 0
      ? "Główna skrzynka"
      : `Konto ${index + 1}`);

  return {
    id: asNonEmptyString(raw.id, index === 0 ? "default" : `acc-${index + 1}`),
    label: asNonEmptyString(raw.label, defaultLabel),
    color: asNonEmptyString(
      raw.color,
      ACCOUNT_COLOR_PALETTE[index % ACCOUNT_COLOR_PALETTE.length]
    ),
    enabled: asBoolean(raw.enabled, true),
    mailProvider,
    mailAuthMethod,
    serverDomain,
    googleOAuthClientId: asString(raw.googleOAuthClientId, fallback.googleOAuthClientId).trim(),
    imapHost,
    imapPort: asPort(raw.imapPort, fallback.imapPort),
    imapSecure: asBoolean(raw.imapSecure, fallback.imapSecure),
    imapUser,
    smtpHost: asString(raw.smtpHost, fallback.smtpHost).trim(),
    smtpPort: asPort(raw.smtpPort, fallback.smtpPort),
    smtpSecure: asBoolean(raw.smtpSecure, fallback.smtpSecure),
    senderName: asString(raw.senderName, fallback.senderName).trim(),
    emailSignature: asString(raw.emailSignature, fallback.emailSignature),
    inboxFolder: asNonEmptyString(raw.inboxFolder, fallback.inboxFolder),
    sentFolder: asNonEmptyString(raw.sentFolder, fallback.sentFolder),
    draftsFolder: asNonEmptyString(raw.draftsFolder, fallback.draftsFolder),
    archiveFolder: asNonEmptyString(raw.archiveFolder, fallback.archiveFolder),
    spamFolder: asNonEmptyString(raw.spamFolder, fallback.spamFolder),
    trashFolder: asNonEmptyString(raw.trashFolder, fallback.trashFolder),
    allowlistFolder: asString(raw.allowlistFolder, fallback.allowlistFolder).trim(),
    appendSentToImap: asBoolean(raw.appendSentToImap, fallback.appendSentToImap),
    strictTlsVerification: asBoolean(raw.strictTlsVerification, fallback.strictTlsVerification),
  };
}

export function getActiveAccount(settings: TrinitecPluginSettings): MailAccountConfig {
  const found = settings.accounts.find((a) => a.id === settings.activeAccountId);
  return found || settings.accounts[0] || { ...DEFAULT_ACCOUNT };
}

export function getAccountById(
  settings: TrinitecPluginSettings,
  accountId?: string
): MailAccountConfig {
  if (!accountId) return getActiveAccount(settings);
  return settings.accounts.find((a) => a.id === accountId) || getActiveAccount(settings);
}

/**
 * Synchronizuje pola aktywnego konta do top-level pól settings (pełna kompatybilność wsteczna).
 */
export function syncActiveAccountToTopLevel(settings: TrinitecPluginSettings): void {
  const acc = getActiveAccount(settings);
  settings.activeAccountId = acc.id;
  settings.mailProvider = acc.mailProvider;
  settings.mailAuthMethod = acc.mailAuthMethod;
  settings.serverDomain = acc.serverDomain;
  settings.googleOAuthClientId = acc.googleOAuthClientId;
  settings.imapHost = acc.imapHost;
  settings.imapPort = acc.imapPort;
  settings.imapSecure = acc.imapSecure;
  settings.imapUser = acc.imapUser;
  settings.smtpHost = acc.smtpHost;
  settings.smtpPort = acc.smtpPort;
  settings.smtpSecure = acc.smtpSecure;
  settings.senderName = acc.senderName;
  settings.emailSignature = acc.emailSignature;
  settings.inboxFolder = acc.inboxFolder;
  settings.sentFolder = acc.sentFolder;
  settings.draftsFolder = acc.draftsFolder;
  settings.archiveFolder = acc.archiveFolder;
  settings.spamFolder = acc.spamFolder;
  settings.trashFolder = acc.trashFolder;
  settings.allowlistFolder = acc.allowlistFolder;
  settings.appendSentToImap = acc.appendSentToImap;
  settings.strictTlsVerification = acc.strictTlsVerification;
}

/**
 * Synchronizuje top-level pola settings z powrotem do obiektu aktywnego konta w `accounts[]`.
 */
export function syncTopLevelToActiveAccount(settings: TrinitecPluginSettings): void {
  const acc = getActiveAccount(settings);
  acc.mailProvider = settings.mailProvider;
  acc.mailAuthMethod = settings.mailAuthMethod;
  acc.serverDomain = settings.serverDomain;
  acc.googleOAuthClientId = settings.googleOAuthClientId;
  acc.imapHost = settings.imapHost;
  acc.imapPort = settings.imapPort;
  acc.imapSecure = settings.imapSecure;
  acc.imapUser = settings.imapUser;
  acc.smtpHost = settings.smtpHost;
  acc.smtpPort = settings.smtpPort;
  acc.smtpSecure = settings.smtpSecure;
  acc.senderName = settings.senderName;
  acc.emailSignature = settings.emailSignature;
  acc.inboxFolder = settings.inboxFolder;
  acc.sentFolder = settings.sentFolder;
  acc.draftsFolder = settings.draftsFolder;
  acc.archiveFolder = settings.archiveFolder;
  acc.spamFolder = settings.spamFolder;
  acc.trashFolder = settings.trashFolder;
  acc.allowlistFolder = settings.allowlistFolder;
  acc.appendSentToImap = settings.appendSentToImap;
  acc.strictTlsVerification = settings.strictTlsVerification;
}

/**
 * Bezpieczna migracja i walidacja schematu ustawień (v1/v2 pojedyncze konto → v3 accounts[]):
 * - Zachowuje wszystkie ustawienia z dotychczasowego pliku data.json bez utraty danych.
 * - Chroni przed TypeError na pustym/uszkodzonym pliku.
 * - Gwarantuje, że hasła nigdy nie trafiają do data.json.
 */
export function migrateAndValidateSettings(raw: unknown): TrinitecPluginSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // Migracja legacy 1-konto -> accounts[]
  let accounts: MailAccountConfig[];
  if (Array.isArray(src.accounts) && src.accounts.length > 0) {
    accounts = src.accounts
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === "object"))
      .map((a, idx) => sanitizeAccount(a, idx));
    if (accounts.length === 0) {
      accounts = [sanitizeAccount(src, 0)];
    }
  } else {
    // Stary format data.json (pojedyncze konto na poziomie głównym)
    accounts = [sanitizeAccount({ ...src, id: "default" }, 0)];
  }

  const rawActiveId = asString(src.activeAccountId, accounts[0].id);
  const activeAccount = accounts.find((a) => a.id === rawActiveId) || accounts[0];

  const rawRegex = asNonEmptyString(src.projectCodeRegex, DEFAULT_SETTINGS.projectCodeRegex);
  const regexCheck = validateSafeRegexPattern(rawRegex);
  const projectCodeRegex = regexCheck.ok ? rawRegex : DEFAULT_SETTINGS.projectCodeRegex;

  const rawSubfolders = Array.isArray(src.projectSubfolders)
    ? src.projectSubfolders
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim())
    : DEFAULT_SETTINGS.projectSubfolders;

  const rawCategories = Array.isArray(src.aiCategories)
    ? src.aiCategories
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
        .map((c, idx) => {
          const keywords = Array.isArray(c.keywords)
            ? c.keywords.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
            : [];
          const regexPattern =
            typeof c.regexPattern === "string" && validateSafeRegexPattern(c.regexPattern).ok
              ? c.regexPattern.trim()
              : undefined;
          return {
            id: asNonEmptyString(c.id, `cat-${idx + 1}`),
            label: asNonEmptyString(c.label, `Kategoria ${idx + 1}`),
            imapFolder: asNonEmptyString(c.imapFolder, "INBOX"),
            vaultTopic: asNonEmptyString(c.vaultTopic, "Korespondencja"),
            keywords,
            ...(regexPattern ? { regexPattern } : {}),
          };
        })
    : DEFAULT_SETTINGS.aiCategories;

  const rawRules: ClientMailRule[] = Array.isArray(src.mailRules)
    ? src.mailRules
        .filter((r): r is Record<string, unknown> => Boolean(r && typeof r === "object"))
        .map((r, idx) => {
          const condsRaw = Array.isArray(r.conditions) ? r.conditions : [];
          const conditions: MailRuleCondition[] = condsRaw
            .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === "object"))
            .map((c) => {
              const field =
                c.field === "from" ||
                c.field === "subject" ||
                c.field === "domain" ||
                c.field === "hasAttachment"
                  ? c.field
                  : "from";
              return {
                field,
                contains: typeof c.contains === "string" ? c.contains.trim() : undefined,
                hasAttachment:
                  typeof c.hasAttachment === "boolean" ? c.hasAttachment : undefined,
              };
            });
          const actRaw =
            r.actions && typeof r.actions === "object"
              ? (r.actions as Record<string, unknown>)
              : {};
          return {
            id: asNonEmptyString(r.id, `rule-${idx + 1}`),
            name: asNonEmptyString(r.name, `Reguła ${idx + 1}`),
            enabled: asBoolean(r.enabled, true),
            matchAll: asBoolean(r.matchAll, false),
            conditions,
            actions: {
              star: asBoolean(actRaw.star, false) || undefined,
              markRead: asBoolean(actRaw.markRead, false) || undefined,
              moveToFolder:
                typeof actRaw.moveToFolder === "string" && actRaw.moveToFolder.trim()
                  ? actRaw.moveToFolder.trim()
                  : undefined,
              suggestProjectCode:
                typeof actRaw.suggestProjectCode === "string" && actRaw.suggestProjectCode.trim()
                  ? actRaw.suggestProjectCode.trim()
                  : undefined,
            },
          };
        })
    : [];

  const trustedImageSenders = Array.isArray(src.trustedImageSenders)
    ? Array.from(
        new Set(
          src.trustedImageSenders
            .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
            .map((s) => s.trim().toLowerCase())
        )
      )
    : [];

  const validModes = new Set(["suggest", "auto"]);
  const asApplyMode = (val: unknown, fb: "suggest" | "auto"): "suggest" | "auto" =>
    typeof val === "string" && validModes.has(val) ? (val as "suggest" | "auto") : fb;

  const settings: TrinitecPluginSettings = {
    settingsVersion: 3,

    activeProjectsDir: asNonEmptyString(src.activeProjectsDir, DEFAULT_SETTINGS.activeProjectsDir),
    archiveProjectsDir: asNonEmptyString(
      src.archiveProjectsDir,
      DEFAULT_SETTINGS.archiveProjectsDir
    ),
    contactsDir: asNonEmptyString(src.contactsDir, DEFAULT_SETTINGS.contactsDir),
    baseFilePath: asString(src.baseFilePath, DEFAULT_SETTINGS.baseFilePath).trim(),
    globalAssetsDir: asNonEmptyString(src.globalAssetsDir, DEFAULT_SETTINGS.globalAssetsDir),
    replyTemplatesDir: asNonEmptyString(src.replyTemplatesDir, DEFAULT_SETTINGS.replyTemplatesDir),
    projectCodeRegex,
    masterNotePrefix: asString(src.masterNotePrefix, DEFAULT_SETTINGS.masterNotePrefix),
    projectSubfolders:
      rawSubfolders.length > 0 ? rawSubfolders : DEFAULT_SETTINGS.projectSubfolders,

    accounts,
    activeAccountId: activeAccount.id,
    unifiedInboxEnabled: asBoolean(src.unifiedInboxEnabled, false),

    mailProvider: activeAccount.mailProvider,
    mailAuthMethod: activeAccount.mailAuthMethod,
    serverDomain: activeAccount.serverDomain,
    googleOAuthClientId: activeAccount.googleOAuthClientId,
    imapHost: activeAccount.imapHost,
    imapPort: activeAccount.imapPort,
    imapSecure: activeAccount.imapSecure,
    imapUser: activeAccount.imapUser,
    smtpHost: activeAccount.smtpHost,
    smtpPort: activeAccount.smtpPort,
    smtpSecure: activeAccount.smtpSecure,
    senderName: activeAccount.senderName,
    emailSignature: activeAccount.emailSignature,
    inboxFolder: activeAccount.inboxFolder,
    sentFolder: activeAccount.sentFolder,
    draftsFolder: activeAccount.draftsFolder,
    archiveFolder: activeAccount.archiveFolder,
    spamFolder: activeAccount.spamFolder,
    trashFolder: activeAccount.trashFolder,
    allowlistFolder: activeAccount.allowlistFolder,
    quotaWarnPercent: asRangeNumber(src.quotaWarnPercent, 10, 99, DEFAULT_SETTINGS.quotaWarnPercent),

    enableImapIdle: asBoolean(src.enableImapIdle, DEFAULT_SETTINGS.enableImapIdle),
    desktopNotifications: asBoolean(src.desktopNotifications, DEFAULT_SETTINGS.desktopNotifications),
    nonIntrusivePeek: asBoolean(src.nonIntrusivePeek, DEFAULT_SETTINGS.nonIntrusivePeek),
    autoMarkReadDelaySec: asRangeNumber(src.autoMarkReadDelaySec, 0, 30, 0),
    appendSentToImap: activeAccount.appendSentToImap,
    stripQuotesAndSignatures: asBoolean(
      src.stripQuotesAndSignatures,
      DEFAULT_SETTINGS.stripQuotesAndSignatures
    ),
    blockRemoteImagesByDefault: asBoolean(
      src.blockRemoteImagesByDefault,
      DEFAULT_SETTINGS.blockRemoteImagesByDefault
    ),
    trustedImageSenders,
    saveRawEmlCopy: asBoolean(src.saveRawEmlCopy, DEFAULT_SETTINGS.saveRawEmlCopy),
    strictTlsVerification: activeAccount.strictTlsVerification,
    maxAttachmentSizeMb: asRangeNumber(
      src.maxAttachmentSizeMb,
      1,
      250,
      DEFAULT_SETTINGS.maxAttachmentSizeMb
    ),

    layoutMode:
      src.layoutMode === "classic-split" || src.layoutMode === "three-column"
        ? src.layoutMode
        : DEFAULT_SETTINGS.layoutMode,
    foldersCollapsed: asBoolean(src.foldersCollapsed, false),
    messageListMode:
      src.messageListMode === "list" || src.messageListMode === "threads"
        ? src.messageListMode
        : DEFAULT_SETTINGS.messageListMode,
    readerThemeMode:
      src.readerThemeMode === "force-dark" ||
      src.readerThemeMode === "markdown" ||
      src.readerThemeMode === "original-light"
        ? src.readerThemeMode
        : DEFAULT_SETTINGS.readerThemeMode,

    mailRules: rawRules,

    optInStrictMode: asBoolean(src.optInStrictMode, DEFAULT_SETTINGS.optInStrictMode),
    defaultSaveMode:
      src.defaultSaveMode === "append-note" || src.defaultSaveMode === "new-file"
        ? src.defaultSaveMode
        : DEFAULT_SETTINGS.defaultSaveMode,
    attachmentsTarget:
      src.attachmentsTarget === "global-assets" || src.attachmentsTarget === "project-attachments"
        ? src.attachmentsTarget
        : DEFAULT_SETTINGS.attachmentsTarget,
    fileNamePattern: asNonEmptyString(src.fileNamePattern, DEFAULT_SETTINGS.fileNamePattern),
    defaultElectricalTopic: asNonEmptyString(
      src.defaultElectricalTopic,
      DEFAULT_SETTINGS.defaultElectricalTopic
    ),
    autoDetectTasks: asBoolean(src.autoDetectTasks, DEFAULT_SETTINGS.autoDetectTasks),

    cliExecutablePath: asNonEmptyString(src.cliExecutablePath, DEFAULT_SETTINGS.cliExecutablePath),
    aiAnalyzeIncomingImap: asBoolean(
      src.aiAnalyzeIncomingImap,
      DEFAULT_SETTINGS.aiAnalyzeIncomingImap
    ),
    aiAnalyzeVaultNotes: asBoolean(src.aiAnalyzeVaultNotes, DEFAULT_SETTINGS.aiAnalyzeVaultNotes),
    aiCategorizationEnabled: asBoolean(
      src.aiCategorizationEnabled,
      DEFAULT_SETTINGS.aiCategorizationEnabled
    ),
    aiCategorizationMode: asApplyMode(
      src.aiCategorizationMode,
      DEFAULT_SETTINGS.aiCategorizationMode
    ),
    aiFolderRoutingEnabled: asBoolean(
      src.aiFolderRoutingEnabled,
      DEFAULT_SETTINGS.aiFolderRoutingEnabled
    ),
    aiFolderRoutingMode: asApplyMode(src.aiFolderRoutingMode, DEFAULT_SETTINGS.aiFolderRoutingMode),
    aiTaskExtractionEnabled: asBoolean(
      src.aiTaskExtractionEnabled,
      DEFAULT_SETTINGS.aiTaskExtractionEnabled
    ),
    aiTaskExtractionMode: asApplyMode(
      src.aiTaskExtractionMode,
      DEFAULT_SETTINGS.aiTaskExtractionMode
    ),
    aiPrioritizationEnabled: asBoolean(
      src.aiPrioritizationEnabled,
      DEFAULT_SETTINGS.aiPrioritizationEnabled
    ),
    aiPrioritizationMode: asApplyMode(
      src.aiPrioritizationMode,
      DEFAULT_SETTINGS.aiPrioritizationMode
    ),
    aiCategories: rawCategories.length > 0 ? rawCategories : DEFAULT_SETTINGS.aiCategories,
  };

  return settings;
}
