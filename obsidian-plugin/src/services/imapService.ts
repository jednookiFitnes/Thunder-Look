import { ImapFlow, type MessageStructureObject } from "imapflow";
import {
  buildPolishImapErrorHint,
  isGmailHostname,
  isOutlookHostname,
} from "../../../shared/networkSecurity";
import {
  buildImapSearchCriteria,
  calculateMailboxTotals,
  deduplicateLargestMessages,
  detectFolderRole,
  isSystemFolder,
  normalizeQuotaValues,
  parseSearchQuery,
  resolveSpecialFolders,
  validateImapFolderName,
  type SpecialFoldersMap,
} from "../../../shared/folderMapper";
import {
  FolderStorageInfo,
  ImapConnectionTestOverride,
  ImapConnectionTestResult,
  ImapFolderSummary,
  ImapMessageHeader,
  LargeMessageInfo,
  LazyAttachmentMeta,
  MailAccountConfig,
  MailboxQuotaReport,
  ParsedEmailMessage,
  TrinitecPluginSettings,
} from "../types";
import { getAccountById } from "../utils/settingsMigration";
import { naturalCompare } from "../utils/textUtils";
import { parseRawEmlBuffer } from "./mailParserService";
import { SecretService } from "./secretService";
import { GoogleOAuthService } from "./googleOAuthService";
import { MailCacheService } from "./mailCacheService";
import { PriorityTaskQueue, TaskTimeoutError, type TaskPriority } from "../../../shared/taskQueue";

const CONNECTION_TIMEOUT_MS = 12_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 35_000;
const FETCH_BODY_TIMEOUT_MS = 10_000;
const DEFAULT_OP_TIMEOUT_MS = 22_000;
const PREFETCH_MAX_BYTES = 200 * 1024; // 200 KB
const KEEP_ALIVE_INTERVAL_MS = 4 * 60 * 1000;
const IDLE_RENEW_INTERVAL_MS = 14 * 60 * 1000; // RFC 2177 (<15 min)
const WAKE_CHECK_INTERVAL_MS = 30_000;
const DEFAULT_PAGE_SIZE = 50;

export interface IdleNewMailEvent {
  accountId: string;
  accountLabel: string;
  accountColor: string;
  folder: string;
  newHeaders: ImapMessageHeader[];
  totalUnseen: number;
}

export interface ListMessagesPageResult {
  headers: ImapMessageHeader[];
  hasMore: boolean;
  totalOnServer: number;
  uidValidity: string;
  uidNext?: number;
  fromCache: boolean;
}

interface AccountSession {
  accountId: string;
  signature: string;
  client: ImapFlow | null;
  connecting: Promise<ImapFlow> | null;
  queue: PriorityTaskQueue;
  keepAliveTimer: ReturnType<typeof setInterval> | null;
  lastUsedAt: number;
}

interface AccountIdleHandle {
  accountId: string;
  client: ImapFlow | null;
  renewTimer: ReturnType<typeof setInterval> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
  attempt: number;
  lastSeenMaxUid: number;
}

function isTransientNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("eai_again") ||
    msg.includes("socket closed") ||
    msg.includes("connection closed") ||
    msg.includes("connection not available") ||
    msg.includes("timeout") ||
    msg.includes("broken pipe")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractAttachmentsFromBodyStructure(
  node: MessageStructureObject | undefined,
  out: LazyAttachmentMeta[] = []
): LazyAttachmentMeta[] {
  if (!node) return out;
  if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
    for (const child of node.childNodes) {
      extractAttachmentsFromBodyStructure(child, out);
    }
    return out;
  }

  const disposition = (node.disposition || "").toLowerCase();
  const dispParams = node.dispositionParameters as Record<string, string> | undefined;
  const params = node.parameters as Record<string, string> | undefined;
  const filename = dispParams?.filename || params?.name || "";
  const type = (node.type || "").toLowerCase();

  const isAttachment =
    disposition === "attachment" ||
    (Boolean(filename) && !type.startsWith("text/plain") && !type.startsWith("text/html"));

  if (isAttachment && node.part) {
    out.push({
      partId: String(node.part),
      filename: filename || `zalacznik-${node.part}.bin`,
      contentType: node.type || "application/octet-stream",
      size: typeof node.size === "number" ? node.size : 0,
      encoding: node.encoding,
    });
  }
  return out;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Wydajny, wielokontowy klient IMAP (imapflow) z trwałym menedżerem sesji:
 * - Pojedyncze, trwałe połączenie TCP/TLS per konto z kolejkowaniem operacji (mutex), keep-alive NOOP i auto-reconnectem.
 * - Paginacja po 50 nagłówków (UID, FLAGS, ENVELOPE, INTERNALDATE, RFC822.SIZE, BODYSTRUCTURE) + delta sync po UIDNEXT.
 * - Leniwe pobieranie treści (BODY.PEEK[]) i dużych załączników (partId) + cichy prefetch sąsiednich maili.
 * - Pełne operacje pocztowe: MOVE/Kosz/Trwałe usuwanie/Archiwum/Spam/Flagi/Foldery CRUD/Szkice/IMAP SEARCH/X-GM-RAW.
 * - Stabilny, osobny IMAP IDLE per konto z bezpiecznym odnawianiem co 14 min (RFC 2177) i wznawianiem po wybudzeniu.
 */
export class ImapService {
  private settings: TrinitecPluginSettings;
  private secretService: SecretService;
  private googleOAuthService: GoogleOAuthService;
  private cacheService: MailCacheService;

  private sessions = new Map<string, AccountSession>();
  private idleHandles = new Map<string, AccountIdleHandle>();
  private wakeWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private lastWakeTick = Date.now();
  private idleCallback: ((event: IdleNewMailEvent) => void) | null = null;
  private prefetchInFlight = new Set<string>();
  private prefetchControllers = new Map<string, AbortController>();

  constructor(
    settings: TrinitecPluginSettings,
    secretService: SecretService,
    cacheService: MailCacheService,
    googleOAuthService?: GoogleOAuthService
  ) {
    this.settings = settings;
    this.secretService = secretService;
    this.cacheService = cacheService;
    this.googleOAuthService = googleOAuthService ?? new GoogleOAuthService(secretService);
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
    // Zresetuj tylko te sesje, których parametry połączenia uległy zmianie
    for (const [accId, session] of this.sessions.entries()) {
      const account = this.resolveAccount(accId);
      const nextSig = this.accountSignature(account);
      if (session.signature !== nextSig) {
        void this.disconnectAccount(accId);
      }
    }
  }

  resolveAccount(accountId?: string): MailAccountConfig {
    return getAccountById(this.settings, accountId);
  }

  isGmailServer(host?: string, accountId?: string): boolean {
    const resolvedHost = host ?? this.resolveAccount(accountId).imapHost;
    return isGmailHostname(resolvedHost);
  }

  private detectProvider(host: string, account?: MailAccountConfig): "gmail" | "outlook" | "roundcube" | "imap" {
    if (isGmailHostname(host)) return "gmail";
    if (isOutlookHostname(host)) return "outlook";
    if (
      host.toLowerCase().includes("roundcube") ||
      (account?.mailProvider ?? this.settings.mailProvider) === "roundcube"
    ) {
      return "roundcube";
    }
    return "imap";
  }

  private accountSignature(acc: MailAccountConfig): string {
    return [
      acc.id,
      acc.imapHost.trim().toLowerCase(),
      acc.imapPort,
      acc.imapSecure ? "1" : "0",
      acc.imapUser.trim().toLowerCase(),
      acc.mailAuthMethod,
      acc.strictTlsVerification ? "1" : "0",
    ].join("|");
  }

  private async resolveAuthConfig(
    account: MailAccountConfig,
    override?: ImapConnectionTestOverride
  ): Promise<{ user: string; pass?: string; accessToken?: string }> {
    const authMethod = override?.authMethod ?? account.mailAuthMethod;
    const host = (override?.host ?? account.imapHost).trim();
    const configuredUser = (override?.user ?? account.imapUser).trim();

    if (authMethod === "google-oauth" && isGmailHostname(host)) {
      const token = await this.googleOAuthService.getValidAccessToken(
        account.googleOAuthClientId || this.settings.googleOAuthClientId,
        account.id
      );
      const user = configuredUser || token.email;
      if (!user) {
        throw new Error("Brak adresu e-mail dla sesji Google OAuth2.");
      }
      return { user, accessToken: token.accessToken };
    }

    const password =
      override?.password !== undefined && override.password.length > 0
        ? override.password
        : await this.secretService.getMailPassword(account.id);

    if (!configuredUser || !password) {
      throw new Error(
        `Brak pełnej konfiguracji IMAP (login lub hasło) dla konta „${account.label}”. Uzupełnij dane w ustawieniach Thunder Look.`
      );
    }

    return { user: configuredUser, pass: password };
  }

