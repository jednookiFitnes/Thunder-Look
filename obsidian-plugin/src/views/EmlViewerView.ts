import { FileView, TFile, WorkspaceLeaf } from "obsidian";
import { ParsedEmailMessage } from "../types";
import { parseRawEmlBuffer } from "../services/mailParserService";
import { formatBytes, sanitizeHtmlForSandbox } from "../utils/textUtils";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import type TrinitecMailPlugin from "../main";

export const VIEW_TYPE_TRINITEC_EML = "trinitec-mail-eml-viewer";

/**
 * Wbudowany podgląd plików .eml w Vaulcie (wzorzec z obsidian-eml-email-viewer):
 * umożliwia czytanie zarchiwizowanych plików dowodowych .eml z blokadą pikseli śledzących.
 */
export class EmlViewerView extends FileView {
  private plugin: TrinitecMailPlugin;
  private parsed: ParsedEmailMessage | null = null;
  private mode: "html" | "markdown" = "html";
  private allowRemoteImages = false;

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TRINITEC_EML;
  }

  getDisplayText(): string {
    return this.file ? this.file.basename : "Podgląd EML";
  }

  canAcceptExtension(extension: string): boolean {
    return extension.toLowerCase() === "eml";
  }

  async onLoadFile(file: TFile): Promise<void> {
    const bin = await this.app.vault.readBinary(file);
    this.parsed = await parseRawEmlBuffer(Buffer.from(bin));
    this.mode = this.parsed.htmlBody ? "html" : "markdown";
    this.allowRemoteImages = false;
    this.render();
  }

  async onClose(): Promise<void> {
    this.parsed = null;
    this.contentEl.empty();
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    const root = container.createDiv({ cls: "trinitec-mail-reader" });

    if (!this.parsed) {
      root.createDiv({ cls: "trinitec-mail-status-text", text: "Wczytywanie pliku .eml..." });
      return;
    }

    const email = this.parsed;
    const head = root.createDiv({ cls: "trinitec-mail-reader-head" });
    head.createEl("h3", { cls: "trinitec-mail-reader-title", text: email.subject });
    head.createDiv({
      cls: "trinitec-mail-status-text",
      text: `Od: ${email.fromRaw} · Do: ${email.toRaw} · ${email.date} · ${formatBytes(email.sizeBytes)}`,
    });

    const actions = head.createDiv({ cls: "trinitec-mail-actions-row" });
    const saveNoteBtn = actions.createEl("button", {
      text: "Zapisz jako notatkę projektu (Opt-in)",
      cls: "mod-cta",
    });
    saveNoteBtn.onclick = () => {
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
    };

    const toggleBtn = actions.createEl("button", {
      text: this.mode === "html" ? "Pokaż Markdown" : "Pokaż HTML Sandbox",
    });
    toggleBtn.onclick = () => {
      this.mode = this.mode === "html" ? "markdown" : "html";
      this.render();
    };

    if (this.mode === "html" && email.htmlBody) {
      const blockRemote =
        this.plugin.settings.blockRemoteImagesByDefault && !this.allowRemoteImages;
      const sanitized = sanitizeHtmlForSandbox(email.htmlBody, blockRemote);
      if (sanitized.blockedRemoteImagesCount > 0) {
        const warn = root.createDiv({ cls: "trinitec-mail-banner-warn" });
        warn.createSpan({
          text: `Zablokowano ${sanitized.blockedRemoteImagesCount} zdalnych obrazków.`,
        });
        const btn = warn.createEl("button", { text: "Pokaż obrazy" });
        btn.onclick = () => {
          this.allowRemoteImages = true;
          this.render();
        };
      }
      const iframe = root.createEl("iframe", { cls: "trinitec-mail-html-frame" });
      iframe.setAttr("sandbox", "allow-same-origin");
      iframe.srcdoc = sanitized.html;
    } else {
      root.createDiv({
        cls: "trinitec-mail-markdown-preview",
        text: email.markdownBody,
      });
    }
  }
}
