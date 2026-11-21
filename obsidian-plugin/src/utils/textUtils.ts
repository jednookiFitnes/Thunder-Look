import { TaskPriority } from "../types";

export function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

/**
 * Windows CRLF-safe processing zgodnie z AGENTS.md:
 * wykrywa styl końców linii pliku i zachowuje go bez korumpowania diffów Git.
 */
export function processLinesCrlfSafe(
  rawContent: string,
  transform: (lines: string[]) => string[]
): string {
  const isCrlf = rawContent.includes("\r\n");
  const lines = rawContent.split(/\r?\n/);
  const updated = transform(lines);
  return updated.join(isCrlf ? "\r\n" : "\n");
}

/**
 * Naturalne / alfanumeryczne sortowanie (np. Part 2 przed Part 10, 26-2 przed 26-10).
 */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "pl", { numeric: true, sensitivity: "base" });
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
}

export function formatPolishDate(isoDate: string): string {
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function normalizeSubjectForThread(subject: string): string {
  return subject
    .replace(/^(\s*(re|fwd|fw|odp|pd)\s*:\s*)+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Quote & Signature Stripping (wzorzec z Himalaya):
 * usuwa powtarzaną historię cytowań oraz standardowe stopki mobilne/RODO,
 * zmniejszając objętość notatek Markdown i zużycie kontekstu AI o 60–80%.
 */
export function stripQuotesAndSignatures(markdown: string): string {
  const lines = normalizeLineEndings(markdown).split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Standardowy separator podpisu RFC 3676 ("-- ") lub mobilne stopki
    if (
      line === "-- " ||
      trimmed === "--" ||
      /^wysłano z (mojego )?(iphone|ipad|samsung|telefonu|aplikacji)/i.test(trimmed) ||
      /^sent from my (iphone|ipad|android|mobile|outlook)/i.test(trimmed) ||
      /^(wiadomość ta jest poufna|niniejsza wiadomość|this email and any attachments)/i.test(trimmed)
    ) {
      break;
    }

    // Nagłówki cytowanego bloku historii odpowiedzi (Gmail / Outlook / Roundcube)
    if (
      /^W dniu .+ napisał\(a\):$/i.test(trimmed) ||
      /^On .+ wrote:$/i.test(trimmed) ||
      /^-{3,}\s*(Oryginalna wiadomość|Original Message|Forwarded message)\s*-{3,}$/i.test(trimmed) ||
      /^Od:\s+.+@.+$/i.test(trimmed)
    ) {
      break;
    }

    // Pomiń zagnieżdżone cytaty ">"
    if (/^>\s*/.test(trimmed)) {
      continue;
    }

    result.push(line);
  }

  return result.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Sanityzacja HTML do wyświetlenia w <iframe sandbox="allow-same-origin">:
 * - usuwa <script>, <iframe>, <object>, <embed>, <form>, zewnętrzne <link>
 * - usuwa inline event handlery (onclick, onerror, onload) i javascript: URI
 * - opcjonalnie blokuje zdalne obrazy (ochrona przed pikselami śledzącymi)
 */
export function sanitizeHtmlForSandbox(
  rawHtml: string,
  blockRemoteImages: boolean
): { html: string; blockedRemoteImagesCount: number } {
  let html = rawHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[^>]*>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*["']\s*javascript:[^"']*["']/gi, 'href="#"');

  let blockedRemoteImagesCount = 0;

  if (blockRemoteImages) {
    html = html.replace(
      /<img([^>]*?)\ssrc\s*=\s*(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
      (_match, pre: string, _q: string, _url: string, post: string) => {
        blockedRemoteImagesCount++;
        return `<span data-blocked-img="true" style="display:inline-block;padding:2px 6px;border:1px dashed #888;font-size:11px;color:#555;"${pre}${post}>[Zablokowany obraz zdalny]</span>`;
      }
    );
  }

  const wrapped = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${blockRemoteImages ? "data: cid:" : "https: http: data: cid:"}; style-src 'unsafe-inline';" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.55; color: #1f2328; margin: 12px; word-wrap: break-word; }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { border: 1px solid #d0d7de; padding: 4px 8px; }
  img { max-width: 100%; height: auto; }
  a { color: #5b21b6; }
</style>
</head>
<body>${html}</body>
</html>`;

  return { html: wrapped, blockedRemoteImagesCount };
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
    /(proszę|prośba|trzeba|należy|odesłać|potwierdzić|zweryfikować|przesłanie|dostarcz|przygotować|uzupełnić)/i;
  const dateRegex = /\b(20\d{2}-\d{2}-\d{2})\b/;
  const tasks: string[] = [];

  for (const line of lines) {
    if (actionTrigger.test(line) && line.length >= 16) {
      const clean = line.replace(/^(\d+[.)]\s*|[-*•]\s*)/, "").trim();
      const dateMatch = clean.match(dateRegex);
      const dueSuffix = dateMatch ? ` 📅 ${dateMatch[1]}` : "";
      const urgent = /(piln|asap|natychmiast|dzisiaj|awari|blokad)/i.test(clean);
      const prioIcon =
        urgent || defaultPriority === "high"
          ? " ⏫"
          : defaultPriority === "medium"
          ? " 🔼"
          : " 🔽";
      tasks.push(`- [ ] ${clean}${dueSuffix}${prioIcon}`);
    }
  }

  return tasks;
}
