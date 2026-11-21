import { App, Modal, Notice, Setting } from "obsidian";
import { validateSafeRegexPattern } from "../../../shared/networkSecurity";
import { AiCategoryConfig, ImapMessageHeader } from "../types";
import { doesCategoryRuleMatch } from "../services/aiBridgeService";
import { MailCacheService } from "../services/mailCacheService";

/**
 * Dedykowany pływający modal do tworzenia i edycji reguły kategorii AI:
 * - Waliduje opcjonalny wzorzec Regex (ochrona przed ReDoS)
 * - Pokazuje podgląd na żywo, ile zapisanych w cache wiadomości pasuje do reguły
 */
export class CategoryRuleModal extends Modal {
  private initialRule: AiCategoryConfig | null;
  private cacheService: MailCacheService | null;
  private onSave: (rule: AiCategoryConfig) => void;

  private label: string;
  private imapFolder: string;
  private vaultTopic: string;
  private keywordsText: string;
  private regexPattern: string;
  private cachedHeaders: ImapMessageHeader[] = [];
  private previewContainer: HTMLElement | null = null;

  constructor(
    app: App,
    initialRule: AiCategoryConfig | null,
    onSave: (rule: AiCategoryConfig) => void,
    cacheService: MailCacheService | null = null
  ) {
    super(app);
    this.initialRule = initialRule;
    this.cacheService = cacheService;
    this.onSave = onSave;

    this.label = initialRule?.label || "";
    this.imapFolder = initialRule?.imapFolder || "INBOX/";
    this.vaultTopic = initialRule?.vaultTopic || "Korespondencja";
    this.keywordsText = initialRule?.keywords.join(", ") || "";
    this.regexPattern = initialRule?.regexPattern || "";
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
        t.setValue(this.label).onChange((v) => {
          this.label = v.trim();
        })
      );

    new Setting(contentEl)
      .setName("Docelowy folder IMAP")
      .setDesc("Folder, do którego wiadomość zostanie przeniesiona / zasugerowana")
      .addText((t) =>
        t.setValue(this.imapFolder).onChange((v) => {
          this.imapFolder = v.trim();
        })
      );

    new Setting(contentEl)
      .setName("Temat w Vaulcie (electrical_topic)")
      .setDesc("Np. Korespondencja, Zamówienia, Pomiary, Spotkanie")
      .addText((t) =>
        t.setValue(this.vaultTopic).onChange((v) => {
          this.vaultTopic = v.trim();
        })
      );

    new Setting(contentEl)
      .setName("Słowa kluczowe (oddzielone przecinkami)")
      .addTextArea((ta) => {
        ta.setValue(this.keywordsText);
        ta.inputEl.rows = 3;
        ta.inputEl.addClass("tl-full-width");
        ta.onChange((v) => {
          this.keywordsText = v;
          this.updateLivePreview();
        });
      });

    new Setting(contentEl)
      .setName("Opcjonalny wzorzec Regex (chroniony przed ReDoS)")
      .setDesc("Np. \\b(FV|FAKTURA)\\s*\\d+/202\\d\\b — dopasowywany bez rozróżniania wielkości liter.")
      .addText((t) => {
        t.setPlaceholder("\\b(RFQ|OFERTA)\\b")
          .setValue(this.regexPattern)
          .onChange((v) => {
            this.regexPattern = v.trim();
            this.updateLivePreview();
          });
        t.inputEl.addClass("tl-full-width");
      });

    this.previewContainer = contentEl.createDiv({ cls: "tl-info-box" });
    this.updateLivePreview();

    if (this.cacheService) {
      void this.cacheService.getAllCachedHeaders(120).then((headers) => {
        this.cachedHeaders = headers;
        this.updateLivePreview();
      });
    }

    const footer = contentEl.createDiv({ cls: "tl-modal-footer" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj", type: "button" });
    cancelBtn.addEventListener("click", () => this.close());

    const saveBtn = footer.createEl("button", {
      text: "Zapisz kategorię",
      type: "button",
      cls: "mod-cta",
    });
    saveBtn.addEventListener("click", () => {
      if (!this.label) {
        new Notice("Podaj nazwę kategorii.");
        return;
      }
      const regexCheck = validateSafeRegexPattern(this.regexPattern);
      if (!regexCheck.ok) {
        new Notice(regexCheck.error || "Nieprawidłowe wyrażenie regularne.");
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
        regexPattern: this.regexPattern || undefined,
      });
      this.close();
    });
  }

  onClose(): void {
    this.previewContainer = null;
    this.contentEl.empty();
  }

  private updateLivePreview(): void {
    if (!this.previewContainer) return;
    this.previewContainer.empty();

    const regexCheck = validateSafeRegexPattern(this.regexPattern);
    if (!regexCheck.ok) {
      this.previewContainer.createDiv({
        cls: "tl-codeblock-error",
        text: regexCheck.error || "Niepoprawny wzorzec Regex.",
      });
      return;
    }

    const draftRule: AiCategoryConfig = {
      id: "preview",
      label: this.label || "Podgląd",
      imapFolder: this.imapFolder,
      vaultTopic: this.vaultTopic,
      keywords: this.keywordsText
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
      regexPattern: this.regexPattern || undefined,
    };

    if (this.cachedHeaders.length === 0) {
      this.previewContainer.createDiv({
        cls: "tl-status-text",
        text: "Podgląd na żywo: brak wiadomości w lokalnym cache (odśwież skrzynkę IMAP, aby przetestować dopasowania).",
      });
      return;
    }

    const matched = this.cachedHeaders.filter((h) =>
      doesCategoryRuleMatch(draftRule, h.subject, `${h.fromName} ${h.fromEmail}`)
    );

    this.previewContainer.createDiv({
      cls: "tl-diag-step-head",
      text: `Podgląd na żywo: pasuje ${matched.length} z ${this.cachedHeaders.length} wiadomości w cache`,
    });

    for (const sample of matched.slice(0, 3)) {
      this.previewContainer.createDiv({
        cls: "tl-test-result-line",
        text: `• [${sample.date}] ${sample.subject}`,
      });
    }
  }
}
