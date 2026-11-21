import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import TurndownService from 'turndown';
import type { AppConfig } from './config.js';
import {
  assertSafeSmtpHeaderValue,
  isGmailHostname,
} from '../../shared/networkSecurity.js';
import {
  buildCanonicalThreadId,
  computeContentHash,
} from '../../shared/textUtils.js';
import { sanitizeEmailHtml } from '../../shared/htmlSanitizer.js';
import { formatBytes, naturalCompare, stripQuotesAndSignatures } from './textUtils.js';

const CONNECTION_TIMEOUT_MS = 12_000;
const GREETING_TIMEOUT_MS = 10_000;
const SOCKET_TIMEOUT_MS = 30_000;

export interface FolderInfo {
  path: string;
  name: string;
  specialUse?: string;
  messages: number;
  unseen: number;
  uidValidity: string;
  totalBytes: number;
  totalFormatted: string;
}

export interface EmailSummary {
  uid: number;
  folder: string;
  messageId: string;
  inReplyTo?: string;
  threadId?: string;
  subject: string;
  from: string;
  fromEmail: string;
  to: string[];
  date: string;
  sizeBytes: number;
  sizeFormatted: string;
  flags: string[];
  hasAttachments: boolean;
}

export interface ParsedAttachmentInfo {
  filename: string;
  contentType: string;
  size: number;
  content: Buffer;
}

export interface ParsedEmailFull extends EmailSummary {
  threadId: string;
  contentHash: string;
  text: string;
  markdown: string;
  cleanedMarkdown: string;
  quoteSavingsPercent: number;
  html: string;
  rawEml: Buffer;
  attachments: ParsedAttachmentInfo[];
}

export interface MailboxQuotaReport {
  account: string;
  quotaStorage: {
    usedBytes: number;
    limitBytes: number | null;
    usedFormatted: string;
    limitFormatted: string | null;
    usagePercent: number | null;
  };
  totalMeasuredBytes: number;
  totalMeasuredFormatted: string;
  totalMessages: number;
  folders: FolderInfo[];
  largestMessages: EmailSummary[];
}

function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  td.remove(['script', 'style', 'iframe', 'noscript', 'object', 'embed']);
  return td;
}

export class ImapMailService {
  constructor(private readonly config: AppConfig) {}

  private assertImapCredentials(): void {
    if (!this.config.imap.host || !this.config.imap.user || !this.config.imap.password) {
      throw new Error(
        'Brak danych logowania IMAP (IMAP_HOST, MAIL_USER, MAIL_PASSWORD w .env lub zmiennych środowiskowych).'
      );
    }
  }

  private createImapClient(): ImapFlow {
    this.assertImapCredentials();
    return new ImapFlow({
      host: this.config.imap.host,
      port: this.config.imap.port,
      secure: this.config.imap.secure,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      auth: {
        user: this.config.imap.user,
        pass: this.config.imap.password,
      },
      tls: {
        rejectUnauthorized: this.config.imap.strictTls,
        minVersion: 'TLSv1.2',
      },
      logger: false,
    });
  }

  private async withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const client = this.createImapClient();
      try {
        await client.connect();
        try {
          return await fn(client);
        } finally {
          await client.logout().catch(() => {
            client.close();
          });
        }
      } catch (err) {
        lastErr = err;
        const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
        const transient =
          msg.includes('econnreset') || msg.includes('etimedout') || msg.includes('timeout');
        if (attempt >= 2 || !transient) throw err;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw lastErr;
  }

