import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import {
  AiAnalysisProposal,
  ParsedEmailMessage,
  SaveDestinationMode,
  SaveScopeMode,
  TrinitecPluginSettings,
  VaultContactMatch,
  VaultProjectMatch,
} from "../types";
import { ProjectMatcherService } from "../services/projectMatcherService";
import { VaultWriterService } from "../services/vaultWriterService";
import { MruStore } from "../utils/mruStore";
import { extractObsidianTasks, formatBytes } from "../utils/textUtils";

class NoteMruSuggestModal extends FuzzySuggestModal<TFile> {
  private mru: MruStore;
  private onChoose: (file: TFile) => void;

  constructor(app: App, mru: MruStore, onChoose: (file: TFile) => void) {
    super(app);
    this.mru = mru;
    this.onChoose = onChoose;
    this.setPlaceholder("Wyszukaj istniejącą notatkę (sortowanie MRU + naturalne)...");
  }

  getItems(): TFile[] {
    return this.mru.sortByMru(
      "append-notes",
      this.app.vault.getMarkdownFiles(),
      (f) => f.path,
      (f) => f.path
    );
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.mru.recordUse("append-notes", item.path);
    this.onChoose(item);
  }
}

export class SaveEmailModal extends Modal {
  private settings: TrinitecPluginSettings;
  private email: ParsedEmailMessage;
  private matcher: ProjectMatcherService;
  private writer: VaultWriterService;
  private mru: MruStore;
  private aiProposal: AiAnalysisProposal | null;

  private selectedProject: VaultProjectMatch | null;
  private matchedContact: VaultContactMatch | null;
  private duplicateNote: TFile | null;

  private saveScope: SaveScopeMode;
  private selectedExcerpt: string;
  private destinationMode: SaveDestinationMode;
  private appendTargetFile: TFile | null = null;
  private selectedAttachmentNames: Set<string>;
  private tasksText: string;
  private createMissingContact = false;
  private useQuoteStrippedBody: boolean;
  private saveRawEmlCopy: boolean;

  constructor(
    app: App,
    settings: TrinitecPluginSettings,
    matcher: ProjectMatcherService,
    writer: VaultWriterService,
    mru: MruStore,
    email: ParsedEmailMessage,
    initialSelection = "",
    aiProposal: AiAnalysisProposal | null = null
  ) {
    super(app);
    this.settings = settings;
    this.matcher = matcher;
    this.writer = writer;
    this.mru = mru;
    this.email = email;
    this.aiProposal = aiProposal;

    const matched = this.matcher.matchEmailToVault(email);
    this.selectedProject = matched.project;
    this.matchedContact = matched.contact;
    this.duplicateNote = matched.duplicateNote;

    this.selectedExcerpt = initialSelection.trim();
    this.saveScope = this.selectedExcerpt ? "selection" : "full";
    this.destinationMode = settings.defaultSaveMode;
    this.selectedAttachmentNames = new Set(email.attachments.map((a) => a.filename));
    this.useQuoteStrippedBody = settings.stripQuotesAndSignatures;
    this.saveRawEmlCopy = settings.saveRawEmlCopy;

    const baseText = this.selectedExcerpt || email.strippedMarkdownBody || email.markdownBody;
    const tasks =
      aiProposal?.extractedTasks.length
        ? aiProposal.extractedTasks
        : settings.autoDetectTasks
        ? extractObsidianTasks(baseText)
        : [];
    this.tasksText = tasks.join("\n");
  }

