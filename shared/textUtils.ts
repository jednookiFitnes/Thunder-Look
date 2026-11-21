import type { TaskPriority } from "./types.js";

const naturalCollator = new Intl.Collator("pl", { numeric: true, sensitivity: "base" });

export function naturalCompare(a: string, b: string): number {
  return naturalCollator.compare(a, b);
}

export function normalizeLineEndings(input: string): string {
  return String(input || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/**
 * Windows CRLF-safe processing: zachowuje oryginalne końce linii (\r\n vs \n).
 */
export function processLinesCrlfSafe(
  rawContent: string,
  transform: (lines: string[]) => string[]
): string {
  const isCrlf = rawContent.includes("\r\n");
  const lines = rawContent.replace(/\r\n/g, "\n").split("\n");
  const updated = transform(lines);
  return updated.join(isCrlf ? "\r\n" : "\n");
}

export function formatPolishDate(isoDate: string): string {
  const parts = String(isoDate || "").slice(0, 10).split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function normalizeSubjectForThread(subject: string): string {
  return String(subject || "")
    .replace(/^(\s*(re|fwd|fw|odp|pd|aw)\s*(\[\d+\])?\s*:\s*)+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export interface QuoteStripResult {
  cleaned: string;
  originalLength: number;
  cleanedLength: number;
  savedChars: number;
  savedPercent: number;
}

/**
 * Quote & Signature Stripping — usuwa powtarzaną historię cytowań oraz standardowe stopki.
 */
export function stripQuotesAndSignaturesDetailed(text: string): QuoteStripResult {
  const originalLength = text.length;
  const lines = normalizeLineEndings(text).split("\n");
  const result: string[] = [];

  const quoteStartPatterns = [
    /^On\s.+wrote:\s*$/i,
    /^W\s+dniu\s.+napisał(?:\(a\))?:\s*$/i,
    /^Dnia\s.+napisał(?:\(a\))?:\s*$/i,
    /^-{2,}\s*(Oryginalna wiadomość|Wiadomość oryginalna|Original Message|Forwarded message)\s*-{2,}$/i,
    /^Od:\s+.+@.+$/i,
    /^From:\s+.+@.+$/i,
  ];

  const signatureStartPatterns = [
    /^--\s*$/,
    /^Pozdrawiam(?: serdecznie)?,?\s*$/i,
    /^Z poważaniem,?\s*$/i,
    /^Best regards,?\s*$/i,
    /^Kind regards,?\s*$/i,
    /^Wysłan[eo] z (?:mojego )?(?:iPhone|iPad|Samsung|Android|telefonu|aplikacji|urządzenia)/i,
    /^Sent from my /i,
    /^(wiadomość ta jest poufna|niniejsza wiadomość|this email and any attachments)/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith(">")) continue;
    if (quoteStartPatterns.some((rx) => rx.test(trimmed))) break;
    if (line === "-- " || (i > 2 && signatureStartPatterns.some((rx) => rx.test(trimmed)))) {
      break;
    }

    result.push(line);
  }

  const cleaned = result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const cleanedLength = cleaned.length;
  const savedChars = Math.max(0, originalLength - cleanedLength);
  const savedPercent =
    originalLength > 0 ? Math.max(0, Math.round((savedChars / originalLength) * 100)) : 0;

  return { cleaned, originalLength, cleanedLength, savedChars, savedPercent };
}

export function stripQuotesAndSignatures(markdown: string): string {
  return stripQuotesAndSignaturesDetailed(markdown).cleaned;
}

export function priorityToEmoji(priority: TaskPriority): string {
  switch (priority) {
    case "high":
      return "⏫";
    case "medium":
      return "🔼";
    case "low":
      return "🔽";
  }
}

export function formatObsidianTaskLine(params: {
  description: string;
  dueDate?: string;
  priority?: TaskPriority;
  sourceNoteLink?: string;
}): string {
  const parts = [`- [ ] ${params.description.trim()}`];
  if (params.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(params.dueDate)) {
    parts.push(`📅 ${params.dueDate}`);
  }
  if (params.priority) {
    parts.push(priorityToEmoji(params.priority));
  }
  if (params.sourceNoteLink) {
    const link = params.sourceNoteLink.startsWith("[[")
      ? params.sourceNoteLink
      : `[[${params.sourceNoteLink.replace(/^\[\[|\]\]$/g, "")}]]`;
    parts.push(link);
  }
  return parts.join(" ");
}

export function extractObsidianTasks(
  text: string,
  defaultPriority: TaskPriority = "medium"
): string[] {
  const lines = normalizeLineEndings(text)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const actionTrigger =
    /(proszę|prosimy|prośba|trzeba|należy|odesłać|potwierdzić|zweryfikować|przesłanie|dostarcz|przygotować|uzupełnić|sprawdź|wyślij|zrób)/i;
  const isoDateRegex = /\b(20\d{2}-\d{2}-\d{2})\b/;
  const plDateRegex = /\b(\d{2})\.(\d{2})\.(20\d{2})\b/;
  const seen = new Set<string>();
  const tasks: string[] = [];

  for (const line of lines) {
    if (actionTrigger.test(line) && line.length >= 16) {
      const clean = line.replace(/^(\d+[.)]\s*|[-*•]\s*)/, "").trim();
      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const isoMatch = clean.match(isoDateRegex);
      const plMatch = clean.match(plDateRegex);
      const dueDate = isoMatch
        ? isoMatch[1]
        : plMatch
        ? `${plMatch[3]}-${plMatch[2]}-${plMatch[1]}`
        : undefined;

      const urgent = /(piln|asap|natychmiast|dzisiaj|awari|blokad|zamknąć)/i.test(clean);
      const prio: TaskPriority = urgent ? "high" : defaultPriority;
      tasks.push(formatObsidianTaskLine({ description: clean, dueDate, priority: prio }));
      if (tasks.length >= 10) break;
    }
  }

  return tasks;
}

/**
 * Deterministyczny, niezależny od środowiska hash treści wiadomości (FNV-1a 64-bit hex)
 * do deduplikacji maili nawet przy braku nagłówka Message-ID.
 */
export function computeContentHash(input: {
  fromEmail?: string;
  subject?: string;
  date?: string;
  body?: string;
}): string {
  const canonical = [
    (input.fromEmail || "").trim().toLowerCase(),
    normalizeSubjectForThread(input.subject || ""),
    (input.date || "").slice(0, 10),
    normalizeLineEndings(input.body || "").slice(0, 4000),
  ].join("|");

  let h1 = 0xdeadbeef ^ canonical.length;
  let h2 = 0x41c6ce57 ^ canonical.length;
  for (let i = 0; i < canonical.length; i++) {
    const ch = canonical.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h2 >>> 0).toString(16).padStart(8, "0")}${(h1 >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Wyznacza stabilny identyfikator wątku (thread_id) wg RFC 5322:
 * 1. Pierwszy wpis z nagłówka References (korzeń wątku),
 * 2. In-Reply-To,
 * 3. Message-ID,
 * 4. Znormalizowany temat jako fallback.
 */
export function buildCanonicalThreadId(input: {
  references?: string[];
  inReplyTo?: string;
  messageId?: string;
  subject?: string;
}): string {
  const cleanId = (val?: string): string =>
    String(val || "")
      .trim()
      .replace(/^["']|["']$/g, "")
      .toLowerCase();

  const firstRef = (input.references || []).map(cleanId).find(Boolean);
  if (firstRef) return firstRef;

  const reply = cleanId(input.inReplyTo);
  if (reply) return reply;

  const msgId = cleanId(input.messageId);
  if (msgId) return msgId;

  const subj = normalizeSubjectForThread(input.subject || "");
  return `thread:${computeContentHash({ subject: subj })}`;
}
