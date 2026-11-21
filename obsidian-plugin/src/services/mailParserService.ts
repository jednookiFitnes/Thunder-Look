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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Bezpieczna konwersja prostego Markdown z edytora odpowiedzi na czysty HTML wiadomości e-mail
 * (pogrubienie, kursywa, kod, linki, listy, cytaty, akapity).
 */
export function convertMarkdownToCleanEmailHtml(markdown: string): string {
  const lines = normalizeLineEndings(markdown).split("\n");
  const out: string[] = [];
  let inList = false;
  let inQuote = false;

  const formatInline = (raw: string): string => {
    let s = escapeHtml(raw);
    s = s.replace(/`([^`]+)`/g, "<code style=\"background:#f1f5f9;padding:1px 4px;border-radius:3px;\">$1</code>");
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
    s = s.replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      "<a href=\"$2\" style=\"color:#2563eb;text-decoration:underline;\">$1</a>"
    );
    return s;
  };

  const closeOpenBlocks = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
    if (inQuote) {
      out.push("</blockquote>");
      inQuote = false;
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeOpenBlocks();
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      if (inQuote) {
        out.push("</blockquote>");
        inQuote = false;
      }
      if (!inList) {
        out.push("<ul style=\"margin:8px 0;padding-left:20px;\">");
        inList = true;
      }
      out.push(`<li>${formatInline(trimmed.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      if (inList) {
        out.push("</ul>");
        inList = false;
      }
      if (!inQuote) {
        out.push(
          "<blockquote style=\"margin:8px 0;padding:4px 12px;border-left:3px solid #cbd5e1;color:#475569;\">"
        );
        inQuote = true;
      }
      out.push(`<div>${formatInline(trimmed.replace(/^>\s?/, ""))}</div>`);
      continue;
    }

    closeOpenBlocks();
    if (/^###\s+/.test(trimmed)) {
      out.push(`<h3 style="margin:12px 0 6px;">${formatInline(trimmed.slice(4))}</h3>`);
    } else if (/^##\s+/.test(trimmed)) {
      out.push(`<h2 style="margin:14px 0 6px;">${formatInline(trimmed.slice(3))}</h2>`);
    } else if (/^#\s+/.test(trimmed)) {
      out.push(`<h1 style="margin:14px 0 8px;">${formatInline(trimmed.slice(2))}</h1>`);
    } else {
      out.push(`<p style="margin:0 0 10px;line-height:1.55;">${formatInline(line)}</p>`);
    }
  }
  closeOpenBlocks();

  return `<!doctype html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#111827;margin:0;padding:0;">${out.join("")}</body></html>`;
}