  private async createClient(
    account: MailAccountConfig,
    override?: ImapConnectionTestOverride
  ): Promise<ImapFlow> {
    const host = (override?.host ?? account.imapHost).trim();
    const port = override?.port ?? account.imapPort;
    const secure = override?.secure ?? account.imapSecure;
    const strictTls = override?.strictTls ?? account.strictTlsVerification;

    if (!host) {
      throw new Error(
        "Brak adresu serwera IMAP (np. trinitec.pl, mail.twojadomena.pl lub imap.gmail.com)."
      );
    }

    const auth = await this.resolveAuthConfig(account, override);

    return new ImapFlow({
      host,
      port,
      secure,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      tls: {
        rejectUnauthorized: strictTls,
        minVersion: "TLSv1.2",
      },
      auth: auth.accessToken
        ? { user: auth.user, accessToken: auth.accessToken }
        : { user: auth.user, pass: auth.pass },
      logger: false,
    });
  }

  private async safeCloseClient(client: ImapFlow | null, fast = false): Promise<void> {
    if (!client) return;
    try {
      if (fast) {
        client.close();
        return;
      }
      await Promise.race([
        client.logout(),
        sleep(1500).then(() => {
          client.close();
        }),
      ]);
    } catch {
      try {
        client.close();
      } catch {
        // ignore
      }
    }
  }

  // ============================================================================
  // Trwały Connection Manager per konto (mutex + NOOP keep-alive + auto-reconnect)
  // ============================================================================

  private getOrCreateSession(account: MailAccountConfig): AccountSession {
    const sig = this.accountSignature(account);
    const existing = this.sessions.get(account.id);
    if (existing && existing.signature === sig) {
      return existing;
    }
    if (existing) {
      void this.disconnectAccount(account.id);
    }
    const created: AccountSession = {
      accountId: account.id,
      signature: sig,
      client: null,
      connecting: null,
      queue: new PriorityTaskQueue(),
      keepAliveTimer: null,
      lastUsedAt: Date.now(),
    };
    this.sessions.set(account.id, created);
    return created;
  }

  private async ensureSessionClient(session: AccountSession, account: MailAccountConfig): Promise<ImapFlow> {
    if (session.client && session.client.usable) {
      session.lastUsedAt = Date.now();
      return session.client;
    }

    if (session.connecting) {
      return session.connecting;
    }

    session.connecting = (async () => {
      if (session.client) {
        await this.safeCloseClient(session.client, true);
        session.client = null;
      }
      const client = await this.createClient(account);
      client.on("error", () => {
        if (session.client === client) {
          session.client = null;
        }
      });
      client.on("close", () => {
        if (session.client === client) {
          session.client = null;
        }
      });
      await client.connect();
      session.client = client;
      session.lastUsedAt = Date.now();
      this.ensureKeepAliveTimer(session);
      return client;
    })();

    try {
      return await session.connecting;
    } finally {
      session.connecting = null;
    }
  }

  private ensureKeepAliveTimer(session: AccountSession): void {
    if (session.keepAliveTimer) return;
    session.keepAliveTimer = setInterval(() => {
      if (!session.client || !session.client.usable) return;
      if (Date.now() - session.lastUsedAt < KEEP_ALIVE_INTERVAL_MS - 30_000) return;
      if (session.queue.isRunning || session.queue.pendingCount > 0) return;
      void session.queue
        .enqueue(
          async () => {
            if (session.client && session.client.usable) {
              await session.client.noop();
              session.lastUsedAt = Date.now();
            }
          },
          { priority: "low", timeoutMs: 8_000, tag: "keepalive" }
        )
        .catch(() => {
          session.client = null;
        });
    }, KEEP_ALIVE_INTERVAL_MS);
  }

  /**
   * Natychmiast anuluje oczekujące i aktywne zadania prefetchu (dla wybranego konta lub wszystkich),
   * aby kliknięcie wiadomości przez użytkownika nigdy nie czekało za prefetchowaniem.
   */
  abortPrefetch(accountId?: string): void {
    if (accountId) {
      const ctrl = this.prefetchControllers.get(accountId);
      if (ctrl) {
        ctrl.abort();
        this.prefetchControllers.delete(accountId);
      }
      const session = this.sessions.get(accountId);
      session?.queue.cancelPendingByTag("prefetch");
      return;
    }

    for (const ctrl of this.prefetchControllers.values()) {
      ctrl.abort();
    }
    this.prefetchControllers.clear();
    for (const session of this.sessions.values()) {
      session.queue.cancelPendingByTag("prefetch");
    }
  }