  async listFolders(includeSizes = false): Promise<FolderInfo[]> {
    return this.withClient(async (client) => {
      const mailboxes = await client.list();
      const results: FolderInfo[] = [];

      for (const mb of mailboxes) {
        let messages = 0;
        let unseen = 0;
        let uidValidity = '0';
        let totalBytes = 0;

        try {
          const status = await client.status(mb.path, {
            messages: true,
            unseen: true,
            uidValidity: true,
          });
          messages = status.messages ?? 0;
          unseen = status.unseen ?? 0;
          uidValidity = status.uidValidity ? String(status.uidValidity) : '0';

          if (includeSizes && messages > 0) {
            const lock = await client.getMailboxLock(mb.path, { readOnly: true });
            try {
              for await (const msg of client.fetch('1:*', { size: true })) {
                totalBytes += msg.size || 0;
              }
            } finally {
              lock.release();
            }
          }
        } catch (err) {
          console.error(`[thunder-look-mcp] Nie udało się pobrać statusu folderu ${mb.path}:`, err);
        }

        results.push({
          path: mb.path,
          name: mb.name,
          specialUse: mb.specialUse,
          messages,
          unseen,
          uidValidity,
          totalBytes,
          totalFormatted: formatBytes(totalBytes),
        });
      }

      results.sort((a, b) => naturalCompare(a.path, b.path));
      return results;
    });
  }

  async getMailboxStorageQuota(topLargest = 20): Promise<MailboxQuotaReport> {
    return this.withClient(async (client) => {
      let quotaUsedBytes = 0;
      let quotaLimitBytes: number | null = null;

      try {
        const quota = await client.getQuota('INBOX');
        if (quota && typeof quota === 'object' && quota.storage) {
          quotaUsedBytes = quota.storage.used ?? 0;
          quotaLimitBytes = quota.storage.limit ?? null;
        }
      } catch {
        // RFC 2087 QUOTA nieobsługiwane
      }

      const mailboxes = await client.list();
      const folders: FolderInfo[] = [];
      const allMessages: EmailSummary[] = [];
      let totalMeasuredBytes = 0;
      let totalMessages = 0;

      for (const mb of mailboxes) {
        let messages = 0;
        let unseen = 0;
        let uidValidity = '0';
        let folderBytes = 0;

        try {
          const status = await client.status(mb.path, {
            messages: true,
            unseen: true,
            uidValidity: true,
          });
          messages = status.messages ?? 0;
          unseen = status.unseen ?? 0;
          uidValidity = status.uidValidity ? String(status.uidValidity) : '0';

          if (messages > 0) {
            const lock = await client.getMailboxLock(mb.path, { readOnly: true });
            try {
              for await (const msg of client.fetch('1:*', {
                uid: true,
                size: true,
                envelope: true,
                flags: true,
                bodyStructure: true,
              })) {
                const sz = msg.size || 0;
                folderBytes += sz;
                const fromObj = msg.envelope?.from?.[0];
                allMessages.push({
                  uid: msg.uid,
                  folder: mb.path,
                  messageId: msg.envelope?.messageId || '',
                  inReplyTo: msg.envelope?.inReplyTo || undefined,
                  subject: msg.envelope?.subject || '(Bez tematu)',
                  from: fromObj?.name
                    ? `${fromObj.name} <${fromObj.address || ''}>`
                    : fromObj?.address || 'Nieznany',
                  fromEmail: (fromObj?.address || '').toLowerCase(),
                  to: (msg.envelope?.to || []).map((t) => t.address || '').filter(Boolean),
                  date: msg.envelope?.date ? msg.envelope.date.toISOString() : new Date().toISOString(),
                  sizeBytes: sz,
                  sizeFormatted: formatBytes(sz),
                  flags: Array.from(msg.flags || []),
                  hasAttachments: hasAttachmentInStructure(msg.bodyStructure),
                });
              }
            } finally {
              lock.release();
            }
          }
        } catch (err) {
          console.error(`[thunder-look-mcp] Błąd analizy rozmiaru folderu ${mb.path}:`, err);
        }

        const isGmailAllMail =
          isGmailHostname(this.config.imap.host) &&
          (mb.specialUse === '\\All' || /^\[Gmail\]\/(All Mail|Wszystkie)/i.test(mb.path));

        if (!isGmailAllMail) {
          totalMeasuredBytes += folderBytes;
          totalMessages += messages;
        }
        folders.push({
          path: mb.path,
          name: mb.name,
          specialUse: mb.specialUse,
          messages,
          unseen,
          uidValidity,
          totalBytes: folderBytes,
          totalFormatted: formatBytes(folderBytes),
        });
      }

      folders.sort((a, b) => b.totalBytes - a.totalBytes);
      allMessages.sort((a, b) => b.sizeBytes - a.sizeBytes);

      const effectiveUsed = quotaUsedBytes > 0 ? quotaUsedBytes : totalMeasuredBytes;
      const usagePercent =
        quotaLimitBytes && quotaLimitBytes > 0
          ? Number(((effectiveUsed / quotaLimitBytes) * 100).toFixed(1))
          : null;

      return {
        account: this.config.imap.user,
        quotaStorage: {
          usedBytes: effectiveUsed,
          limitBytes: quotaLimitBytes,
          usedFormatted: formatBytes(effectiveUsed),
          limitFormatted: quotaLimitBytes ? formatBytes(quotaLimitBytes) : null,
          usagePercent,
        },
        totalMeasuredBytes,
        totalMeasuredFormatted: formatBytes(totalMeasuredBytes),
        totalMessages,
        folders,
        largestMessages: allMessages.slice(0, topLargest),
      };
    });
  }

