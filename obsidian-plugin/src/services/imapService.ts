import { ImapFlow } from "imapflow";
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
import { MailCacheService } from "./mailCacheService";

/**
 * Klient IMAP (imapflow) z ulepszeniami z publicznych repozytoriów:
 * - Nieinwazyjne czytanie (EXAMINE / readOnly lock -> nie oznacza \Seen na serwerze Roundcube)
 * - Walidacja UIDVALIDITY + lokalny cache IndexedDB
 * - IMAP IDLE (push z heartbeat 29 min) dla natychmiastowych powiadomień o nowej poczcie
 * - IMAP APPEND do folderu Sent po wysyłce SMTP
 * - Ścisła weryfikacja TLS
 */
export class ImapService {
  private settings: TrinitecPluginSettings;
  private secretService: SecretService;
  private cacheService: MailCacheService;

  private idleClient: ImapFlow | null = null;
  private idleHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private idleStopRequested = false;

  constructor(
    settings: TrinitecPluginSettings,
    secretService: SecretService,
    cacheService: MailCacheService
  ) {
    this.settings = settings;
    this.secretService = secretService;
    this.cacheService = cacheService;
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
  }

  isGmailServer(host = this.settings.imapHost): boolean {
    const h = (host || "").toLowerCase();
    return h.includes("gmail.com") || h.includes("googlemail.com");
  }

  private async createClient(override?: ImapConnectionTestOverride): Promise<ImapFlow> {
    const host = (override?.host ?? this.settings.imapHost).trim();
    const port = override?.port ?? this.settings.imapPort;
    const secure = override?.secure ?? this.settings.imapSecure;
    const user = (override?.user ?? this.settings.imapUser).trim();
    const strictTls = override?.strictTls ?? this.settings.strictTlsVerification;
    const password =
      override?.password !== undefined && override.password.length > 0
        ? override.password
        : await this.secretService.getMailPassword();

    if (!host || !user || !password) {
      throw new Error(
        "Brak pełnej konfiguracji IMAP (host, login lub hasło). Uzupełnij dane w ustawieniach poczty."
      );
    }

    return new ImapFlow({
      host,
      port,
      secure,
      tls: {
        rejectUnauthorized: strictTls,
      },
      auth: {
        user,
        pass: password,
      },
      logger: false,
    });
  }

