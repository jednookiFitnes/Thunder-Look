import { FileView, Notice, TFile, WorkspaceLeaf, setIcon } from "obsidian";
import { ParsedEmailMessage, ReaderViewTheme } from "../types";
import { parseRawEmlBuffer } from "../services/mailParserService";
import { sanitizeHtmlForSandbox } from "../utils/htmlSanitizer";
import { formatBytes } from "../utils/textUtils";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import { AttachmentPreviewModal } from "../modals/AttachmentPreviewModal";
import type TrinitecMailPlugin from "../main";

export const VIEW_TYPE_TRINITEC_EML = "trinitec-mail-eml-viewer";

/**
 * Wbudowany bezpieczny podgląd plików .eml w Vaulcie:
 * - DOMPurify + <iframe sandbox=""> (bez allow-scripts i bez allow-same-origin) + czysty reset tabel
 * - 3-stanowy przełącznik: Oryginalny (jasny) / Tryb ciemny / Markdown
 * - Podgląd i zapis załączników z pliku .eml
 */
export class EmlViewerView extends FileView {
  private plugin: TrinitecMailPlugin;
  private parsed: ParsedEmailMessage | null = null;
  private themeMode: ReaderViewTheme = "original-light";
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
    this.themeMode = this.parsed.htmlBody
      ? this.plugin.settings.readerThemeMode || "original-light"
      : "markdown";
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
    const root = container.createDiv({ cls: "tl-reader-shell" });

    if (!this.parsed) {
      root.createDiv({ cls: "tl-empty-state", text: "Wczytywanie pliku .eml..." });
      return;
    }

    const email = this.parsed;

    const toolbar = root.createDiv({ cls: "tl-reader-toolbar" });
    const leftBar = toolbar.createDiv({ cls: "tl-toolbar-group" });

    const saveNoteBtn = leftBar.createEl("button", {
      type: "button",
      cls: "tl-tool-btn mod-cta",
    });
    setIcon(saveNoteBtn.createSpan({ cls: "tl-tool-icon" }), "bookmark-plus");
    saveNoteBtn.createSpan({ text: "Zapisz jako notatkę projektu (Opt-in)" });
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

    const rightBar = toolbar.createDiv({ cls: "tl-toolbar-group" });
    const segmented = rightBar.createDiv({ cls: "tl-segmented" });
    const addSeg = (mode: ReaderViewTheme, label: string, icon: string) => {
      const b = segmented.createEl("button", {
        type: "button",
        cls: `tl-seg-btn${this.themeMode === mode ? " is-active" : ""}`,
      });
      setIcon(b.createSpan({ cls: "tl-seg-icon" }), icon);
      b.createSpan({ text: label });
      b.addEventListener("click", () => {
        this.themeMode = mode;
        this.render();
      });
    };
    addSeg("original-light", "Jasny", "sun");
    addSeg("force-dark", "Ciemny", "moon");
    addSeg("markdown", "Markdown", "file-text");

    const scroll = root.createDiv({ cls: "tl-reader-scroll" });
    const inner = scroll.createDiv({ cls: "tl-reader-inner" });

    const head = inner.createDiv({ cls: "tl-reader-header-card" });
    head.createEl("h2", { cls: "tl-reader-subject", text: email.subject });
    head.createDiv({
      cls: "tl-muted-sm",
      text: `Od: ${email.fromRaw} · Do: ${email.toRaw} · ${email.date} · ${formatBytes(email.sizeBytes)}`,
    });

    if (email.attachments.length > 0) {
      const attBar = inner.createDiv({ cls: "tl-attachments-bar" });
      attBar.createDiv({
        cls: "tl-attachments-title",
        text: `Załączniki (${email.attachments.length})`,
      });
      const chips = attBar.createDiv({ cls: "tl-attachments-chips" });
      for (const att of email.attachments) {
        const chip = chips.createDiv({ cls: "tl-att-chip" });
        const info = chip.createDiv({ cls: "tl-att-chip-info" });
        info.createDiv({ cls: "tl-att-chip-name", text: att.filename });
        info.createDiv({ cls: "tl-att-chip-meta", text: formatBytes(att.size) });
        const acts = chip.createDiv({ cls: "tl-att-chip-actions" });
        const prevBtn = acts.createEl("button", {
          type: "button",
          cls: "tl-icon-btn-xs",
          attr: { title: "Podgląd" },
        });
        setIcon(prevBtn, "eye");
        prevBtn.addEventListener("click", () => {
          new AttachmentPreviewModal(this.app, {
            filename: att.filename,
            contentType: att.contentType,
            content: att.content,
            onSaveToVault: async () => {
              const matched = this.plugin.projectMatcher.matchEmailToVault(email);
              const stored = await this.plugin.vaultWriter.saveAttachmentOnlyToProject(
                att,
                matched.project
              );
              new Notice(`Zapisano załącznik: ${stored}`);
            },
          }).open();
        });
      }
    }

    if (this.themeMode !== "markdown" && email.htmlBody) {
      const blockRemote =
        this.plugin.settings.blockRemoteImagesByDefault && !this.allowRemoteImages;
      const sanitized = sanitizeHtmlForSandbox(email.htmlBody, blockRemote, this.themeMode);

      if (sanitized.blockedRemoteImagesCount > 0) {
        const warn = inner.createDiv({ cls: "tl-remote-img-banner" });
        warn.createSpan({
          cls: "tl-remote-img-text",
          text: `Zablokowano ${sanitized.blockedRemoteImagesCount} zdalnych obrazków / pikseli śledzących.`,
        });
        const btn = warn.createEl("button", {
          text: "Pokaż raz",
          type: "button",
          cls: "tl-btn-subtle",
        });
        btn.addEventListener("click", () => {
          this.allowRemoteImages = true;
          this.render();
        });
      }
      const frameWrap = inner.createDiv({
        cls: `tl-html-frame-wrap${
          this.themeMode === "original-light" ? " is-light-surface" : " is-dark-surface"
        }`,
      });
      const iframe = frameWrap.createEl("iframe", { cls: "tl-html-frame" });
      iframe.setAttr("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      iframe.setAttr("referrerpolicy", "no-referrer");
      iframe.srcdoc = sanitized.html;
    } else {
      inner.createDiv({
        cls: "tl-markdown-preview",
        text: email.markdownBody,
      });
    }
  }
}
