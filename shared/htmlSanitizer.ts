export interface SanitizedEmailHtmlResult {
  html: string;
  bodyHtml: string;
  blockedRemoteImagesCount: number;
  cspHeader: string;
}

export type ExternalDomSanitizer = (dirtyHtml: string) => string;

const FORBIDDEN_CONTAINER_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "applet",
  "form",
  "svg",
  "math",
  "template",
  "noscript",
  "style",
];

const FORBIDDEN_VOID_TAGS = ["base", "meta", "link", "input", "button", "textarea", "select"];

/**
 * Wielowarstwowy sanitizer HTML dla podglądu e-maili (działa w Node oraz w przeglądarce/Electron):
 * 1. Opcjonalnie uruchamia DOMPurify (w Obsidian/przeglądarce).
 * 2. Zawsze wykonuje rygorystyczne czyszczenie niebezpiecznych tagów, event handlerów on*,
 *    schematów javascript:/vbscript:/data:text/html/data:image/svg+xml oraz CSS url(...).
 * 3. Domyślnie blokuje zdalne obrazki i piksele śledzące (src, srcset, background, CSS url)
 *    oraz generuje restrykcyjną politykę Content-Security-Policy bez wykonywania skryptów.
 */
export type EmailHtmlThemeMode = "original-light" | "force-dark";

