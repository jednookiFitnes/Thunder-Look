import { simpleParser } from "mailparser";
import TurndownService from "turndown";
import { EmailThreadGroup, ImapMessageHeader, ParsedEmailMessage } from "../types";
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

export function convertHtmlToMarkdown(html: string): string {
  try {
    return normalizeLineEndings(turndown.turndown(html));
  } catch {
    return normalizeLineEndings(html.replace(/<[^>]+>/g, " "));
  }
}

export async function parseRawEmlBuffer(
  raw: Buffer | string,
  meta?: { uid?: number; folder?: string; seen?: boolean; flagged?: boolean }
): Promise<ParsedEmailMessage> {
  const rawBuffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
  const parsed = await simpleParser(rawBuffer);

  const fromAddr = parsed.from?.value?.[0];
  const dateObj = parsed.date || new Date();
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

  return {
    uid: meta?.uid,
    folder: meta?.folder,
    messageId: parsed.messageId?.trim() || undefined,
    inReplyTo: parsed.inReplyTo?.trim() || undefined,
    references,
    date: dateObj.toISOString().slice(0, 10),
    dateTimeIso: dateObj.toISOString(),
    fromName: fromAddr?.name || fromAddr?.address || "Nieznany",
    fromEmail: fromAddr?.address || "",
    fromRaw: parsed.from?.text || fromAddr?.address || "",
    toRaw: Array.isArray(parsed.to)
      ? parsed.to.map((t) => t.text).join(", ")
      : parsed.to?.text || "",
    subject: parsed.subject || "(Bez tematu)",
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

  // Przetwarzaj od najstarszych, aby korzeń wątku był stabilny
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
