import { ImapFlow } from "imapflow";
import {
  buildPolishImapErrorHint,
  isGmailHostname,
  isOutlookHostname,
} from "../../../shared/networkSecurity";
import {
  FolderStorageInfo,
  ImapConnectionTestOverride,
  ImapConnectionTestResult,
  ImapFolderSummary,
  ImapMessageHeader,
  LargeMessageInfo,
  MailboxQuotaReport,
  ParsedEmailMessage,
  TrinitecPluginSettings,
} from "../types";
import { naturalCompare } from "../utils/textUtils";
import { parseRawEmlBuffer } from "./mailParserService";
import { SecretService } from "./secretService";
import { GoogleOAuthService } from "./googleOAuthService";
import { MailCacheService } from "./mailCacheService";

const CONNECTION_TIMEOUT_MS = 12_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

function isTransientNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("eai_again") ||
    msg.includes("socket closed") ||
    msg.includes("connection closed") ||
    msg.includes("timeout")
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withExponentialRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 450
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientNetworkError(err)) {
        throw err;
      }
      await sleep(baseDelayMs * Math.pow(2, attempt - 1));
    }
  }
  throw lastError;
}

/**
 * Niezawodny klient IMAP (imapflow) dla Thunder Look:
 * - Obsługa hasła aplikacji / skrzynki (Roundcube, własny IMAP, Outlook, Gmail) ORAZ Google OAuth2 (XOAUTH2)
 * - Twarde timeouty połączenia, powitania i gniazda + retry z exponential backoff dla błędów przejściowych
 * - Gwarantowane rozłączanie w blokach try/finally (brak wycieków gniazd)
 * - Nieinwazyjne czytanie (EXAMINE / readOnly -> nie oznacza \Seen na serwerze)
 * - Walidacja UIDVALIDITY + offline cache IndexedDB
 * - Ścisła weryfikacja TLS domyślnie (rejectUnauthorized: true)
 */
export class ImapService {
  private settings: TrinitecPluginSettings;
  private secretService: SecretService;
  private googleOAuthService: GoogleOAuthService;
  private cacheService: MailCacheService;

