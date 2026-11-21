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
export function sanitizeEmailHtml(
  rawHtml: string,
  options: {
    blockRemoteImages: boolean;
    darkMode?: boolean;
    domSanitizer?: ExternalDomSanitizer;
  }
): SanitizedEmailHtmlResult {
  const { blockRemoteImages, darkMode = false, domSanitizer } = options;
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
  // Oddzielna obsługa podwójnych cudzysłowów, pojedynczych cudzysłowów oraz wartości bez cudzysłowów (odporne na zagnieżdżone cudzysłowy)
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

    // Zablokuj zdalne obrazy <img src="http..."> oraz srcset="http..." bez kopiowania surowych atrybutów!
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
        return `<span data-tl-blocked-img="true" style="display:inline-block;padding:2px 6px;border:1px dashed #888;border-radius:3px;font-size:11px;color:#777;">[Zablokowany obraz zdalny]</span>`;
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

  // Wymuś bezpieczne linki (target="_blank" + rel="noopener noreferrer")
  html = html.replace(/<a\b([^>]*)>/gi, (_m, attrs: string) => {
    const cleaned = attrs
      .replace(/\starget\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
      .replace(/\srel\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    return `<a${cleaned} target="_blank" rel="noopener noreferrer">`;
  });

  // Ścisła polityka CSP: brak skryptów, obiektów, formularzy, base-uri; domyślnie img-src 'none' (lub bezpieczne cid:/raster data tylko jeśli występują)
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

  const bgColor = darkMode ? "#181A20" : "#ffffff";
  const textColor = darkMode ? "#E6E8EF" : "#1f2328";
  const borderColor = darkMode ? "#2B2E3B" : "#d0d7de";
  const linkColor = darkMode ? "#a78bfa" : "#5b21b6";

  const wrapped = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${cspHeader}" />
<style>
  body { font-family: system-ui, -apple-system, sans-serif; font-size: 14px; line-height: 1.55; color: ${textColor}; background: ${bgColor}; margin: 12px; word-wrap: break-word; }
  table { border-collapse: collapse; max-width: 100%; }
  td, th { border: 1px solid ${borderColor}; padding: 4px 8px; }
  img { max-width: 100%; height: auto; }
  a { color: ${linkColor}; }
</style>
</head>
<body>${html}</body>
</html>`;

  return {
    html: wrapped,
    bodyHtml: html,
    blockedRemoteImagesCount,
    cspHeader,
  };
}
