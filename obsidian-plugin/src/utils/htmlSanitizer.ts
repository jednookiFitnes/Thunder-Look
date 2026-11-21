import DOMPurify from "dompurify";
import {
  sanitizeEmailHtml,
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
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid):|data:image\/(?:png|jpeg|jpg|gif|webp);base64,)/i,
};

/**
 * Sanityzacja treści HTML wiadomości dla podglądu w <iframe sandbox=""> (bez allow-scripts i bez allow-same-origin):
 * Warstwa 1: DOMPurify z blokadą <script>, <iframe>, <object>, <embed>, atrybutów on* i schematów javascript:/data:text/html.
 * Warstwa 2: Wspólny sanitizer + ścisłe CSP blokujące zdalne obrazki i piksele śledzące domyślnie.
 */
export function sanitizeHtmlForSandbox(
  rawHtml: string,
  blockRemoteImages: boolean,
  darkMode = false
): SanitizedEmailHtmlResult {
  const domSanitizer = (dirty: string): string => {
    if (typeof window !== "undefined" && typeof DOMPurify?.sanitize === "function") {
      return String(DOMPurify.sanitize(dirty, DOMPURIFY_CONFIG));
    }
    return dirty;
  };

  return sanitizeEmailHtml(rawHtml, {
    blockRemoteImages,
    darkMode,
    domSanitizer,
  });
}

export function stripHtmlToSafeMarkup(rawHtml: string): string {
  const res = sanitizeHtmlForSandbox(rawHtml, true, false);
  return res.bodyHtml;
}
