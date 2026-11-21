import { App, FuzzySuggestModal, Modal, Notice, Setting, TFile, setIcon } from "obsidian";
import { TrinitecPluginSettings } from "../types";
import { SmtpService } from "../services/smtpService";
import { ImapService } from "../services/imapService";
import { MailCacheService } from "../services/mailCacheService";
import { ProjectMatcherService } from "../services/projectMatcherService";
import { convertMarkdownToCleanEmailHtml } from "../services/mailParserService";
import { MruStore } from "../utils/mruStore";
import { formatBytes } from "../utils/textUtils";

const UNDO_DELAY_SECONDS = 5;
const AUTO_DRAFT_INTERVAL_MS = 15_000;

interface ContactSuggestionItem {
  name: string;
  email: string;
  source: "Vault" | "Historia";
}

class ContactAutocompleteModal extends FuzzySuggestModal<ContactSuggestionItem> {
  private items: ContactSuggestionItem[];
  private onPick: (item: ContactSuggestionItem) => void;

  constructor(
    app: App,
    items: ContactSuggestionItem[],
    onPick: (item: ContactSuggestionItem) => void
  ) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.setPlaceholder("Wyszukaj odbiorcę (kontakty Vaulta + ostatnia korespondencja)...");
  }

  getItems(): ContactSuggestionItem[] {
    return this.items;
  }

  getItemText(item: ContactSuggestionItem): string {
    return item.name
      ? `${item.name} <${item.email}> [${item.source}]`
      : `${item.email} [${item.source}]`;
  }

  onChooseItem(item: ContactSuggestionItem): void {
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

interface PendingAttachment {
  id: string;
  filename: string;
  size: number;
  vaultFile?: TFile;
  buffer?: Buffer;
}

export interface ComposeDefaults {
  accountId?: string;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string;
  references?: string[];
  originalSenderName?: string;
  draftUid?: number;
}

export class ComposeMailModal extends Modal {
  private settings: TrinitecPluginSettings;
  private smtpService: SmtpService;
  private matcher: ProjectMatcherService;
  private mru: MruStore;
  private imapService?: ImapService;
  private cacheService?: MailCacheService;

  private accountId: string;
  private to: string;
  private cc: string;
  private bcc = "";
  private subject: string;
  private body: string;
  private inReplyTo?: string;
  private references?: string[];
  private originalSenderName: string;
  private attachments: PendingAttachment[] = [];

  private draftUid: number | null;
  private lastSavedDraftHash = "";
  private draftStatusText = "";
  private draftStatusEl: HTMLElement | null = null;
  private autoDraftTimer: number | null = null;
  private savingDraft = false;

  private pendingSendCountdown = 0;
  private countdownInterval: number | null = null;
  private sendingNow = false;
  private bodyTextareaEl: HTMLTextAreaElement | null = null;

  constructor(
    app: App,
    settings: TrinitecPluginSettings,
    smtpService: SmtpService,
    matcher: ProjectMatcherService,
    mru: MruStore,
    defaults?: ComposeDefaults,
    imapService?: ImapService,
    cacheService?: MailCacheService
  ) {
    super(app);
    this.settings = settings;
    this.smtpService = smtpService;
    this.matcher = matcher;
    this.mru = mru;
    this.imapService = imapService;
    this.cacheService = cacheService;

    this.accountId = defaults?.accountId || settings.activeAccountId || settings.accounts[0]?.id || "default";
    this.to = defaults?.to || "";
    this.cc = defaults?.cc || "";
    this.subject = defaults?.subject || "";
    this.body = defaults?.body || "";
    this.inReplyTo = defaults?.inReplyTo;
    this.references = defaults?.references;
    this.originalSenderName = defaults?.originalSenderName || "";
    this.draftUid = defaults?.draftUid ?? null;
    this.lastSavedDraftHash = this.computeDraftHash();
  }

  onOpen(): void {
    this.modalEl.addClass("tl-modal-spacious");
    this.modalEl.addClass("tl-compose-modal");
    this.render();

    // Auto-zapis szkicu na IMAP co 15 s, gdy treść uległa zmianie
    if (this.imapService) {
      this.autoDraftTimer = window.setInterval(() => {
        if (this.sendingNow || this.pendingSendCountdown > 0 || this.savingDraft) return;
        const hash = this.computeDraftHash();
        if (hash !== this.lastSavedDraftHash && (this.to.trim() || this.subject.trim() || this.body.trim())) {
          void this.saveDraftToImap(true);
        }
      }, AUTO_DRAFT_INTERVAL_MS);
    }
  }

  onClose(): void {
    this.cancelPendingSend();
    if (this.autoDraftTimer !== null) {
      window.clearInterval(this.autoDraftTimer);
      this.autoDraftTimer = null;
    }
    this.contentEl.empty();
  }

  private computeDraftHash(): string {
    return `${this.accountId}|${this.to}|${this.cc}|${this.bcc}|${this.subject}|${this.body}|${this.attachments.length}`;
  }

  private cancelPendingSend(): void {
    if (this.countdownInterval !== null) {
      window.clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    this.pendingSendCountdown = 0;
  }

  private buildContactSuggestions(): ContactSuggestionItem[] {
    const byEmail = new Map<string, ContactSuggestionItem>();
    for (const c of this.matcher.listAllContacts(true)) {
      for (const email of c.emails) {
        const clean = email.trim().toLowerCase();
        if (clean && !byEmail.has(clean)) {
          byEmail.set(clean, { name: c.contactName, email: clean, source: "Vault" });
        }
      }
    }
    if (this.cacheService) {
      for (const entry of this.cacheService.getKnownEmailAddresses()) {
        if (!byEmail.has(entry.email)) {
          byEmail.set(entry.email, {
            name: entry.name,
            email: entry.email,
            source: "Historia",
          });
        }
      }
    }
    return Array.from(byEmail.values());
  }

  private listReplyTemplates(): TFile[] {
    const dir = (this.settings.replyTemplatesDir || "_Templates/Mail").replace(/^\/+|\/+$/g, "");
    if (!dir) return [];
    const prefix = `${dir}/`;
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(prefix))
      .sort((a, b) => a.basename.localeCompare(b.basename, "pl"));
  }

  private async applyReplyTemplate(file: TFile): Promise<void> {
    const raw = await this.app.vault.read(file);
    const today = new Date().toISOString().slice(0, 10);
    const interpolated = raw
      .replace(/\{\{\s*sender_name\s*\}\}/gi, this.originalSenderName || "Szanowni Państwo")
      .replace(/\{\{\s*subject\s*\}\}/gi, this.subject || "")
      .replace(/\{\{\s*date\s*\}\}/gi, today);

    this.body = `${interpolated.trim()}\n\n${this.body}`;
    if (this.bodyTextareaEl) {
      this.bodyTextareaEl.value = this.body;
    }
    new Notice(`Wstawiono szablon: ${file.basename}`);
  }

  private wrapSelectionInBody(prefix: string, suffix: string, fallbackText: string): void {
    const ta = this.bodyTextareaEl;
    if (!ta) return;
    const start = ta.selectionStart ?? this.body.length;
    const end = ta.selectionEnd ?? this.body.length;
    const selected = this.body.slice(start, end) || fallbackText;
    this.body = this.body.slice(0, start) + prefix + selected + suffix + this.body.slice(end);
    ta.value = this.body;
    ta.focus();
    ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  }

  private async addNativeFiles(fileList: FileList | File[]): Promise<void> {
    const maxBytes = Math.max(1, this.settings.maxAttachmentSizeMb || 25) * 1024 * 1024;
    const files = Array.from(fileList);
    let added = 0;
    for (const f of files) {
      if (f.size > maxBytes) {
        new Notice(`Pominięto „${f.name}” — przekracza limit ${this.settings.maxAttachmentSizeMb} MB.`);
        continue;
      }
      const arr = await f.arrayBuffer();
      const buf = Buffer.from(arr);
      this.attachments.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        filename: f.name || "zalacznik.bin",
        size: buf.byteLength,
        buffer: buf,
      });
      added++;
    }
    if (added > 0) this.render();
  }

  private async resolveAttachmentBuffers(): Promise<Array<{ filename: string; content: Buffer }>> {
    const maxBytes = Math.max(1, this.settings.maxAttachmentSizeMb || 25) * 1024 * 1024;
    return Promise.all(
      this.attachments.map(async (att) => {
        if (att.size > maxBytes) {
          throw new Error(
            `Załącznik „${att.filename}” przekracza limit ${this.settings.maxAttachmentSizeMb} MB.`
          );
        }
        if (att.buffer) {
          return { filename: att.filename, content: att.buffer };
        }
        if (att.vaultFile) {
          const bin = await this.app.vault.readBinary(att.vaultFile);
          return { filename: att.filename, content: Buffer.from(bin) };
        }
        throw new Error(`Brak danych dla załącznika „${att.filename}”.`);
      })
    );
  }

  private async saveDraftToImap(silent = false): Promise<void> {
    if (!this.imapService || this.savingDraft) return;
    this.savingDraft = true;
    try {
      const attachments = await this.resolveAttachmentBuffers();
      const rawMime = await this.smtpService.buildRawMimeMessage({
        accountId: this.accountId,
        to: this.to,
        cc: this.cc,
        bcc: this.bcc,
        subject: this.subject || "(Szkic bez tematu)",
        text: this.body,
        html: convertMarkdownToCleanEmailHtml(this.body),
        inReplyTo: this.inReplyTo,
        references: this.references,
        attachments,
      });

      const saved = await this.imapService.saveDraft(rawMime, {
        accountId: this.accountId,
        previousDraftUid: this.draftUid,
      });
      if (saved.draftUid) this.draftUid = saved.draftUid;
      this.lastSavedDraftHash = this.computeDraftHash();
      const nowTime = new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });
      this.draftStatusText = `Szkic zapisany (${nowTime})`;
      if (this.draftStatusEl) this.draftStatusEl.setText(this.draftStatusText);
      if (!silent) new Notice(`Zapisano szkic w folderze ${saved.folder}.`);
    } catch (err) {
      if (!silent) {
        new Notice(`Nie udało się zapisać szkicu: ${(err as Error).message}`);
      }
    } finally {
      this.savingDraft = false;
    }
  }

  private startDelayedSend(): void {
    if (!this.to.trim() || !this.subject.trim()) {
      new Notice("Podaj adres odbiorcy oraz temat wiadomości.");
      return;
    }

    this.cancelPendingSend();
    this.pendingSendCountdown = UNDO_DELAY_SECONDS;
    this.render();

    this.countdownInterval = window.setInterval(() => {
      this.pendingSendCountdown -= 1;
      if (this.pendingSendCountdown <= 0) {
        this.cancelPendingSend();
        void this.executeActualSend();
      } else {
        this.render();
      }
    }, 1000);
  }

  private async executeActualSend(): Promise<void> {
    if (this.sendingNow) return;
    this.sendingNow = true;
    this.render();

    try {
      const attachments = await this.resolveAttachmentBuffers();
      const res = await this.smtpService.sendEmail({
        accountId: this.accountId,
        to: this.to,
        cc: this.cc,
        bcc: this.bcc,
        subject: this.subject,
        text: this.body,
        html: convertMarkdownToCleanEmailHtml(this.body),
        inReplyTo: this.inReplyTo,
        references: this.references,
        attachments,
      });

      // Usuń szkic po udanym wysłaniu
      if (this.draftUid && this.imapService) {
        void this.imapService.deleteDraft(this.draftUid, this.accountId).catch(() => {});
        this.draftUid = null;
      }

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
      this.sendingNow = false;
      this.render();
    }
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();

    const headerRow = contentEl.createDiv({ cls: "tl-modal-header-row" });
    headerRow.createEl("h2", { text: "Nowa wiadomość e-mail", cls: "tl-modal-title" });
    this.draftStatusEl = headerRow.createSpan({
      cls: "tl-muted-xs",
      text: this.draftStatusText,
    });

    if (this.pendingSendCountdown > 0) {
      const undoBanner = contentEl.createDiv({ cls: "tl-banner-warn" });
      undoBanner.createSpan({
        text: `Wysyłanie wiadomości za ${this.pendingSendCountdown} s...`,
      });
      const undoBtn = undoBanner.createEl("button", {
        text: "Cofnij wysyłkę",
        type: "button",
        cls: "mod-warning",
      });
      undoBtn.addEventListener("click", () => {
        this.cancelPendingSend();
        new Notice("Cofnięto wysyłkę wiadomości.");
        this.render();
      });
    }

    const scrollEl = contentEl.createDiv({ cls: "tl-modal-scroll" });

    // Drag & Drop plików z systemu operacyjnego na okno kompozytora
    scrollEl.addEventListener("dragover", (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) {
        e.preventDefault();
        scrollEl.addClass("is-drop-target");
      }
    });
    scrollEl.addEventListener("dragleave", () => scrollEl.removeClass("is-drop-target"));
    scrollEl.addEventListener("drop", (e: DragEvent) => {
      scrollEl.removeClass("is-drop-target");
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        void this.addNativeFiles(e.dataTransfer.files);
      }
    });

    // Pole wyboru nadawcy (Od:) dla Multi-Account
    const enabledAccounts = this.settings.accounts.filter((a) => a.enabled);
    if (enabledAccounts.length > 0) {
      new Setting(scrollEl).setName("Od (konto nadawcy)").addDropdown((dd) => {
        for (const acc of enabledAccounts) {
          dd.addOption(acc.id, `${acc.label} (${acc.imapUser || acc.imapHost})`);
        }
        dd.setValue(this.accountId).onChange((val) => {
          this.accountId = val;
        });
      });
    }

    // Do (z rozszerzonym autouzupełnianiem: Vault + historia maili)
    new Setting(scrollEl)
      .setName("Do (odbiorca)")
      .addText((t) => {
        t.setValue(this.to)
          .setPlaceholder("odbiorca@firma.pl")
          .onChange((v) => (this.to = v.trim()));
        t.inputEl.addClass("tl-full-width");
      })
      .addButton((btn) =>
        btn.setButtonText("Kontakty").onClick(() => {
          const items = this.buildContactSuggestions();
          new ContactAutocompleteModal(this.app, items, (picked) => {
            this.mru.recordUse("contacts", picked.email);
            this.to = this.to ? `${this.to}, ${picked.email}` : picked.email;
            this.render();
          }).open();
        })
      );

    new Setting(scrollEl).setName("DW (CC)").addText((t) => {
      t.setValue(this.cc).onChange((v) => (this.cc = v.trim()));
      t.inputEl.addClass("tl-full-width");
    });

    new Setting(scrollEl).setName("UDW (BCC)").addText((t) => {
      t.setValue(this.bcc).onChange((v) => (this.bcc = v.trim()));
      t.inputEl.addClass("tl-full-width");
    });

    new Setting(scrollEl).setName("Temat").addText((t) => {
      t.setValue(this.subject)
        .setPlaceholder("[26-125] Temat wiadomości")
        .onChange((v) => (this.subject = v));
      t.inputEl.addClass("tl-full-width");
    });

    // Szablony odpowiedzi z Vaulta
    const templates = this.listReplyTemplates();
    if (templates.length > 0) {
      new Setting(scrollEl)
        .setName("Szablon odpowiedzi")
        .setDesc(`Folder szablonów: ${this.settings.replyTemplatesDir}`)
        .addDropdown((dd) => {
          dd.addOption("", "— Wybierz szablon do wstawienia —");
          for (const tpl of templates) {
            dd.addOption(tpl.path, tpl.basename);
          }
          dd.onChange(async (path) => {
            if (!path) return;
            const found = templates.find((f) => f.path === path);
            if (found) {
              await this.applyReplyTemplate(found);
              dd.setValue("");
            }
          });
        });
    }

    // Pasek formatowania Markdown -> czysty HTML (multipart/alternative)
    const fmtBar = scrollEl.createDiv({ cls: "tl-compose-fmt-bar" });
    const addFmt = (icon: string, title: string, onClick: () => void) => {
      const b = fmtBar.createEl("button", {
        type: "button",
        cls: "tl-icon-btn-sm",
        attr: { "aria-label": title, title },
      });
      setIcon(b, icon);
      b.addEventListener("click", onClick);
    };
    addFmt("bold", "Pogrubienie (**tekst**)", () => this.wrapSelectionInBody("**", "**", "tekst"));
    addFmt("italic", "Kursywa (*tekst*)", () => this.wrapSelectionInBody("*", "*", "tekst"));
    addFmt("list", "Lista punktowana", () => this.wrapSelectionInBody("\n- ", "", "element listy"));
    addFmt("quote", "Cytat", () => this.wrapSelectionInBody("\n> ", "", "cytat"));
    addFmt("link", "Wstaw link", () =>
      this.wrapSelectionInBody("[", "](https://)", "opis linku")
    );
    fmtBar.createSpan({
      cls: "tl-muted-xs tl-fmt-hint",
      text: "Markdown → multipart HTML + tekst · Ctrl+V wkleja zrzut ekranu · Ctrl+Enter wysyła",
    });

    const ta = scrollEl.createEl("textarea", {
      cls: "tl-compose-textarea",
      attr: { rows: "11", placeholder: "Treść wiadomości (obsługuje Markdown i wklejanie obrazków Ctrl+V)..." },
    });
    ta.value = this.body;
    this.bodyTextareaEl = ta;
    ta.addEventListener("input", () => {
      this.body = ta.value;
    });
    ta.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.startDelayedSend();
      }
    });
    // Wklejanie zrzutów ekranu bezpośrednio ze schowka (Ctrl+V)
    ta.addEventListener("paste", (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            const ext = item.type.split("/")[1] || "png";
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            const renamed = new File([f], `zrzut-ekranu-${stamp}.${ext}`, { type: f.type });
            imageFiles.push(renamed);
          }
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        void this.addNativeFiles(imageFiles);
        new Notice(`Dołączono zrzut ekranu ze schowka (${imageFiles.length}).`);
      }
    });

    // Sekcja załączników (Vault + dysk + Drag & Drop + chipy z usuwaniem)
    const attBox = scrollEl.createDiv({ cls: "tl-compose-attachments" });
    const attActions = attBox.createDiv({ cls: "tl-actions-row" });

    const addVaultBtn = attActions.createEl("button", {
      type: "button",
      text: "Dodaj plik z Vaulta...",
    });
    addVaultBtn.addEventListener("click", () => {
      new VaultFileSuggestModal(this.app, (file) => {
        if (!this.attachments.some((a) => a.vaultFile?.path === file.path)) {
          this.attachments.push({
            id: `${Date.now()}-${file.path}`,
            filename: file.name,
            size: file.stat.size,
            vaultFile: file,
          });
          this.render();
        }
      }).open();
    });

    const fileInput = attActions.createEl("input", {
      type: "file",
      cls: "tl-hidden-input",
      attr: { multiple: "true" },
    });
    fileInput.addEventListener("change", () => {
      if (fileInput.files && fileInput.files.length > 0) {
        void this.addNativeFiles(fileInput.files);
      }
    });
    const addDiskBtn = attActions.createEl("button", {
      type: "button",
      text: "Dodaj z dysku...",
    });
    addDiskBtn.addEventListener("click", () => fileInput.click());

    attActions.createSpan({
      cls: "tl-muted-xs",
      text: "lub przeciągnij pliki tutaj (Drag & Drop)",
    });

    if (this.attachments.length > 0) {
      const chipList = attBox.createDiv({ cls: "tl-attachments-chips" });
      for (const att of this.attachments) {
        const chip = chipList.createDiv({ cls: "tl-att-chip tl-att-chip-compact" });
        chip.createSpan({ text: `${att.filename} (${formatBytes(att.size)})` });
        const rmBtn = chip.createEl("button", {
          type: "button",
          cls: "tl-icon-btn-xs",
          attr: { "aria-label": "Usuń załącznik" },
        });
        setIcon(rmBtn, "x");
        rmBtn.addEventListener("click", () => {
          this.attachments = this.attachments.filter((a) => a.id !== att.id);
          this.render();
        });
      }
    }

    const footer = contentEl.createDiv({ cls: "tl-modal-footer" });
    const leftFooter = footer.createDiv({ cls: "tl-btn-row" });
    const cancelBtn = leftFooter.createEl("button", { text: "Anuluj", type: "button" });
    cancelBtn.addEventListener("click", () => this.close());

    if (this.imapService) {
      const draftBtn = leftFooter.createEl("button", {
        text: "Zapisz szkic",
        type: "button",
      });
      draftBtn.addEventListener("click", () => void this.saveDraftToImap(false));
    }

    const sendBtn = footer.createEl("button", {
      text: this.sendingNow
        ? "Wysyłanie..."
        : this.pendingSendCountdown > 0
        ? `Wysyłanie za ${this.pendingSendCountdown} s...`
        : "Wyślij wiadomość (5 s na cofnięcie)",
      type: "button",
      cls: "mod-cta",
    });
    sendBtn.disabled = this.sendingNow || this.pendingSendCountdown > 0;
    sendBtn.addEventListener("click", () => this.startDelayedSend());
  }
}