export function sanitizeEmailHtml(
  rawHtml: string,
  options: {
    blockRemoteImages: boolean;
    darkMode?: boolean;
    themeMode?: EmailHtmlThemeMode;
    domSanitizer?: ExternalDomSanitizer;
  }
): SanitizedEmailHtmlResult {
  const { blockRemoteImages, darkMode = false, themeMode, domSanitizer } = options;
  const effectiveDark = themeMode ? themeMode === "force-dark" : darkMode;
  let html = String(rawHtml || "").replace(/\0/g, "");

  // Warstwa 1: DOMPurify jeśli dostępny (Obsidian Electron / przeglądarka)
  if (domSanitizer) {
    html = domSanitizer(html);
  }

  // Warstwa 2: Iteracyjne usuwanie niebezpiecznych tagów (odporne na zagnieżdżenia typu <scr<script>ipt>)
  let prev = "";
  let iterations = 0;
  while (html !== prev && iterations < 6) {
    prev = html;
    iterations++;
    for (const tag of FORBIDDEN_CONTAINER_TAGS) {
      const pairRx = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
      const openRx = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
      const closeRx = new RegExp(`<\\/${tag}\\s*>`, "gi");
      html = html.replace(pairRx, "").replace(openRx, "").replace(closeRx, "");
    }
    for (const tag of FORBIDDEN_VOID_TAGS) {
      const rx = new RegExp(`<\\/?${tag}\\b[^>]*\\/?>`, "gi");
      html = html.replace(rx, "");
    }
  }

  // Usuń komentarze HTML (często używane do obchodzenia filtrów)
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  // Usuń wszelkie atrybuty on* oraz srcdoc/formaction
  html = html.replace(
    /\s(?:on[a-z0-9_-]+|srcdoc|formaction|xlink:href)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    ""
  );

  // Neutralizuj niebezpieczne schematy URI (javascript:, vbscript:, file:, data:text/html, data:image/svg+xml)
  const dangerousScheme = "(?:javascript|vbscript|file|data\\s*:\\s*(?:text\\/html|application\\/|image\\/svg\\+xml))";
  html = html
    .replace(
      new RegExp(`\\b(href|src|action|poster|background)\\s*=\\s*"\\s*${dangerousScheme}[^"]*"`, "gi"),
      '$1="#"'
    )
    .replace(
      new RegExp(`\\b(href|src|action|poster|background)\\s*=\\s*'\\s*${dangerousScheme}[^']*'`, "gi"),
      "$1='#'"
    )
    .replace(
      new RegExp(`\\b(href|src|action|poster|background)\\s*=\\s*${dangerousScheme}[^\\s>]*`, "gi"),
      '$1="#"'
    );

  // Usuń CSS expression(), @import oraz url(...) ze stylów inline
  let blockedRemoteImagesCount = 0;
  html = html.replace(/\bstyle\s*=\s*(["'])([\s\S]*?)\1/gi, (_m, q: string, cssVal: string) => {
    let cleanCss = cssVal
      .replace(/expression\s*\([^)]*\)/gi, "")
      .replace(/@import[^;]+;?/gi, "")
      .replace(/behavior\s*:[^;]+;?/gi, "");

    if (blockRemoteImages) {
      cleanCss = cleanCss.replace(/url\s*\(\s*(['"]?)\s*https?:\/\/[^)]+\)/gi, () => {
        blockedRemoteImagesCount++;
        return "none";
      });
    }
    return `style=${q}${cleanCss}${q}`;
  });

  // Usuń atrybut background="http..." na tabelach/komórkach (częsty tracking pixel w newsletterach)
  if (blockRemoteImages) {
    html = html.replace(
      /\sbackground\s*=\s*(["'])\s*https?:\/\/[^"']+\1/gi,
      () => {
        blockedRemoteImagesCount++;
        return "";
      }
    );

    // Zablokuj zdalne obrazy <img src="http..."> oraz srcset="http..."
    html = html.replace(/<img\b([^>]*)>/gi, (fullTag, attrs: string) => {
      const hasRemoteSrc = /\bsrc\s*=\s*(?:"\s*https?:\/\/[^"]*"|'\s*https?:\/\/[^']*'|https?:\/\/[^\s>]+)/i.test(
        attrs
      );
      const hasRemoteSrcset = /\bsrcset\s*=\s*(?:"[^"]*https?:\/\/[^"]*"|'[^']*https?:\/\/[^']*')/i.test(
        attrs
      );
      const hasUnsafeData = /\bsrc\s*=\s*(?:"\s*data:(?!image\/(?:png|jpeg|jpg|gif|webp);base64,)[^"]*"|'\s*data:(?!image\/(?:png|jpeg|jpg|gif|webp);base64,)[^']*')/i.test(
        attrs
      );

      if (hasRemoteSrc || hasRemoteSrcset || hasUnsafeData) {
        blockedRemoteImagesCount++;
        return `<span data-tl-blocked-img="true" style="display:inline-block;padding:2px 6px;border:1px dashed #9ca3af;border-radius:4px;font-size:11px;color:#6b7280;">[Zablokowany obraz zdalny]</span>`;
      }
      return fullTag;
    });

    // Zablokuj <source srcset="http..."> w <picture>
    html = html.replace(/<source\b[^>]*>/gi, (tag) => {
      if (/https?:\/\//i.test(tag)) {
        blockedRemoteImagesCount++;
        return "";
      }
      return tag;
    });
  }

  // Wymuś bezpieczne linki (target="_blank" + rel="noopener noreferrer" + anty-phishingowy tooltip title z pełnym URL)
  html = html.replace(/<a\b([^>]*)>/gi, (_m, attrs: string) => {
    const cleaned = attrs
      .replace(/\starget\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\srel\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    const hasTitle = /\stitle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i.test(cleaned);
    const hrefMatch = cleaned.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    let titleAttr = "";
    if (!hasTitle && rawHref && rawHref !== "#") {
      const escapedHref = rawHref
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      titleAttr = ` title="${escapedHref}"`;
    }
    return `<a${cleaned}${titleAttr} target="_blank" rel="noopener noreferrer">`;
  });

  const hasSafeInlineDataImg =
    /<img\b[^>]*src\s*=\s*["']data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(html);
  const hasCidImg = /<img\b[^>]*src\s*=\s*["']cid:/i.test(html);

  let imgSrcPolicy: string;
  if (!blockRemoteImages) {
    imgSrcPolicy = "https: http: cid: data:";
  } else {
    const allowed: string[] = [];
    if (hasCidImg) allowed.push("cid:");
    if (hasSafeInlineDataImg) allowed.push("data:");
    imgSrcPolicy = allowed.length > 0 ? allowed.join(" ") : "'none'";
  }

  const cspHeader = `default-src 'none'; script-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; img-src ${imgSrcPolicy}; style-src 'unsafe-inline';`;

  const outerBg = effectiveDark ? "#13151a" : "#f3f4f6";
  const cardBg = effectiveDark ? "#1b1e26" : "#ffffff";
  const textColor = effectiveDark ? "#e5e7eb" : "#1f2328";
  const linkColor = effectiveDark ? "#a78bfa" : "#4f46e5";
  const cardShadow = effectiveDark
    ? "0 4px 20px rgba(0, 0, 0, 0.35)"
    : "0 2px 12px rgba(15, 23, 42, 0.08)";

  const darkOverrides = effectiveDark
    ? `
  .tl-mail-card, .tl-mail-card * {
    color: ${textColor} !important;
    border-color: rgba(255, 255, 255, 0.12) !important;
  }
  .tl-mail-card [style*="background"],
  .tl-mail-card table,
  .tl-mail-card td,
  .tl-mail-card th,
  .tl-mail-card div {
    background-color: transparent !important;
  }
  .tl-mail-card a { color: ${linkColor} !important; }
  `
    : "";

  const wrapped = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${cspHeader}" />
<style>
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    color-scheme: ${effectiveDark ? "dark" : "light"};
    background: ${outerBg};
    color: ${textColor};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
    font-size: 14px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  body {
    padding: 16px;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .tl-mail-card {
    max-width: 920px;
    width: 100%;
    margin: 0 auto;
    background: ${cardBg};
    border-radius: 10px;
    padding: 20px 24px;
    box-shadow: ${cardShadow};
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    border: 0;
    max-width: 100%;
  }
  td, th {
    border: 0;
    vertical-align: top;
  }
  img {
    max-width: 100%;
    height: auto;
  }
  a {
    color: ${linkColor};
  }
  blockquote {
    margin: 8px 0;
    padding-left: 12px;
    border-left: 3px solid ${effectiveDark ? "#4b5563" : "#d1d5db"};
    color: ${effectiveDark ? "#9ca3af" : "#4b5563"};
  }
  pre, code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    white-space: pre-wrap;
  }
  ${darkOverrides}
</style>
</head>
<body><div class="tl-mail-card">${html}</div></body>
</html>`;

  return {
    html: wrapped,
    bodyHtml: html,
    blockedRemoteImagesCount,
    cspHeader,
  };
}
