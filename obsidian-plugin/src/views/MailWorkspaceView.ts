import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import {
  EmailThreadGroup,
  ImapFolderSummary,
  ImapMessageHeader,
  ParsedEmailMessage,
} from "../types";
import { groupHeadersIntoThreads } from "../services/mailParserService";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import { ComposeMailModal } from "../modals/ComposeMailModal";
import type TrinitecMailPlugin from "../main";
import { renderFolderPane } from "./mailWorkspace/FolderPane";
import { renderThreadListPane } from "./mailWorkspace/ThreadListPane";
import {
  renderMessageReaderPane,
  type ReaderRenderMode,
  type ReplyComposeMode,
} from "./mailWorkspace/MessageReaderPane";

export const VIEW_TYPE_TRINITEC_MAIL = "trinitec-mail-workspace";

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
  private offlineMode = false;
  private isClosed = false;
  private requestEpoch = 0;

  private activeContextMenu: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.currentFolder = plugin.settings.inboxFolder || "INBOX";
  }

  getViewType(): string {
    return VIEW_TYPE_TRINITEC_MAIL;
  }

  getDisplayText(): string {
    return "Thunder Look (IMAP)";
  }

  getIcon(): string {
    return "mail";
  }

  async onOpen(): Promise<void> {
    this.isClosed = false;
    this.registerDomEvent(window, "click", () => this.closeContextMenu());
    this.render();

    // Natychmiastowe wczytanie cache z IndexedDB (poza OneDrive)
    const [cachedFolders, cachedHeaders] = await Promise.all([
      this.plugin.cacheService.getFolderList(),
      this.plugin.cacheService.getFolderHeaders(this.currentFolder),
    ]);
    if (this.isClosed) return;
    if (cachedFolders && cachedFolders.length > 0) {
      this.folders = cachedFolders;
    }
    if (cachedHeaders && cachedHeaders.length > 0) {
      this.headers = cachedHeaders;
      this.threads = groupHeadersIntoThreads(cachedHeaders);
    }
    this.render();
  }

  async onClose(): Promise<void> {
    this.isClosed = true;
    this.requestEpoch++;
    this.closeContextMenu();
    this.selectedEmail = null;
    this.contentEl.empty();
  }

  async refreshFolder(folder = this.currentFolder): Promise<void> {
    if (this.isClosed) return;
    const epoch = ++this.requestEpoch;
    this.loading = true;
    this.plugin.updateRuntimeStatus({ state: "syncing" });
    this.render();

    try {
      const prevFolder = this.currentFolder;
      const folderRes = await this.plugin.imapService.listFolders(true);
      if (this.isClosed || epoch !== this.requestEpoch) return;

      this.folders = folderRes.folders;
      const folderStillExists = this.folders.some((f) => f.path === folder);
      this.currentFolder = folderStillExists
        ? folder
        : this.folders.some((f) => f.path === prevFolder)
        ? prevFolder
        : this.folders[0]?.path || "INBOX";

      const msgRes = await this.plugin.imapService.listMessagesWithMeta(
        this.currentFolder,
        60,
        false
      );
      if (this.isClosed || epoch !== this.requestEpoch) return;

      this.headers = msgRes.headers;
      this.threads = groupHeadersIntoThreads(this.headers);
      this.offlineMode = folderRes.fromCache || msgRes.fromCache;

      const inboxSummary = this.folders.find(
        (f) => f.path.toLowerCase() === (this.plugin.settings.inboxFolder || "INBOX").toLowerCase()
      );
      const unreadCount =
        inboxSummary?.unseen ?? this.headers.filter((h) => !h.seen).length;

      this.plugin.updateRuntimeStatus({
        state: this.offlineMode ? "offline" : "connected",
        lastSyncAt: this.offlineMode ? this.plugin.runtimeStatus.lastSyncAt : new Date(),
        unreadCount,
        lastError: this.offlineMode ? "Tryb offline (dane z lokalnego cache)" : null,
      });

      if (this.offlineMode) {
        new Notice("Brak połączenia z serwerem IMAP — wyświetlono zapisany cache offline.");
      }
    } catch (err) {
      if (this.isClosed || epoch !== this.requestEpoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.offlineMode = true;
      this.plugin.updateRuntimeStatus({ state: "error", lastError: msg });
      new Notice(`Błąd połączenia IMAP: ${msg}`);
    } finally {
      if (!this.isClosed && epoch === this.requestEpoch) {
        this.loading = false;
        this.render();
      }
    }
  }

  private async openMessage(header: ImapMessageHeader): Promise<void> {
    if (this.isClosed) return;
    const epoch = ++this.requestEpoch;
    this.selectedUid = header.uid;
    this.allowRemoteImagesForCurrent = false;
    this.render();

    try {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid);
      if (this.isClosed || epoch !== this.requestEpoch) return;
      this.selectedEmail = full;
      this.renderMode = full.htmlBody ? "html" : "markdown";
      this.render();
    } catch (err) {
      if (!this.isClosed) {
        new Notice(`Nie udało się pobrać wiadomości: ${(err as Error).message}`);
      }
    }
  }

  private openComposeForMessage(email: ParsedEmailMessage, mode: ReplyComposeMode): void {
    const myEmail = this.plugin.settings.imapUser.trim().toLowerCase();
    const signatureBlock = this.plugin.settings.emailSignature.trim()
      ? `\n\n-- \n${this.plugin.settings.emailSignature.trim()}`
      : "";

    const quotedBody = `\n\n--- Oryginalna wiadomość od ${email.fromName} (${email.date}) ---\n${email.strippedMarkdownBody}`;

    if (mode === "forward") {
      new ComposeMailModal(
        this.app,
        this.plugin.settings,
        this.plugin.smtpService,
        this.plugin.projectMatcher,
        this.plugin.mruStore,
        {
          subject: /^fwd?:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`,
          body: `${signatureBlock}\n\n---------- Przekazana wiadomość ----------\nOd: ${email.fromRaw}\nData: ${email.date}\nTemat: ${email.subject}\nDo: ${email.toRaw}\n\n${email.markdownBody}`,
        }
      ).open();
      return;
    }

    const replyTarget = email.replyToRaw || email.fromEmail;
    let ccList = "";
    if (mode === "reply-all") {
      const allRecipients = `${email.toRaw}, ${email.ccRaw || ""}`
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((addr) => {
          const lower = addr.toLowerCase();
          return (
            (!myEmail || !lower.includes(myEmail)) &&
            !lower.includes(replyTarget.toLowerCase())
          );
        });
      ccList = Array.from(new Set(allRecipients)).join(", ");
    }

    new ComposeMailModal(
      this.app,
      this.plugin.settings,
      this.plugin.smtpService,
      this.plugin.projectMatcher,
      this.plugin.mruStore,
      {
        to: replyTarget,
        cc: ccList,
        subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
        body: `${signatureBlock}${quotedBody}`,
        inReplyTo: email.messageId,
        references: [...(email.references || []), ...(email.messageId ? [email.messageId] : [])],
      }
    ).open();
  }

  private closeContextMenu(): void {
    if (this.activeContextMenu) {
      this.activeContextMenu.remove();
      this.activeContextMenu = null;
    }
  }

  private openThreadContextMenu(evt: MouseEvent, header: ImapMessageHeader): void {
    evt.preventDefault();
    evt.stopPropagation();
    this.closeContextMenu();

    const menu = document.body.createDiv({ cls: "tl-context-menu" });
    this.activeContextMenu = menu;

    const addItem = (label: string, onClick: () => void) => {
      const btn = menu.createEl("button", {
        text: label,
        type: "button",
        cls: "tl-context-item",
      });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeContextMenu();
        onClick();
      });
    };

    addItem("Zapisz w Vaulcie (Opt-in)...", async () => {
      try {
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
      } catch (err) {
        new Notice(`Nie udało się wczytać wiadomości: ${(err as Error).message}`);
      }
    });

    if (!this.offlineMode) {
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
    }

    // Viewport clamping — menu nigdy nie wyjdzie poza ekran
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
    const root = container.createDiv({ cls: "tl-workspace" });

    // Pasek narzędzi
    const topbar = root.createDiv({ cls: "tl-topbar" });
    const leftTools = topbar.createDiv({ cls: "tl-topbar-group" });

    const refreshBtn = leftTools.createEl("button", {
      text: this.loading ? "Synchronizacja..." : "Odśwież IMAP",
      type: "button",
      cls: "mod-cta",
    });
    refreshBtn.disabled = this.loading;
    refreshBtn.addEventListener("click", () => {
      void this.refreshFolder();
    });

    const composeBtn = leftTools.createEl("button", { text: "Nowy e-mail", type: "button" });
    composeBtn.addEventListener("click", () => {
      const signature = this.plugin.settings.emailSignature.trim()
        ? `\n\n-- \n${this.plugin.settings.emailSignature.trim()}`
        : "";
      new ComposeMailModal(
        this.app,
        this.plugin.settings,
        this.plugin.smtpService,
        this.plugin.projectMatcher,
        this.plugin.mruStore,
        { body: signature }
      ).open();
    });

    const quotaBtn = leftTools.createEl("button", { text: "Rozmiar skrzynki", type: "button" });
    quotaBtn.addEventListener("click", () => {
      void this.plugin.activateStorageView();
    });

    const rightTools = topbar.createDiv({ cls: "tl-topbar-group" });
    const searchInput = rightTools.createEl("input", {
      type: "search",
      placeholder: "Filtruj temat, nadawcę lub kod YY-XXX...",
    });
    searchInput.value = this.filterQuery;

    if (this.offlineMode) {
      const offlineBanner = root.createDiv({ cls: "tl-banner-warn tl-offline-banner" });
      offlineBanner.createSpan({
        text: "Tryb offline — przeglądasz lokalnie zapisane nagłówki i treści z cache IndexedDB.",
      });
      const retryBtn = offlineBanner.createEl("button", {
        text: "Połącz ponownie",
        type: "button",
      });
      retryBtn.addEventListener("click", () => {
        void this.refreshFolder();
      });
    }

    const threePane = root.createDiv({ cls: "tl-three-pane" });

    const foldersPane = threePane.createDiv({ cls: "tl-pane" });
    renderFolderPane({
      pane: foldersPane,
      folders: this.folders,
      currentFolder: this.currentFolder,
      headerCount: this.headers.length,
      onSelectFolder: (folderPath) => {
        void this.refreshFolder(folderPath);
      },
    });

    const threadsPane = threePane.createDiv({ cls: "tl-pane" });
    const renderThreads = () => {
      renderThreadListPane({
        pane: threadsPane,
        currentFolder: this.currentFolder,
        threads: this.threads,
        filterQuery: this.filterQuery,
        selectedUid: this.selectedUid,
        onSelectMessage: (header) => {
          void this.openMessage(header);
        },
        onOpenContextMenu: (evt, header) => this.openThreadContextMenu(evt, header),
      });
    };
    renderThreads();

    searchInput.addEventListener("input", () => {
      this.filterQuery = searchInput.value;
      renderThreads();
    });

    const readerPane = threePane.createDiv({ cls: "tl-pane" });
    renderMessageReaderPane({
      pane: readerPane,
      plugin: this.plugin,
      selectedEmail: this.selectedEmail,
      renderMode: this.renderMode,
      allowRemoteImages: this.allowRemoteImagesForCurrent,
      showStrippedMarkdown: this.showStrippedMarkdown,
      offlineMode: this.offlineMode,
      onSaveOptIn: (email, proposal) => {
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
      },
      onComposeAction: (email, mode) => this.openComposeForMessage(email, mode),
      onToggleSeen: async (email) => {
        if (!email.folder || !email.uid) return;
        await this.plugin.imapService.setMessageFlag(email.folder, email.uid, "\\Seen", !email.seen);
        email.seen = !email.seen;
        await this.refreshFolder();
      },
      onApplyAiMove: async (email, proposal) => {
        await this.plugin.aiBridge.applyProposalToImapMessage(
          this.plugin.imapService,
          email,
          proposal,
          true
        );
        this.selectedEmail = null;
        this.selectedUid = null;
        await this.refreshFolder();
      },
      onToggleRenderMode: () => {
        this.renderMode = this.renderMode === "html" ? "markdown" : "html";
        this.render();
      },
      onToggleStripped: () => {
        this.showStrippedMarkdown = !this.showStrippedMarkdown;
        this.render();
      },
      onAllowRemoteImages: () => {
        this.allowRemoteImagesForCurrent = true;
        this.render();
      },
    });
  }
}
