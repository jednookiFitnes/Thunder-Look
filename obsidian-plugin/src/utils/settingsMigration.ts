import { DEFAULT_SETTINGS, TrinitecPluginSettings } from "../types";
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

/**
 * Bezpieczna migracja i walidacja schematu ustawień (chroni przed TypeError na pustym
 * lub starym pliku data.json oraz gwarantuje, że hasła nigdy nie trafią z powrotem do ustawień).
 */
export function migrateAndValidateSettings(raw: unknown): TrinitecPluginSettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  // Usuń ewentualne historyczne pola z hasłami/sekretami, gdyby ktoś wgrał stary plik ręcznie
  const validProviders = new Set(["roundcube", "gmail", "outlook", "custom"]);
  const mailProvider =
    typeof src.mailProvider === "string" && validProviders.has(src.mailProvider)
      ? (src.mailProvider as TrinitecPluginSettings["mailProvider"])
      : DEFAULT_SETTINGS.mailProvider;

  const mailAuthMethod =
    src.mailAuthMethod === "google-oauth" || src.mailAuthMethod === "password"
      ? src.mailAuthMethod
      : DEFAULT_SETTINGS.mailAuthMethod;

  const imapHost = asString(src.imapHost, DEFAULT_SETTINGS.imapHost).trim();
  const serverDomain =
    asString(src.serverDomain, "").trim() ||
    (mailProvider === "roundcube" ? imapHost || DEFAULT_SETTINGS.serverDomain : "");

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
            typeof c.regexPattern === "string" &&
            validateSafeRegexPattern(c.regexPattern).ok
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

  const validModes = new Set(["suggest", "auto"]);
  const asApplyMode = (val: unknown, fb: "suggest" | "auto"): "suggest" | "auto" =>
    typeof val === "string" && validModes.has(val) ? (val as "suggest" | "auto") : fb;

  return {
    settingsVersion: 2,

    activeProjectsDir: asNonEmptyString(src.activeProjectsDir, DEFAULT_SETTINGS.activeProjectsDir),
    archiveProjectsDir: asNonEmptyString(src.archiveProjectsDir, DEFAULT_SETTINGS.archiveProjectsDir),
    contactsDir: asNonEmptyString(src.contactsDir, DEFAULT_SETTINGS.contactsDir),
    baseFilePath: asString(src.baseFilePath, DEFAULT_SETTINGS.baseFilePath).trim(),
    globalAssetsDir: asNonEmptyString(src.globalAssetsDir, DEFAULT_SETTINGS.globalAssetsDir),
    projectCodeRegex,
    masterNotePrefix: asString(src.masterNotePrefix, DEFAULT_SETTINGS.masterNotePrefix),
    projectSubfolders: rawSubfolders.length > 0 ? rawSubfolders : DEFAULT_SETTINGS.projectSubfolders,

    mailProvider,
    mailAuthMethod,
    serverDomain,
    googleOAuthClientId: asString(src.googleOAuthClientId, DEFAULT_SETTINGS.googleOAuthClientId).trim(),
    imapHost,
    imapPort: asPort(src.imapPort, DEFAULT_SETTINGS.imapPort),
    imapSecure: asBoolean(src.imapSecure, DEFAULT_SETTINGS.imapSecure),
    imapUser: asString(src.imapUser, DEFAULT_SETTINGS.imapUser).trim(),
    smtpHost: asString(src.smtpHost, DEFAULT_SETTINGS.smtpHost).trim(),
    smtpPort: asPort(src.smtpPort, DEFAULT_SETTINGS.smtpPort),
    smtpSecure: asBoolean(src.smtpSecure, DEFAULT_SETTINGS.smtpSecure),
    senderName: asString(src.senderName, DEFAULT_SETTINGS.senderName).trim(),
    emailSignature: asString(src.emailSignature, DEFAULT_SETTINGS.emailSignature),
    inboxFolder: asNonEmptyString(src.inboxFolder, DEFAULT_SETTINGS.inboxFolder),
    sentFolder: asNonEmptyString(src.sentFolder, DEFAULT_SETTINGS.sentFolder),
    archiveFolder: asNonEmptyString(src.archiveFolder, DEFAULT_SETTINGS.archiveFolder),
    trashFolder: asNonEmptyString(src.trashFolder, DEFAULT_SETTINGS.trashFolder),
    allowlistFolder: asString(src.allowlistFolder, DEFAULT_SETTINGS.allowlistFolder).trim(),
    quotaWarnPercent: asRangeNumber(src.quotaWarnPercent, 10, 99, DEFAULT_SETTINGS.quotaWarnPercent),

    enableImapIdle: asBoolean(src.enableImapIdle, DEFAULT_SETTINGS.enableImapIdle),
    nonIntrusivePeek: asBoolean(src.nonIntrusivePeek, DEFAULT_SETTINGS.nonIntrusivePeek),
    appendSentToImap: asBoolean(src.appendSentToImap, DEFAULT_SETTINGS.appendSentToImap),
    stripQuotesAndSignatures: asBoolean(
      src.stripQuotesAndSignatures,
      DEFAULT_SETTINGS.stripQuotesAndSignatures
    ),
    blockRemoteImagesByDefault: asBoolean(
      src.blockRemoteImagesByDefault,
      DEFAULT_SETTINGS.blockRemoteImagesByDefault
    ),
    saveRawEmlCopy: asBoolean(src.saveRawEmlCopy, DEFAULT_SETTINGS.saveRawEmlCopy),
    strictTlsVerification: asBoolean(
      src.strictTlsVerification,
      DEFAULT_SETTINGS.strictTlsVerification
    ),
    maxAttachmentSizeMb: asRangeNumber(
      src.maxAttachmentSizeMb,
      1,
      200,
      DEFAULT_SETTINGS.maxAttachmentSizeMb
    ),

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
    aiFolderRoutingMode: asApplyMode(
      src.aiFolderRoutingMode,
      DEFAULT_SETTINGS.aiFolderRoutingMode
    ),
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
}