  private idleClient: ImapFlow | null = null;
  private idleHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private idleStopRequested = false;

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
  }

  isGmailServer(host = this.settings.imapHost): boolean {
    return isGmailHostname(host);
  }

  private detectProvider(host: string): "gmail" | "outlook" | "roundcube" | "imap" {
    if (isGmailHostname(host)) return "gmail";
    if (isOutlookHostname(host)) return "outlook";
    if (
      host.toLowerCase().includes("roundcube") ||
      this.settings.mailProvider === "roundcube"
    ) {
      return "roundcube";
    }
    return "imap";
  }

  private async resolveAuthConfig(override?: ImapConnectionTestOverride): Promise<{
    user: string;
    pass?: string;
    accessToken?: string;
  }> {
    const authMethod = override?.authMethod ?? this.settings.mailAuthMethod;
    const host = (override?.host ?? this.settings.imapHost).trim();
    const configuredUser = (override?.user ?? this.settings.imapUser).trim();

    if (authMethod === "google-oauth" && isGmailHostname(host)) {
      const token = await this.googleOAuthService.getValidAccessToken(
        this.settings.googleOAuthClientId
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
        : await this.secretService.getMailPassword();

    if (!configuredUser || !password) {
      throw new Error(
        "Brak pełnej konfiguracji IMAP (login lub hasło). Uzupełnij dane w ustawieniach Thunder Look."
      );
    }

    return { user: configuredUser, pass: password };
  }

  private async createClient(override?: ImapConnectionTestOverride): Promise<ImapFlow> {
    const host = (override?.host ?? this.settings.imapHost).trim();
    const port = override?.port ?? this.settings.imapPort;
    const secure = override?.secure ?? this.settings.imapSecure;
    const strictTls = override?.strictTls ?? this.settings.strictTlsVerification;

    if (!host) {
      throw new Error(
        "Brak adresu serwera IMAP (np. trinitec.pl, mail.twojadomena.pl lub imap.gmail.com)."
      );
    }

    const auth = await this.resolveAuthConfig(override);

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

  private async safeCloseClient(client: ImapFlow | null): Promise<void> {
    if (!client) return;
    try {
      await Promise.race([
        client.logout(),
        sleep(2500).then(() => {
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

  /**
   * Test połączenia IMAP (Roundcube, Gmail OAuth2/App Password, Outlook lub własny serwer).
   */
  async testConnection(
    override?: ImapConnectionTestOverride
  ): Promise<ImapConnectionTestResult> {
    const host = (override?.host ?? this.settings.imapHost).trim();
    const port = override?.port ?? this.settings.imapPort;
    const secure = override?.secure ?? this.settings.imapSecure;
    const started = Date.now();
    const providerDetected = this.detectProvider(host);

    let client: ImapFlow | null = null;
    try {
      client = await this.createClient(override);
      await client.connect();

      const capabilities = Array.from(client.capabilities.keys()).sort();
      const boxes = await client.list();
      const selectableBoxes = boxes.filter((b) => !b.flags?.has("\\Noselect"));
      const sentBox =
        selectableBoxes.find((b) => b.specialUse === "\\Sent") ||
        selectableBoxes.find((b) =>
          /^(INBOX\.)?(Sent|Wysłane|Sent Items|\[Gmail\]\/(Sent Mail|Wysłane))$/i.test(b.path)
        );

      let inboxMessages = 0;
      let inboxUnseen = 0;
      try {
        const st = await client.status(this.settings.inboxFolder || "INBOX", {
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
        const quota = await client.getQuota(this.settings.inboxFolder || "INBOX");
        if (quota && typeof quota !== "boolean" && quota.storage) {
          quotaUsedBytes = quota.storage.used ?? null;
          quotaLimitBytes = quota.storage.limit ?? null;
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
      const rawMessage = err instanceof Error ? err.message : String(err);
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

  async listFolders(preferCacheOnFailure = true): Promise<{
    folders: ImapFolderSummary[];
    fromCache: boolean;
  }> {
    try {
      const folders = await withExponentialRetry(async () => {
        let client: ImapFlow | null = null;
        const out: ImapFolderSummary[] = [];
        try {
          client = await this.createClient();
          await client.connect();
          const boxes = await client.list();
          for (const box of boxes) {
            if (box.flags?.has("\\Noselect")) continue;
            try {
              const st = await client.status(box.path, {
                messages: true,
                unseen: true,
                uidValidity: true,
              });
              out.push({
                path: box.path,
                messages: st.messages || 0,
                unseen: st.unseen || 0,
                uidValidity: st.uidValidity ? String(st.uidValidity) : "0",
              });
            } catch {
              out.push({
                path: box.path,
                messages: 0,
                unseen: 0,
                uidValidity: "0",
              });
            }
          }
          return out.sort((a, b) => naturalCompare(a.path, b.path));
        } finally {
          await this.safeCloseClient(client);
        }
      });

      await this.cacheService.setFolderList(folders);
      return { folders, fromCache: false };
    } catch (err) {
      if (preferCacheOnFailure) {
        const cached = await this.cacheService.getFolderList();
        if (cached && cached.length > 0) {
          return { folders: cached, fromCache: true };
        }
      }
      throw err;
    }
  }

  async listMessages(
    folder: string,
    limit = 60,
    preferCache = false
  ): Promise<ImapMessageHeader[]> {
    const res = await this.listMessagesWithMeta(folder, limit, preferCache);
    return res.headers;
  }

  async listMessagesWithMeta(
    folder: string,
    limit = 60,
    preferCache = false
  ): Promise<{ headers: ImapMessageHeader[]; fromCache: boolean }> {
    if (preferCache) {
      const cached = await this.cacheService.getFolderHeaders(folder);
      if (cached && cached.length > 0) return { headers: cached, fromCache: true };
    }

    try {
      const { newestFirst, uidValidityStr } = await withExponentialRetry(async () => {
        let client: ImapFlow | null = null;
        const results: ImapMessageHeader[] = [];
        const projectRegex = this.safeProjectRegex();
        let uidValidity = "0";

        try {
          client = await this.createClient();
          await client.connect();

          const lock = await client.getMailboxLock(folder, { readOnly: true });
          try {
            const mailbox = client.mailbox;
            const total = mailbox && typeof mailbox !== "boolean" ? mailbox.exists : 0;
            uidValidity =
              mailbox && typeof mailbox !== "boolean" && mailbox.uidValidity
                ? String(mailbox.uidValidity)
                : "0";

            if (total === 0) {
              return { newestFirst: [] as ImapMessageHeader[], uidValidityStr: uidValidity };
            }

            const startSeq = Math.max(1, total - limit + 1);
            for await (const msg of client.fetch(`${startSeq}:${total}`, {
              uid: true,
              envelope: true,
              flags: true,
              size: true,
              internalDate: true,
              headers: ["references"],
            })) {
              const fromEntry = msg.envelope?.from?.[0];
              const subject = msg.envelope?.subject || "(Bez tematu)";
              const dateObj = msg.internalDate ? new Date(msg.internalDate) : new Date();
              const codeMatch = subject.match(projectRegex);
              const rawHeaderText = msg.headers ? msg.headers.toString("utf8") : "";
              const refMatches = rawHeaderText.match(/<[^>]+>/g) || [];

              results.push({
                uid: msg.uid,
                folder,
                uidValidity,
                messageId: msg.envelope?.messageId || "",
                inReplyTo: msg.envelope?.inReplyTo || "",
                references: refMatches,
                date: dateObj.toISOString().slice(0, 10),
                fromName: fromEntry?.name || fromEntry?.address || "Nieznany",
                fromEmail: fromEntry?.address || "",
                subject,
                sizeBytes: msg.size || 0,
                seen: msg.flags?.has("\\Seen") ?? false,
                flagged: msg.flags?.has("\\Flagged") ?? false,
                detectedProjectCode: codeMatch ? codeMatch[0] : null,
              });
            }
          } finally {
            lock.release();
          }

          return { newestFirst: results.reverse(), uidValidityStr: uidValidity };
        } finally {
          await this.safeCloseClient(client);
        }
      });

      await this.cacheService.setFolderHeaders(folder, uidValidityStr, newestFirst);
      return { headers: newestFirst, fromCache: false };
    } catch (err) {
      const cached = await this.cacheService.getFolderHeaders(folder);
      if (cached && cached.length > 0) {
        return { headers: cached, fromCache: true };
      }
      throw err;
    }
  }

  /**
   * Pobiera pełną wiadomość przez BODY.PEEK[] (readOnly lock) z fallbackiem offline do lokalnego cache IndexedDB.
   */
  async fetchFullMessage(folder: string, uid: number): Promise<ParsedEmailMessage> {
    try {
      const parsed = await withExponentialRetry(async () => {
        let client: ImapFlow | null = null;
        try {
          client = await this.createClient();
          await client.connect();
          const lock = await client.getMailboxLock(folder, {
            readOnly: this.settings.nonIntrusivePeek,
          });
          try {
            const fetched = await client.fetchOne(
              String(uid),
              { source: true, flags: true },
              { uid: true }
            );
            if (!fetched || !fetched.source) {
              throw new Error(`Nie znaleziono wiadomości UID ${uid} w folderze ${folder}.`);
            }

            const rawBuffer = Buffer.isBuffer(fetched.source)
              ? fetched.source
              : Buffer.from(fetched.source);

            return await parseRawEmlBuffer(rawBuffer, {
              uid,
              folder,
              seen: fetched.flags?.has("\\Seen") ?? false,
              flagged: fetched.flags?.has("\\Flagged") ?? false,
            });
          } finally {
            lock.release();
          }
        } finally {
          await this.safeCloseClient(client);
        }
      });

      await this.cacheService.cacheParsedMessage(parsed);
      return parsed;
    } catch (err) {
      const cached = await this.cacheService.getCachedMessage(folder, uid);
      if (cached) {
        return cached;
      }
      throw err;
    }
  }

  /**
   * Monitor zajętości skrzynki: IMAP GETQUOTAROOT + LIST + STATUS + RFC822.SIZE
   */
  async getMailboxStorageReport(topLargestLimit = 40): Promise<MailboxQuotaReport> {
    let client: ImapFlow | null = null;
    const foldersReport: FolderStorageInfo[] = [];
    const largestCandidates: LargeMessageInfo[] = [];
    let quotaSupported = false;
    let usedBytes = 0;
    let limitBytes: number | null = null;
    let totalCalculatedBytes = 0;
    let totalMessages = 0;

    try {
      client = await this.createClient();
      await client.connect();

      try {
        const quota = await client.getQuota(this.settings.inboxFolder || "INBOX");
        if (quota && typeof quota !== "boolean" && quota.storage) {
          quotaSupported = true;
          usedBytes = quota.storage.used ?? 0;
          limitBytes = quota.storage.limit ?? null;
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

              if (sz >= 200 * 1024 || largestCandidates.length < topLargestLimit) {
                const fromEntry = msg.envelope?.from?.[0];
                const d = msg.internalDate ? new Date(msg.internalDate) : new Date();
                largestCandidates.push({
                  uid: msg.uid,
                  folder: box.path,
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

        const isGmailAllMail =
          this.isGmailServer() &&
          (box.specialUse === "\\All" || /^\[Gmail\]\/(All Mail|Wszystkie)/i.test(box.path));

        if (!isGmailAllMail) {
          totalCalculatedBytes += folderBytes;
          totalMessages += folderMessages;
        }
        foldersReport.push({
          path: box.path,
          messages: folderMessages,
          unseen: folderUnseen,
          totalBytes: folderBytes,
          largestMessageBytes: folderLargest,
        });
      }
    } finally {
      await this.safeCloseClient(client);
    }

    const effectiveUsed = quotaSupported && usedBytes > 0 ? usedBytes : totalCalculatedBytes;
    const usagePercent =
      limitBytes && limitBytes > 0
        ? Math.round((effectiveUsed / limitBytes) * 1000) / 10
        : null;

    foldersReport.sort((a, b) => b.totalBytes - a.totalBytes);
    largestCandidates.sort((a, b) => b.sizeBytes - a.sizeBytes);

    return {
      quotaSupported,
      usedBytes: effectiveUsed,
      limitBytes,
      usagePercent,
      totalCalculatedBytes,
      totalMessages,
      folders: foldersReport,
      largestMessages: largestCandidates.slice(0, topLargestLimit),
    };
  }

  async moveMessage(sourceFolder: string, uid: number, targetFolder: string): Promise<void> {
    let client: ImapFlow | null = null;
    try {
      client = await this.createClient();
      await client.connect();
      await client.mailboxCreate(targetFolder).catch(() => {});
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(String(uid), targetFolder, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await this.safeCloseClient(client);
    }
    await this.cacheService.clearFolder(sourceFolder);
    await this.cacheService.clearFolder(targetFolder);
  }

  async setMessageFlag(
    folder: string,
    uid: number,
    flag: "\\Seen" | "\\Flagged",
    enabled: boolean
  ): Promise<void> {
    let client: ImapFlow | null = null;
    try {
      client = await this.createClient();
      await client.connect();
      const lock = await client.getMailboxLock(folder);
      try {
        if (enabled) {
          await client.messageFlagsAdd(String(uid), [flag], { uid: true });
        } else {
          await client.messageFlagsRemove(String(uid), [flag], { uid: true });
        }
      } finally {
        lock.release();
      }
    } finally {
      await this.safeCloseClient(client);
    }
  }

  async appendSentMessage(rawMimeBuffer: Buffer): Promise<void> {
    if (!this.settings.appendSentToImap) return;
    if (this.isGmailServer()) return;

    let client: ImapFlow | null = null;
    try {
      client = await this.createClient();
      await client.connect();
      let targetSent = this.settings.sentFolder || "Sent";
      try {
        const boxes = await client.list();
        const detected = boxes.find((b) => b.specialUse === "\\Sent");
        if (detected) targetSent = detected.path;
      } catch {
        // fallback do skonfigurowanej nazwy
      }
      await client.append(targetSent, rawMimeBuffer, ["\\Seen"], new Date());
    } finally {
      await this.safeCloseClient(client);
    }
  }

  async startIdleWatcher(onMailboxChanged: (folder: string) => void): Promise<void> {
    if (!this.settings.enableImapIdle) return;
    await this.stopIdleWatcher();
    this.idleStopRequested = false;

    try {
      const client = await this.createClient();
      this.idleClient = client;
      const watchFolder = this.settings.inboxFolder || "INBOX";

      client.on("exists", () => {
        if (!this.idleStopRequested) onMailboxChanged(watchFolder);
      });
      client.on("error", () => {
        // Ciche przechwycenie błędów sieciowych w tle
      });

      await client.connect();
      await client.mailboxOpen(watchFolder, { readOnly: true });

      this.idleHeartbeatTimer = setInterval(() => {
        if (this.idleClient && !this.idleStopRequested) {
          this.idleClient.noop().catch(() => {});
        }
      }, 25 * 60 * 1000);
    } catch {
      await this.stopIdleWatcher();
    }
  }

  async stopIdleWatcher(): Promise<void> {
    this.idleStopRequested = true;
    if (this.idleHeartbeatTimer) {
      clearInterval(this.idleHeartbeatTimer);
      this.idleHeartbeatTimer = null;
    }
    if (this.idleClient) {
      const c = this.idleClient;
      this.idleClient = null;
      await this.safeCloseClient(c);
    }
  }

  private safeProjectRegex(): RegExp {
    try {
      return new RegExp(this.settings.projectCodeRegex);
    } catch {
      return /\b\d{2}-\d{3}\b/;
    }
  }
}