  /**
   * Serializuje operację na trwałej sesji IMAP danego konta przez kolejkę priorytetową:
   * - "high" (kliknięcie maila, flagi, usuwanie/przenoszenie) wyprzedza "normal" i "low" (prefetch).
   * - Twardy timeout per próba + natychmiastowe zamknięcie zawieszonego gniazda i 1 ponowienie na świeżej sesji.
   */
  private runWithSession<T>(
    accountId: string | undefined,
    operation: (client: ImapFlow, account: MailAccountConfig) => Promise<T>,
    signalOrOpts?:
      | AbortSignal
      | {
          signal?: AbortSignal;
          priority?: TaskPriority;
          timeoutMs?: number;
          tag?: string;
        }
  ): Promise<T> {
    const account = this.resolveAccount(accountId);
    const session = this.getOrCreateSession(account);

    const opts =
      signalOrOpts && "aborted" in signalOrOpts
        ? { signal: signalOrOpts }
        : signalOrOpts || {};

    const priority: TaskPriority = opts.priority ?? "normal";
    const signal = opts.signal;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_OP_TIMEOUT_MS;
    const tag = opts.tag;

    if (priority === "high") {
      this.abortPrefetch(account.id);
    }

    const runWithHardTimeout = async (
      client: ImapFlow,
      acc: MailAccountConfig
    ): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      try {
        return await Promise.race([
          operation(client, acc),
          new Promise<never>((_res, rej) => {
            timer = setTimeout(() => {
              rej(new TaskTimeoutError(timeoutMs));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const run = async (): Promise<T> => {
      if (signal?.aborted) {
        throw new Error("ABORTED");
      }

      for (let attempt = 1; attempt <= 2; attempt++) {
        if (signal?.aborted) throw new Error("ABORTED");
        const client = await this.ensureSessionClient(session, account);
        try {
          const result = await runWithHardTimeout(client, account);
          session.lastUsedAt = Date.now();
          return result;
        } catch (err) {
          if (signal?.aborted) throw new Error("ABORTED");
          const isTimeout = err instanceof TaskTimeoutError;
          if (isTimeout || !client.usable || isTransientNetworkError(err)) {
            await this.safeCloseClient(session.client, true);
            session.client = null;
            if (attempt < 2) {
              await sleep(200);
              continue;
            }
          }
          throw err;
        }
      }
      throw new Error("Nie udało się wykonać operacji IMAP.");
    };

    return session.queue.enqueue(run, {
      priority,
      signal,
      tag,
    });
  }

  async disconnectAccount(accountId: string): Promise<void> {
    this.abortPrefetch(accountId);
    const session = this.sessions.get(accountId);
    if (!session) return;
    this.sessions.delete(accountId);
    session.queue.clearAllPending("DISCONNECTED");
    if (session.keepAliveTimer) {
      clearInterval(session.keepAliveTimer);
      session.keepAliveTimer = null;
    }
    const client = session.client;
    session.client = null;
    await this.safeCloseClient(client, true);
  }

  /**
   * Natychmiastowe, nieblokujące zamknięcie wszystkich połączeń roboczych i IDLE (wywoływane w onunload).
   */
  async disconnectAll(): Promise<void> {
    await this.stopIdleWatcher();
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.disconnectAccount(id)));
  }

  // ============================================================================
  // Test połączenia (dedykowany, odizolowany klient diagnostyczny)
  // ============================================================================

  async testConnection(
    override?: ImapConnectionTestOverride
  ): Promise<ImapConnectionTestResult> {
    const account = this.resolveAccount(override?.accountId);
    const host = (override?.host ?? account.imapHost).trim();
    const port = override?.port ?? account.imapPort;
    const secure = override?.secure ?? account.imapSecure;
    const started = Date.now();
    const providerDetected = this.detectProvider(host, account);

    let client: ImapFlow | null = null;
    try {
      client = await this.createClient(account, override);
      await client.connect();

      const capabilities = Array.from(client.capabilities.keys()).sort();
      const boxes = await client.list();
      const selectableBoxes = boxes.filter((b) => !b.flags?.has("\\Noselect"));
      const sentBox =
        selectableBoxes.find((b) => detectFolderRole(b.path, b.specialUse) === "sent") || null;

      let inboxMessages = 0;
      let inboxUnseen = 0;
      try {
        const st = await client.status(account.inboxFolder || "INBOX", {
          messages: true,
          unseen: true,
        });
        inboxMessages = st.messages ?? 0;
        inboxUnseen = st.unseen ?? 0;
      } catch {
        // Ignoruj brak dostępu do statusu INBOX
      }

      let quotaUsedBytes: number | null = null;
      let quotaLimitBytes: number | null = null;
      try {
        const quota = await client.getQuota(account.inboxFolder || "INBOX");
        if (quota && typeof quota !== "boolean" && quota.storage) {
          const storage = quota.storage as { usage?: number; used?: number; limit?: number };
          const normalized = normalizeQuotaValues({
            rawUsage: storage.usage ?? storage.used ?? null,
            rawLimit: storage.limit ?? null,
            calculatedBytes: 0,
            isGmail: isGmailHostname(host),
          });
          quotaUsedBytes = normalized.usedBytes || null;
          quotaLimitBytes = normalized.limitBytes;
        }
      } catch {
        // Serwer nie wspiera RFC 2087 QUOTA
      }

      return {
        ok: true,
        providerDetected,
        latencyMs: Date.now() - started,
        host,
        port,
        secure,
        capabilities,
        folderCount: selectableBoxes.length,
        inboxMessages,
        inboxUnseen,
        sentFolderDetected: sentBox?.path ?? null,
        quotaUsedBytes,
        quotaLimitBytes,
      };
    } catch (err) {
      const imapErr = err as {
        message?: string;
        responseText?: string;
        authenticationFailed?: boolean;
      };
      const baseMsg = err instanceof Error ? err.message : String(err);
      const serverText =
        typeof imapErr?.responseText === "string" && imapErr.responseText.trim()
          ? imapErr.responseText.trim()
          : "";
      const rawMessage = serverText
        ? `${serverText}${baseMsg && !serverText.includes(baseMsg) ? ` (${baseMsg})` : ""}`
        : imapErr?.authenticationFailed
        ? `Authentication failed (${baseMsg})`
        : baseMsg;
      return {
        ok: false,
        providerDetected,
        latencyMs: Date.now() - started,
        host,
        port,
        secure,
        capabilities: [],
        folderCount: 0,
        inboxMessages: 0,
        inboxUnseen: 0,
        sentFolderDetected: null,
        quotaUsedBytes: null,
        quotaLimitBytes: null,
        error: rawMessage,
        hint: buildPolishImapErrorHint(rawMessage, host, port, secure),
      };
    } finally {
      await this.safeCloseClient(client);
    }
  }

  // ============================================================================
  // Foldery + Special Folders
  // ============================================================================

  async listFolders(
    preferCacheOnFailure = true,
    accountId?: string
  ): Promise<{ folders: ImapFolderSummary[]; fromCache: boolean }> {
    const acc = this.resolveAccount(accountId);
    try {
      const folders = await this.runWithSession(acc.id, async (client) => {
        const out: ImapFolderSummary[] = [];
        const boxes = await client.list({ statusQuery: { messages: true, unseen: true, uidValidity: true, uidNext: true } });
        for (const box of boxes) {
          if (box.flags?.has("\\Noselect")) continue;
          const role = detectFolderRole(box.path, box.specialUse);
          if (box.status) {
            out.push({
              path: box.path,
              messages: box.status.messages || 0,
              unseen: box.status.unseen || 0,
              uidValidity: box.status.uidValidity ? String(box.status.uidValidity) : "0",
              uidNext: box.status.uidNext ? Number(box.status.uidNext) : undefined,
              specialUse: box.specialUse,
              delimiter: box.delimiter,
              role,
              accountId: acc.id,
            });
          } else {
            try {
              const st = await client.status(box.path, {
                messages: true,
                unseen: true,
                uidValidity: true,
                uidNext: true,
              });
              out.push({
                path: box.path,
                messages: st.messages || 0,
                unseen: st.unseen || 0,
                uidValidity: st.uidValidity ? String(st.uidValidity) : "0",
                uidNext: st.uidNext ? Number(st.uidNext) : undefined,
                specialUse: box.specialUse,
                delimiter: box.delimiter,
                role,
                accountId: acc.id,
              });
            } catch {
              out.push({
                path: box.path,
                messages: 0,
                unseen: 0,
                uidValidity: "0",
                specialUse: box.specialUse,
                delimiter: box.delimiter,
                role,
                accountId: acc.id,
              });
            }
          }
        }
        return out.sort((a, b) => naturalCompare(a.path, b.path));
      });

      await this.cacheService.setFolderList(folders, acc.id);
      return { folders, fromCache: false };
    } catch (err) {
      if (preferCacheOnFailure) {
        const cached = await this.cacheService.getFolderList(acc.id);
        if (cached && cached.length > 0) {
          return { folders: cached, fromCache: true };
        }
      }
      throw err;
    }
  }

  async getSpecialFolders(accountId?: string): Promise<SpecialFoldersMap> {
    const acc = this.resolveAccount(accountId);
    let folders = this.cacheService.getFolderListSync(acc.id);
    if (!folders || folders.length === 0) {
      folders = (await this.cacheService.getFolderList(acc.id)) || [];
    }
    if (folders.length === 0) {
      try {
        const fresh = await this.listFolders(true, acc.id);
        folders = fresh.folders;
      } catch {
        folders = [];
      }
    }
    return resolveSpecialFolders(folders, acc.imapHost, {
      inboxFolder: acc.inboxFolder,
      sentFolder: acc.sentFolder,
      draftsFolder: acc.draftsFolder,
      archiveFolder: acc.archiveFolder,
      spamFolder: acc.spamFolder,
      trashFolder: acc.trashFolder,
    });
  }

  // ============================================================================
  // Paginacja, Delta Sync i lekkie nagłówki
  // ============================================================================

  private mapFetchedHeader(
    msg: {
      uid: number;
      envelope?: {
        messageId?: string;
        inReplyTo?: string;
        subject?: string;
        from?: Array<{ name?: string; address?: string }>;
        to?: Array<{ name?: string; address?: string }>;
      };
      flags?: Set<string>;
      size?: number;
      internalDate?: Date | string;
      bodyStructure?: MessageStructureObject;
      headers?: Buffer;
    },
    folder: string,
    uidValidity: string,
    account: MailAccountConfig,
    projectRegex: RegExp
  ): ImapMessageHeader {
    const fromEntry = msg.envelope?.from?.[0];
    const toEntry = msg.envelope?.to?.[0];
    const subject = msg.envelope?.subject || "(Bez tematu)";
    const dateObj = msg.internalDate ? new Date(msg.internalDate) : new Date();
    const codeMatch = subject.match(projectRegex);
    const rawHeaderText = msg.headers ? msg.headers.toString("utf8") : "";
    const refMatches = rawHeaderText.match(/<[^>]+>/g) || [];
    const attachmentParts = extractAttachmentsFromBodyStructure(msg.bodyStructure);

    return {
      uid: msg.uid,
      folder,
      accountId: account.id,
      accountLabel: account.label,
      accountColor: account.color,
      uidValidity,
      messageId: msg.envelope?.messageId || "",
      inReplyTo: msg.envelope?.inReplyTo || "",
      references: refMatches,
      date: dateObj.toISOString().slice(0, 10),
      internalDateIso: dateObj.toISOString(),
      fromName: fromEntry?.name || fromEntry?.address || "Nieznany",
      fromEmail: fromEntry?.address || "",
      toEmail: toEntry?.address || "",
      subject,
      hasAttachments: attachmentParts.length > 0,
      attachmentParts: attachmentParts.length > 0 ? attachmentParts : undefined,
      sizeBytes: msg.size || 0,
      seen: msg.flags?.has("\\Seen") ?? false,
      flagged: msg.flags?.has("\\Flagged") ?? false,
      detectedProjectCode: codeMatch ? codeMatch[0] : null,
    };
  }

  async listMessagesPage(
    folder: string,
    options?: {
      pageSize?: number;
      beforeUid?: number;
      accountId?: string;
      signal?: AbortSignal;
    }
  ): Promise<ListMessagesPageResult> {
    const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    const acc = this.resolveAccount(options?.accountId);
    const projectRegex = this.safeProjectRegex();

    const result = await this.runWithSession(
      acc.id,
      async (client, account) => {
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const mailbox = client.mailbox;
          const total = mailbox && typeof mailbox !== "boolean" ? mailbox.exists : 0;
          const uidValidity =
            mailbox && typeof mailbox !== "boolean" && mailbox.uidValidity
              ? String(mailbox.uidValidity)
              : "0";
          const uidNext =
            mailbox && typeof mailbox !== "boolean" && mailbox.uidNext
              ? Number(mailbox.uidNext)
              : undefined;

          if (total === 0) {
            return {
              headers: [] as ImapMessageHeader[],
              hasMore: false,
              totalOnServer: 0,
              uidValidity,
              uidNext,
            };
          }

          const headers: ImapMessageHeader[] = [];
          let hasMore = false;

          if (options?.beforeUid && options.beforeUid > 1) {
            // Pobierz starszą paczkę (UID < beforeUid)
            const allOlderUids = await client.search(
              { uid: `1:${options.beforeUid - 1}` },
              { uid: true }
            );
            const uidList = Array.isArray(allOlderUids) ? allOlderUids : [];
            if (uidList.length > 0) {
              uidList.sort((a, b) => a - b);
              const sliceStart = Math.max(0, uidList.length - pageSize);
              hasMore = sliceStart > 0;
              const pageUids = uidList.slice(sliceStart);
              for await (const msg of client.fetch(
                pageUids,
                {
                  uid: true,
                  envelope: true,
                  flags: true,
                  size: true,
                  internalDate: true,
                  bodyStructure: true,
                  headers: ["references"],
                },
                { uid: true }
              )) {
                headers.push(this.mapFetchedHeader(msg, folder, uidValidity, account, projectRegex));
              }
            }
          } else {
            const startSeq = Math.max(1, total - pageSize + 1);
            hasMore = startSeq > 1;
            for await (const msg of client.fetch(`${startSeq}:${total}`, {
              uid: true,
              envelope: true,
              flags: true,
              size: true,
              internalDate: true,
              bodyStructure: true,
              headers: ["references"],
            })) {
              headers.push(this.mapFetchedHeader(msg, folder, uidValidity, account, projectRegex));
            }
          }

          headers.sort((a, b) => b.uid - a.uid);
          return { headers, hasMore, totalOnServer: total, uidValidity, uidNext };
        } finally {
          lock.release();
        }
      },
      options?.signal
    );

    const merged = await this.cacheService.mergeFolderHeaders(
      folder,
      result.uidValidity,
      result.headers,
      acc.id,
      { uidNext: result.uidNext, totalOnServer: result.totalOnServer }
    );

    const finalHeaders = options?.beforeUid ? merged : result.headers;
    const computedHasMore = options?.beforeUid
      ? result.hasMore && result.headers.length >= pageSize && finalHeaders.length < result.totalOnServer
      : result.hasMore && result.totalOnServer > 0 && finalHeaders.length < result.totalOnServer;

    return {
      headers: finalHeaders,
      hasMore: computedHasMore,
      totalOnServer: result.totalOnServer,
      uidValidity: result.uidValidity,
      uidNext: result.uidNext,
      fromCache: false,
    };
  }

  /**
   * Stale-While-Revalidate delta sync:
   * Jeśli UIDVALIDITY się zgadza, pobiera TYLKO nowe UID (> maxCachedUid) oraz odświeża flagi/usunięcia
   * dla aktualnie zbuforowanych wiadomości (błyskawiczne <150 ms).
   */
  async syncFolderDelta(
    folder: string,
    options?: { pageSize?: number; accountId?: string; signal?: AbortSignal }
  ): Promise<ListMessagesPageResult> {
    const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
    const acc = this.resolveAccount(options?.accountId);
    const cachedRecord = await this.cacheService.getFolderRecord(folder, acc.id);
    if (!cachedRecord || cachedRecord.headers.length === 0) {
      return this.listMessagesPage(folder, { pageSize, accountId: acc.id, signal: options?.signal });
    }

    const projectRegex = this.safeProjectRegex();
    const cachedHeaders = cachedRecord.headers;
    const maxCachedUid = cachedHeaders[0]?.uid ?? 0;
    const minCachedUid = cachedHeaders[cachedHeaders.length - 1]?.uid ?? 0;

    return this.runWithSession(
      acc.id,
      async (client, account) => {
        const lock = await client.getMailboxLock(folder, { readOnly: true });
        try {
          const mailbox = client.mailbox;
          const total = mailbox && typeof mailbox !== "boolean" ? mailbox.exists : 0;
          const uidValidity =
            mailbox && typeof mailbox !== "boolean" && mailbox.uidValidity
              ? String(mailbox.uidValidity)
              : "0";
          const uidNext =
            mailbox && typeof mailbox !== "boolean" && mailbox.uidNext
              ? Number(mailbox.uidNext)
              : undefined;

          // Jeśli UIDVALIDITY się zmieniło — pobierz świeżą pierwszą stronę
          if (uidValidity !== cachedRecord.uidValidity || total === 0) {
            if (total === 0) {
              await this.cacheService.setFolderHeaders(folder, uidValidity, [], acc.id, {
                uidNext,
                totalOnServer: 0,
              });
              return {
                headers: [],
                hasMore: false,
                totalOnServer: 0,
                uidValidity,
                uidNext,
                fromCache: false,
              };
            }
            const startSeq = Math.max(1, total - pageSize + 1);
            const fresh: ImapMessageHeader[] = [];
            for await (const msg of client.fetch(`${startSeq}:${total}`, {
              uid: true,
              envelope: true,
              flags: true,
              size: true,
              internalDate: true,
              bodyStructure: true,
              headers: ["references"],
            })) {
              fresh.push(this.mapFetchedHeader(msg, folder, uidValidity, account, projectRegex));
            }
            fresh.sort((a, b) => b.uid - a.uid);
            await this.cacheService.setFolderHeaders(folder, uidValidity, fresh, acc.id, {
              uidNext,
              totalOnServer: total,
            });
            return {
              headers: fresh,
              hasMore: startSeq > 1,
              totalOnServer: total,
              uidValidity,
              uidNext,
              fromCache: false,
            };
          }

          // 1. Pobierz tylko nowe wiadomości o UID > maxCachedUid (gdy uidNext > maxCachedUid + 1 lub brak uidNext)
          const newlyArrived: ImapMessageHeader[] = [];
          if (!uidNext || uidNext > maxCachedUid + 1) {
            for await (const msg of client.fetch(
              `${maxCachedUid + 1}:*`,
              {
                uid: true,
                envelope: true,
                flags: true,
                size: true,
                internalDate: true,
                bodyStructure: true,
                headers: ["references"],
              },
              { uid: true }
            )) {
              if (msg.uid > maxCachedUid) {
                newlyArrived.push(
                  this.mapFetchedHeader(msg, folder, uidValidity, account, projectRegex)
                );
              }
            }
          }

          // 2. Szybkie odświeżenie flag i wykrycie usuniętych wiadomości w zakresie cache
          const serverFlags = new Map<number, { seen: boolean; flagged: boolean }>();
          if (minCachedUid > 0 && maxCachedUid >= minCachedUid) {
            for await (const msg of client.fetch(
              `${minCachedUid}:${maxCachedUid}`,
              { uid: true, flags: true },
              { uid: true }
            )) {
              serverFlags.set(msg.uid, {
                seen: msg.flags?.has("\\Seen") ?? false,
                flagged: msg.flags?.has("\\Flagged") ?? false,
              });
            }
          }

          const updatedExisting: ImapMessageHeader[] = [];
          for (const h of cachedHeaders) {
            const st = serverFlags.get(h.uid);
            if (!st) continue; // Wiadomość została usunięta/przeniesiona po stronie serwera
            updatedExisting.push({
              ...h,
              seen: st.seen,
              flagged: st.flagged,
            });
          }

          const byUid = new Map<number, ImapMessageHeader>();
          for (const h of updatedExisting) byUid.set(h.uid, h);
          for (const h of newlyArrived) byUid.set(h.uid, h);
          const merged = Array.from(byUid.values()).sort((a, b) => b.uid - a.uid);

          await this.cacheService.setFolderHeaders(folder, uidValidity, merged, acc.id, {
            uidNext,
            totalOnServer: total,
          });

          return {
            headers: merged,
            hasMore: total > 0 && merged.length < total,
            totalOnServer: total,
            uidValidity,
            uidNext,
            fromCache: false,
          };
        } finally {
          lock.release();
        }
      },
      options?.signal
    );
  }

  // Kompatybilność wsteczna z istniejącymi wywołaniami
  async listMessages(
    folder: string,
    limit = DEFAULT_PAGE_SIZE,
    preferCache = false,
    accountId?: string
  ): Promise<ImapMessageHeader[]> {
    const res = await this.listMessagesWithMeta(folder, limit, preferCache, accountId);
    return res.headers;
  }

  async listMessagesWithMeta(
    folder: string,
    limit = DEFAULT_PAGE_SIZE,
    preferCache = false,
    accountId?: string
  ): Promise<{ headers: ImapMessageHeader[]; fromCache: boolean }> {
    const acc = this.resolveAccount(accountId);
    if (preferCache) {
      const cached = await this.cacheService.getFolderHeaders(folder, undefined, acc.id);
      if (cached && cached.length > 0) return { headers: cached, fromCache: true };
    }
    try {
      const page = await this.syncFolderDelta(folder, { pageSize: limit, accountId: acc.id });
      return { headers: page.headers, fromCache: false };
    } catch (err) {
      const cached = await this.cacheService.getFolderHeaders(folder, undefined, acc.id);
      if (cached && cached.length > 0) {
        return { headers: cached, fromCache: true };
      }
      throw err;
    }
  }

  /**
   * Wspólna skrzynka odbiorcza (Unified Inbox): scala najnowsze wiadomości z INBOX wszystkich aktywnych kont.
   */
  async listUnifiedInboxMessages(
    pageSize = 35
  ): Promise<{ headers: ImapMessageHeader[]; errors: string[] }> {
    const enabledAccounts = this.settings.accounts.filter((a) => a.enabled && a.imapHost.trim());
    const allHeaders: ImapMessageHeader[] = [];
    const errors: string[] = [];

    await Promise.all(
      enabledAccounts.map(async (acc) => {
        try {
          const res = await this.syncFolderDelta(acc.inboxFolder || "INBOX", {
            pageSize,
            accountId: acc.id,
          });
          for (const h of res.headers) {
            allHeaders.push({
              ...h,
              accountId: acc.id,
              accountLabel: acc.label,
              accountColor: acc.color,
            });
          }
        } catch (err) {
          errors.push(`${acc.label}: ${err instanceof Error ? err.message : String(err)}`);
        }
      })
    );

    allHeaders.sort((a, b) => {
      const ta = a.internalDateIso ? Date.parse(a.internalDateIso) : Date.parse(a.date);
      const tb = b.internalDateIso ? Date.parse(b.internalDateIso) : Date.parse(b.date);
      return (tb || 0) - (ta || 0) || b.uid - a.uid;
    });

    return { headers: allHeaders, errors };
  }

  // ============================================================================
  // Pobieranie pełnej treści, lazy załączników i cichy prefetch
  // ============================================================================

  async fetchFullMessage(
    folder: string,
    uid: number,
    options?: {
      accountId?: string;
      forceNetwork?: boolean;
      signal?: AbortSignal;
      priority?: TaskPriority;
      tag?: string;
    }
  ): Promise<ParsedEmailMessage> {
    const acc = this.resolveAccount(options?.accountId);
    const priority: TaskPriority = options?.priority ?? "high";

    if (!options?.forceNetwork) {
      const cachedRam = this.cacheService.getCachedMessageSync(folder, uid, acc.id);
      if (cachedRam && (cachedRam.htmlBody || cachedRam.textBody || cachedRam.markdownBody)) {
        return cachedRam;
      }
      const cachedDb = await this.cacheService.getCachedMessage(folder, uid, acc.id);
      if (cachedDb && (cachedDb.htmlBody || cachedDb.textBody || cachedDb.markdownBody)) {
        return cachedDb;
      }
    }

    if (options?.signal?.aborted) {
      throw new Error("ABORTED");
    }

    try {
      const parsed = await this.runWithSession(
        acc.id,
        async (client, account) => {
          if (options?.signal?.aborted) throw new Error("ABORTED");
          const lock = await client.getMailboxLock(folder, {
            readOnly: this.settings.nonIntrusivePeek,
          });
          try {
            if (options?.signal?.aborted) throw new Error("ABORTED");
            const fetched = await client.fetchOne(
              String(uid),
              { source: true, flags: true, bodyStructure: true },
              { uid: true }
            );
            if (!fetched || !fetched.source) {
              throw new Error(`Nie znaleziono wiadomości UID ${uid} w folderze ${folder}.`);
            }

            const rawBuffer = Buffer.isBuffer(fetched.source)
              ? fetched.source
              : Buffer.from(fetched.source);

            const msg = await parseRawEmlBuffer(rawBuffer, {
              uid,
              folder,
              accountId: account.id,
              accountLabel: account.label,
              accountColor: account.color,
              seen: fetched.flags?.has("\\Seen") ?? false,
              flagged: fetched.flags?.has("\\Flagged") ?? false,
            });

            // Dopisz `partId` z BODYSTRUCTURE do załączników, aby po przeładowaniu z L2 IndexedDB działał lazy fetch
            const parts = extractAttachmentsFromBodyStructure(fetched.bodyStructure);
            if (parts.length > 0 && msg.attachments.length > 0) {
              for (let i = 0; i < msg.attachments.length; i++) {
                const match =
                  parts.find((p) => p.filename === msg.attachments[i].filename) || parts[i];
                if (match) {
                  msg.attachments[i].partId = match.partId;
                }
              }
            }
            return msg;
          } finally {
            lock.release();
          }
        },
        {
          signal: options?.signal,
          priority,
          timeoutMs: FETCH_BODY_TIMEOUT_MS,
          tag: options?.tag,
        }
      );

      await this.cacheService.cacheParsedMessage(parsed, acc.id);
      return parsed;
    } catch (err) {
      if (err instanceof Error && err.message === "ABORTED") throw err;
      const cached = await this.cacheService.getCachedMessage(folder, uid, acc.id);
      if (cached) return cached;
      throw err;
    }
  }

  /**
   * Leniwe pobieranie pojedynczego załącznika po `partId` (lub fallback z pełnej wiadomości).
   */
  async fetchAttachmentPart(
    folder: string,
    uid: number,
    partId: string | undefined,
    filename: string,
    accountId?: string
  ): Promise<Buffer> {
    const acc = this.resolveAccount(accountId);
    if (partId) {
      const cached = this.cacheService.getCachedAttachmentPart(folder, uid, partId, acc.id);
      if (cached) return cached;

      try {
        const buf = await this.runWithSession(
          acc.id,
          async (client) => {
            const lock = await client.getMailboxLock(folder, { readOnly: true });
            try {
              const downloaded = await client.download(String(uid), partId, { uid: true });
              return await streamToBuffer(downloaded.content);
            } finally {
              lock.release();
            }
          },
          { priority: "high", timeoutMs: 30_000 }
        );
        this.cacheService.setCachedAttachmentPart(folder, uid, partId, buf, acc.id);
        return buf;
      } catch {
        // Fallback poniżej — pobierz całą wiadomość
      }
    }

    const full = await this.fetchFullMessage(folder, uid, {
      accountId: acc.id,
      forceNetwork: true,
      priority: "high",
    });
    const found = full.attachments.find((a) => a.filename === filename) || full.attachments[0];
    if (!found || !found.content || found.content.byteLength === 0) {
      throw new Error(`Nie udało się pobrać załącznika „${filename}”.`);
    }
    return found.content;
  }

  /**
   * Cichy prefetch w tle 1–2 małych sąsiednich wiadomości (< 200 KB) z priorytetem "low",
   * natychmiast anulowany gdy użytkownik kliknie kolejną wiadomość.
   */
  prefetchMessages(
    folder: string,
    headers: ImapMessageHeader[],
    accountId?: string
  ): void {
    const acc = this.resolveAccount(accountId);
    this.abortPrefetch(acc.id);
    const controller = new AbortController();
    this.prefetchControllers.set(acc.id, controller);

    for (const h of headers.slice(0, 2)) {
      if (h.sizeBytes > PREFETCH_MAX_BYTES) continue;
      if (this.cacheService.getCachedMessageSync(folder, h.uid, acc.id)) continue;
      const inflightKey = `${acc.id}::${folder}::${h.uid}`;
      if (this.prefetchInFlight.has(inflightKey)) continue;
      this.prefetchInFlight.add(inflightKey);
      void this.fetchFullMessage(folder, h.uid, {
        accountId: acc.id,
        priority: "low",
        signal: controller.signal,
        tag: "prefetch",
      })
        .catch(() => {
          // Prefetch jest best-effort i może zostać anulowany kliknięciem użytkownika
        })
        .finally(() => {
          this.prefetchInFlight.delete(inflightKey);
        });
    }
  }

  // ============================================================================
  // Serwerowe wyszukiwanie (IMAP SEARCH + Gmail X-GM-RAW)
  // ============================================================================

  async searchMessages(
    rawQuery: string,
    options: {
      folder: string;
      scope: "folder" | "all";
      accountId?: string;
      maxResults?: number;
      signal?: AbortSignal;
    }
  ): Promise<ImapMessageHeader[]> {
    const acc = this.resolveAccount(options.accountId);
    const parsed = parseSearchQuery(rawQuery);
    const maxResults = options.maxResults ?? 60;
    const projectRegex = this.safeProjectRegex();

    return this.runWithSession(
      acc.id,
      async (client, account) => {
        const supportsGmRaw =
          isGmailHostname(account.imapHost) && client.capabilities.has("X-GM-EXT-1");
        const criteria = buildImapSearchCriteria(parsed, supportsGmRaw);

        const targetFolders: string[] = [];
        if (options.scope === "folder") {
          targetFolders.push(options.folder);
        } else {
          const special = await this.getSpecialFolders(account.id);
          if (special.all) {
            targetFolders.push(special.all);
          } else {
            const cachedList = this.cacheService.getFolderListSync(account.id) || [];
            const candidates = [
              special.inbox,
              special.sent,
              special.archive,
              ...cachedList
                .filter((f) => {
                  const r = f.role ?? detectFolderRole(f.path, f.specialUse);
                  return r === "custom";
                })
                .slice(0, 6)
                .map((f) => f.path),
            ].filter((x): x is string => Boolean(x));
            for (const c of candidates) {
              if (!targetFolders.includes(c)) targetFolders.push(c);
            }
          }
        }

        const results: ImapMessageHeader[] = [];
        const seenKeys = new Set<string>();

        for (const folder of targetFolders) {
          if (options.signal?.aborted) throw new Error("ABORTED");
          if (results.length >= maxResults) break;

          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const mailbox = client.mailbox;
            const uidValidity =
              mailbox && typeof mailbox !== "boolean" && mailbox.uidValidity
                ? String(mailbox.uidValidity)
                : "0";

            const uidsRaw = await client.search(criteria, { uid: true });
            const uids = Array.isArray(uidsRaw) ? uidsRaw : [];
            if (uids.length === 0) continue;

            uids.sort((a, b) => b - a);
            const needed = Math.max(1, maxResults - results.length);
            const slice = uids.slice(0, needed);

            for await (const msg of client.fetch(
              slice,
              {
                uid: true,
                envelope: true,
                flags: true,
                size: true,
                internalDate: true,
                bodyStructure: true,
                headers: ["references"],
              },
              { uid: true }
            )) {
              const header = this.mapFetchedHeader(msg, folder, uidValidity, account, projectRegex);
              // Filtr klienta dla `has:attachment` na serwerach bez X-GM-RAW
              if (parsed.hasAttachment && !supportsGmRaw && !header.hasAttachments) {
                continue;
              }
              const dedupKey = header.messageId || `${folder}::${header.uid}`;
              if (seenKeys.has(dedupKey)) continue;
              seenKeys.add(dedupKey);
              results.push(header);
            }
          } catch {
            // Jeśli pojedynczy folder nie wspiera kryterium, kontynuuj pozostałe
          } finally {
            lock.release();
          }
        }

        results.sort((a, b) => {
          const ta = a.internalDateIso ? Date.parse(a.internalDateIso) : Date.parse(a.date);
          const tb = b.internalDateIso ? Date.parse(b.internalDateIso) : Date.parse(b.date);
          return (tb || 0) - (ta || 0) || b.uid - a.uid;
        });
        return results.slice(0, maxResults);
      },
      options.signal
    );
  }

  // ============================================================================
  // Pełne operacje na wiadomościach: Usuń, Kosz, Archiwum, Spam, Przenieś, Flagi
  // ============================================================================

  async moveMessages(
    sourceFolder: string,
    uids: number[],
    targetFolder: string,
    accountId?: string
  ): Promise<{ movedCount: number; targetFolder: string }> {
    if (uids.length === 0 || sourceFolder === targetFolder) {
      return { movedCount: 0, targetFolder };
    }
    const acc = this.resolveAccount(accountId);
    const uidRange = uids.join(",");

    await this.runWithSession(
      acc.id,
      async (client) => {
        await client.mailboxCreate(targetFolder).catch(() => {});
        const lock = await client.getMailboxLock(sourceFolder);
        try {
          try {
            await client.messageMove(uidRange, targetFolder, { uid: true });
          } catch {
            // Fallback dla serwerów bez rozszerzenia RFC 6851 MOVE: COPY + \Deleted + EXPUNGE
            await client.messageCopy(uidRange, targetFolder, { uid: true });
            await client.messageFlagsAdd(uidRange, ["\\Deleted"], { uid: true });
            await client.messageDelete(uidRange, { uid: true });
          }
        } finally {
          lock.release();
        }
      },
      { priority: "high" }
    );

    await this.cacheService.removeHeadersFromCache(sourceFolder, uids, acc.id);
    await this.cacheService.clearFolder(targetFolder, acc.id);
    this.cacheService.updateFolderSummaryCount(sourceFolder, -uids.length, 0, acc.id);
    this.cacheService.updateFolderSummaryCount(targetFolder, uids.length, 0, acc.id);
    return { movedCount: uids.length, targetFolder };
  }

  async moveMessage(
    sourceFolder: string,
    uid: number,
    targetFolder: string,
    accountId?: string
  ): Promise<void> {
    await this.moveMessages(sourceFolder, [uid], targetFolder, accountId);
  }

  async deleteMessages(
    folder: string,
    uids: number[],
    options?: { permanent?: boolean; accountId?: string }
  ): Promise<{ permanent: boolean; targetFolder: string | null }> {
    if (uids.length === 0) return { permanent: false, targetFolder: null };
    const acc = this.resolveAccount(options?.accountId);
    const role = detectFolderRole(folder);
    const shouldPermanent = Boolean(options?.permanent || role === "trash" || role === "spam");

    if (shouldPermanent) {
      const uidRange = uids.join(",");
      await this.runWithSession(
        acc.id,
        async (client) => {
          const lock = await client.getMailboxLock(folder);
          try {
            await client.messageDelete(uidRange, { uid: true });
          } finally {
            lock.release();
          }
        },
        { priority: "high" }
      );
      await this.cacheService.removeHeadersFromCache(folder, uids, acc.id);
      this.cacheService.updateFolderSummaryCount(folder, -uids.length, 0, acc.id);
      return { permanent: true, targetFolder: null };
    }

    const special = await this.getSpecialFolders(acc.id);
    const trashFolder = special.trash || acc.trashFolder || "Trash";
    await this.moveMessages(folder, uids, trashFolder, acc.id);
    return { permanent: false, targetFolder: trashFolder };
  }

  async archiveMessages(
    folder: string,
    uids: number[],
    accountId?: string
  ): Promise<{ targetFolder: string }> {
    const acc = this.resolveAccount(accountId);
    const special = await this.getSpecialFolders(acc.id);
    const archiveTarget = special.archive || special.all || acc.archiveFolder || "Archive";
    await this.moveMessages(folder, uids, archiveTarget, acc.id);
    return { targetFolder: archiveTarget };
  }

  async markAsSpam(
    folder: string,
    uids: number[],
    isSpam: boolean,
    accountId?: string
  ): Promise<{ targetFolder: string }> {
    const acc = this.resolveAccount(accountId);
    const special = await this.getSpecialFolders(acc.id);
    const target = isSpam ? special.spam || acc.spamFolder || "Junk" : special.inbox || "INBOX";
    await this.moveMessages(folder, uids, target, acc.id);
    return { targetFolder: target };
  }

  async restoreFromTrash(
    folder: string,
    uids: number[],
    accountId?: string
  ): Promise<{ targetFolder: string }> {
    const acc = this.resolveAccount(accountId);
    const special = await this.getSpecialFolders(acc.id);
    const target = special.inbox || acc.inboxFolder || "INBOX";
    await this.moveMessages(folder, uids, target, acc.id);
    return { targetFolder: target };
  }

  async emptyFolder(folder: string, accountId?: string): Promise<number> {
    const role = detectFolderRole(folder);
    if (role !== "trash" && role !== "spam") {
      throw new Error("Opróżnianie całego folderu jest dozwolone wyłącznie dla Kosza i Spamu.");
    }
    const acc = this.resolveAccount(accountId);
    const deletedCount = await this.runWithSession(acc.id, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const mailbox = client.mailbox;
        const count = mailbox && typeof mailbox !== "boolean" ? mailbox.exists : 0;
        if (count > 0) {
          await client.messageDelete("1:*");
        }
        return count;
      } finally {
        lock.release();
      }
    });
    await this.cacheService.clearFolder(folder, acc.id);
    this.cacheService.updateFolderSummaryCount(folder, -deletedCount, -deletedCount, acc.id);
    return deletedCount;
  }

  async setMessagesFlag(
    folder: string,
    uids: number[],
    flag: "\\Seen" | "\\Flagged",
    enabled: boolean,
    accountId?: string
  ): Promise<void> {
    if (uids.length === 0) return;
    const acc = this.resolveAccount(accountId);
    const uidRange = uids.join(",");
    const uidSet = new Set(uids);

    // Optymistyczna aktualizacja cache przed wysłaniem do serwera
    await this.cacheService.mutateHeadersInCache(folder, acc.id, (headers) =>
      headers.map((h) => {
        if (!uidSet.has(h.uid)) return h;
        return flag === "\\Seen" ? { ...h, seen: enabled } : { ...h, flagged: enabled };
      })
    );
    if (flag === "\\Seen") {
      this.cacheService.updateFolderSummaryCount(
        folder,
        0,
        enabled ? -uids.length : uids.length,
        acc.id
      );
    }

    await this.runWithSession(
      acc.id,
      async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          if (enabled) {
            await client.messageFlagsAdd(uidRange, [flag], { uid: true });
          } else {
            await client.messageFlagsRemove(uidRange, [flag], { uid: true });
          }
        } finally {
          lock.release();
        }
      },
      { priority: "high" }
    );
  }

  async setMessageFlag(
    folder: string,
    uid: number,
    flag: "\\Seen" | "\\Flagged",
    enabled: boolean,
    accountId?: string
  ): Promise<void> {
    await this.setMessagesFlag(folder, [uid], flag, enabled, accountId);
  }

  async markFolderAllRead(folder: string, accountId?: string): Promise<void> {
    const acc = this.resolveAccount(accountId);
    await this.runWithSession(acc.id, async (client) => {
      const lock = await client.getMailboxLock(folder);
      try {
        const unseenUids = await client.search({ seen: false }, { uid: true });
        if (Array.isArray(unseenUids) && unseenUids.length > 0) {
          await client.messageFlagsAdd(unseenUids, ["\\Seen"], { uid: true });
        }
      } finally {
        lock.release();
      }
    });

    await this.cacheService.mutateHeadersInCache(folder, acc.id, (headers) =>
      headers.map((h) => ({ ...h, seen: true }))
    );
    this.cacheService.updateFolderSummaryCount(folder, 0, -999999, acc.id);
  }

  // ============================================================================
  // Zarządzanie folderami IMAP (CREATE / RENAME / DELETE z ochroną systemowych)
  // ============================================================================

  async createFolder(folderPath: string, accountId?: string): Promise<void> {
    const validationErr = validateImapFolderName(folderPath);
    if (validationErr) throw new Error(validationErr);
    const acc = this.resolveAccount(accountId);
    await this.runWithSession(acc.id, async (client) => {
      await client.mailboxCreate(folderPath.trim());
    });
  }

  async renameFolder(oldPath: string, newPath: string, accountId?: string): Promise<void> {
    if (isSystemFolder(oldPath)) {
      throw new Error(`Folder systemowy „${oldPath}” jest chroniony i nie może zmienić nazwy.`);
    }
    const validationErr = validateImapFolderName(newPath);
    if (validationErr) throw new Error(validationErr);
    const acc = this.resolveAccount(accountId);
    await this.runWithSession(acc.id, async (client) => {
      await client.mailboxRename(oldPath, newPath.trim());
    });
    await this.cacheService.clearFolder(oldPath, acc.id);
  }

  async deleteFolder(folderPath: string, accountId?: string): Promise<void> {
    if (isSystemFolder(folderPath)) {
      throw new Error(`Folder systemowy „${folderPath}” jest chroniony przed usunięciem.`);
    }
    const acc = this.resolveAccount(accountId);
    await this.runWithSession(acc.id, async (client) => {
      await client.mailboxDelete(folderPath);
    });
    await this.cacheService.clearFolder(folderPath, acc.id);
  }

  // ============================================================================
  // Szkice (IMAP APPEND \Draft) i Wysłane (IMAP APPEND \Seen)
  // ============================================================================

  async saveDraft(
    rawMimeBuffer: Buffer,
    options?: { accountId?: string; previousDraftUid?: number | null }
  ): Promise<{ draftUid: number | null; folder: string }> {
    const acc = this.resolveAccount(options?.accountId);
    const special = await this.getSpecialFolders(acc.id);
    const draftsFolder = special.drafts || acc.draftsFolder || "Drafts";

    const draftUid = await this.runWithSession(acc.id, async (client) => {
      await client.mailboxCreate(draftsFolder).catch(() => {});
      const appended = await client.append(
        draftsFolder,
        rawMimeBuffer,
        ["\\Draft", "\\Seen"],
        new Date()
      );
      if (options?.previousDraftUid) {
        const lock = await client.getMailboxLock(draftsFolder);
        try {
          await client.messageDelete(String(options.previousDraftUid), { uid: true });
        } catch {
          // Poprzedni szkic mógł już nie istnieć
        } finally {
          lock.release();
        }
      }
      return appended && typeof appended === "object" && "uid" in appended && appended.uid
        ? Number(appended.uid)
        : null;
    });

    await this.cacheService.clearFolder(draftsFolder, acc.id);
    return { draftUid, folder: draftsFolder };
  }

  async deleteDraft(uid: number, accountId?: string): Promise<void> {
    const acc = this.resolveAccount(accountId);
    const special = await this.getSpecialFolders(acc.id);
    const draftsFolder = special.drafts || acc.draftsFolder || "Drafts";
    await this.deleteMessages(draftsFolder, [uid], { permanent: true, accountId: acc.id });
  }

  async appendSentMessage(rawMimeBuffer: Buffer, accountId?: string): Promise<void> {
    const acc = this.resolveAccount(accountId);
    if (!acc.appendSentToImap) return;
    if (this.isGmailServer(acc.imapHost, acc.id)) return;

    const special = await this.getSpecialFolders(acc.id);
    const targetSent = special.sent || acc.sentFolder || "Sent";

    await this.runWithSession(acc.id, async (client) => {
      await client.append(targetSent, rawMimeBuffer, ["\\Seen"], new Date());
    });
    await this.cacheService.clearFolder(targetSent, acc.id);
  }

  // ============================================================================
  // Monitor zajętości skrzynki (naprawione jednostki QUOTA, All Mail i deduplikacja)
  // ============================================================================

  async getMailboxStorageReport(
    topLargestLimit = 50,
    accountId?: string
  ): Promise<MailboxQuotaReport> {
    const acc = this.resolveAccount(accountId);

    return this.runWithSession(acc.id, async (client, account) => {
      const foldersReport: FolderStorageInfo[] = [];
      const calcInputs: Array<{
        path: string;
        specialUse?: string;
        messages: number;
        unseen: number;
        totalBytes: number;
        largestMessageBytes: number;
      }> = [];
      const largestCandidates: LargeMessageInfo[] = [];

      let quotaSupported = false;
      let rawUsage: number | null = null;
      let rawLimit: number | null = null;

      try {
        const quota = await client.getQuota(account.inboxFolder || "INBOX");
        if (quota && typeof quota !== "boolean" && quota.storage) {
          quotaSupported = true;
          const storage = quota.storage as { usage?: number; used?: number; limit?: number };
          rawUsage = storage.usage ?? storage.used ?? null;
          rawLimit = storage.limit ?? null;
        }
      } catch {
        quotaSupported = false;
      }

      const mailboxes = await client.list();
      for (const box of mailboxes) {
        if (box.flags?.has("\\Noselect")) continue;

        let folderMessages = 0;
        let folderUnseen = 0;
        let folderBytes = 0;
        let folderLargest = 0;

        try {
          const st = await client.status(box.path, { messages: true, unseen: true });
          folderMessages = st.messages || 0;
          folderUnseen = st.unseen || 0;
        } catch {
          continue;
        }

        if (folderMessages > 0) {
          const lock = await client.getMailboxLock(box.path, { readOnly: true });
          try {
            for await (const msg of client.fetch("1:*", {
              uid: true,
              size: true,
              envelope: true,
              internalDate: true,
            })) {
              const sz = msg.size || 0;
              folderBytes += sz;
              if (sz > folderLargest) folderLargest = sz;

              if (sz >= 200 * 1024 || largestCandidates.length < topLargestLimit * 2) {
                const fromEntry = msg.envelope?.from?.[0];
                const d = msg.internalDate ? new Date(msg.internalDate) : new Date();
                largestCandidates.push({
                  uid: msg.uid,
                  folder: box.path,
                  messageId: msg.envelope?.messageId || undefined,
                  date: d.toISOString().slice(0, 10),
                  from: fromEntry?.address || fromEntry?.name || "Nieznany",
                  subject: msg.envelope?.subject || "(Bez tematu)",
                  sizeBytes: sz,
                });
              }
            }
          } finally {
            lock.release();
          }
        }

        const role = detectFolderRole(box.path, box.specialUse);
        const isAggregate = role === "all";

        calcInputs.push({
          path: box.path,
          specialUse: box.specialUse,
          messages: folderMessages,
          unseen: folderUnseen,
          totalBytes: folderBytes,
          largestMessageBytes: folderLargest,
        });

        foldersReport.push({
          path: box.path,
          messages: folderMessages,
          unseen: folderUnseen,
          totalBytes: folderBytes,
          largestMessageBytes: folderLargest,
          isAggregate,
          role,
        });
      }

      const totals = calculateMailboxTotals(calcInputs);
      const normalizedQuota = normalizeQuotaValues({
        rawUsage,
        rawLimit,
        calculatedBytes: totals.totalCalculatedBytes,
        isGmail: isGmailHostname(account.imapHost),
      });

      const effectiveUsed =
        quotaSupported && normalizedQuota.usedBytes > 0
          ? normalizedQuota.usedBytes
          : totals.totalCalculatedBytes;
      const limitBytes = normalizedQuota.limitBytes;
      const usagePercent =
        limitBytes && limitBytes > 0
          ? Math.round((effectiveUsed / limitBytes) * 1000) / 10
          : null;

      foldersReport.sort((a, b) => b.totalBytes - a.totalBytes);
      const deduplicatedLargest = deduplicateLargestMessages(largestCandidates, topLargestLimit);

      return {
        quotaSupported,
        usedBytes: effectiveUsed,
        limitBytes,
        usagePercent,
        totalCalculatedBytes: totals.totalCalculatedBytes,
        totalMessages: totals.totalMessages,
        aggregateFolderPath: totals.aggregateFolderPath,
        folders: foldersReport,
        largestMessages: deduplicatedLargest,
      };
    });
  }

  // ============================================================================
  // Stabilny wielokontowy IMAP IDLE (RFC 2177: odnawianie 14 min + sleep/wake)
  // ============================================================================

  async startIdleWatchers(onNewMail: (event: IdleNewMailEvent) => void): Promise<void> {
    if (!this.settings.enableImapIdle) return;
    await this.stopIdleWatcher();
    this.idleCallback = onNewMail;

    const enabledAccounts = this.settings.accounts.filter((a) => a.enabled && a.imapHost.trim());
    for (const acc of enabledAccounts) {
      void this.startSingleAccountIdle(acc);
    }

    // Watchdog wybudzenia systemu (sleep/wake): jeśli czas skoczył >90 s między 30-sekundowymi tickami, odnów IDLE
    this.lastWakeTick = Date.now();
    this.wakeWatchdogTimer = setInterval(() => {
      const now = Date.now();
      const drift = now - this.lastWakeTick;
      this.lastWakeTick = now;
      if (drift > 90_000) {
        for (const acc of this.settings.accounts.filter((a) => a.enabled && a.imapHost.trim())) {
          void this.restartSingleAccountIdle(acc);
        }
      }
    }, WAKE_CHECK_INTERVAL_MS);
  }

  /**
   * Kompatybilność wsteczna z jednokontowym callbackiem.
   */
  async startIdleWatcher(onMailboxChanged: (folder: string) => void): Promise<void> {
    await this.startIdleWatchers((ev) => onMailboxChanged(ev.folder));
  }

  private async restartSingleAccountIdle(acc: MailAccountConfig): Promise<void> {
    await this.stopSingleAccountIdle(acc.id);
    if (!this.idleCallback || !this.settings.enableImapIdle) return;
    void this.startSingleAccountIdle(acc);
  }

  private async startSingleAccountIdle(acc: MailAccountConfig): Promise<void> {
    const existing = this.idleHandles.get(acc.id);
    if (existing) {
      await this.stopSingleAccountIdle(acc.id);
    }

    const handle: AccountIdleHandle = {
      accountId: acc.id,
      client: null,
      renewTimer: null,
      reconnectTimer: null,
      stopped: false,
      attempt: 0,
      lastSeenMaxUid: this.cacheService.getFolderHeadersSync(acc.inboxFolder || "INBOX", acc.id)?.[0]?.uid ?? 0,
    };
    this.idleHandles.set(acc.id, handle);

    const connectLoop = async () => {
      if (handle.stopped) return;
      const watchFolder = acc.inboxFolder || "INBOX";

      try {
        const client = await this.createClient(acc);
        if (handle.stopped) {
          await this.safeCloseClient(client, true);
          return;
        }
        handle.client = client;

        client.on("error", () => {
          // Ciche przechwycenie błędów w tle — obsługiwane przez 'close'
        });

        client.on("close", () => {
          if (handle.stopped || handle.client !== client) return;
          handle.client = null;
          this.scheduleIdleReconnect(acc, handle, connectLoop);
        });

        client.on("exists", async (data: { count: number; prevCount: number }) => {
          if (handle.stopped || !this.idleCallback) return;
          if (data.count <= data.prevCount) return;

          try {
            // Użyj sesji roboczej (nie blokuj gniazda IDLE), aby pobrać tylko nowe nagłówki
            const prevMax = handle.lastSeenMaxUid;
            const delta = await this.syncFolderDelta(watchFolder, { accountId: acc.id });
            const newHeaders = prevMax
              ? delta.headers.filter((h) => h.uid > prevMax)
              : delta.headers.slice(0, Math.max(1, data.count - data.prevCount));
            if (delta.headers[0]?.uid) {
              handle.lastSeenMaxUid = delta.headers[0].uid;
            }
            const totalUnseen = delta.headers.filter((h) => !h.seen).length;
            this.idleCallback({
              accountId: acc.id,
              accountLabel: acc.label,
              accountColor: acc.color,
              folder: watchFolder,
              newHeaders,
              totalUnseen,
            });
          } catch {
            // Jeśli delta chwilowo nie wyszła, wyślij lekkie powiadomienie o zmianie
            this.idleCallback?.({
              accountId: acc.id,
              accountLabel: acc.label,
              accountColor: acc.color,
              folder: watchFolder,
              newHeaders: [],
              totalUnseen: 0,
            });
          }
        });

        await client.connect();
        if (handle.stopped) {
          await this.safeCloseClient(client, true);
          return;
        }
        const mailbox = await client.mailboxOpen(watchFolder, { readOnly: true });
        if (mailbox && mailbox.uidNext && handle.lastSeenMaxUid === 0) {
          handle.lastSeenMaxUid = Math.max(0, Number(mailbox.uidNext) - 1);
        }
        handle.attempt = 0;

        // RFC 2177: bezpieczne odnawianie IDLE co 14 minut zanim serwer zamknie nieaktywne gniazdo
        if (handle.renewTimer) clearInterval(handle.renewTimer);
        handle.renewTimer = setInterval(() => {
          if (handle.stopped || !handle.client || !handle.client.usable) return;
          handle.client.noop().catch(() => {
            if (!handle.stopped) {
              void this.restartSingleAccountIdle(acc);
            }
          });
        }, IDLE_RENEW_INTERVAL_MS);
      } catch {
        if (!handle.stopped) {
          this.scheduleIdleReconnect(acc, handle, connectLoop);
        }
      }
    };

    void connectLoop();
  }

  private scheduleIdleReconnect(
    _acc: MailAccountConfig,
    handle: AccountIdleHandle,
    connectLoop: () => Promise<void>
  ): void {
    if (handle.stopped) return;
    if (handle.reconnectTimer) clearTimeout(handle.reconnectTimer);
    handle.attempt += 1;
    const delayMs = Math.min(120_000, 4_000 * Math.pow(2, Math.min(handle.attempt - 1, 5)));
    handle.reconnectTimer = setTimeout(() => {
      handle.reconnectTimer = null;
      if (!handle.stopped) {
        void connectLoop();
      }
    }, delayMs);
  }

  private async stopSingleAccountIdle(accountId: string): Promise<void> {
    const handle = this.idleHandles.get(accountId);
    if (!handle) return;
    this.idleHandles.delete(accountId);
    handle.stopped = true;
    if (handle.renewTimer) {
      clearInterval(handle.renewTimer);
      handle.renewTimer = null;
    }
    if (handle.reconnectTimer) {
      clearTimeout(handle.reconnectTimer);
      handle.reconnectTimer = null;
    }
    const client = handle.client;
    handle.client = null;
    await this.safeCloseClient(client, true);
  }

  async stopIdleWatcher(): Promise<void> {
    this.idleCallback = null;
    if (this.wakeWatchdogTimer) {
      clearInterval(this.wakeWatchdogTimer);
      this.wakeWatchdogTimer = null;
    }
    const ids = Array.from(this.idleHandles.keys());
    await Promise.all(ids.map((id) => this.stopSingleAccountIdle(id)));
  }

  private safeProjectRegex(): RegExp {
    try {
      return new RegExp(this.settings.projectCodeRegex);
    } catch {
      return /\b\d{2}-\d{3}\b/;
    }
  }
}
