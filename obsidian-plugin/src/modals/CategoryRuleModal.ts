import { App, Modal, Notice, Setting } from "obsidian";
import { AiCategoryConfig } from "../types";

/**
 * Dedykowany pływający modal do tworzenia i edycji reguły kategorii AI.
 * Zgodnie z AGENTS.md zastępuje edycję inline w wierszach tabeli ustawień.
 */
export class CategoryRuleModal extends Modal {
  private initialRule: AiCategoryConfig | null;
  private onSave: (rule: AiCategoryConfig) => void;

  private label: string;
  private imapFolder: string;
  private vaultTopic: string;
  private keywordsText: string;

  constructor(
    app: App,
    initialRule: AiCategoryConfig | null,
    onSave: (rule: AiCategoryConfig) => void
  ) {
    super(app);
    this.initialRule = initialRule;
    this.onSave = onSave;

    this.label = initialRule?.label || "";
    this.imapFolder = initialRule?.imapFolder || "INBOX/";
    this.vaultTopic = initialRule?.vaultTopic || "Korespondencja";
    this.keywordsText = initialRule?.keywords.join(", ") || "";
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", {
      text: this.initialRule ? "Edytuj kategorię AI" : "Nowa kategoria AI",
    });

    new Setting(contentEl)
      .setName("Nazwa kategorii")
      .setDesc("Np. Zlecenie, Pytanie, Raport, Oferta")
      .addText((t) =>
        t.setValue(this.label).onChange((v) => (this.label = v.trim()))
      );

    new Setting(contentEl)
      .setName("Docelowy folder IMAP")
      .setDesc("Folder, do którego wiadomość zostanie przeniesiona / zasugerowana")
      .addText((t) =>
        t.setValue(this.imapFolder).onChange((v) => (this.imapFolder = v.trim()))
      );

    new Setting(contentEl)
      .setName("Temat w Vaulcie (electrical_topic)")
      .setDesc("Np. Korespondencja, Zamówienia, Pomiary, Spotkanie")
      .addText((t) =>
        t.setValue(this.vaultTopic).onChange((v) => (this.vaultTopic = v.trim()))
      );

    new Setting(contentEl)
      .setName("Słowa kluczowe (oddzielone przecinkami)")
      .addTextArea((ta) => {
        ta.setValue(this.keywordsText);
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = "100%";
        ta.onChange((v) => (this.keywordsText = v));
      });

    const footer = contentEl.createDiv({ cls: "trinitec-mail-modal-footer" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", { text: "Zapisz kategorię", cls: "mod-cta" });
    saveBtn.onclick = () => {
      if (!this.label) {
        new Notice("Podaj nazwę kategorii.");
        return;
      }
      const keywords = this.keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      this.onSave({
        id: this.initialRule?.id || `cat-${Date.now()}`,
        label: this.label,
        imapFolder: this.imapFolder || "INBOX",
        vaultTopic: this.vaultTopic || "Korespondencja",
        keywords,
      });
      this.close();
    };
  }
}
