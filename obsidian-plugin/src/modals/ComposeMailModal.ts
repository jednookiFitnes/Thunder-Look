import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile } from "obsidian";
import { VaultContactMatch } from "../types";
import { SmtpService } from "../services/smtpService";
import { ProjectMatcherService } from "../services/projectMatcherService";
import { MruStore } from "../utils/mruStore";

class ContactMruSuggestModal extends FuzzySuggestModal<VaultContactMatch> {
  private contacts: VaultContactMatch[];
  private onPick: (contact: VaultContactMatch) => void;

  constructor(
    app: App,
    contacts: VaultContactMatch[],
    onPick: (contact: VaultContactMatch) => void
  ) {
    super(app);
    this.contacts = contacts;
    this.onPick = onPick;
    this.setPlaceholder("Wybierz odbiorcę z kontakty/ (sortowanie MRU)...");
  }

  getItems(): VaultContactMatch[] {
    return this.contacts;
  }

  getItemText(item: VaultContactMatch): string {
    return `${item.contactName} <${item.emails[0] || ""}>`;
  }

  onChooseItem(item: VaultContactMatch): void {
    this.onPick(item);
  }
}

class VaultFileSuggestModal extends FuzzySuggestModal<TFile> {
  private onPick: (file: TFile) => void;

  constructor(app: App, onPick: (file: TFile) => void) {
    super(app);
    this.onPick = onPick;
    this.setPlaceholder("Wybierz plik z Vaulta do załączenia (PDF, DWG, XLSX, MD)...");
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles();
  }

  getItemText(item: TFile): string {
    return item.path;
  }

  onChooseItem(item: TFile): void {
    this.onPick(item);
  }
}

export class ComposeMailModal extends Modal {
  private smtpService: SmtpService;
  private matcher: ProjectMatcherService;
  private mru: MruStore;

  private to: string;
  private cc = "";
  private bcc = "";
  private subject: string;
  private body: string;
  private inReplyTo?: string;
  private references?: string[];
  private attachedFiles: TFile[] = [];

  constructor(
    app: App,
    smtpService: SmtpService,
    matcher: ProjectMatcherService,
    mru: MruStore,
    defaults?: {
      to?: string;
      subject?: string;
      body?: string;
      inReplyTo?: string;
      references?: string[];
    }
  ) {
    super(app);
    this.smtpService = smtpService;
    this.matcher = matcher;
    this.mru = mru;
    this.to = defaults?.to || "";
    this.subject = defaults?.subject || "";
    this.body = defaults?.body || "";
    this.inReplyTo = defaults?.inReplyTo;
    this.references = defaults?.references;
  }

  onOpen(): void {
    this.modalEl.addClass("trinitec-mail-modal-spacious");
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h2", { text: "Nowa wiadomość e-mail (SMTP + kopia w Sent)" });

    const scrollEl = contentEl.createDiv({ cls: "trinitec-mail-modal-scroll" });

    new Setting(scrollEl)
      .setName("Do (odbiorca)")
      .addText((t) => {
        t.setValue(this.to)
          .setPlaceholder("odbiorca@firma.pl")
          .onChange((v) => (this.to = v.trim()));
        t.inputEl.style.width = "100%";
      })
      .addButton((btn) =>
        btn.setButtonText("Z kontaktów (MRU)").onClick(() => {
          const contacts = this.matcher
            .listAllContacts(true)
            .filter((c) => c.emails.length > 0);
          new ContactMruSuggestModal(this.app, contacts, (picked) => {
            const addr = picked.emails[0];
            if (addr) {
              this.mru.recordUse("contacts", addr);
              this.to = this.to ? `${this.to}, ${addr}` : addr;
              this.render();
            }
          }).open();
        })
      );

    new Setting(scrollEl).setName("DW (CC)").addText((t) => {
      t.setValue(this.cc).onChange((v) => (this.cc = v.trim()));
      t.inputEl.style.width = "100%";
    });

    new Setting(scrollEl).setName("UDW (BCC)").addText((t) => {
      t.setValue(this.bcc).onChange((v) => (this.bcc = v.trim()));
      t.inputEl.style.width = "100%";
    });

    new Setting(scrollEl).setName("Temat").addText((t) => {
      t.setValue(this.subject)
        .setPlaceholder("[26-125] Temat wiadomości")
        .onChange((v) => (this.subject = v));
      t.inputEl.style.width = "100%";
    });

    new Setting(scrollEl).setName("Treść wiadomości").addTextArea((ta) => {
      ta.setValue(this.body);
      ta.inputEl.rows = 10;
      ta.inputEl.style.width = "100%";
      ta.onChange((v) => (this.body = v));
    });

    new Setting(scrollEl)
      .setName("Załączniki z Vaulta")
      .setDesc(
        this.attachedFiles.length > 0
          ? this.attachedFiles.map((f) => f.name).join(", ")
          : "Brak załączników"
      )
      .addButton((btn) =>
        btn.setButtonText("Dodaj plik z Vaulta...").onClick(() => {
          new VaultFileSuggestModal(this.app, (file) => {
            if (!this.attachedFiles.some((f) => f.path === file.path)) {
              this.attachedFiles.push(file);
              this.render();
            }
          }).open();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Wyczyść").onClick(() => {
          this.attachedFiles = [];
          this.render();
        })
      );

    const footer = contentEl.createDiv({ cls: "trinitec-mail-modal-footer" });
    const cancelBtn = footer.createEl("button", { text: "Anuluj" });
    cancelBtn.onclick = () => this.close();

    const sendBtn = footer.createEl("button", { text: "Wyślij wiadomość", cls: "mod-cta" });
    sendBtn.onclick = async () => {
      if (!this.to || !this.subject) {
        new Notice("Podaj adres odbiorcy oraz temat wiadomości.");
        return;
      }
      sendBtn.setAttr("disabled", "true");
      sendBtn.setText("Wysyłanie...");
      try {
        const attachments = await Promise.all(
          this.attachedFiles.map(async (file) => {
            const bin = await this.app.vault.readBinary(file);
            return { filename: file.name, content: Buffer.from(bin) };
          })
        );

        const res = await this.smtpService.sendEmail({
          to: this.to,
          cc: this.cc,
          bcc: this.bcc,
          subject: this.subject,
          text: this.body,
          inReplyTo: this.inReplyTo,
          references: this.references,
          attachments,
        });

        const firstEmail = this.to.split(",")[0]?.trim().toLowerCase();
        if (firstEmail) this.mru.recordUse("contacts", firstEmail);

        new Notice(
          res.appendedToSent
            ? `Wysłano do ${this.to} i zapisano kopię w folderze Sent.`
            : `Wysłano do ${this.to}.`
        );
        this.close();
      } catch (err) {
        new Notice(`Błąd wysyłki SMTP: ${(err as Error).message}`);
        sendBtn.removeAttribute("disabled");
        sendBtn.setText("Wyślij wiadomość");
      }
    };
  }
}
