import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { processLinesCrlfSafe } from "../utils/textUtils";

/**
 * Modal edycji parametrów bloku kodu ```thunder-look``` / ```trinitec-mail``` — zawsze dostępny
 * nawet w przypadku błędnej składni bloku (AGENTS.md Error Resilience).
 */
export class EditCodeBlockModal extends Modal {
  private file: TFile;
  private lineStart: number;
  private lineEnd: number;
  private content: string;

  constructor(
    app: App,
    file: TFile,
    lineStart: number,
    lineEnd: number,
    initialSource: string
  ) {
    super(app);
    this.file = file;
    this.lineStart = lineStart;
    this.lineEnd = lineEnd;
    this.content = initialSource;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Edytuj blok kodu Thunder Look" });
    contentEl.createDiv({
      cls: "tl-status-text",
      text: "Dozwolone parametry: project (np. 26-125), topic (domyślnie Korespondencja), limit (1-200).",
    });

    new Setting(contentEl).setName("Konfiguracja bloku").addTextArea((ta) => {
      ta.setValue(this.content);
      ta.inputEl.rows = 6;
      ta.inputEl.addClass("tl-full-width", "tl-mono");
      ta.onChange((v) => (this.content = v));
    });

    const footer = contentEl.createDiv({ cls: "tl-modal-footer" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj", type: "button" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = footer.createEl("button", {
      text: "Zapisz blok",
      type: "button",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", async () => {
      try {
        await this.app.vault.process(this.file, (data) =>
          processLinesCrlfSafe(data, (lines) => {
            const innerLines = this.content.replace(/\r\n/g, "\n").split("\n");
            const before = lines.slice(0, this.lineStart + 1);
            const after = lines.slice(this.lineEnd);
            return [...before, ...innerLines, ...after];
          })
        );
        new Notice("Zaktualizowano blok kodu Thunder Look.");
        this.close();
      } catch (err) {
        new Notice(`Nie udało się zapisać bloku: ${(err as Error).message}`);
      }
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
