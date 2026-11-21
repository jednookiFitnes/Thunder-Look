import { App, Modal, Setting } from "obsidian";
import { validateImapFolderName } from "../../../shared/folderMapper";

export class ConfirmModal extends Modal {
  private titleText: string;
  private messageText: string;
  private confirmLabel: string;
  private danger: boolean;
  private onConfirm: () => void | Promise<void>;

  constructor(
    app: App,
    options: {
      title: string;
      message: string;
      confirmLabel?: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    }
  ) {
    super(app);
    this.titleText = options.title;
    this.messageText = options.message;
    this.confirmLabel = options.confirmLabel ?? "Potwierdź";
    this.danger = options.danger ?? false;
    this.onConfirm = options.onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tl-confirm-modal");

    contentEl.createEl("h3", { text: this.titleText });
    contentEl.createEl("p", { text: this.messageText, cls: "tl-confirm-message" });

    const btnRow = contentEl.createDiv({ cls: "tl-modal-footer-row" });
    const cancelBtn = btnRow.createEl("button", { text: "Anuluj" });
    cancelBtn.addEventListener("click", () => this.close());

    const confirmBtn = btnRow.createEl("button", {
      text: this.confirmLabel,
      cls: this.danger ? "mod-warning" : "mod-cta",
    });
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      try {
        await this.onConfirm();
        this.close();
      } finally {
        confirmBtn.disabled = false;
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class FolderNamePromptModal extends Modal {
  private titleText: string;
  private descriptionText: string;
  private initialValue: string;
  private confirmLabel: string;
  private onSubmit: (value: string) => void | Promise<void>;

  constructor(
    app: App,
    options: {
      title: string;
      description?: string;
      initialValue?: string;
      confirmLabel?: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  ) {
    super(app);
    this.titleText = options.title;
    this.descriptionText = options.description ?? "";
    this.initialValue = options.initialValue ?? "";
    this.confirmLabel = options.confirmLabel ?? "Zapisz";
    this.onSubmit = options.onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tl-confirm-modal");

    contentEl.createEl("h3", { text: this.titleText });
    if (this.descriptionText) {
      contentEl.createEl("p", { text: this.descriptionText, cls: "tl-muted-sm" });
    }

    let currentVal = this.initialValue;
    const errorEl = contentEl.createDiv({ cls: "tl-inline-error" });

    let inputEl: HTMLInputElement | null = null;
    new Setting(contentEl).setName("Nazwa / ścieżka folderu").addText((t) => {
      inputEl = t.inputEl;
      t.setValue(this.initialValue)
        .setPlaceholder("np. INBOX/Projekty/Nowy")
        .onChange((val) => {
          currentVal = val;
          errorEl.setText("");
        });
      t.inputEl.addClass("tl-input-wide");
    });

    const btnRow = contentEl.createDiv({ cls: "tl-modal-footer-row" });
    const cancelBtn = btnRow.createEl("button", { text: "Anuluj" });
    cancelBtn.addEventListener("click", () => this.close());

    const submitBtn = btnRow.createEl("button", {
      text: this.confirmLabel,
      cls: "mod-cta",
    });

    const handleSubmit = async () => {
      const err = validateImapFolderName(currentVal);
      if (err) {
        errorEl.setText(err);
        return;
      }
      submitBtn.disabled = true;
      try {
        await this.onSubmit(currentVal.trim());
        this.close();
      } catch (e) {
        errorEl.setText(e instanceof Error ? e.message : String(e));
      } finally {
        submitBtn.disabled = false;
      }
    };

    submitBtn.addEventListener("click", () => void handleSubmit());
    const boundInput = inputEl as HTMLInputElement | null;
    if (boundInput) {
      boundInput.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void handleSubmit();
        }
      });
      setTimeout(() => boundInput.focus(), 20);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
