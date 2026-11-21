const WINDOWS_RESERVED_NAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

export const DANGEROUS_ATTACHMENT_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".ps1",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".mjs",
  ".cjs",
  ".scr",
  ".msi",
  ".msp",
  ".iso",
  ".img",
  ".com",
  ".pif",
  ".hta",
  ".jar",
  ".reg",
  ".sh",
  ".lnk",
  ".dll",
  ".wsf",
  ".wsh",
]);

/**
 * Centralna sanityzacja nazwy pliku (Windows + Obsidian wikilinki + ochrona przed Path Traversal).
 * Usuwa znaki niedozwolone w Windows oraz znakach specjalnych Obsidiana (/ \ : * ? " < > | # ^ [ ]),
 * kontrolne bajty (\x00-\x1F), sekwencje "..", końcowe kropki/spacje oraz zastrzeżone nazwy Windows.
 */
export function sanitizeFilename(name: string, maxLen = 96): string {
  const withoutControls = String(name || "")
    .replace(/\0/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\.\.+/g, "-")
    .replace(/[\\/:*?"<>|#^[\]]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+/, "")
    .replace(/[.\s]+$/, "")
    .trim();

  let safe = (withoutControls || "Bez-nazwy").slice(0, maxLen).replace(/[.\s]+$/, "").trim();
  if (!safe) safe = "Bez-nazwy";

  const dotIdx = safe.indexOf(".");
  const baseUpper = (dotIdx >= 0 ? safe.slice(0, dotIdx) : safe).toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(baseUpper)) {
    safe = `_${safe}`;
  }

  return safe;
}

/**
 * Waliduje ścieżkę względną wewnątrz sejfu Obsidian:
 * blokuje bajty NULL, segmenty "..", ścieżki absolutne (/ lub C:\) oraz znaki kontrolne.
 */
export function assertSafeRelativeVaultPath(relativePath: string): string {
  const raw = String(relativePath || "");
  if (raw.includes("\0") || /[\x00-\x1F\x7F]/.test(raw)) {
    throw new Error("Niedozwolone znaki kontrolne lub bajt NULL w ścieżce.");
  }

  const normalizedSlashes = raw.replace(/\\/g, "/").trim();
  if (!normalizedSlashes) {
    throw new Error("Ścieżka docelowa w sejfie nie może być pusta.");
  }

  if (normalizedSlashes.startsWith("/") || /^[a-zA-Z]:/.test(normalizedSlashes)) {
    throw new Error(`Niedozwolona ścieżka absolutna poza katalogiem sejfu: ${relativePath}`);
  }

  const segments = normalizedSlashes.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error("Ścieżka docelowa w sejfie nie może być pusta.");
  }

  for (const seg of segments) {
    if (seg === "." || seg === ".." || seg.includes("..")) {
      throw new Error(`Zablokowano próbę wyjścia poza katalog sejfu (Path Traversal): ${relativePath}`);
    }
    if (/[<>:"|?*]/.test(seg)) {
      throw new Error(`Ścieżka zawiera niedozwolony znak systemu plików w segmencie: ${seg}`);
    }
  }

  return segments.join("/");
}

/**
 * Sprawdza, czy rozszerzenie załącznika należy do listy potencjalnie niebezpiecznych plików wykonywalnych/skryptów.
 */
export function isDangerousAttachmentExtension(filename: string): boolean {
  const lower = String(filename || "").trim().toLowerCase();
  const lastDot = lower.lastIndexOf(".");
  if (lastDot <= 0) return false;
  const ext = lower.slice(lastDot);
  if (DANGEROUS_ATTACHMENT_EXTENSIONS.has(ext)) return true;

  // Wykryj podwójne rozszerzenia typu faktura.pdf.exe lub dokument.docx.js
  const parts = lower.split(".");
  if (parts.length >= 3) {
    const finalExt = `.${parts[parts.length - 1]}`;
    if (DANGEROUS_ATTACHMENT_EXTENSIONS.has(finalExt)) return true;
  }
  return false;
}

/**
 * Rozpoznaje tymczasowe pliki blokad synchronizacji chmurowej (OneDrive / Google Drive / MS Office).
 */
export function isCloudLockFile(filenameOrPath: string): boolean {
  const base = String(filenameOrPath || "").split(/[\\/]/).pop() || "";
  if (!base) return false;
  const lower = base.toLowerCase();
  return (
    base.startsWith("~$") ||
    base.startsWith(".~") ||
    lower.endsWith(".tmp") ||
    lower.endsWith(".temp") ||
    lower.endsWith(".part") ||
    lower.endsWith(".crdownload") ||
    lower.endsWith(".lock") ||
    lower === ".ds_store" ||
    lower === "desktop.ini" ||
    lower === "thumbs.db"
  );
}
