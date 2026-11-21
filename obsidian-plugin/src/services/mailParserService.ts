import { simpleParser } from "mailparser";
import TurndownService from "turndown";
import {
  buildCanonicalThreadId,
  computeContentHash,
} from "../../../shared/textUtils";
import { EmailThreadGroup, ImapMessageHeader, ParsedEmailMessage } from "../types";
import { stripHtmlToSafeMarkup } from "../utils/htmlSanitizer";
import {
  normalizeLineEndings,
  normalizeSubjectForThread,
  stripQuotesAndSignatures,
} from "../utils/textUtils";

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

/**
 * Konwertuje HTML na czysty Markdown WYŁĄCZNIE po uprzedniej sanityzacji (DOMPurify + blokada skryptów/SVG/eventów).
 */
export function convertHtmlToMarkdown(html: string): string {
  const safeHtml = stripHtmlToSafeMarkup(html);
  try {
    return normalizeLineEndings(turndown.turndown(safeHtml));
  } catch {
    return normalizeLineEndings(safeHtml.replace(/<[^>]+>/g, " "));
  }
}

export async function parseRawEmlBuffer(
  raw: Buffer | string,
  meta?: { uid?: number; folder?: string; seen?: boolean; flagged?: boolean }
): Promise<ParsedEmailMessage> {
  const rawBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  const parsed = await simpleParser(rawBuffer, {
    skipHtmlToText: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });

  const fromAddr = parsed.from?.value?.[0];
  const dateObj = parsed.date || new Date();
  const dateIso = dateObj.toISOString().slice(0, 10);
  const textBody = normalizeLineEndings(parsed.text || "");
  const htmlBody = typeof parsed.html === "string" ? parsed.html : undefined;
  const markdownBody = htmlBody ? convertHtmlToMarkdown(htmlBody) : textBody;
  const strippedMarkdownBody = stripQuotesAndSignatures(markdownBody);

  const rawRefs = parsed.references;
  const references: string[] = Array.isArray(rawRefs)
    ? rawRefs.map((r) => String(r).trim()).filter(Boolean)
    : typeof rawRefs === "string"
    ? rawRefs.split(/\s+/).filter(Boolean)
    : [];

  const messageId = parsed.messageId?.trim() || undefined;
  const inReplyTo = parsed.inReplyTo?.trim() || undefined;
  const subject = parsed.subject || "(Bez tematu)";
  const fromEmail = fromAddr?.address || "";

  const ccRaw = Array.isArray(parsed.cc)
    ? parsed.cc.map((c) => c.text).join(", ")
    : parsed.cc?.text || undefined;

  const replyToRaw = Array.isArray(parsed.replyTo)
    ? parsed.replyTo.map((r) => r.text).join(", ")
    : parsed.replyTo?.text || undefined;

  const threadId = buildCanonicalThreadId({
    references,
    inReplyTo,
    messageId,
    subject,
  });

  const contentHash = computeContentHash({
    fromEmail,
    subject,
    date: dateIso,
    body: strippedMarkdownBody || markdownBody || textBody,
  });

  return {
    uid: meta?.uid,
    folder: meta?.folder,
    messageId,
    inReplyTo,
    references,
    threadId,
    contentHash,
    date: dateIso,
    dateTimeIso: dateObj.toISOString(),
    fromName: fromAddr?.name || fromEmail || "Nieznany",
    fromEmail,
    fromRaw: parsed.from?.text || fromEmail || "",
    toRaw: Array.isArray(parsed.to)
      ? parsed.to.map((t) => t.text).join(", ")
      : parsed.to?.text || "",
    ccRaw,
    replyToRaw,
    subject,
    textBody,
    htmlBody,
    markdownBody,
    strippedMarkdownBody: strippedMarkdownBody || markdownBody,
    rawEmlBuffer: rawBuffer,
    sizeBytes: rawBuffer.byteLength,
    seen: meta?.seen,
    flagged: meta?.flagged,
    attachments: (parsed.attachments || []).map((att) => ({
      filename: att.filename || "zalacznik.bin",
      contentType: att.contentType || "application/octet-stream",
      size: att.size || att.content.byteLength,
      content: att.content,
    })),
  };
}

/**
 * Grupuje płaską listę nagłówków w wątki RFC 5322 (Message-ID / In-Reply-To / References)
 * z fallbackiem po znormalizowanym temacie.
 */
export function groupHeadersIntoThreads(headers: ImapMessageHeader[]): EmailThreadGroup[] {
  const msgToRoot = new Map<string, string>();
  const subjectToRoot = new Map<string, string>();
  const groups = new Map<string, ImapMessageHeader[]>();

  const chronological = [...headers].sort((a, b) => a.uid - b.uid);

  for (const h of chronological) {
    let rootKey: string | undefined;

    for (const ref of h.references) {
      if (msgToRoot.has(ref)) {
        rootKey = msgToRoot.get(ref);
        break;
      }
    }
    if (!rootKey && h.inReplyTo && msgToRoot.has(h.inReplyTo)) {
      rootKey = msgToRoot.get(h.inReplyTo);
    }

    const normSubj = normalizeSubjectForThread(h.subject);
    if (!rootKey && normSubj && subjectToRoot.has(normSubj)) {
      rootKey = subjectToRoot.get(normSubj);
    }

    if (!rootKey) {
      rootKey = h.messageId || `subj:${normSubj || h.uid}`;
    }

    if (h.messageId) msgToRoot.set(h.messageId, rootKey);
    if (h.inReplyTo) msgToRoot.set(h.inReplyTo, rootKey);
    if (normSubj) subjectToRoot.set(normSubj, rootKey);

    const list = groups.get(rootKey) || [];
    list.push(h);
    groups.set(rootKey, list);
  }

  const threads: EmailThreadGroup[] = [];
  for (const [threadKey, list] of groups.entries()) {
    list.sort((a, b) => b.uid - a.uid);
    const newest = list[0];
    threads.push({
      threadKey,
      subject: newest.subject,
      latestDate: newest.date,
      totalSizeBytes: list.reduce((sum, m) => sum + m.sizeBytes, 0),
      unreadCount: list.filter((m) => !m.seen).length,
      flagged: list.some((m) => m.flagged),
      projectCode: list.find((m) => m.detectedProjectCode)?.detectedProjectCode || null,
      messages: list,
    });
  }

  return threads.sort((a, b) => (b.messages[0]?.uid || 0) - (a.messages[0]?.uid || 0));
}