  async listEmails(params: {
    folder?: string;
    limit?: number;
    unseenOnly?: boolean;
    searchQuery?: string;
  }): Promise<EmailSummary[]> {
    const folder = params.folder || this.config.imap.allowlistFolder || 'INBOX';
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const criteria: Record<string, unknown> = {};
        if (params.unseenOnly) {
          criteria.seen = false;
        }
        if (params.searchQuery && params.searchQuery.trim()) {
          criteria.or = [
            { subject: params.searchQuery.trim() },
            { from: params.searchQuery.trim() },
            { body: params.searchQuery.trim() },
          ];
        }

        const matchedUids = await client.search(
          Object.keys(criteria).length > 0 ? criteria : { all: true },
          { uid: true }
        );

        const uidList = Array.isArray(matchedUids) ? matchedUids : [];
        if (uidList.length === 0) return [];

        const recentUids = uidList.slice(-limit).reverse();
        const summaries: EmailSummary[] = [];

        for await (const msg of client.fetch(
          recentUids,
          {
            uid: true,
            size: true,
            envelope: true,
            flags: true,
            bodyStructure: true,
          },
          { uid: true }
        )) {
          const fromObj = msg.envelope?.from?.[0];
          const sz = msg.size || 0;
          summaries.push({
            uid: msg.uid,
            folder,
            messageId: msg.envelope?.messageId || '',
            inReplyTo: msg.envelope?.inReplyTo || undefined,
            subject: msg.envelope?.subject || '(Bez tematu)',
            from: fromObj?.name
              ? `${fromObj.name} <${fromObj.address || ''}>`
              : fromObj?.address || 'Nieznany',
            fromEmail: (fromObj?.address || '').toLowerCase(),
            to: (msg.envelope?.to || []).map((t) => t.address || '').filter(Boolean),
            date: msg.envelope?.date ? msg.envelope.date.toISOString() : new Date().toISOString(),
            sizeBytes: sz,
            sizeFormatted: formatBytes(sz),
            flags: Array.from(msg.flags || []),
            hasAttachments: hasAttachmentInStructure(msg.bodyStructure),
          });
        }

        summaries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        return summaries;
      } finally {
        lock.release();
      }
    });
  }

  async readEmailByUid(folder: string, uid: number): Promise<ParsedEmailFull> {
    return this.withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const fetched = await client.fetchOne(
          String(uid),
          {
            uid: true,
            size: true,
            envelope: true,
            flags: true,
            source: true,
          },
          { uid: true }
        );

        if (!fetched || !fetched.source) {
          throw new Error(`Nie znaleziono wiadomości UID ${uid} w folderze "${folder}".`);
        }

        const parsed = await simpleParser(fetched.source);
        const td = createTurndown();

        const rawHtml = typeof parsed.html === 'string' ? parsed.html : '';
        const safeHtml = rawHtml
          ? sanitizeEmailHtml(rawHtml, { blockRemoteImages: true }).bodyHtml
          : '';
        const textString = parsed.text || '';
        const markdown = safeHtml ? td.turndown(safeHtml) : textString;

        const stripped = stripQuotesAndSignatures(markdown || textString);
        const fromFirst = parsed.from?.value?.[0];
        const toAddrs = extractAddresses(parsed.to);
        const sz = fetched.size || fetched.source.length;
        const dateIso = (parsed.date || fetched.envelope?.date || new Date()).toISOString();
        const subject = parsed.subject || fetched.envelope?.subject || '(Bez tematu)';
        const messageId = parsed.messageId || fetched.envelope?.messageId || `<uid-${uid}@local>`;
        const inReplyTo = parsed.inReplyTo || fetched.envelope?.inReplyTo || undefined;
        const fromEmail = (fromFirst?.address || '').toLowerCase();

        const rawRefs = parsed.references;
        const references: string[] = Array.isArray(rawRefs)
          ? rawRefs.map((r) => String(r).trim()).filter(Boolean)
          : typeof rawRefs === 'string'
          ? rawRefs.split(/\s+/).filter(Boolean)
          : [];

        const threadId = buildCanonicalThreadId({
          references,
          inReplyTo,
          messageId,
          subject,
        });
        const contentHash = computeContentHash({
          fromEmail,
          subject,
          date: dateIso.slice(0, 10),
          body: stripped.cleaned || markdown,
        });

        const attachments: ParsedAttachmentInfo[] = (parsed.attachments || []).map((att) => ({
          filename: att.filename || 'zalacznik.bin',
          contentType: att.contentType || 'application/octet-stream',
          size: att.size || att.content.length,
          content: att.content,
        }));

        return {
          uid: fetched.uid,
          folder,
          messageId,
          inReplyTo,
          threadId,
          contentHash,
          subject,
          from: fromFirst?.name
            ? `${fromFirst.name} <${fromFirst.address || ''}>`
            : fromFirst?.address || 'Nieznany',
          fromEmail,
          to: toAddrs,
          date: dateIso,
          sizeBytes: sz,
          sizeFormatted: formatBytes(sz),
          flags: Array.from(fetched.flags || []),
          hasAttachments: attachments.length > 0,
          text: textString,
          markdown,
          cleanedMarkdown: stripped.cleaned,
          quoteSavingsPercent: stripped.savedPercent,
          html: safeHtml,
          rawEml: fetched.source,
          attachments,
        };
      } finally {
        lock.release();
      }
    });
  }

  async moveEmailFolder(params: {
    sourceFolder: string;
    uid: number;
    destinationFolder: string;
  }): Promise<{ moved: boolean; uid: number; from: string; to: string }> {
    return this.withClient(async (client) => {
      try {
        await client.mailboxCreate(params.destinationFolder);
      } catch {
        // Folder już istnieje
      }

      const lock = await client.getMailboxLock(params.sourceFolder);
      try {
        await client.messageMove(String(params.uid), params.destinationFolder, { uid: true });
        return {
          moved: true,
          uid: params.uid,
          from: params.sourceFolder,
          to: params.destinationFolder,
        };
      } finally {
        lock.release();
      }
    });
  }

  async sendEmail(params: {
    to: string;
    cc?: string;
    subject: string;
    text: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string; appendedToSent: boolean; sentFolder: string | null }> {
    if (!this.config.smtp.host || !this.config.smtp.user || !this.config.smtp.password) {
      throw new Error('Brak danych logowania SMTP (SMTP_HOST, MAIL_USER, MAIL_PASSWORD).');
    }

    // Ochrona przed SMTP Header Injection (\r, \n, \0)
    const safeTo = assertSafeSmtpHeaderValue('to', params.to);
    const safeCc = params.cc ? assertSafeSmtpHeaderValue('cc', params.cc) : undefined;
    const safeSubject = assertSafeSmtpHeaderValue('subject', params.subject);
    const safeInReplyTo = params.inReplyTo
      ? assertSafeSmtpHeaderValue('inReplyTo', params.inReplyTo)
      : undefined;
    const safeReferences = params.references
      ? assertSafeSmtpHeaderValue('references', params.references)
      : undefined;
    const safeFromName = this.config.smtp.fromName
      ? assertSafeSmtpHeaderValue('fromName', this.config.smtp.fromName).replace(/"/g, "'")
      : '';
    const safeUser = assertSafeSmtpHeaderValue('from', this.config.smtp.user);

    const transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      greetingTimeout: GREETING_TIMEOUT_MS,
      socketTimeout: SOCKET_TIMEOUT_MS,
      auth: {
        user: safeUser,
        pass: this.config.smtp.password,
      },
      tls: {
        rejectUnauthorized: this.config.smtp.strictTls,
        minVersion: 'TLSv1.2',
      },
    });

    const mailOptions = {
      from: safeFromName ? `"${safeFromName}" <${safeUser}>` : safeUser,
      to: safeTo,
      cc: safeCc,
      subject: safeSubject,
      text: params.text,
      html: params.html
        ? sanitizeEmailHtml(params.html, { blockRemoteImages: true }).bodyHtml
        : undefined,
      inReplyTo: safeInReplyTo,
      references: safeReferences,
    };

    let info: { messageId: string };
    try {
      info = await transporter.sendMail(mailOptions);
    } finally {
      transporter.close();
    }

    const isGmailSmtp = isGmailHostname(this.config.smtp.host);
    let appendedToSent = false;
    let sentFolder: string | null = isGmailSmtp ? '[Gmail]/Sent Mail (auto)' : null;
    if (!isGmailSmtp) {
      try {
        const rawTransporter = nodemailer.createTransport({ streamTransport: true, buffer: true });
        const rawInfo = await rawTransporter.sendMail({
          ...mailOptions,
          messageId: info.messageId,
        });
        const rawBuffer = Buffer.isBuffer(rawInfo.message)
          ? rawInfo.message
          : Buffer.from(String(rawInfo.message));

        const appendRes = await this.appendToSentFolder(rawBuffer);
        appendedToSent = appendRes.appended;
        sentFolder = appendRes.folder;
      } catch (err) {
        console.error('[thunder-look-mcp] Wysłano SMTP, błąd zapisu kopii w Sent:', err);
      }
    }

    return {
      messageId: info.messageId,
      appendedToSent,
      sentFolder,
    };
  }

  private async appendToSentFolder(
    rawMime: Buffer
  ): Promise<{ appended: boolean; folder: string | null }> {
    return this.withClient(async (client) => {
      const mailboxes = await client.list();
      const sentMailbox =
        mailboxes.find((m) => m.specialUse === '\\Sent') ||
        mailboxes.find((m) => /^(INBOX\.)?(Sent|Wysłane|Sent Items|Sent Mail)$/i.test(m.path));

      const targetPath = sentMailbox?.path || 'Sent';
      await client.append(targetPath, rawMime, ['\\Seen']);
      return { appended: true, folder: targetPath };
    });
  }
}

function hasAttachmentInStructure(structure: unknown): boolean {
  if (!structure || typeof structure !== 'object') return false;
  const node = structure as {
    disposition?: string;
    childNodes?: unknown[];
    dispositionParameters?: Record<string, string>;
  };
  if (node.disposition?.toLowerCase() === 'attachment') return true;
  if (node.dispositionParameters?.filename) return true;
  if (Array.isArray(node.childNodes)) {
    return node.childNodes.some((child) => hasAttachmentInStructure(child));
  }
  return false;
}

function extractAddresses(addrObj: unknown): string[] {
  if (!addrObj) return [];
  const list = Array.isArray(addrObj) ? addrObj : [addrObj];
  const emails: string[] = [];
  for (const item of list) {
    if (item && typeof item === 'object' && 'value' in item) {
      const vals = (item as { value?: Array<{ address?: string }> }).value || [];
      for (const v of vals) {
        if (v.address) emails.push(v.address);
      }
    }
  }
  return emails;
}
