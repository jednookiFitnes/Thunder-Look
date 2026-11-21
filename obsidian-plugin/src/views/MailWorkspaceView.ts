import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import {
  EmailThreadGroup,
  ImapFolderSummary,
  ImapMessageHeader,
  ParsedEmailMessage,
} from "../types";
import { groupHeadersIntoThreads } from "../services/mailParserService";
import { formatBytes, sanitizeHtmlForSandbox } from "../utils/textUtils";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import { ComposeMailModal } from "../modals/ComposeMailModal";
import type TrinitecMailPlugin from "../main";

export const VIEW_TYPE_TRINITEC_MAIL = "trinitec-mail-workspace";

type ReaderRenderMode = "html" | "markdown";

export class MailWorkspaceView extends ItemView {
  private plugin: TrinitecMailPlugin;
  private currentFolder: string;
  private folders: ImapFolderSummary[] = [];
  private headers: ImapMessageHeader[] = [];
  private threads: EmailThreadGroup[] = [];
  private selectedUid: number | null = null;
  private selectedEmail: ParsedEmailMessage | null = null;

  private renderMode: ReaderRenderMode = "html";
  private allowRemoteImagesForCurrent = false;
  private showStrippedMarkdown = true;
  private filterQuery = "";
  private loading = false;
  private activeContextMenu: HTMLElement | null = null;
  private dismissMenuHandler: ((e: MouseEvent) => void) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentFolder = plugin.settings.inboxFolder || "INBOX";
  }

  getViewType(): string {
    return VIEW_TYPE_TRINITEC_MAIL;
  }

  getDisplayText(): string {
    return "Trinitec Mail (IMAP)";
  }

  getIcon(): string {
    return "mail";
  }

  async onOpen(): Promise<void> {
    this.dismissMenuHandler = () => this.closeContextMenu();
    window.addEventListener("click", this.dismissMenuHandler);
    this.render();
    // Natychmiastowe wczytanie ostatniego cache z IndexedDB (poza OneDrive)
    const cached = await this.plugin.imapService.listMessages(this.currentFolder, 60, true);
    if (cached.length > 0) {
      this.headers = cached;
      this.threads = groupHeadersIntoThreads(cached);
      this.render();
    }
  }

  async onClose(): Promise<void> {
    this.closeContextMenu();
    if (this.dismissMenuHandler) {
      window.removeEventListener("click", this.dismissMenuHandler);
      this.dismissMenuHandler = null;
    }
    this.contentEl.empty();
  }

  async refreshFolder(folder = this.currentFolder): Promise<void> {
    this.loading = true;
    this.render();
    try {
      const prevFolder = this.currentFolder;
      this.folders = await this.plugin.imapService.listFolders();
      // Selection State Persistence: zachowaj wybrany folder, jeśli nadal istnieje
      const folderStillExists = this.folders.some((f) => f.path === folder);
      this.currentFolder = folderStillExists
        ? folder
        : this.folders.some((f) => f.path === prevFolder)
        ? prevFolder
        : this.folders[0]?.path || "INBOX";

      this.headers = await this.plugin.imapService.listMessages(this.currentFolder, 60, false);
      this.threads = groupHeadersIntoThreads(this.headers);
    } catch (err) {
      new Notice(`Błąd połączenia IMAP: ${(err as Error).message}`);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async openMessage(header: ImapMessageHeader): Promise<void> {
    this.selectedUid = header.uid;
    this.allowRemoteImagesForCurrent = false;
    this.render();
    try {
      this.selectedEmail = await this.plugin.imapService.fetchFullMessage(
        header.folder,
        header.uid
      );
      this.renderMode = this.selectedEmail.htmlBody ? "html" : "markdown";
      this.render();
    } catch (err) {
      new Notice(`Nie udało się pobrać wiadomości: ${(err as Error).message}`);
    }
  }

  private closeContextMenu(): void {
    if (this.activeContextMenu) {
      this.activeContextMenu.remove();
      this.activeContextMenu = null;
    }
  }

  /**
   * Niestandardowe menu kontekstowe z viewport clampingiem (AGENTS.md).
   */
  private openThreadContextMenu(evt: MouseEvent, header: ImapMessageHeader): void {
    evt.preventDefault();
    evt.stopPropagation();
    this.closeContextMenu();

    const menu = document.body.createDiv({ cls: "trinitec-mail-context-menu" });
    this.activeContextMenu = menu;

    const addItem = (label: string, onClick: () => void) => {
      const btn = menu.createEl("button", { text: label, cls: "trinitec-mail-context-item" });
      btn.onclick = (e) => {
        e.stopPropagation();
        this.closeContextMenu();
        onClick();
      };
    };

    addItem("Zapisz w Praca Vault (Opt-in)...", async () => {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid);
      const proposal = this.plugin.aiBridge.analyzeContent(
        full.subject,
        full.strippedMarkdownBody
      );
      new SaveEmailModal(
        this.app,
        this.plugin.settings,
        this.plugin.projectMatcher,
        this.plugin.vaultWriter,
        this.plugin.mruStore,
        full,
        "",
        proposal
      ).open();
    });

    addItem(header.seen ? "Oznacz jako nieprzeczytaną" : "Oznacz jako przeczytaną", async () => {
      await this.plugin.imapService.setMessageFlag(
        header.folder,
        header.uid,
        "\\Seen",
        !header.seen
      );
      await this.refreshFolder();
    });

    addItem(header.flagged ? "Usuń flagę priorytetu" : "Oznacz jako pilną (Flaga)", async () => {
      await this.plugin.imapService.setMessageFlag(
        header.folder,
        header.uid,
        "\\Flagged",
        !header.flagged
      );
      await this.refreshFolder();
    });

    if (this.plugin.settings.allowlistFolder) {
      addItem(`Przenieś do kolejki ${this.plugin.settings.allowlistFolder}`, async () => {
        await this.plugin.imapService.moveMessage(
          header.folder,
          header.uid,
          this.plugin.settings.allowlistFolder
        );
        new Notice(`Przeniesiono do kolejki ${this.plugin.settings.allowlistFolder}`);
        await this.refreshFolder();
      });
    }

    // Viewport clamping — menu nigdy nie wyjdzie poza widoczny obszar ekranu
    menu.style.left = `${evt.clientX}px`;
    menu.style.top = `${evt.clientY}px`;
    const rect = menu.getBoundingClientRect();
    const clampedX = Math.max(8, Math.min(evt.clientX, window.innerWidth - rect.width - 8));
    const clampedY = Math.max(8, Math.min(evt.clientY, window.innerHeight - rect.height - 8));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    const root = container.createDiv({ cls: "trinitec-mail-workspace" });

    // Górny pasek narzędzi
    const topbar = root.createDiv({ cls: "trinitec-mail-topbar" });
    const leftTools = topbar.createDiv({ cls: "trinitec-mail-topbar-group" });

    const refreshBtn = leftTools.createEl("button", {
      text: this.loading ? "Synchronizacja..." : "Odśwież IMAP",
      cls: "mod-cta",
    });
    refreshBtn.onclick = () => this.refreshFolder();

    const composeBtn = leftTools.createEl("button", { text: "Nowy e-mail" });
    composeBtn.onclick = () =>
      new ComposeMailModal(
        this.app,
        this.plugin.smtpService,
        this.plugin.projectMatcher,
        this.plugin.mruStore
      ).open();

    const quotaBtn = leftTools.createEl("button", { text: "Rozmiar skrzynki" });
    quotaBtn.onclick = () => this.plugin.activateStorageView();

    const rightTools = topbar.createDiv({ cls: "trinitec-mail-topbar-group" });
    const searchInput = rightTools.createEl("input", {
      type: "search",
      placeholder: "Filtruj temat, nadawcę lub kod YY-XXX...",
    });
    searchInput.value = this.filterQuery;
    searchInput.oninput = () => {
      this.filterQuery = searchInput.value;
      this.renderThreadList(threadsPane);
    };

    // 3-kolumnowy widok klienta poczty
    const threePane = root.createDiv({ cls: "trinitec-mail-three-pane" });

    // Kolumna 1: Drzewo folderów IMAP
    const foldersPane = threePane.createDiv({ cls: "trinitec-mail-pane" });
    foldersPane.createDiv({
      cls: "trinitec-mail-pane-header",
      text: `Foldery (${this.folders.length || 1})`,
    });

    const folderItems =
      this.folders.length > 0
        ? this.folders
        : [{ path: this.currentFolder, messages: this.headers.length, unseen: 0, uidValidity: "0" }];

    for (const f of folderItems) {
      const row = foldersPane.createDiv({
        cls: `trinitec-mail-folder-item${f.path === this.currentFolder ? " is-active" : ""}`,
      });
      row.createSpan({ text: f.path });
      row.createSpan({
        cls: "trinitec-mail-status-text",
        text: f.unseen > 0 ? `${f.unseen}/${f.messages}` : String(f.messages),
      });
      row.onclick = () => this.refreshFolder(f.path);
    }

    // Kolumna 2: Lista wątków
    const threadsPane = threePane.createDiv({ cls: "trinitec-mail-pane" });
    this.renderThreadList(threadsPane);

    // Kolumna 3: Panel czytania wiadomości
    const readerPane = threePane.createDiv({ cls: "trinitec-mail-pane" });
    this.renderReaderPane(readerPane);
  }

  private renderThreadList(pane: HTMLElement): void {
    pane.empty();
    const q = this.filterQuery.trim().toLowerCase();
    const visible = q
      ? this.threads.filter(
          (t) =>
            t.subject.toLowerCase().includes(q) ||
            t.messages.some(
              (m) =>
                m.fromName.toLowerCase().includes(q) ||
                m.fromEmail.toLowerCase().includes(q) ||
                (m.detectedProjectCode || "").toLowerCase().includes(q)
            )
        )
      : this.threads;

    pane.createDiv({
      cls: "trinitec-mail-pane-header",
      text: `${this.currentFolder} · Wątki: ${visible.length}`,
    });

    if (visible.length === 0) {
      const empty = pane.createDiv({ cls: "trinitec-mail-reader" });
      empty.createDiv({
        cls: "trinitec-mail-status-text",
        text: "Brak wiadomości do wyświetlenia. Kliknij „Odśwież IMAP”, aby pobrać listę z serwera.",
      });
      return;
    }

    for (const thread of visible) {
      const headMsg = thread.messages[0];
      if (!headMsg) continue;
      const isSelected = this.selectedUid === headMsg.uid;
      const item = pane.createDiv({
        cls: `trinitec-mail-thread-item${isSelected ? " is-selected" : ""}${
          thread.unreadCount > 0 ? " is-unread" : ""
        }`,
      });

      const titleRow = item.createDiv({ cls: "trinitec-mail-meta-row" });
      titleRow.createSpan({
        cls: "trinitec-mail-thread-subject",
        text: `${thread.flagged ? "★ " : ""}${thread.subject}`,
      });
      if (thread.messages.length > 1) {
        titleRow.createSpan({ text: `(${thread.messages.length})` });
      }

      const meta = item.createDiv({ cls: "trinitec-mail-meta-row" });
      meta.createSpan({
        text: `${headMsg.fromName}${thread.projectCode ? ` · ${thread.projectCode}` : ""}`,
      });
      meta.createSpan({ text: `${thread.latestDate} · ${formatBytes(thread.totalSizeBytes)}` });

      // Weryfikacja lewego przycisku myszy (e.button === 0) zgodnie z AGENTS.md
      item.addEventListener("mousedown", (e: MouseEvent) => {
        if (e.button !== 0) return;
        void this.openMessage(headMsg);
      });

      item.addEventListener("contextmenu", (e: MouseEvent) => {
        this.openThreadContextMenu(e, headMsg);
      });
    }
  }

  private renderReaderPane(pane: HTMLElement): void {
    pane.empty();
    if (!this.selectedEmail) {
      const placeholder = pane.createDiv({ cls: "trinitec-mail-reader" });
      placeholder.createEl("h4", { text: "Podgląd wiadomości (nieinwazyjny BODY.PEEK)" });
      placeholder.createDiv({
        cls: "trinitec-mail-status-text",
        text: "Wybierz wątek z listy, aby odczytać wiadomość bez automatycznego zmieniania flagi „Przeczytane” na serwerze Roundcube. Zapis do Vaulta następuje wyłącznie po kliknięciu „Zapisz w Vaulcie (Opt-in)”.",
      });
      return;
    }

    const email = this.selectedEmail;
    const proposal = this.plugin.aiBridge.analyzeContent(
      email.subject,
      email.strippedMarkdownBody
    );

    const reader = pane.createDiv({ cls: "trinitec-mail-reader" });
    const head = reader.createDiv({ cls: "trinitec-mail-reader-head" });
    head.createEl("h3", { cls: "trinitec-mail-reader-title", text: email.subject });
    head.createDiv({
      cls: "trinitec-mail-status-text",
      text: `Od: ${email.fromRaw} · Do: ${email.toRaw} · ${email.date} · ${formatBytes(email.sizeBytes)} · Załączniki: ${email.attachments.length}`,
    });
    head.createDiv({
      cls: "trinitec-mail-status-text",
      text: `Sugestia AI (bez kluczy API): ${proposal.category} · Priorytet: ${proposal.priority} · Folder IMAP: ${proposal.suggestedImapFolder}`,
    });

    // Pasek akcji Opt-in, odpowiedzi i przełączania widoku
    const actions = head.createDiv({ cls: "trinitec-mail-actions-row" });

    const saveBtn = actions.createEl("button", {
      text: "Zapisz w Vaulcie (Opt-in)",
      cls: "mod-cta",
    });
    saveBtn.onclick = () => {
      const selectedText = window.getSelection()?.toString() || "";
      new SaveEmailModal(
        this.app,
        this.plugin.settings,
        this.plugin.projectMatcher,
        this.plugin.vaultWriter,
        this.plugin.mruStore,
        email,
        selectedText,
        proposal
      ).open();
    };

    const replyBtn = actions.createEl("button", { text: "Odpowiedz" });
    replyBtn.onclick = () => {
      new ComposeMailModal(
        this.app,
        this.plugin.smtpService,
        this.plugin.projectMatcher,
        this.plugin.mruStore,
        {
          to: email.fromEmail,
          subject: email.subject.startsWith("Re:") ? email.subject : `Re: ${email.subject}`,
          body: `\n\n--- Oryginalna wiadomość od ${email.fromName} (${email.date}) ---\n${email.strippedMarkdownBody}`,
          inReplyTo: email.messageId,
          references: [...(email.references || []), ...(email.messageId ? [email.messageId] : [])],
        }
      ).open();
    };

    if (email.uid && email.folder) {
      const seenBtn = actions.createEl("button", {
        text: email.seen ? "Oznacz nieprzeczytane" : "Oznacz przeczytane",
      });
      seenBtn.onclick = async () => {
        await this.plugin.imapService.setMessageFlag(
          email.folder!,
          email.uid!,
          "\\Seen",
          !email.seen
        );
        email.seen = !email.seen;
        await this.refreshFolder();
      };

      const aiMoveBtn = actions.createEl("button", {
        text: `Przenieś wg AI → ${proposal.suggestedImapFolder}`,
      });
      aiMoveBtn.onclick = async () => {
        await this.plugin.aiBridge.applyProposalToImapMessage(
          this.plugin.imapService,
          email,
          proposal,
          true
        );
        this.selectedEmail = null;
        this.selectedUid = null;
        await this.refreshFolder();
      };
    }

    // Przełącznik HTML Sandbox / Markdown
    const modeToggle = actions.createEl("button", {
      text: this.renderMode === "html" ? "Pokaż Markdown" : "Pokaż HTML Sandbox",
    });
    modeToggle.onclick = () => {
      this.renderMode = this.renderMode === "html" ? "markdown" : "html";
      this.render();
    };

    if (this.renderMode === "markdown") {
      const stripBtn = actions.createEl("button", {
        text: this.showStrippedMarkdown ? "Pokaż pełne cytaty" : "Oczyść cytaty (Quote-Strip)",
      });
      stripBtn.onclick = () => {
        this.showStrippedMarkdown = !this.showStrippedMarkdown;
        this.render();
      };
    }

    // Treść wiadomości: Sandboxowany HTML z blokadą pikseli LUB czysty Markdown
    if (this.renderMode === "html" && email.htmlBody) {
      const blockRemote =
        this.plugin.settings.blockRemoteImagesByDefault && !this.allowRemoteImagesForCurrent;
      const sanitized = sanitizeHtmlForSandbox(email.htmlBody, blockRemote);

      if (sanitized.blockedRemoteImagesCount > 0) {
        const banner = reader.createDiv({ cls: "trinitec-mail-banner-warn" });
        banner.createSpan({
          text: `Zablokowano ${sanitized.blockedRemoteImagesCount} zdalnych obrazków (ochrona przed pikselami śledzącymi).`,
        });
        const allowBtn = banner.createEl("button", { text: "Pokaż obrazy dla tej wiadomości" });
        allowBtn.onclick = () => {
          this.allowRemoteImagesForCurrent = true;
          this.render();
        };
      }

      const iframe = reader.createEl("iframe", { cls: "trinitec-mail-html-frame" });
      iframe.setAttr("sandbox", "allow-same-origin");
      iframe.srcdoc = sanitized.html;
    } else {
      const bodyText = this.showStrippedMarkdown
        ? email.strippedMarkdownBody
        : email.markdownBody;
      reader.createDiv({
        cls: "trinitec-mail-markdown-preview",
        text: bodyText,
      });
    }

    if (email.attachments.length > 0) {
      reader.createEl("h4", { text: `Załączniki (${email.attachments.length})` });
      const attRow = reader.createDiv({ cls: "trinitec-mail-actions-row" });
      for (const att of email.attachments) {
        const btn = attRow.createEl("button", {
          text: `Zapisz: ${att.filename} (${formatBytes(att.size)})`,
        });
        btn.onclick = async () => {
          const matched = this.plugin.projectMatcher.matchEmailToVault(email);
          const stored = await this.plugin.vaultWriter.saveAttachmentOnlyToProject(
            att,
            matched.project
          );
          new Notice(`Zapisano załącznik: ${stored}`);
        };
      }
    }
  }
}