  /**
   * Test połączenia IMAP (Roundcube.pl, Gmail z hasłem aplikacji lub własny serwer).
   * Sprawdza uwierzytelnienie, opóźnienie, obsługiwane rozszerzenia, foldery, status INBOX i QUOTA.
   */
  async testConnection(
    override?: ImapConnectionTestOverride
  ): Promise<ImapConnectionTestResult> {
    const host = (override?.host ?? this.settings.imapHost).trim();
    const port = override?.port ?? this.settings.imapPort;
    const secure = override?.secure ?? this.settings.imapSecure;
    const started = Date.now();
    const isGmail = this.isGmailServer(host);
    const providerDetected: "gmail" | "roundcube" | "imap" = isGmail
      ? "gmail"
      : host.toLowerCase().includes("roundcube")
      ? "roundcube"
      : "imap";

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
        hint: buildPolishImapErrorHint(rawMessage, isGmail, port, secure),
      };
    } finally {
      if (client) {
        await client.logout().catch(() => {
          client?.close();
        });
      }
    }
  }

  async listFolders(): Promise<ImapFolderSummary[]> {
    const client = await this.createClient();
    await client.connect();
    const out: ImapFolderSummary[] = [];
    try {
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
    } finally {
      await client.logout().catch(() => {});
    }

    return out.sort((a, b) => naturalCompare(a.path, b.path));
  }

  async listMessages(
    folder: string,
    limit = 60,
    preferCache = false
  ): Promise<ImapMessageHeader[]> {
    if (preferCache) {
      const cached = await this.cacheService.getFolderHeaders(folder);
      if (cached && cached.length > 0) return cached;
    }

    const client = await this.createClient();
    await client.connect();
    const results: ImapMessageHeader[] = [];
    const projectRegex = this.safeProjectRegex();
    let uidValidityStr = "0";

    try {
      // Nieinwazyjne otwarcie readOnly (EXAMINE) — nie zmienia flag \Seen
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const mailbox = client.mailbox;
        const total = mailbox && typeof mailbox !== "boolean" ? mailbox.exists : 0;
        uidValidityStr =
          mailbox && typeof mailbox !== "boolean" && mailbox.uidValidity
            ? String(mailbox.uidValidity)
            : "0";

        if (total === 0) {
          await this.cacheService.setFolderHeaders(folder, uidValidityStr, []);
          return [];
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
            uidValidity: uidValidityStr,
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
    } finally {
      await client.logout().catch(() => {});
    }

    const newestFirst = results.reverse();
    await this.cacheService.setFolderHeaders(folder, uidValidityStr, newestFirst);
    return newestFirst;
  }

  /**
   * Pobiera pełną wiadomość za pomocą BODY.PEEK[] (readOnly lock przy nonIntrusivePeek),
   * aby podgląd w Obsidianie nie oznaczał automatycznie maila jako przeczytanego na serwerze.
   */
  async fetchFullMessage(folder: string, uid: number): Promise<ParsedEmailMessage> {
    const client = await this.createClient();
    await client.connect();
    try {
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
      await client.logout().catch(() => {});
    }
  }

  /**
   * Monitor zajętości skrzynki: IMAP GETQUOTAROOT + LIST + STATUS + RFC822.SIZE
   */
  async getMailboxStorageReport(topLargestLimit = 40): Promise<MailboxQuotaReport> {
    const client = await this.createClient();
    await client.connect();

    const foldersReport: FolderStorageInfo[] = [];
    const largestCandidates: LargeMessageInfo[] = [];
    let quotaSupported = false;
    let usedBytes = 0;
    let limitBytes: number | null = null;
    let totalCalculatedBytes = 0;
    let totalMessages = 0;

    try {
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

        // Na Gmailu [Gmail]/All Mail dubluje wiadomości z INBOX i etykiet — nie dublujemy w sumie całkowitej
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
      await client.logout().catch(() => {});
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
    const client = await this.createClient();
    await client.connect();
    try {
      await client.mailboxCreate(targetFolder).catch(() => {});
      const lock = await client.getMailboxLock(sourceFolder);
      try {
        await client.messageMove(String(uid), targetFolder, { uid: true });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
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
    const client = await this.createClient();
    await client.connect();
    try {
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
      await client.logout().catch(() => {});
    }
  }

  /**
   * IMAP APPEND do folderu Sent po wysłaniu wiadomości przez SMTP.
   * Dla serwerów Gmail pomijamy APPEND, ponieważ SMTP Gmaila sam zapisuje kopię w [Gmail]/Sent Mail (Wysłane).
   */
  async appendSentMessage(rawMimeBuffer: Buffer): Promise<void> {
    if (!this.settings.appendSentToImap) return;
    if (this.isGmailServer()) return;

    const client = await this.createClient();
    await client.connect();
    try {
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
      await client.logout().catch(() => {});
    }
  }

  /**
   * IMAP IDLE w tle (heartbeat co 29 min wg RFC 2177) — powiadamia aktywny widok o nowych mailach.
   */
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

      // Heartbeat co 25 minut (poniżej limitu 29 min RFC 2177)
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
      await c.logout().catch(() => {
        c.close();
      });
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

function buildPolishImapErrorHint(
  message: string,
  isGmail: boolean,
  port: number,
  secure: boolean
): string {
  const lower = message.toLowerCase();
  if (
    isGmail &&
    (lower.includes("auth") ||
      lower.includes("credential") ||
      lower.includes("application-specific") ||
      lower.includes("web login"))
  ) {
    return "Gmail wymaga 16-znakowego Hasła aplikacji Google (Konto Google → Bezpieczeństwo → Weryfikacja dwuetapowa → Hasła aplikacji) zamiast zwykłego hasła do konta. Upewnij się też, że IMAP jest włączony w ustawieniach Gmaila.";
  }
  if (lower.includes("auth") || lower.includes("login") || lower.includes("credentials")) {
    return "Serwer odrzucił dane logowania. Sprawdź, czy login to pełny adres e-mail oraz czy hasło zostało poprawnie zapisane.";
  }
  if (lower.includes("enotfound") || lower.includes("eai_again")) {
    return "Nie udało się rozwiązać nazwy hosta DNS. Zweryfikuj adres serwera IMAP (np. imap.roundcube.pl lub imap.gmail.com).";
  }
  if (lower.includes("wrong version number") || lower.includes("ssl") || lower.includes("tls")) {
    return port === 143 && secure
      ? "Port 143 używa STARTTLS — wyłącz opcję „Bezpośredni SSL/TLS” lub zmień port na 993."
      : "Błąd uzgadniania TLS/SSL. Dla portu 993 włącz SSL/TLS, dla portu 143 użyj STARTTLS (wyłączony SSL/TLS).";
  }
  if (lower.includes("timeout") || lower.includes("econnrefused")) {
    return "Przekroczono czas połączenia lub port jest zablokowany przez zaporę. Sprawdź port (993 dla SSL/TLS) i dostępność sieci.";
  }
  return "Sprawdź poprawność hosta, portu, szyfrowania TLS oraz poświadczeń skrzynki.";
}
