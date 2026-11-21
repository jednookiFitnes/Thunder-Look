import DOMPurify from "dompurify";
import {
  sanitizeEmailHtml,
  type EmailHtmlThemeMode,
  type SanitizedEmailHtmlResult,
} from "../../../shared/htmlSanitizer";

const DOMPURIFY_CONFIG = {
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "applet",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "base",
    "meta",
    "link",
    "svg",
    "math",
    "template",
    "noscript",
    "style",
  ],
  FORBID_ATTR: [
    "onerror",
    "onload",
    "onclick",
    "onmouseover",
    "onfocus",
    "onblur",
    "onsubmit",
    "srcdoc",
    "formaction",
    "xlink:href",
  ],
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOWED_URI_REGEXP:
    /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpeg|jpg|gif|webp);base64,)/i,
};

/**
 * Sanityzacja treści HTML wiadomości dla podglądu w <iframe sandbox=""> (bez allow-scripts i bez allow-same-origin):
 * Warstwa 1: DOMPurify z blokadą <script>, <iframe>, <object>, <embed>, atrybutów on* i schematów javascript:/data:text/html.
 * Warstwa 2: Wspólny sanitizer + ścisłe CSP + czysty reset tabel (bez wymuszonych obramowań komórek).
 */
export function sanitizeHtmlForSandbox(
  rawHtml: string,
  blockRemoteImages: boolean,
  themeOrDarkMode: boolean | EmailHtmlThemeMode = "original-light"
): SanitizedEmailHtmlResult {
  const domSanitizer = (dirty: string): string => {
    if (typeof window !== "undefined" && typeof DOMPurify?.sanitize === "function") {
      return String(DOMPurify.sanitize(dirty, DOMPURIFY_CONFIG));
    }
    return dirty;
  };

  const themeMode: EmailHtmlThemeMode =
    typeof themeOrDarkMode === "boolean"
      ? themeOrDarkMode
        ? "force-dark"
        : "original-light"
      : themeOrDarkMode;

  return sanitizeEmailHtml(rawHtml, {
    blockRemoteImages,
    themeMode,
    darkMode: themeMode === "force-dark",
    domSanitizer,
  });
}

export function stripHtmlToSafeMarkup(rawHtml: string): string {
  const res = sanitizeHtmlForSandbox(rawHtml, true, "original-light");
  return res.bodyHtml;
}