export async function parseRawEmlBuffer(
  raw: Buffer | string,
  meta?: {
    uid?: number;
    folder?: string;
    accountId?: string;
    accountLabel?: string;
    accountColor?: string;
    seen?: boolean;
    flagged?: boolean;
  }
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
    accountId: meta?.accountId,
    accountLabel: meta?.accountLabel,
    accountColor: meta?.accountColor,
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

const GENERIC_SUBJECTS = new Set([
  "",
  "(bez tematu)",
  "bez tematu",
  "brak tematu",
  "(no subject)",
  "no subject",
  "powiadomienie",
  "notification",
  "informacja",
  "wiadomość",
  "wiadomosc",
  "alert",
  "newsletter",
  "potwierdzenie",
  "faktura",
  "zamówienie",
  "zamowienie",
]);

function hasReplyOrForwardPrefix(subject: string): boolean {
  return /^\s*(re|fwd|fw|odp|pd|aw)\s*(\[\d+\])?\s*:/i.test(String(subject || ""));
}

function cleanMessageIdToken(id?: string): string {
  return String(id || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .toLowerCase();
}

function collectMessageIdSet(input: {
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}): Set<string> {
  const out = new Set<string>();
  const add = (val?: string) => {
    const cleaned = cleanMessageIdToken(val);
    if (cleaned) out.add(cleaned);
  };
  add(input.messageId);
  add(input.inReplyTo);
  for (const r of input.references || []) add(r);
  return out;
}

/**
 * Grupuje płaską listę nagłówków w wątki RFC 5322 (Message-ID / In-Reply-To / References)
 * ze ścisłą izolacją per konto (`accountId`) i bezpiecznym fallbackiem po temacie
 * (nigdy nie skleja niepowiązanych maili o generycznym temacie ani z różnych kont).
 */
export function groupHeadersIntoThreads(headers: ImapMessageHeader[]): EmailThreadGroup[] {
  const msgToRoot = new Map<string, string>();
  const subjectToRoot = new Map<string, { rootKey: string; senders: Set<string>; hasReply: boolean }>();
  const groups = new Map<string, ImapMessageHeader[]>();

  const timeOf = (h: ImapMessageHeader): number =>
    h.internalDateIso ? Date.parse(h.internalDateIso) || h.uid : Date.parse(h.date) || h.uid;

  const chronological = [...headers].sort((a, b) => timeOf(a) - timeOf(b));

  for (const h of chronological) {
    const accScope = h.accountId || "default";
    let rootKey: string | undefined;

    for (const ref of h.references || []) {
      const cleaned = cleanMessageIdToken(ref);
      if (!cleaned) continue;
      const scopedRef = `${accScope}::${cleaned}`;
      if (msgToRoot.has(scopedRef)) {
        rootKey = msgToRoot.get(scopedRef);
        break;
      }
    }
    if (!rootKey && h.inReplyTo) {
      const cleaned = cleanMessageIdToken(h.inReplyTo);
      const scopedReply = cleaned ? `${accScope}::${cleaned}` : "";
      if (scopedReply && msgToRoot.has(scopedReply)) {
        rootKey = msgToRoot.get(scopedReply);
      }
    }

    const normSubj = normalizeSubjectForThread(h.subject);
    const isReplyLike = hasReplyOrForwardPrefix(h.subject);
    const senderEmail = (h.fromEmail || "").trim().toLowerCase();
    const subjScopeKey = normSubj && !GENERIC_SUBJECTS.has(normSubj) ? `${accScope}::${normSubj}` : "";

    if (!rootKey && subjScopeKey && subjectToRoot.has(subjScopeKey)) {
      const existing = subjectToRoot.get(subjScopeKey)!;
      // Fallback po temacie TYLKO gdy to wyraźna odpowiedź (Re:/Odp:/Fwd:) albo ten sam nadawca
      if (isReplyLike || existing.hasReply || (senderEmail && existing.senders.has(senderEmail))) {
        rootKey = existing.rootKey;
      }
    }

    if (!rootKey) {
      const cleanMid = cleanMessageIdToken(h.messageId);
      rootKey = cleanMid
        ? `${accScope}::mid:${cleanMid}`
        : `${accScope}::uid:${h.folder}:${h.uid}`;
    }

    const cleanMid = cleanMessageIdToken(h.messageId);
    const cleanReply = cleanMessageIdToken(h.inReplyTo);
    if (cleanMid) msgToRoot.set(`${accScope}::${cleanMid}`, rootKey);
    if (cleanReply) msgToRoot.set(`${accScope}::${cleanReply}`, rootKey);
    for (const ref of h.references || []) {
      const c = cleanMessageIdToken(ref);
      if (c) msgToRoot.set(`${accScope}::${c}`, rootKey);
    }

    if (subjScopeKey) {
      const entry = subjectToRoot.get(subjScopeKey);
      if (entry && entry.rootKey === rootKey) {
        if (senderEmail) entry.senders.add(senderEmail);
        if (isReplyLike) entry.hasReply = true;
      } else if (!entry) {
        subjectToRoot.set(subjScopeKey, {
          rootKey,
          senders: new Set(senderEmail ? [senderEmail] : []),
          hasReply: isReplyLike,
        });
      }
    }

    const list = groups.get(rootKey) || [];
    list.push(h);
    groups.set(rootKey, list);
  }

  const threads: EmailThreadGroup[] = [];
  for (const [threadKey, list] of groups.entries()) {
    list.sort((a, b) => timeOf(b) - timeOf(a) || b.uid - a.uid);
    const newest = list[0];
    threads.push({
      threadKey,
      subject: newest.subject,
      latestDate: newest.date,
      latestDateIso: newest.internalDateIso,
      totalSizeBytes: list.reduce((sum, m) => sum + m.sizeBytes, 0),
      unreadCount: list.filter((m) => !m.seen).length,
      flagged: list.some((m) => m.flagged),
      hasAttachments: list.some((m) => Boolean(m.hasAttachments)),
      projectCode: list.find((m) => m.detectedProjectCode)?.detectedProjectCode || null,
      messages: list,
    });
  }

  return threads.sort((a, b) => {
    const ta = a.messages[0] ? timeOf(a.messages[0]) : 0;
    const tb = b.messages[0] ? timeOf(b.messages[0]) : 0;
    return tb - ta || (b.messages[0]?.uid || 0) - (a.messages[0]?.uid || 0);
  });
}

/**
 * Zwraca wyłącznie autentycznie powiązane wiadomości z tego samego wątku i tego samego konta,
 * chroniąc panel podglądu przed wyświetlaniem przypadkowych maili z innych kont lub niepowiązanych tematów.
 */
export function filterRelatedThreadMessages(
  email: ParsedEmailMessage,
  candidates: ImapMessageHeader[]
): ImapMessageHeader[] {
  if (!candidates || candidates.length <= 1) return [];
  const emailAcc = email.accountId || "default";
  const emailIds = collectMessageIdSet(email);
  const emailNormSubj = normalizeSubjectForThread(email.subject);
  const emailIsReply = hasReplyOrForwardPrefix(email.subject);
  const emailFrom = (email.fromEmail || "").trim().toLowerCase();

  return candidates.filter((cand) => {
    const candAcc = cand.accountId || "default";
    if (candAcc !== emailAcc) return false;
    if (cand.uid === email.uid && (!email.folder || cand.folder === email.folder)) return false;

    // 1. Ścisłe powiązanie RFC 5322 (wspólny Message-ID / In-Reply-To / References)
    const candIds = collectMessageIdSet(cand);
    for (const id of candIds) {
      if (emailIds.has(id)) return true;
    }

    // 2. Fallback po znormalizowanym temacie wyłącznie dla niegenerycznego tematu i odpowiedzi
    if (emailNormSubj && !GENERIC_SUBJECTS.has(emailNormSubj)) {
      const candNormSubj = normalizeSubjectForThread(cand.subject);
      if (candNormSubj === emailNormSubj) {
        const candIsReply = hasReplyOrForwardPrefix(cand.subject);
        const candFrom = (cand.fromEmail || "").trim().toLowerCase();
        if (emailIsReply || candIsReply || (emailFrom && candFrom && emailFrom === candFrom)) {
          return true;
        }
      }
    }

    return false;
  });
}
