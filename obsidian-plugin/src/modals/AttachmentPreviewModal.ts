import { App, Modal, Notice } from "obsidian";
import { formatBytes } from "../utils/textUtils";

export interface AttachmentPreviewOptions {
  filename: string;
  contentType: string;
  content: Buffer;
  onSaveToVault?: () => Promise<void>;
  onDownloadToDisk?: () => void;
}

/**
 * Podgląd załączników bezpośrednio w Obsidianie:
 * - Obrazy (PNG/JPG/JPEG/WebP/GIF) jako wyśrodkowany podgląd <img>.
 * - Pliki PDF jako wbudowany podgląd <iframe src="blob:..."> z natywnym viewerem Electron/Chromium.
 * - Automatyczne zwalnianie URL.revokeObjectURL przy zamknięciu okna.
 */
export class AttachmentPreviewModal extends Modal {
  private options: AttachmentPreviewOptions;
  private objectUrl: string | null = null;

  constructor(app: App, options: AttachmentPreviewOptions) {
    super(app);
    this.options = options;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tl-attachment-preview-modal");

    const header = contentEl.createDiv({ cls: "tl-modal-header-row" });
    const titleWrap = header.createDiv();
    titleWrap.createEl("h3", { text: this.options.filename, cls: "tl-modal-title" });
    titleWrap.createDiv({
      cls: "tl-muted-sm",
      text: `${this.options.contentType} • ${formatBytes(this.options.content.byteLength)}`,
    });

    const actions = header.createDiv({ cls: "tl-btn-row" });
    if (this.options.onSaveToVault) {
      const saveBtn = actions.createEl("button", {
        text: "Zapisz w Vaulcie",
        cls: "mod-cta",
      });
      saveBtn.addEventListener("click", async () => {
        try {
          await this.options.onSaveToVault?.();
        } catch (err) {
          new Notice(`Błąd zapisu: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }
    if (this.options.onDownloadToDisk) {
      const dlBtn = actions.createEl("button", { text: "Pobierz na dysk" });
      dlBtn.addEventListener("click", () => this.options.onDownloadToDisk?.());
    }

    const previewBox = contentEl.createDiv({ cls: "tl-attachment-preview-stage" });
    const mime = (this.options.contentType || "").toLowerCase();
    const ext = this.options.filename.split(".").pop()?.toLowerCase() || "";
    const bytes = new Uint8Array(this.options.content);

    const isImage =
      mime.startsWith("image/") ||
      ["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext);
    const isPdf = mime === "application/pdf" || ext === "pdf";
    const isText =
      mime.startsWith("text/") ||
      ["txt", "md", "csv", "json", "xml", "log"].includes(ext);

    if (isImage) {
      const blob = new Blob([bytes], { type: mime.startsWith("image/") ? mime : `image/${ext === "jpg" ? "jpeg" : ext}` });
      this.objectUrl = URL.createObjectURL(blob);
      const img = previewBox.createEl("img", {
        cls: "tl-attachment-preview-img",
        attr: { src: this.objectUrl, alt: this.options.filename },
      });
      img.loading = "eager";
    } else if (isPdf) {
      const blob = new Blob([bytes], { type: "application/pdf" });
      this.objectUrl = URL.createObjectURL(blob);
      previewBox.createEl("iframe", {
        cls: "tl-attachment-preview-pdf",
        attr: {
          src: this.objectUrl,
          title: this.options.filename,
        },
      });
    } else if (isText) {
      const pre = previewBox.createEl("pre", { cls: "tl-attachment-preview-text" });
      pre.setText(this.options.content.toString("utf8").slice(0, 60_000));
    } else {
      previewBox.createDiv({
        cls: "tl-empty-state",
        text: "Podgląd w oknie dostępny jest dla obrazów, plików PDF i tekstowych. Użyj przycisków powyżej, aby zapisać załącznik w Vaulcie lub pobrać go na dysk.",
      });
    }
  }

  onClose(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.contentEl.empty();
  }
}
