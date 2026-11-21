import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import { ParsedEmailMessage } from "../types";
import { parseRawEmlBuffer } from "../services/mailParserService";
import { sanitizeHtmlForSandbox } from "../utils/htmlSanitizer";
import { formatBytes } from "../utils/textUtils";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import type TrinitecMailPlugin from "../main";

export const VIEW_TYPE_TRINITEC_EML = "trinitec-mail-eml-viewer";

/**
 * Wbudowany bezpieczny podgląd plików .eml w Vaulcie:
 * - DOMPurify + <iframe sandbox=""> (bez allow-scripts i bez allow-same-origin)
 * - Domyślna blokada zdalnych obrazków i pikseli śledzących z przyciskiem ręcznego doładowania
 */
export class EmlViewerView extends FileView {
  private plugin: TrinitecMailPlugin;
  private parsed: ParsedEmailMessage | null = null;
  private mode: "html" | "markdown" = "html";
  private allowRemoteImages = false;
  private isClosed = false;

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TRINITEC_EML;
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : "Podgląd EML (Thunder Look)";
  }

  canAcceptExtension(extension: string): boolean {
    return extension.toLowerCase() === "eml";
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.isClosed = false;
    const bin = await this.app.vault.readBinary(file);
    if (this.isClosed) return;
    this.parsed = await parseRawEmlBuffer(Buffer.from(bin));
    if (this.isClosed) return;
    this.mode = this.parsed.htmlBody ? "html" : "markdown";
    this.allowRemoteImages = false;
    this.render();
  }

  async onClose(): Promise<void> {
    this.isClosed = true;
    this.parsed = null;
    this.contentEl.empty();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    const root = container.createDiv({ cls: "tl-reader" });

    if (!this.parsed) {
      root.createDiv({ cls: "tl-status-text", text: "Wczytywanie pliku .eml..." });
      return;
    }

    const email = this.parsed;
    const head = root.createDiv({ cls: "tl-reader-head" });
    head.createEl("h3", { cls: "tl-reader-title", text: email.subject });
    head.createDiv({
      cls: "tl-status-text",
      text: `Od: ${email.fromRaw} · Do: ${email.toRaw} · ${email.date} · ${formatBytes(email.sizeBytes)}`,
    });

    const actions = head.createDiv({ cls: "tl-actions-row" });
    const saveNoteBtn = actions.createEl("button", {
      text: "Zapisz jako notatkę projektu (Opt-in)",
      type: "button",
      cls: "mod-cta",
    });
    saveNoteBtn.addEventListener("click", () => {
      const proposal = this.plugin.aiBridge.analyzeContent(
        email.subject,
        email.strippedMarkdownBody
      );
      new SaveEmailModal(
        this.app,
        this.plugin.settings,
        this.plugin.projectMatcher,
        this.plugin.vaultWriter,
        this.plugin.mruStore,
        email,
        "",
        proposal
      ).open();
    });

    const toggleBtn = actions.createEl("button", {
      text: this.mode === "html" ? "Pokaż Markdown" : "Pokaż HTML Sandbox",
      type: "button",
    });
    toggleBtn.addEventListener("click", () => {
      this.mode = this.mode === "html" ? "markdown" : "html";
      this.render();
    });

    if (this.mode === "html" && email.htmlBody) {
      const blockRemote =
        this.plugin.settings.blockRemoteImagesByDefault && !this.allowRemoteImages;
      const isDark = document.body.classList.contains("theme-dark");
      const sanitized = sanitizeHtmlForSandbox(email.htmlBody, blockRemote, isDark);

      if (sanitized.blockedRemoteImagesCount > 0) {
        const warn = root.createDiv({ cls: "tl-banner-warn" });
        warn.createSpan({
          text: `Zablokowano ${sanitized.blockedRemoteImagesCount} zdalnych obrazków / pikseli śledzących.`,
        });
        const btn = warn.createEl("button", { text: "Doładuj obrazy", type: "button" });
        btn.addEventListener("click", () => {
          this.allowRemoteImages = true;
          this.render();
        });
      }
      const iframe = root.createEl("iframe", { cls: "tl-html-frame" });
      iframe.setAttr("sandbox", "");
      iframe.setAttr("referrerpolicy", "no-referrer");
      iframe.srcdoc = sanitized.html;
    } else {
      root.createDiv({
        cls: "tl-markdown-preview",
        text: email.markdownBody,
      });
    }
  }
}