  onOpen(): void {
    this.modalEl.addClass("trinitec-mail-modal-spacious");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", { text: "Zapisz korespondencję w Praca Vault (Opt-in)" });
    contentEl.createDiv({
      cls: "trinitec-mail-status-text",
      text: `${this.email.subject} · Od: ${this.email.fromRaw} · ${this.email.date}`,
    });

    const scrollEl = contentEl.createDiv({ cls: "trinitec-mail-modal-scroll" });

    // Ostrzeżenie o duplikacie po nagłówku Message-ID (wykryte przez metadataCache)
    if (this.duplicateNote) {
      const warn = scrollEl.createDiv({ cls: "trinitec-mail-banner-warn" });
      warn.createSpan({
        text: `Uwaga: wiadomość o tym samym Message-ID jest już zapisana w „${this.duplicateNote.path}”.`,
      });
      const openDupBtn = warn.createEl("button", { text: "Otwórz istniejącą" });
      openDupBtn.onclick = async () => {
        if (this.duplicateNote) {
          await this.app.workspace.getLeaf(false).openFile(this.duplicateNote);
          this.close();
        }
      };
    }

    // Projekty posortowane MRU + naturalCompare, z zachowaniem wybranego projektu
    const projects = this.matcher.listActiveProjects(true);
    const selectedPath = this.selectedProject?.folderPath || "";

    new Setting(scrollEl)
      .setName("Projekt docelowy (MRU)")
      .setDesc(
        this.selectedProject
          ? `Dopasowano (${this.selectedProject.matchMethod}): ${this.selectedProject.folderName}`
          : "Brak automatycznego dopasowania — wybierz projekt ręcznie"
      )
      .addDropdown((dd) => {
        dd.addOption("", "-- Bez przypisanego projektu --");
        for (const proj of projects) {
          dd.addOption(proj.folderPath, proj.folderName);
        }
        dd.setValue(projects.some((p) => p.folderPath === selectedPath) ? selectedPath : "");
        dd.onChange((val) => {
          this.selectedProject = projects.find((p) => p.folderPath === val) || null;
        });
      });

    new Setting(scrollEl)
      .setName("Zakres zapisu")
      .setDesc("Możesz zapisać całą wiadomość, tylko zaznaczony fragment albo same załączniki.")
      .addDropdown((dd) => {
        dd.addOption("full", "Cała wiadomość");
        dd.addOption("selection", "Wybrany fragment treści");
        dd.addOption("attachments-only", "Wyłącznie wybrane załączniki");
        dd.setValue(this.saveScope);
        dd.onChange((v) => {
          this.saveScope = v as SaveScopeMode;
          this.render();
        });
      });

    if (this.saveScope === "selection") {
      new Setting(scrollEl).setName("Fragment treści do zapisania").addTextArea((ta) => {
        ta.setValue(this.selectedExcerpt || this.email.strippedMarkdownBody.slice(0, 500));
        ta.inputEl.rows = 6;
        ta.inputEl.style.width = "100%";
        ta.onChange((v) => (this.selectedExcerpt = v));
      });
    }

    if (this.saveScope === "full") {
      const savedChars = Math.max(
        0,
        this.email.markdownBody.length - this.email.strippedMarkdownBody.length
      );
      new Setting(scrollEl)
        .setName("Oczyść cytaty i stopki (Quote & Signature Stripping)")
        .setDesc(
          savedChars > 0
            ? `Usuwa powtarzane cytaty i stopki (oszczędność ok. ${savedChars} znaków).`
            : "Nie wykryto długich cytatów ani stopek do usunięcia."
        )
        .addToggle((t) =>
          t.setValue(this.useQuoteStrippedBody).onChange((v) => (this.useQuoteStrippedBody = v))
        );
    }

    new Setting(scrollEl)
      .setName("Sposób zapisu w Vaulcie")
      .addDropdown((dd) => {
        dd.addOption("new-file", "Nowy osobny plik (Mail - RRRR-MM-DD - Temat.md)");
        dd.addOption("append-note", "Dopisz na końcu wybranej istniejącej notatki");
        dd.setValue(this.destinationMode);
        dd.onChange((v) => {
          this.destinationMode = v as SaveDestinationMode;
          this.render();
        });
      });

    if (this.destinationMode === "append-note") {
      new Setting(scrollEl)
        .setName("Docelowa notatka (MRU)")
        .setDesc(this.appendTargetFile ? this.appendTargetFile.path : "Nie wybrano jeszcze pliku")
        .addButton((btn) =>
          btn.setButtonText("Wybierz notatkę...").onClick(() => {
            new NoteMruSuggestModal(this.app, this.mru, (file) => {
              this.appendTargetFile = file;
              this.render();
            }).open();
          })
        );
    }

    if (this.email.rawEmlBuffer) {
      new Setting(scrollEl)
        .setName("Dołącz źródłowy plik .eml (kopia dowodowa)")
        .setDesc("Zapisuje oryginalny plik MIME .eml w Attachments/ i linkuje go w frontmatterze.")
        .addToggle((t) =>
          t.setValue(this.saveRawEmlCopy).onChange((v) => (this.saveRawEmlCopy = v))
        );
    }

    if (this.email.attachments.length > 0) {
      scrollEl.createEl("h4", { text: "Załączniki do zapisania" });
      for (const att of this.email.attachments) {
        new Setting(scrollEl)
          .setName(att.filename)
          .setDesc(`${formatBytes(att.size)} · ${att.contentType}`)
          .addToggle((t) =>
            t
              .setValue(this.selectedAttachmentNames.has(att.filename))
              .onChange((checked) => {
                if (checked) this.selectedAttachmentNames.add(att.filename);
                else this.selectedAttachmentNames.delete(att.filename);
              })
          );
      }
    }

    if (!this.matchedContact && this.email.fromEmail) {
      new Setting(scrollEl)
        .setName("Utwórz brakujący kontakt w kontakty/ (1-click)")
        .setDesc(`Nadawca ${this.email.fromEmail} nie figuruje w katalogu kontaktów.`)
        .addToggle((t) =>
          t.setValue(this.createMissingContact).onChange((v) => (this.createMissingContact = v))
        );
    }

    new Setting(scrollEl)
      .setName("Zadania Obsidian Tasks (jedno na linię)")
      .setDesc("Standard: - [ ] Opis zadania 📅 YYYY-MM-DD ⏫")
      .addTextArea((ta) => {
        ta.setValue(this.tasksText);
        ta.inputEl.rows = 4;
        ta.inputEl.style.width = "100%";
        ta.onChange((v) => (this.tasksText = v));
      });

    // Stała stopka z przyciskami (nigdy niezasłaniana przez rozwijane listy)
    const footer = contentEl.createDiv({ cls: "trinitec-mail-modal-footer" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj" });
    cancelBtn.onclick = () => this.close();

    const saveBtn = footer.createEl("button", { text: "Zapisz w Vaulcie", cls: "mod-cta" });
    saveBtn.onclick = async () => {
      if (this.destinationMode === "append-note" && !this.appendTargetFile) {
        new Notice("Wybierz istniejącą notatkę docelową.");
        return;
      }

      try {
        if (this.createMissingContact && this.email.fromEmail) {
          const domain = this.email.fromEmail.split("@")[1]?.split(".")[0] || "Klient";
          await this.matcher.createContactNote({
            name: this.email.fromName,
            email: this.email.fromEmail,
            clientName: domain.charAt(0).toUpperCase() + domain.slice(1),
            projectMasterNote: this.selectedProject?.masterNoteName || null,
          });
        }

        const tasks = this.tasksText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);

        const targetFile = await this.writer.saveExplicitEmail({
          email: this.email,
          project: this.selectedProject,
          scope: this.saveScope,
          selectedExcerpt: this.selectedExcerpt,
          destinationMode: this.destinationMode,
          appendTargetFile: this.appendTargetFile,
          selectedAttachmentNames: Array.from(this.selectedAttachmentNames),
          tasksMarkdown: tasks,
          useQuoteStrippedBody: this.useQuoteStrippedBody,
          saveRawEmlCopy: this.saveRawEmlCopy,
          aiCategory: this.aiProposal?.category,
          aiPriority: this.aiProposal?.priority,
        });

        new Notice(`Zapisano w Vaulcie: ${targetFile.path}`);
        await this.app.workspace.getLeaf(false).openFile(targetFile);
        this.close();
      } catch (err) {
        new Notice(`Błąd zapisu do Vaulta: ${(err as Error).message}`);
      }
    };
  }
}
