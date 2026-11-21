import { ItemView, Modal, Notice, WorkspaceLeaf, setIcon } from "obsidian";
import { detectFolderRole, isSystemFolder } from "../../../shared/folderMapper";
import {
  EmailThreadGroup,
  ImapFolderSummary,
  ImapMessageHeader,
  ParsedAttachment,
  ParsedEmailMessage,
  ReaderViewTheme,
} from "../types";
import { groupHeadersIntoThreads } from "../services/mailParserService";
import type { IdleNewMailEvent } from "../services/imapService";
import { SaveEmailModal } from "../modals/SaveEmailModal";
import { ComposeMailModal } from "../modals/ComposeMailModal";
import { MoveToFolderModal } from "../modals/MoveToFolderModal";
import { AttachmentPreviewModal } from "../modals/AttachmentPreviewModal";
import { ConfirmModal, FolderNamePromptModal } from "../modals/ConfirmModal";
import { ShortcutsHelpModal } from "../modals/ShortcutsHelpModal";
import type TrinitecMailPlugin from "../main";
import {
  renderFolderPane,
  UNIFIED_INBOX_PATH,
  type DroppedMailPayload,
} from "./mailWorkspace/FolderPane";
import {
  buildVisibleListRows,
  renderThreadListPane,
  type ListQuickFilters,
  type ListRowItem,
  type SearchScope,
} from "./mailWorkspace/ThreadListPane";
import {
  disposeReaderIframes,
  renderMessageReaderPane,
  type ReplyComposeMode,
} from "./mailWorkspace/MessageReaderPane";

export const VIEW_TYPE_TRINITEC_MAIL = "trinitec-mail-workspace";

const SPLIT_STORAGE_KEY = "thunder-look-splitter-sizes-v1";

interface SplitterSizes {
  folderWidth: number;
  listWidth: number;
  classicListHeightPct: number;
}

const DEFAULT_SPLIT_SIZES: SplitterSizes = {
  folderWidth: 230,
  listWidth: 360,
  classicListHeightPct: 44,
};

interface UndoToastState {
  message: string;
  undo: () => Promise<void>;
  timerId: number;
}

class RawSourceModal extends Modal {
  private titleText: string;
  private rawText: string;

  constructor(app: ItemView["app"], titleText: string, rawText: string) {
    super(app);
    this.titleText = titleText;
    this.rawText = rawText;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("tl-raw-source-modal");
    contentEl.createEl("h3", { text: `Źródło EML — ${this.titleText}` });
    const pre = contentEl.createEl("pre", { cls: "tl-attachment-preview-text" });
    pre.setText(this.rawText.slice(0, 120_000));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class MailWorkspaceView extends ItemView {
  private plugin: TrinitecMailPlugin;
  private activeAccountId: string;
  private unifiedInboxActive = false;
  private currentFolder: string;

  private folders: ImapFolderSummary[] = [];
  private headers: ImapMessageHeader[] = [];
  private threads: EmailThreadGroup[] = [];
  private totalOnServer = 0;
  private hasMorePages = false;
  private loadingMore = false;

  private selectedRowKey: string | null = null;
  private selectedHeader: ImapMessageHeader | null = null;
  private selectedThreadMessages: ImapMessageHeader[] = [];
  private selectedEmail: ParsedEmailMessage | null = null;
  private expandedThreadEmails = new Map<number, ParsedEmailMessage>();
  private loadingMessage = false;

  private selectedUids = new Set<string>();
  private lastCheckedIndex: number | null = null;

  private collapsedFolderPaths = new Set<string>();
  private allowRemoteImagesForCurrent = false;
  private showStrippedMarkdown = true;
  private showMessageDetails = false;
  private aiBarCollapsed = false;

  private filterQuery = "";
  private searchScope: SearchScope = "folder";
  private serverSearchActive = false;
  private serverSearchResults: ImapMessageHeader[] = [];
  private quickFilters: ListQuickFilters = {
    unreadOnly: false,
    starredOnly: false,
    hasAttachmentOnly: false,
    daysWindow: 0,
  };

  private syncingFolders = false;
  private syncingList = false;
  private offlineMode = false;
  private isClosed = false;

  private folderEpoch = 0;
  private messageLoadSeq = 0;
  private folderAbort: AbortController | null = null;
  private messageAbort: AbortController | null = null;
  private autoMarkReadTimer: number | null = null;
  private prefetchDebounceTimer: number | null = null;

  private accountUnreadMap = new Map<string, number>();
  private accountErrorMap = new Map<string, string>();

  private undoToast: UndoToastState | null = null;
  private activeContextMenu: HTMLElement | null = null;
  private splitSizes: SplitterSizes = { ...DEFAULT_SPLIT_SIZES };

  // Referencje do paneli (częściowe renderowanie bez migotania całej aplikacji)
  private accountTabsEl: HTMLElement | null = null;
  private foldersPaneEl: HTMLElement | null = null;
  private threadsPaneEl: HTMLElement | null = null;
  private readerPaneEl: HTMLElement | null = null;
  private undoSlotEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: TrinitecMailPlugin) {
    super(leaf);
    this.plugin = plugin;
    this.activeAccountId = plugin.settings.activeAccountId || plugin.settings.accounts[0]?.id || "default";
    this.unifiedInboxActive = Boolean(
      plugin.settings.unifiedInboxEnabled && plugin.settings.accounts.filter((a) => a.enabled).length > 1
    );
    const activeAcc = plugin.imapService.resolveAccount(this.activeAccountId);
    this.currentFolder = this.unifiedInboxActive
      ? UNIFIED_INBOX_PATH
      : activeAcc.inboxFolder || "INBOX";
    this.loadSplitterSizes();
  }

  getViewType(): string {
    return VIEW_TYPE_TRINITEC_MAIL;
  }

  getDisplayText(): string {
    return "Thunder Look";
  }

  getIcon(): string {
    return "mail";
  }

  private loadSplitterSizes(): void {
    try {
      const raw = window.localStorage.getItem(SPLIT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SplitterSizes>;
      if (typeof parsed.folderWidth === "number") {
        this.splitSizes.folderWidth = Math.max(160, Math.min(420, parsed.folderWidth));
      }
      if (typeof parsed.listWidth === "number") {
        this.splitSizes.listWidth = Math.max(240, Math.min(620, parsed.listWidth));
      }
      if (typeof parsed.classicListHeightPct === "number") {
        this.splitSizes.classicListHeightPct = Math.max(22, Math.min(72, parsed.classicListHeightPct));
      }
    } catch {
      // ignore
    }
  }

  private saveSplitterSizes(): void {
    try {
      window.localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(this.splitSizes));
    } catch {
      // ignore
    }
  }

  private hasConfiguredAccount(): boolean {
    return this.plugin.settings.accounts.some(
      (a) => a.enabled && a.imapHost.trim().length > 0 && a.imapUser.trim().length > 0
    );
  }

  private openPluginSettings(): void {
    const settingApi = (
      this.app as unknown as {
        setting?: { open?: () => void; openTabById?: (id: string) => void };
      }
    ).setting;
    settingApi?.open?.();
    settingApi?.openTabById?.("thunder-look");
  }

  private renderWelcomeScreen(): void {
    const container = this.contentEl;
    disposeReaderIframes(container);
    container.empty();
    const wrap = container.createDiv({ cls: "tl-welcome-screen" });
    const card = wrap.createDiv({ cls: "tl-welcome-card" });
    const icon = card.createDiv({ cls: "tl-welcome-icon" });
    setIcon(icon, "mail");
    card.createEl("h2", { text: "Witaj w Thunder Look" });
    card.createEl("p", {
      cls: "tl-muted-sm",
      text: "Podłącz swoją pierwszą skrzynkę IMAP/SMTP (Gmail, Outlook, Roundcube lub własny serwer), aby przeglądać pocztę i zapisywać wybrane maile jako notatki w Vaulcie.",
    });
    const cta = card.createEl("button", {
      type: "button",
      cls: "mod-cta tl-welcome-cta",
      text: "Skonfiguruj pierwsze konto pocztowe",
    });
    cta.addEventListener("click", () => this.openPluginSettings());
  }

  private syncUnreadCountFromFolders(accountId: string, folders: ImapFolderSummary[]): void {
    const inbox = folders.find((f) => detectFolderRole(f.path, f.specialUse) === "inbox");
    if (inbox) {
      this.accountUnreadMap.set(accountId, inbox.unseen || 0);
    }
  }

  private async preloadAllAccountsUnreadFromCache(): Promise<void> {
    const enabled = this.plugin.settings.accounts.filter((a) => a.enabled);
    await Promise.all(
      enabled.map(async (acc) => {
        const cached = await this.plugin.cacheService.getFolderList(acc.id);
        if (cached && cached.length > 0) {
          this.syncUnreadCountFromFolders(acc.id, cached);
        }
      })
    );
  }

  async onOpen(): Promise<void> {
    this.isClosed = false;
    this.registerDomEvent(window, "click", () => this.closeContextMenu());
    this.registerDomEvent(this.contentEl, "keydown", (e: KeyboardEvent) =>
      this.handleWorkspaceKeydown(e)
    );
    this.contentEl.tabIndex = 0;

    if (!this.hasConfiguredAccount()) {
      this.renderWelcomeScreen();
      return;
    }

    this.renderShell();

    // Natychmiastowe wczytanie z L1/L2 cache (<10 ms), a potem ciche odświeżenie w tle (stale-while-revalidate)
    const [cachedFolders, cachedRec] = await Promise.all([
      this.plugin.cacheService.getFolderList(this.activeAccountId),
      this.unifiedInboxActive
        ? Promise.resolve(null)
        : this.plugin.cacheService.getFolderRecord(this.currentFolder, this.activeAccountId),
      this.preloadAllAccountsUnreadFromCache(),
    ]);
    if (this.isClosed) return;

    if (cachedFolders && cachedFolders.length > 0) {
      this.folders = cachedFolders;
      this.syncUnreadCountFromFolders(this.activeAccountId, cachedFolders);
    }
    if (cachedRec && cachedRec.headers.length > 0) {
      this.headers = cachedRec.headers;
      this.threads = groupHeadersIntoThreads(this.headers);
      this.totalOnServer = cachedRec.totalOnServer ?? this.headers.length;
      this.hasMorePages = this.totalOnServer > 0 && this.headers.length < this.totalOnServer;
    }
    this.renderAllPanes();

    // Cicha synchronizacja w tle (bez blokowania widoku z cache)
    const activeAcc = this.plugin.imapService.resolveAccount(this.activeAccountId);
    if (activeAcc.imapHost && activeAcc.imapUser) {
      void this.refreshFolder(this.currentFolder, { background: true });
    }
  }

  async onClose(): Promise<void> {
    this.isClosed = true;
    this.folderEpoch++;
    this.messageLoadSeq++;
    this.folderAbort?.abort();
    this.messageAbort?.abort();
    this.clearPrefetchDebounceTimer();
    this.plugin.imapService.abortPrefetch();
    this.clearAutoMarkReadTimer();
    this.clearUndoToast();
    this.closeContextMenu();
    disposeReaderIframes(this.readerPaneEl);
    this.selectedHeader = null;
    this.selectedEmail = null;
    this.expandedThreadEmails.clear();
    this.contentEl.empty();
  }

  private clearAutoMarkReadTimer(): void {
    if (this.autoMarkReadTimer !== null) {
      window.clearTimeout(this.autoMarkReadTimer);
      this.autoMarkReadTimer = null;
    }
  }

  private clearPrefetchDebounceTimer(): void {
    if (this.prefetchDebounceTimer !== null) {
      window.clearTimeout(this.prefetchDebounceTimer);
      this.prefetchDebounceTimer = null;
    }
  }

  private resetReaderSelection(): void {
    this.messageLoadSeq++;
    this.messageAbort?.abort();
    this.messageAbort = null;
    this.clearPrefetchDebounceTimer();
    this.clearAutoMarkReadTimer();
    this.plugin.imapService.abortPrefetch();
    this.selectedRowKey = null;
    this.selectedHeader = null;
    this.selectedEmail = null;
    this.selectedThreadMessages = [];
    this.expandedThreadEmails.clear();
    this.loadingMessage = false;
    this.allowRemoteImagesForCurrent = false;
    this.showMessageDetails = false;
    disposeReaderIframes(this.readerPaneEl);
    this.renderReaderPane();
  }

  private clearUndoToast(): void {
    if (this.undoToast) {
      window.clearTimeout(this.undoToast.timerId);
      this.undoToast = null;
      this.renderUndoToast();
    }
  }

  private showUndoToast(message: string, undo: () => Promise<void>): void {
    this.clearUndoToast();
    const timerId = window.setTimeout(() => {
      this.undoToast = null;
      this.renderUndoToast();
    }, 5000);
    this.undoToast = { message, undo, timerId };
    this.renderUndoToast();
  }

  private renderUndoToast(): void {
    if (!this.undoSlotEl) return;
    this.undoSlotEl.empty();
    if (!this.undoToast) return;

    const toast = this.undoSlotEl.createDiv({ cls: "tl-undo-toast" });
    toast.createSpan({ text: this.undoToast.message });
    const undoBtn = toast.createEl("button", {
      type: "button",
      cls: "mod-cta tl-undo-btn",
      text: "Cofnij",
    });
    const fn = this.undoToast.undo;
    undoBtn.addEventListener("click", async () => {
      this.clearUndoToast();
      try {
        await fn();
        new Notice("Cofnięto operację.");
      } catch (err) {
        new Notice(`Nie udało się cofnąć: ${(err as Error).message}`);
      }
    });
  }

  /**
   * Wywoływane z main.ts przy nadejściu nowej wiadomości przez IMAP IDLE —
   * wstrzykuje nowe nagłówki na górę listy bez przerywania czytanej wiadomości!
   */
  handleIncomingIdleEvent(event: IdleNewMailEvent): void {
    if (this.isClosed) return;
    const matchesCurrent =
      (this.unifiedInboxActive && detectFolderRole(event.folder) === "inbox") ||
      (event.accountId === this.activeAccountId && event.folder === this.currentFolder);

    if (matchesCurrent && event.newHeaders.length > 0 && !this.serverSearchActive) {
      const byKey = new Map<string, ImapMessageHeader>();
      for (const h of event.newHeaders) {
        byKey.set(`${h.accountId || "default"}::${h.folder}::${h.uid}`, h);
      }
      for (const h of this.headers) {
        const k = `${h.accountId || "default"}::${h.folder}::${h.uid}`;
        if (!byKey.has(k)) byKey.set(k, h);
      }
      this.headers = Array.from(byKey.values());
      this.threads = groupHeadersIntoThreads(this.headers);
      this.totalOnServer = Math.max(this.totalOnServer + event.newHeaders.length, this.headers.length);
      this.renderThreadsPane();
    }

    // Zaktualizuj licznik nieprzeczytanych w folderach i na górnych zakładkach skrzynek
    if (detectFolderRole(event.folder) === "inbox") {
      const prev = this.accountUnreadMap.get(event.accountId) ?? 0;
      this.accountUnreadMap.set(
        event.accountId,
        event.totalUnseen || prev + event.newHeaders.length
      );
      this.renderAccountTabs();
    }
    if (event.accountId === this.activeAccountId) {
      this.folders = this.folders.map((f) =>
        f.path === event.folder
          ? {
              ...f,
              messages: f.messages + event.newHeaders.length,
              unseen: event.totalUnseen || f.unseen + event.newHeaders.length,
            }
          : f
      );
      this.renderFoldersPane();
    }
  }

  /**
   * Otwiera konkretną wiadomość (np. po kliknięciu powiadomienia systemowego).
   */
  async openSpecificMessage(accountId: string, folder: string, uid: number): Promise<void> {
    if (this.isClosed) return;
    this.unifiedInboxActive = false;
    this.activeAccountId = accountId;
    this.currentFolder = folder;
    await this.refreshFolder(folder, { background: true });
    const header = this.headers.find((h) => h.uid === uid && h.folder === folder);
    if (header) {
      await this.openMessage(header, [header], `${accountId}::${folder}::${uid}`);
    } else {
      const full = await this.plugin.imapService.fetchFullMessage(folder, uid, { accountId });
      this.selectedEmail = full;
      this.renderReaderPane();
    }
  }

  // ============================================================================
  // Przełączanie folderów i kont (Stale-While-Revalidate + AbortController)
  // ============================================================================

  async switchFolderInstant(folderPath: string): Promise<void> {
    if (this.isClosed) return;
    this.resetReaderSelection();
    this.unifiedInboxActive = false;
    this.currentFolder = folderPath;
    this.serverSearchActive = false;
    this.serverSearchResults = [];
    this.selectedUids.clear();
    this.lastCheckedIndex = null;

    // 1. Natychmiastowe (<5 ms) wyświetlenie z L1 RAM cache!
    const ramRec = this.plugin.cacheService.getFolderRecordSync(folderPath, this.activeAccountId);
    if (ramRec) {
      this.headers = ramRec.headers;
      this.threads = groupHeadersIntoThreads(this.headers);
      this.totalOnServer = ramRec.totalOnServer ?? this.headers.length;
      this.hasMorePages = this.totalOnServer > 0 && this.headers.length < this.totalOnServer;
      this.renderAccountTabs();
      this.renderFoldersPane();
      this.renderThreadsPane();
    } else {
      // Spróbuj L2 IndexedDB zanim ruszy sieć
      const dbRec = await this.plugin.cacheService.getFolderRecord(folderPath, this.activeAccountId);
      if (this.isClosed || this.currentFolder !== folderPath) return;
      this.headers = dbRec?.headers || [];
      this.threads = groupHeadersIntoThreads(this.headers);
      this.totalOnServer = dbRec?.totalOnServer ?? this.headers.length;
      this.hasMorePages = this.totalOnServer > 0 && this.headers.length < this.totalOnServer;
      this.renderAccountTabs();
      this.renderFoldersPane();
      this.renderThreadsPane();
    }

    // 2. Delta sync w tle na trwałej sesji IMAP
    void this.refreshFolder(folderPath, { background: true, skipFolderList: true });
  }

  async switchAccount(accountId: string): Promise<void> {
    if (this.isClosed) return;
    this.resetReaderSelection();
    this.unifiedInboxActive = false;
    this.activeAccountId = accountId;
    this.plugin.settings.activeAccountId = accountId;
    this.plugin.settings.unifiedInboxEnabled = false;
    const acc = this.plugin.imapService.resolveAccount(accountId);
    this.currentFolder = acc.inboxFolder || "INBOX";
    this.selectedUids.clear();
    this.lastCheckedIndex = null;
    this.serverSearchActive = false;
    this.serverSearchResults = [];

    const cachedFolders = await this.plugin.cacheService.getFolderList(accountId);
    if (this.isClosed || this.activeAccountId !== accountId) return;
    this.folders = cachedFolders || [];
    if (cachedFolders) this.syncUnreadCountFromFolders(accountId, cachedFolders);

    const cachedRec = await this.plugin.cacheService.getFolderRecord(this.currentFolder, accountId);
    if (this.isClosed || this.activeAccountId !== accountId) return;
    this.headers = cachedRec?.headers || [];
    this.threads = groupHeadersIntoThreads(this.headers);
    this.totalOnServer = cachedRec?.totalOnServer ?? this.headers.length;
    this.hasMorePages = this.totalOnServer > 0 && this.headers.length < this.totalOnServer;
    this.renderAllPanes();

    void this.refreshFolder(this.currentFolder, { background: true });
  }

  async switchToUnifiedInbox(): Promise<void> {
    if (this.isClosed) return;
    this.resetReaderSelection();
    this.unifiedInboxActive = true;
    this.currentFolder = UNIFIED_INBOX_PATH;
    this.plugin.settings.unifiedInboxEnabled = true;
    this.selectedUids.clear();
    this.lastCheckedIndex = null;
    this.serverSearchActive = false;
    this.serverSearchResults = [];
    this.hasMorePages = false;
    this.renderAllPanes();
    await this.refreshFolder(UNIFIED_INBOX_PATH, { background: true });
  }

  async refreshFolder(
    folder = this.currentFolder,
    options?: { background?: boolean; skipFolderList?: boolean }
  ): Promise<void> {
    if (this.isClosed) return;
    this.folderAbort?.abort();
    const controller = new AbortController();
    this.folderAbort = controller;
    const epoch = ++this.folderEpoch;

    this.syncingList = true;
    if (!options?.skipFolderList) this.syncingFolders = true;
    this.plugin.updateRuntimeStatus({ state: "syncing" });
    this.renderFoldersPane();
    this.renderThreadsPane();

    try {
      if (this.unifiedInboxActive || folder === UNIFIED_INBOX_PATH) {
        const res = await this.plugin.imapService.listUnifiedInboxMessages(35);
        if (this.isClosed || epoch !== this.folderEpoch) return;
        this.headers = res.headers;
        this.threads = groupHeadersIntoThreads(this.headers);
        this.totalOnServer = this.headers.length;
        this.hasMorePages = false;
        this.offlineMode = false;
        if (res.errors.length > 0 && !options?.background) {
          new Notice(`Część kont zgłosiła błąd: ${res.errors[0]}`);
        }
        const unreadCount = this.headers.filter((h) => !h.seen).length;
        this.plugin.updateRuntimeStatus({
          state: "connected",
          lastSyncAt: new Date(),
          unreadCount,
          lastError: null,
        });
        return;
      }

      // Odśwież listę folderów tylko gdy potrzeba (nie przy każdym kliknięciu folderu)
      if (!options?.skipFolderList || this.folders.length === 0) {
        const folderRes = await this.plugin.imapService.listFolders(true, this.activeAccountId);
        if (this.isClosed || epoch !== this.folderEpoch) return;
        this.folders = folderRes.folders;
        this.syncUnreadCountFromFolders(this.activeAccountId, folderRes.folders);
        this.offlineMode = folderRes.fromCache;
        this.syncingFolders = false;
        this.renderAccountTabs();
        this.renderFoldersPane();
      }

      const page = await this.plugin.imapService.syncFolderDelta(folder, {
        pageSize: 50,
        accountId: this.activeAccountId,
        signal: controller.signal,
      });
      if (this.isClosed || epoch !== this.folderEpoch) return;

      this.headers = page.headers;
      this.threads = groupHeadersIntoThreads(this.headers);
      this.totalOnServer = page.totalOnServer;
      this.hasMorePages =
        page.hasMore && page.totalOnServer > 0 && this.headers.length < page.totalOnServer;
      this.offlineMode = page.fromCache;
      this.accountErrorMap.delete(this.activeAccountId);

      const inboxSummary = this.folders.find(
        (f) => detectFolderRole(f.path, f.specialUse) === "inbox"
      );
      const unreadCount = inboxSummary?.unseen ?? this.headers.filter((h) => !h.seen).length;
      if (detectFolderRole(folder) === "inbox") {
        this.accountUnreadMap.set(this.activeAccountId, unreadCount);
      }

      this.plugin.updateRuntimeStatus({
        state: this.offlineMode ? "offline" : "connected",
        lastSyncAt: this.offlineMode ? this.plugin.runtimeStatus.lastSyncAt : new Date(),
        unreadCount,
        lastError: this.offlineMode ? "Tryb offline (dane z lokalnego cache)" : null,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "ABORTED") return;
      if (this.isClosed || epoch !== this.folderEpoch) return;
      const msg = err instanceof Error ? err.message : String(err);
      this.offlineMode = true;
      this.accountErrorMap.set(this.activeAccountId, msg);
      this.plugin.updateRuntimeStatus({ state: "error", lastError: msg });
      if (!options?.background) {
        new Notice(`Błąd synchronizacji IMAP: ${msg}`);
      }
    } finally {
      if (!this.isClosed && epoch === this.folderEpoch) {
        this.syncingList = false;
        this.syncingFolders = false;
        this.renderAccountTabs();
        this.renderFoldersPane();
        this.renderThreadsPane();
      }
    }
  }

  private async loadMoreMessages(): Promise<void> {
    if (this.loadingMore || !this.hasMorePages || this.unifiedInboxActive) return;
    const oldest = this.headers[this.headers.length - 1];
    if (!oldest) return;

    const epoch = this.folderEpoch;
    const prevLen = this.headers.length;
    this.loadingMore = true;
    this.renderThreadsPane();
    try {
      const page = await this.plugin.imapService.listMessagesPage(this.currentFolder, {
        pageSize: 50,
        beforeUid: oldest.uid,
        accountId: this.activeAccountId,
      });
      if (this.isClosed || epoch !== this.folderEpoch) return;
      this.headers = page.headers;
      this.threads = groupHeadersIntoThreads(this.headers);
      this.totalOnServer = page.totalOnServer;
      this.hasMorePages =
        page.hasMore &&
        page.headers.length > prevLen &&
        page.totalOnServer > 0 &&
        page.headers.length < page.totalOnServer;
    } catch (err) {
      new Notice(`Nie udało się załadować starszych wiadomości: ${(err as Error).message}`);
    } finally {
      if (!this.isClosed) {
        this.loadingMore = false;
        this.renderThreadsPane();
      }
    }
  }

  // ============================================================================
  // Otwieranie wiadomości, Prefetch sąsiadów, Rozwijanie wątku, Auto-Mark-Read
  // ============================================================================

  private getVisibleRows(): ListRowItem[] {
    const sourceHeaders = this.serverSearchActive ? this.serverSearchResults : this.headers;
    const sourceThreads = this.serverSearchActive
      ? groupHeadersIntoThreads(this.serverSearchResults)
      : this.threads;
    return buildVisibleListRows({
      headers: sourceHeaders,
      threads: sourceThreads,
      listMode: this.plugin.settings.messageListMode || "threads",
      filterQuery: this.filterQuery,
      serverSearchActive: this.serverSearchActive,
      quickFilters: this.quickFilters,
    });
  }

  private async openMessage(
    header: ImapMessageHeader,
    threadMessages: ImapMessageHeader[],
    rowKey: string
  ): Promise<void> {
    if (this.isClosed) return;

    // 0 ms: przerwij poprzednie pobieranie i prefetch, natychmiast zaktualizuj zaznaczenie i wyczyść stary mail/iframe
    const seq = ++this.messageLoadSeq;
    this.messageAbort?.abort();
    const controller = new AbortController();
    this.messageAbort = controller;
    this.clearAutoMarkReadTimer();
    this.clearPrefetchDebounceTimer();

    const accId = header.accountId || this.activeAccountId;
    this.plugin.imapService.abortPrefetch(accId);

    this.selectedRowKey = rowKey;
    this.selectedHeader = header;
    this.selectedEmail = null;
    this.selectedThreadMessages = threadMessages;
    this.expandedThreadEmails.clear();
    this.allowRemoteImagesForCurrent = false;
    this.showMessageDetails = false;

    // 1. Natychmiastowe synchroniczne wyświetlenie z L1 RAM cache (0 ms, bez sieci)
    const cachedRam = this.plugin.cacheService.getCachedMessageSync(header.folder, header.uid, accId);
    if (cachedRam) {
      this.selectedEmail = cachedRam;
      this.loadingMessage = false;
      this.renderThreadsPane();
      this.renderReaderPane();
      this.scheduleDebouncedPrefetch(header);
      this.scheduleAutoMarkReadIfEnabled(header, cachedRam);
      return;
    }

    // 2. Natychmiast wyczyść stary <iframe>, pokaż nagłówek nowego maila + skeleton loader
    this.loadingMessage = true;
    disposeReaderIframes(this.readerPaneEl);
    this.renderThreadsPane();
    this.renderReaderPane();

    try {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid, {
        accountId: accId,
        signal: controller.signal,
        priority: "high",
      });
      if (
        this.isClosed ||
        seq !== this.messageLoadSeq ||
        (!this.unifiedInboxActive && accId !== this.activeAccountId)
      ) {
        return;
      }
      this.selectedEmail = full;
      this.loadingMessage = false;
      this.renderReaderPane();
      this.scheduleDebouncedPrefetch(header);
      this.scheduleAutoMarkReadIfEnabled(header, full);
    } catch (err) {
      if (err instanceof Error && err.message === "ABORTED") return;
      if (!this.isClosed && seq === this.messageLoadSeq) {
        this.loadingMessage = false;
        this.renderReaderPane();
        new Notice(`Nie udało się pobrać wiadomości: ${(err as Error).message}`);
      }
    }
  }

  private scheduleDebouncedPrefetch(current: ImapMessageHeader): void {
    this.clearPrefetchDebounceTimer();
    const seqAtSchedule = this.messageLoadSeq;
    this.prefetchDebounceTimer = window.setTimeout(() => {
      this.prefetchDebounceTimer = null;
      if (this.isClosed || seqAtSchedule !== this.messageLoadSeq) return;
      const rows = this.getVisibleRows();
      const idx = rows.findIndex(
        (r) =>
          r.head.uid === current.uid &&
          r.head.folder === current.folder &&
          (r.head.accountId || this.activeAccountId) === (current.accountId || this.activeAccountId)
      );
      if (idx < 0) return;
      const neighbors: ImapMessageHeader[] = [];
      if (rows[idx + 1]?.head) neighbors.push(rows[idx + 1].head);
      if (rows[idx - 1]?.head) neighbors.push(rows[idx - 1].head);
      const sameFolder = neighbors.filter(
        (n) =>
          n.folder === current.folder &&
          (n.accountId || this.activeAccountId) === (current.accountId || this.activeAccountId)
      );
      if (sameFolder.length > 0) {
        this.plugin.imapService.prefetchMessages(
          current.folder,
          sameFolder,
          current.accountId || this.activeAccountId
        );
      }
    }, 1500);
  }

  private scheduleAutoMarkReadIfEnabled(
    header: ImapMessageHeader,
    email: ParsedEmailMessage
  ): void {
    if (header.seen || this.plugin.settings.nonIntrusivePeek || this.offlineMode) return;
    const delaySec = this.plugin.settings.autoMarkReadDelaySec ?? 0;
    if (delaySec <= 0) return;
    this.autoMarkReadTimer = window.setTimeout(() => {
      if (this.isClosed || this.selectedEmail?.uid !== email.uid) return;
      void this.applyFlagMutation(
        header.folder,
        [header.uid],
        "\\Seen",
        true,
        header.accountId || this.activeAccountId
      );
    }, delaySec * 1000);
  }

  private async expandThreadMessage(header: ImapMessageHeader): Promise<void> {
    if (this.expandedThreadEmails.has(header.uid)) {
      this.expandedThreadEmails.delete(header.uid);
      this.renderReaderPane();
      return;
    }
    try {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid, {
        accountId: header.accountId || this.activeAccountId,
      });
      if (this.isClosed) return;
      this.expandedThreadEmails.set(header.uid, full);
      this.renderReaderPane();
    } catch (err) {
      new Notice(`Nie udało się wczytać wiadomości w wątku: ${(err as Error).message}`);
    }
  }

  // ============================================================================
  // Optymistyczne akcje na wiadomościach (Usuń, Kosz, Archiwum, Spam, Przenieś, Flagi)
  // ============================================================================

  private removeOptimisticallyFromState(folder: string, uids: number[], accountId: string): void {
    const uidSet = new Set(uids);
    const matches = (h: ImapMessageHeader) =>
      h.folder === folder && (h.accountId || "default") === accountId && uidSet.has(h.uid);

    this.headers = this.headers.filter((h) => !matches(h));
    this.serverSearchResults = this.serverSearchResults.filter((h) => !matches(h));
    this.threads = groupHeadersIntoThreads(this.headers);

    for (const uid of uids) {
      this.selectedUids.delete(`${accountId}::${folder}::${uid}`);
    }
    if (
      (this.selectedEmail &&
        this.selectedEmail.folder === folder &&
        uidSet.has(this.selectedEmail.uid ?? -1)) ||
      (this.selectedHeader &&
        this.selectedHeader.folder === folder &&
        uidSet.has(this.selectedHeader.uid))
    ) {
      this.selectedHeader = null;
      this.selectedEmail = null;
      this.selectedRowKey = null;
      disposeReaderIframes(this.readerPaneEl);
    }
    this.renderAllPanes();
  }

  private async applyFlagMutation(
    folder: string,
    uids: number[],
    flag: "\\Seen" | "\\Flagged",
    enabled: boolean,
    accountId: string
  ): Promise<void> {
    const uidSet = new Set(uids);
    const patch = (h: ImapMessageHeader): ImapMessageHeader => {
      if (h.folder !== folder || (h.accountId || "default") !== accountId || !uidSet.has(h.uid)) {
        return h;
      }
      return flag === "\\Seen" ? { ...h, seen: enabled } : { ...h, flagged: enabled };
    };

    // Optymistyczna aktualizacja natychmiast
    this.headers = this.headers.map(patch);
    this.serverSearchResults = this.serverSearchResults.map(patch);
    this.threads = groupHeadersIntoThreads(this.headers);
    if (this.selectedEmail && this.selectedEmail.folder === folder && uidSet.has(this.selectedEmail.uid ?? -1)) {
      if (flag === "\\Seen") this.selectedEmail.seen = enabled;
      else this.selectedEmail.flagged = enabled;
    }
    this.renderAllPanes();

    try {
      await this.plugin.imapService.setMessagesFlag(folder, uids, flag, enabled, accountId);
    } catch (err) {
      new Notice(`Błąd zmiany flagi IMAP: ${(err as Error).message}`);
      void this.refreshFolder(this.currentFolder, { background: true, skipFolderList: true });
    }
  }

  private async handleDeleteUids(folder: string, uids: number[], accountId: string): Promise<void> {
    if (uids.length === 0) return;
    const role = detectFolderRole(folder);

    if (role === "trash" || role === "spam") {
      new ConfirmModal(this.app, {
        title: "Usuń trwale",
        message: `Czy na pewno chcesz trwale usunąć ${uids.length} wiadomość(i) z folderu „${folder}”? Tej operacji nie można cofnąć.`,
        confirmLabel: "Usuń trwale",
        danger: true,
        onConfirm: async () => {
          this.removeOptimisticallyFromState(folder, uids, accountId);
          await this.plugin.imapService.deleteMessages(folder, uids, {
            permanent: true,
            accountId,
          });
          new Notice(`Usunięto trwale (${uids.length}).`);
        },
      }).open();
      return;
    }

    this.removeOptimisticallyFromState(folder, uids, accountId);
    try {
      const res = await this.plugin.imapService.deleteMessages(folder, uids, { accountId });
      if (res.targetFolder) {
        const trashFolder = res.targetFolder;
        this.showUndoToast(`Przeniesiono do Kosza (${uids.length})`, async () => {
          // Przenieś ostatnie przeniesione wiadomości z powrotem (odświeżając listę Kosza)
          const trashPage = await this.plugin.imapService.listMessagesPage(trashFolder, {
            pageSize: Math.max(10, uids.length * 2),
            accountId,
          });
          const latestUids = trashPage.headers.slice(0, uids.length).map((h) => h.uid);
          if (latestUids.length > 0) {
            await this.plugin.imapService.moveMessages(trashFolder, latestUids, folder, accountId);
          }
          await this.refreshFolder(this.currentFolder, { background: true });
        });
      }
    } catch (err) {
      new Notice(`Nie udało się usunąć wiadomości: ${(err as Error).message}`);
      void this.refreshFolder(this.currentFolder, { background: true });
    }
  }

  private async handleArchiveUids(folder: string, uids: number[], accountId: string): Promise<void> {
    if (uids.length === 0) return;
    this.removeOptimisticallyFromState(folder, uids, accountId);
    try {
      const res = await this.plugin.imapService.archiveMessages(folder, uids, accountId);
      const archiveFolder = res.targetFolder;
      this.showUndoToast(`Zarchiwizowano (${uids.length}) → ${archiveFolder}`, async () => {
        const archPage = await this.plugin.imapService.listMessagesPage(archiveFolder, {
          pageSize: Math.max(10, uids.length * 2),
          accountId,
        });
        const latestUids = archPage.headers.slice(0, uids.length).map((h) => h.uid);
        if (latestUids.length > 0) {
          await this.plugin.imapService.moveMessages(archiveFolder, latestUids, folder, accountId);
        }
        await this.refreshFolder(this.currentFolder, { background: true });
      });
    } catch (err) {
      new Notice(`Nie udało się zarchiwizować: ${(err as Error).message}`);
      void this.refreshFolder(this.currentFolder, { background: true });
    }
  }

  private async handleSpamUids(
    folder: string,
    uids: number[],
    isSpam: boolean,
    accountId: string
  ): Promise<void> {
    if (uids.length === 0) return;
    this.removeOptimisticallyFromState(folder, uids, accountId);
    try {
      const res = await this.plugin.imapService.markAsSpam(folder, uids, isSpam, accountId);
      new Notice(
        isSpam
          ? `Oznaczono jako Spam (${uids.length}) → ${res.targetFolder}`
          : `Przywrócono ze Spamu (${uids.length}) → ${res.targetFolder}`
      );
    } catch (err) {
      new Notice(`Błąd operacji Spam: ${(err as Error).message}`);
      void this.refreshFolder(this.currentFolder, { background: true });
    }
  }

  private async handleRestoreFromTrashUids(
    folder: string,
    uids: number[],
    accountId: string
  ): Promise<void> {
    if (uids.length === 0) return;
    this.removeOptimisticallyFromState(folder, uids, accountId);
    try {
      const res = await this.plugin.imapService.restoreFromTrash(folder, uids, accountId);
      new Notice(`Przywrócono (${uids.length}) → ${res.targetFolder}`);
    } catch (err) {
      new Notice(`Błąd przywracania: ${(err as Error).message}`);
      void this.refreshFolder(this.currentFolder, { background: true });
    }
  }

  private openMoveToFolderPicker(folder: string, uids: number[], accountId: string): void {
    if (uids.length === 0) return;
    new MoveToFolderModal(this.app, this.folders, async (target) => {
      if (target.path === folder) return;
      this.removeOptimisticallyFromState(folder, uids, accountId);
      try {
        await this.plugin.imapService.moveMessages(folder, uids, target.path, accountId);
        new Notice(`Przeniesiono ${uids.length} wiadomość(i) → ${target.path}`);
      } catch (err) {
        new Notice(`Błąd przenoszenia: ${(err as Error).message}`);
        void this.refreshFolder(this.currentFolder, { background: true });
      }
    }).open();
  }

  private handleDropToFolder(payload: DroppedMailPayload, targetFolder: string): void {
    if (payload.sourceFolder === targetFolder) return;
    this.removeOptimisticallyFromState(payload.sourceFolder, payload.uids, payload.accountId);
    void this.plugin.imapService
      .moveMessages(payload.sourceFolder, payload.uids, targetFolder, payload.accountId)
      .then(() => {
        new Notice(`Przeniesiono (${payload.uids.length}) → ${targetFolder}`);
      })
      .catch((err: Error) => {
        new Notice(`Nie udało się przenieść: ${err.message}`);
        void this.refreshFolder(this.currentFolder, { background: true });
      });
  }

  private handleEmptyTrashOrSpam(folderPath = this.currentFolder): void {
    const role = detectFolderRole(folderPath);
    if (role !== "trash" && role !== "spam") return;
    new ConfirmModal(this.app, {
      title: role === "trash" ? "Opróżnij Kosz" : "Opróżnij Spam",
      message: `Czy na pewno chcesz trwale usunąć WSZYSTKIE wiadomości z folderu „${folderPath}”? Tej operacji nie można cofnąć.`,
      confirmLabel: "Opróżnij trwale",
      danger: true,
      onConfirm: async () => {
        const count = await this.plugin.imapService.emptyFolder(folderPath, this.activeAccountId);
        new Notice(`Usunięto trwale ${count} wiadomości z ${folderPath}.`);
        await this.refreshFolder(this.currentFolder, { background: true });
      },
    }).open();
  }

  // ============================================================================
  // Akcje masowe (Bulk Selection)
  // ============================================================================

  private handleToggleCheckRow(row: ListRowItem, shiftKey: boolean, index: number): void {
    const rows = this.getVisibleRows();
    const rowUidKey = `${row.head.accountId || "default"}::${row.head.folder}::${row.head.uid}`;

    if (shiftKey && this.lastCheckedIndex !== null) {
      const start = Math.min(this.lastCheckedIndex, index);
      const end = Math.max(this.lastCheckedIndex, index);
      for (let i = start; i <= end; i++) {
        const r = rows[i];
        if (r) {
          this.selectedUids.add(
            `${r.head.accountId || "default"}::${r.head.folder}::${r.head.uid}`
          );
        }
      }
    } else if (this.selectedUids.has(rowUidKey)) {
      this.selectedUids.delete(rowUidKey);
    } else {
      this.selectedUids.add(rowUidKey);
    }
    this.lastCheckedIndex = index;
    this.renderThreadsPane();
  }

  private async handleBulkAction(
    action: "read" | "unread" | "star" | "move" | "archive" | "spam" | "delete" | "clear"
  ): Promise<void> {
    if (action === "clear") {
      this.selectedUids.clear();
      this.lastCheckedIndex = null;
      this.renderThreadsPane();
      return;
    }

    // Pogrupuj zaznaczone UID po (accountId, folder)
    const grouped = new Map<string, { accountId: string; folder: string; uids: number[] }>();
    for (const k of this.selectedUids) {
      const [accountId, folder, uidStr] = k.split("::");
      const uid = Number(uidStr);
      if (!folder || !Number.isFinite(uid)) continue;
      const gk = `${accountId}::${folder}`;
      const bucket = grouped.get(gk) || { accountId, folder, uids: [] };
      bucket.uids.push(uid);
      grouped.set(gk, bucket);
    }
    const groups = Array.from(grouped.values());
    if (groups.length === 0) return;

    if (action === "move") {
      const first = groups[0];
      new MoveToFolderModal(this.app, this.folders, async (target) => {
        for (const g of groups) {
          this.removeOptimisticallyFromState(g.folder, g.uids, g.accountId);
          await this.plugin.imapService.moveMessages(g.folder, g.uids, target.path, g.accountId);
        }
        new Notice(`Przeniesiono zaznaczone → ${target.path}`);
      }).open();
      void first;
      return;
    }

    for (const g of groups) {
      if (action === "read") {
        await this.applyFlagMutation(g.folder, g.uids, "\\Seen", true, g.accountId);
      } else if (action === "unread") {
        await this.applyFlagMutation(g.folder, g.uids, "\\Seen", false, g.accountId);
      } else if (action === "star") {
        await this.applyFlagMutation(g.folder, g.uids, "\\Flagged", true, g.accountId);
      } else if (action === "archive") {
        await this.handleArchiveUids(g.folder, g.uids, g.accountId);
      } else if (action === "spam") {
        await this.handleSpamUids(g.folder, g.uids, true, g.accountId);
      } else if (action === "delete") {
        await this.handleDeleteUids(g.folder, g.uids, g.accountId);
      }
    }
    this.selectedUids.clear();
    this.renderThreadsPane();
  }

  // ============================================================================
  // Wyszukiwanie serwerowe (IMAP SEARCH + X-GM-RAW)
  // ============================================================================

  private async runServerSearch(): Promise<void> {
    const q = this.filterQuery.trim();
    if (!q) {
      this.serverSearchActive = false;
      this.serverSearchResults = [];
      this.renderThreadsPane();
      return;
    }

    this.syncingList = true;
    this.renderThreadsPane();
    try {
      const folder = this.unifiedInboxActive ? "INBOX" : this.currentFolder;
      const results = await this.plugin.imapService.searchMessages(q, {
        folder,
        scope: this.searchScope,
        accountId: this.activeAccountId,
        maxResults: 60,
      });
      if (this.isClosed) return;
      this.serverSearchActive = true;
      this.serverSearchResults = results;
    } catch (err) {
      new Notice(`Błąd wyszukiwania IMAP: ${(err as Error).message}`);
    } finally {
      if (!this.isClosed) {
        this.syncingList = false;
        this.renderThreadsPane();
      }
    }
  }

  // ============================================================================
  // Załączniki (lazy download + podgląd + zapis w Vaulcie + pobieranie na dysk)
  // ============================================================================

  private async ensureAttachmentBuffer(
    email: ParsedEmailMessage,
    att: ParsedAttachment
  ): Promise<Buffer> {
    if (att.content && att.content.byteLength > 0 && !att.lazy) {
      return att.content;
    }
    if (!email.folder || !email.uid) {
      throw new Error("Brak danych źródłowych IMAP dla załącznika.");
    }
    new Notice(`Pobieranie załącznika „${att.filename}”...`);
    const buf = await this.plugin.imapService.fetchAttachmentPart(
      email.folder,
      email.uid,
      att.partId,
      att.filename,
      email.accountId || this.activeAccountId
    );
    att.content = buf;
    att.lazy = false;
    att.size = buf.byteLength;
    return buf;
  }

  private downloadBufferToDisk(filename: string, contentType: string, buf: Buffer): void {
    const blob = new Blob([new Uint8Array(buf)], {
      type: contentType || "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  private async previewAttachment(email: ParsedEmailMessage, att: ParsedAttachment): Promise<void> {
    try {
      const buf = await this.ensureAttachmentBuffer(email, att);
      new AttachmentPreviewModal(this.app, {
        filename: att.filename,
        contentType: att.contentType,
        content: buf,
        onSaveToVault: async () => {
          const matched = this.plugin.projectMatcher.matchEmailToVault(email);
          const stored = await this.plugin.vaultWriter.saveAttachmentOnlyToProject(
            { ...att, content: buf, lazy: false },
            matched.project
          );
          new Notice(`Zapisano załącznik w Vaulcie: ${stored}`);
        },
        onDownloadToDisk: () => this.downloadBufferToDisk(att.filename, att.contentType, buf),
      }).open();
    } catch (err) {
      new Notice(`Błąd podglądu załącznika: ${(err as Error).message}`);
    }
  }

  private async saveAttachmentToVault(email: ParsedEmailMessage, att: ParsedAttachment): Promise<void> {
    try {
      const buf = await this.ensureAttachmentBuffer(email, att);
      const matched = this.plugin.projectMatcher.matchEmailToVault(email);
      const stored = await this.plugin.vaultWriter.saveAttachmentOnlyToProject(
        { ...att, content: buf, lazy: false },
        matched.project
      );
      new Notice(`Zapisano załącznik: ${stored}`);
    } catch (err) {
      new Notice(`Nie udało się zapisać załącznika: ${(err as Error).message}`);
    }
  }

  private async downloadAttachmentToDisk(
    email: ParsedEmailMessage,
    att: ParsedAttachment
  ): Promise<void> {
    try {
      const buf = await this.ensureAttachmentBuffer(email, att);
      this.downloadBufferToDisk(att.filename, att.contentType, buf);
    } catch (err) {
      new Notice(`Nie udało się pobrać załącznika: ${(err as Error).message}`);
    }
  }

  private async saveAllAttachmentsToVault(email: ParsedEmailMessage): Promise<void> {
    let savedCount = 0;
    const matched = this.plugin.projectMatcher.matchEmailToVault(email);
    for (const att of email.attachments) {
      try {
        const buf = await this.ensureAttachmentBuffer(email, att);
        await this.plugin.vaultWriter.saveAttachmentOnlyToProject(
          { ...att, content: buf, lazy: false },
          matched.project
        );
        savedCount++;
      } catch {
        // kontynuuj pozostałe
      }
    }
    new Notice(`Zapisano ${savedCount}/${email.attachments.length} załączników w Vaulcie.`);
  }

  // ============================================================================
  // Tworzenie wiadomości / odpowiedzi
  // ============================================================================

  private openNewCompose(): void {
    const acc = this.plugin.imapService.resolveAccount(this.activeAccountId);
    const signature = acc.emailSignature.trim() ? `\n\n-- \n${acc.emailSignature.trim()}` : "";
    new ComposeMailModal(
      this.app,
      this.plugin.settings,
      this.plugin.smtpService,
      this.plugin.projectMatcher,
      this.plugin.mruStore,
      { accountId: acc.id, body: signature },
      this.plugin.imapService,
      this.plugin.cacheService
    ).open();
  }

  private openComposeForMessage(email: ParsedEmailMessage, mode: ReplyComposeMode): void {
    const acc = this.plugin.imapService.resolveAccount(email.accountId || this.activeAccountId);
    const myEmail = acc.imapUser.trim().toLowerCase();
    const signatureBlock = acc.emailSignature.trim()
      ? `\n\n-- \n${acc.emailSignature.trim()}`
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
          accountId: acc.id,
          subject: /^fwd?:/i.test(email.subject) ? email.subject : `Fwd: ${email.subject}`,
          body: `${signatureBlock}\n\n---------- Przekazana wiadomość ----------\nOd: ${email.fromRaw}\nData: ${email.date}\nTemat: ${email.subject}\nDo: ${email.toRaw}\n\n${email.markdownBody}`,
          originalSenderName: email.fromName,
        },
        this.plugin.imapService,
        this.plugin.cacheService
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
        accountId: acc.id,
        to: replyTarget,
        cc: ccList,
        subject: /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`,
        body: `${signatureBlock}${quotedBody}`,
        inReplyTo: email.messageId,
        references: [...(email.references || []), ...(email.messageId ? [email.messageId] : [])],
        originalSenderName: email.fromName,
      },
      this.plugin.imapService,
      this.plugin.cacheService
    ).open();
  }

  // ============================================================================
  // Menu kontekstowe (wiadomości i foldery)
  // ============================================================================

  private closeContextMenu(): void {
    if (this.activeContextMenu) {
      this.activeContextMenu.remove();
      this.activeContextMenu = null;
    }
  }

  private positionContextMenu(menu: HTMLElement, evt: MouseEvent): void {
    menu.style.left = `${evt.clientX}px`;
    menu.style.top = `${evt.clientY}px`;
    const rect = menu.getBoundingClientRect();
    const clampedX = Math.max(8, Math.min(evt.clientX, window.innerWidth - rect.width - 8));
    const clampedY = Math.max(8, Math.min(evt.clientY, window.innerHeight - rect.height - 8));
    menu.style.left = `${clampedX}px`;
    menu.style.top = `${clampedY}px`;
  }

  private openThreadContextMenu(evt: MouseEvent, header: ImapMessageHeader): void {
    evt.preventDefault();
    evt.stopPropagation();
    this.closeContextMenu();

    const accId = header.accountId || this.activeAccountId;
    const role = detectFolderRole(header.folder);
    const isTrashOrSpam = role === "trash" || role === "spam";

    const menu = document.body.createDiv({ cls: "tl-context-menu" });
    this.activeContextMenu = menu;

    const addItem = (label: string, icon: string, onClick: () => void, danger = false) => {
      const btn = menu.createEl("button", {
        type: "button",
        cls: `tl-context-item${danger ? " is-danger" : ""}`,
      });
      const ic = btn.createSpan({ cls: "tl-context-icon" });
      setIcon(ic, icon);
      btn.createSpan({ text: label });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeContextMenu();
        onClick();
      });
    };

    const addSep = () => menu.createDiv({ cls: "tl-context-sep" });

    addItem("Odpowiedz", "reply", async () => {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid, {
        accountId: accId,
      });
      this.openComposeForMessage(full, "reply");
    });
    addItem("Odpowiedz wszystkim", "reply-all", async () => {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid, {
        accountId: accId,
      });
      this.openComposeForMessage(full, "reply-all");
    });
    addItem("Przekaż", "forward", async () => {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid, {
        accountId: accId,
      });
      this.openComposeForMessage(full, "forward");
    });

    addSep();

    if (!this.offlineMode) {
      addItem(
        header.seen ? "Oznacz jako nieprzeczytaną" : "Oznacz jako przeczytaną",
        header.seen ? "mail" : "mail-open",
        () => void this.applyFlagMutation(header.folder, [header.uid], "\\Seen", !header.seen, accId)
      );
      addItem(
        header.flagged ? "Usuń gwiazdkę" : "Oznacz gwiazdką",
        "star",
        () =>
          void this.applyFlagMutation(header.folder, [header.uid], "\\Flagged", !header.flagged, accId)
      );
      addItem("Przenieś do folderu...", "folder-input", () =>
        this.openMoveToFolderPicker(header.folder, [header.uid], accId)
      );
      if (isTrashOrSpam) {
        addItem("Przywróć do Odebranych", "inbox", () =>
          void this.handleRestoreFromTrashUids(header.folder, [header.uid], accId)
        );
      } else {
        addItem("Archiwizuj", "archive", () =>
          void this.handleArchiveUids(header.folder, [header.uid], accId)
        );
        addItem("Oznacz jako Spam", "shield-alert", () =>
          void this.handleSpamUids(header.folder, [header.uid], true, accId)
        );
      }
      addItem(
        isTrashOrSpam ? "Usuń trwale..." : "Usuń do Kosza",
        "trash-2",
        () => void this.handleDeleteUids(header.folder, [header.uid], accId),
        true
      );
    }

    addSep();
    addItem("Zapisz w Vaulcie (Opt-in)...", "bookmark-plus", async () => {
      const full = await this.plugin.imapService.fetchFullMessage(header.folder, header.uid, {
        accountId: accId,
      });
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

    this.positionContextMenu(menu, evt);
  }

  private openFolderContextMenu(evt: MouseEvent, folder: ImapFolderSummary): void {
    evt.preventDefault();
    evt.stopPropagation();
    this.closeContextMenu();

    const role = folder.role ?? detectFolderRole(folder.path, folder.specialUse);
    const protectedFolder = isSystemFolder(folder.path, folder.specialUse);
    const delimiter = folder.delimiter || "/";

    const menu = document.body.createDiv({ cls: "tl-context-menu" });
    this.activeContextMenu = menu;

    const addItem = (label: string, icon: string, onClick: () => void, danger = false) => {
      const btn = menu.createEl("button", {
        type: "button",
        cls: `tl-context-item${danger ? " is-danger" : ""}`,
      });
      const ic = btn.createSpan({ cls: "tl-context-icon" });
      setIcon(ic, icon);
      btn.createSpan({ text: label });
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeContextMenu();
        onClick();
      });
    };

    addItem("Oznacz cały folder jako przeczytany", "check-check", async () => {
      try {
        await this.plugin.imapService.markFolderAllRead(folder.path, this.activeAccountId);
        new Notice(`Oznaczono wszystkie wiadomości w „${folder.path}” jako przeczytane.`);
        await this.refreshFolder(this.currentFolder, { background: true });
      } catch (err) {
        new Notice(`Błąd: ${(err as Error).message}`);
      }
    });

    addItem("Nowy podfolder...", "folder-plus", () => {
      this.openCreateFolderModal(`${folder.path}${delimiter}`);
    });

    if (role === "trash" || role === "spam") {
      addItem(
        role === "trash" ? "Opróżnij Kosz..." : "Opróżnij Spam...",
        "trash-2",
        () => this.handleEmptyTrashOrSpam(folder.path),
        true
      );
    }

    if (!protectedFolder) {
      menu.createDiv({ cls: "tl-context-sep" });
      addItem("Zmień nazwę folderu...", "pencil", () => {
        new FolderNamePromptModal(this.app, {
          title: "Zmień nazwę folderu IMAP",
          initialValue: folder.path,
          confirmLabel: "Zmień nazwę",
          onSubmit: async (newPath) => {
            await this.plugin.imapService.renameFolder(folder.path, newPath, this.activeAccountId);
            new Notice(`Zmieniono nazwę folderu → ${newPath}`);
            if (this.currentFolder === folder.path) this.currentFolder = newPath;
            await this.refreshFolder(this.currentFolder);
          },
        }).open();
      });

      addItem(
        "Usuń folder...",
        "trash-2",
        () => {
          new ConfirmModal(this.app, {
            title: "Usuń folder IMAP",
            message: `Czy na pewno chcesz usunąć folder „${folder.path}” wraz z jego zawartością na serwerze IMAP?`,
            confirmLabel: "Usuń folder",
            danger: true,
            onConfirm: async () => {
              await this.plugin.imapService.deleteFolder(folder.path, this.activeAccountId);
              new Notice(`Usunięto folder „${folder.path}”.`);
              if (this.currentFolder === folder.path) {
                this.currentFolder = "INBOX";
              }
              await this.refreshFolder(this.currentFolder);
            },
          }).open();
        },
        true
      );
    }

    this.positionContextMenu(menu, evt);
  }

  private openCreateFolderModal(prefix = ""): void {
    new FolderNamePromptModal(this.app, {
      title: "Nowy folder IMAP",
      description: "Użyj ukośnika (/) aby utworzyć podfolder, np. INBOX/Projekty/2026.",
      initialValue: prefix,
      confirmLabel: "Utwórz folder",
      onSubmit: async (newPath) => {
        await this.plugin.imapService.createFolder(newPath, this.activeAccountId);
        new Notice(`Utworzono folder IMAP: ${newPath}`);
        await this.refreshFolder(this.currentFolder);
      },
    }).open();
  }

  // ============================================================================
  // Nawigacja klawiaturą (J/K, ↓/↑, Delete/#, E, R, A, F, C, S, U, /, ?, Esc)
  // ============================================================================

  private handleWorkspaceKeydown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = e.key;
    if (key === "?") {
      e.preventDefault();
      new ShortcutsHelpModal(this.app).open();
      return;
    }
    if (key === "/") {
      e.preventDefault();
      this.searchInputEl?.focus();
      this.searchInputEl?.select();
      return;
    }
    if (key === "Escape") {
      if (this.selectedUids.size > 0) {
        this.selectedUids.clear();
        this.renderThreadsPane();
      }
      return;
    }
    if (key === "c" || key === "C") {
      e.preventDefault();
      this.openNewCompose();
      return;
    }

    const rows = this.getVisibleRows();
    const curIdx = rows.findIndex(
      (r) =>
        r.key === this.selectedRowKey ||
        `${r.head.accountId || "default"}::${r.head.folder}::${r.head.uid}` === this.selectedRowKey
    );

    if (key === "j" || key === "J" || key === "ArrowDown") {
      e.preventDefault();
      const next = rows[Math.min(rows.length - 1, curIdx + 1)];
      if (next) void this.openMessage(next.head, next.threadMessages, next.key);
      return;
    }
    if (key === "k" || key === "K" || key === "ArrowUp") {
      e.preventDefault();
      const prev = rows[Math.max(0, curIdx <= 0 ? 0 : curIdx - 1)];
      if (prev) void this.openMessage(prev.head, prev.threadMessages, prev.key);
      return;
    }

    const currentRow = curIdx >= 0 ? rows[curIdx] : null;
    if (!currentRow && !this.selectedEmail) return;

    if (key === "Delete" || key === "#") {
      e.preventDefault();
      if (this.selectedUids.size > 0) {
        void this.handleBulkAction("delete");
      } else if (currentRow) {
        void this.handleDeleteUids(
          currentRow.head.folder,
          [currentRow.head.uid],
          currentRow.head.accountId || this.activeAccountId
        );
      }
      return;
    }
    if (key === "e" || key === "E") {
      e.preventDefault();
      if (this.selectedUids.size > 0) {
        void this.handleBulkAction("archive");
      } else if (currentRow) {
        void this.handleArchiveUids(
          currentRow.head.folder,
          [currentRow.head.uid],
          currentRow.head.accountId || this.activeAccountId
        );
      }
      return;
    }
    if ((key === "s" || key === "S") && currentRow) {
      e.preventDefault();
      void this.applyFlagMutation(
        currentRow.head.folder,
        [currentRow.head.uid],
        "\\Flagged",
        !currentRow.head.flagged,
        currentRow.head.accountId || this.activeAccountId
      );
      return;
    }
    if ((key === "u" || key === "U") && currentRow) {
      e.preventDefault();
      void this.applyFlagMutation(
        currentRow.head.folder,
        [currentRow.head.uid],
        "\\Seen",
        !currentRow.head.seen,
        currentRow.head.accountId || this.activeAccountId
      );
      return;
    }
    if (this.selectedEmail) {
      if (key === "r" || key === "R") {
        e.preventDefault();
        this.openComposeForMessage(this.selectedEmail, "reply");
      } else if (key === "a" || key === "A") {
        e.preventDefault();
        this.openComposeForMessage(this.selectedEmail, "reply-all");
      } else if (key === "f" || key === "F") {
        e.preventDefault();
        this.openComposeForMessage(this.selectedEmail, "forward");
      }
    }
  }

  // ============================================================================
  // Renderowanie szkieletu, Resizable Splitters i pojedynczych paneli
  // ============================================================================

  private wireSplitter(
    handleEl: HTMLElement,
    orientation: "vertical" | "horizontal",
    onDrag: (clientX: number, clientY: number) => void
  ): void {
    handleEl.addEventListener("mousedown", (startEvent: MouseEvent) => {
      if (startEvent.button !== 0) return;
      startEvent.preventDefault();
      handleEl.addClass("is-dragging");
      document.body.addClass(orientation === "vertical" ? "tl-resizing-col" : "tl-resizing-row");

      const onMove = (e: MouseEvent) => {
        onDrag(e.clientX, e.clientY);
      };
      const onUp = () => {
        handleEl.removeClass("is-dragging");
        document.body.removeClass("tl-resizing-col");
        document.body.removeClass("tl-resizing-row");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        this.saveSplitterSizes();
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  private renderAccountTabs(): void {
    if (!this.accountTabsEl) return;
    this.accountTabsEl.empty();

    const enabledAccounts = this.plugin.settings.accounts.filter((a) => a.enabled);
    const totalUnread = enabledAccounts.reduce(
      (sum, acc) => sum + (this.accountUnreadMap.get(acc.id) || 0),
      0
    );

    // Pierwsza zakładka: Wszystkie skrzynki (Unified) — gdy skonfigurowano >1 konto
    if (enabledAccounts.length > 1) {
      const unifiedTab = this.accountTabsEl.createEl("button", {
        type: "button",
        cls: `tl-top-account-tab${this.unifiedInboxActive ? " is-active" : ""}`,
        attr: { title: "Wspólna skrzynka odbiorcza ze wszystkich aktywnych kont" },
      });
      const uIcon = unifiedTab.createSpan({ cls: "tl-tab-icon" });
      setIcon(uIcon, "layers");
      unifiedTab.createSpan({ cls: "tl-tab-label", text: "Wszystkie skrzynki" });
      if (totalUnread > 0) {
        unifiedTab.createSpan({
          cls: "tl-tab-badge",
          text: totalUnread > 999 ? "999+" : String(totalUnread),
        });
      }
      unifiedTab.addEventListener("click", () => void this.switchToUnifiedInbox());
    }

    for (const acc of enabledAccounts) {
      const isActive = !this.unifiedInboxActive && acc.id === this.activeAccountId;
      const unread = this.accountUnreadMap.get(acc.id) || 0;
      const errMsg = this.accountErrorMap.get(acc.id);

      const tab = this.accountTabsEl.createEl("button", {
        type: "button",
        cls: `tl-top-account-tab${isActive ? " is-active" : ""}${errMsg ? " has-error" : ""}`,
        attr: {
          title: errMsg
            ? `${acc.label} (${acc.imapUser}) — Błąd: ${errMsg}`
            : `${acc.label}${acc.imapUser ? ` · ${acc.imapUser}` : ""}`,
        },
      });
      const dot = tab.createSpan({ cls: "tl-account-dot" });
      dot.style.backgroundColor = acc.color;
      tab.createSpan({
        cls: "tl-tab-label",
        text: acc.label || acc.imapUser || acc.id,
      });
      if (unread > 0) {
        tab.createSpan({
          cls: "tl-tab-badge",
          text: unread > 999 ? "999+" : String(unread),
        });
      }
      if (errMsg) {
        const warnIcon = tab.createSpan({ cls: "tl-tab-warn-icon" });
        setIcon(warnIcon, "wifi-off");
      }
      tab.addEventListener("click", () => void this.switchAccount(acc.id));
    }

    const addBtn = this.accountTabsEl.createEl("button", {
      type: "button",
      cls: "tl-top-account-add",
      attr: {
        "aria-label": "Dodaj lub edytuj konta pocztowe",
        title: "Dodaj lub edytuj konta pocztowe w ustawieniach Thunder Look",
      },
    });
    setIcon(addBtn, "plus");
    addBtn.addEventListener("click", () => this.openPluginSettings());
  }

  private renderShell(): void {
    const container = this.contentEl;
    disposeReaderIframes(container);
    container.empty();
    const root = container.createDiv({ cls: "tl-workspace" });

    // 0. Górny pasek zakładek skrzynek (Top Account Tabs w stylu Thunderbirda / przeglądarki)
    this.accountTabsEl = root.createDiv({ cls: "tl-account-tabs-bar" });
    this.renderAccountTabs();

    // 1. Górny pasek narzędzi aplikacji (minimalistyczny, odporny na wąskie okna)
    const topbar = root.createDiv({ cls: "tl-topbar" });
    const leftTools = topbar.createDiv({ cls: "tl-topbar-group" });

    if (this.plugin.settings.foldersCollapsed) {
      const expandFoldersBtn = leftTools.createEl("button", {
        type: "button",
        cls: "tl-tool-btn",
        attr: { "aria-label": "Pokaż panel folderów", title: "Pokaż panel folderów" },
      });
      setIcon(expandFoldersBtn, "panel-left-open");
      expandFoldersBtn.addEventListener("click", () => {
        this.plugin.settings.foldersCollapsed = false;
        void this.plugin.saveSettings();
        this.renderShell();
        this.renderAllPanes();
      });
    }

    const composeBtn = leftTools.createEl("button", {
      type: "button",
      cls: "tl-tool-btn mod-cta",
    });
    const compIcon = composeBtn.createSpan({ cls: "tl-tool-icon" });
    setIcon(compIcon, "pen-square");
    composeBtn.createSpan({ text: "Nowa wiadomość" });
    composeBtn.addEventListener("click", () => this.openNewCompose());

    const refreshBtn = leftTools.createEl("button", {
      type: "button",
      cls: "tl-tool-btn",
      attr: { title: "Odśwież foldery i wiadomości IMAP" },
    });
    const refIcon = refreshBtn.createSpan({ cls: "tl-tool-icon" });
    setIcon(refIcon, "refresh-cw");
    refreshBtn.createSpan({ text: "Odśwież" });
    refreshBtn.addEventListener("click", () => void this.refreshFolder(this.currentFolder));

    const quotaBtn = leftTools.createEl("button", {
      type: "button",
      cls: "tl-tool-btn",
      attr: { title: "Monitor zajętości skrzynki i największe wiadomości" },
    });
    const qIcon = quotaBtn.createSpan({ cls: "tl-tool-icon" });
    setIcon(qIcon, "hard-drive");
    quotaBtn.createSpan({ text: "Rozmiar skrzynki" });
    quotaBtn.addEventListener("click", () => void this.plugin.activateStorageView());

    // Prawa część paska: przełącznik układu (3 kolumny / klasyczny góra-dół) + skróty (?)
    const rightTools = topbar.createDiv({ cls: "tl-topbar-group" });
    const layoutSeg = rightTools.createDiv({ cls: "tl-segmented" });
    const isClassic = this.plugin.settings.layoutMode === "classic-split";

    const colBtn = layoutSeg.createEl("button", {
      type: "button",
      cls: `tl-seg-btn${!isClassic ? " is-active" : ""}`,
      attr: { title: "Układ 3-kolumnowy (Foldery | Lista | Podgląd)" },
    });
    setIcon(colBtn.createSpan({ cls: "tl-seg-icon" }), "columns-3");
    colBtn.createSpan({ text: "3 kolumny" });
    colBtn.addEventListener("click", () => {
      if (!isClassic) return;
      this.plugin.settings.layoutMode = "three-column";
      void this.plugin.saveSettings();
      this.renderShell();
      this.renderAllPanes();
    });

    const classicBtn = layoutSeg.createEl("button", {
      type: "button",
      cls: `tl-seg-btn${isClassic ? " is-active" : ""}`,
      attr: { title: "Układ klasyczny (Lista u góry / Podgląd na dole)" },
    });
    setIcon(classicBtn.createSpan({ cls: "tl-seg-icon" }), "layout-panel-top");
    classicBtn.createSpan({ text: "Klasyczny" });
    classicBtn.addEventListener("click", () => {
      if (isClassic) return;
      this.plugin.settings.layoutMode = "classic-split";
      void this.plugin.saveSettings();
      this.renderShell();
      this.renderAllPanes();
    });

    const helpBtn = rightTools.createEl("button", {
      type: "button",
      cls: "tl-icon-btn-sm",
      attr: { "aria-label": "Skróty klawiszowe (?)", title: "Skróty klawiszowe (?)" },
    });
    setIcon(helpBtn, "keyboard");
    helpBtn.addEventListener("click", () => new ShortcutsHelpModal(this.app).open());

    if (this.offlineMode) {
      const offlineBanner = root.createDiv({ cls: "tl-banner-warn tl-offline-banner" });
      offlineBanner.createSpan({
        text: "Tryb offline — przeglądasz lokalnie zapisane nagłówki i treści z cache.",
      });
      const retryBtn = offlineBanner.createEl("button", {
        text: "Połącz ponownie",
        type: "button",
      });
      retryBtn.addEventListener("click", () => void this.refreshFolder());
    }

    // 2. Kontener wielopanelowy z interaktywnymi uchwytami zmiany rozmiaru (Splitters)
    const bodyWrap = root.createDiv({
      cls: `tl-split-layout${isClassic ? " is-classic" : " is-three-col"}`,
    });

    if (!this.plugin.settings.foldersCollapsed) {
      this.foldersPaneEl = bodyWrap.createDiv({ cls: "tl-pane tl-folders-pane" });
      this.foldersPaneEl.style.width = `${this.splitSizes.folderWidth}px`;

      const splitter1 = bodyWrap.createDiv({ cls: "tl-splitter tl-splitter-v" });
      this.wireSplitter(splitter1, "vertical", (clientX) => {
        const rect = bodyWrap.getBoundingClientRect();
        const nextW = Math.max(160, Math.min(420, clientX - rect.left));
        this.splitSizes.folderWidth = nextW;
        if (this.foldersPaneEl) this.foldersPaneEl.style.width = `${nextW}px`;
      });
    } else {
      this.foldersPaneEl = null;
    }

    if (isClassic) {
      const rightStack = bodyWrap.createDiv({ cls: "tl-classic-right-stack" });
      this.threadsPaneEl = rightStack.createDiv({ cls: "tl-pane tl-list-pane" });
      this.threadsPaneEl.style.height = `${this.splitSizes.classicListHeightPct}%`;

      const splitterH = rightStack.createDiv({ cls: "tl-splitter tl-splitter-h" });
      this.wireSplitter(splitterH, "horizontal", (_cx, clientY) => {
        const rect = rightStack.getBoundingClientRect();
        const pct = ((clientY - rect.top) / Math.max(200, rect.height)) * 100;
        const clamped = Math.max(22, Math.min(72, pct));
        this.splitSizes.classicListHeightPct = clamped;
        if (this.threadsPaneEl) this.threadsPaneEl.style.height = `${clamped}%`;
      });

      this.readerPaneEl = rightStack.createDiv({ cls: "tl-pane tl-reader-pane" });
    } else {
      this.threadsPaneEl = bodyWrap.createDiv({ cls: "tl-pane tl-list-pane" });
      this.threadsPaneEl.style.width = `${this.splitSizes.listWidth}px`;

      const splitter2 = bodyWrap.createDiv({ cls: "tl-splitter tl-splitter-v" });
      this.wireSplitter(splitter2, "vertical", (clientX) => {
        const leftAnchor = this.threadsPaneEl?.getBoundingClientRect().left ?? 0;
        const nextW = Math.max(240, Math.min(620, clientX - leftAnchor));
        this.splitSizes.listWidth = nextW;
        if (this.threadsPaneEl) this.threadsPaneEl.style.width = `${nextW}px`;
      });

      this.readerPaneEl = bodyWrap.createDiv({ cls: "tl-pane tl-reader-pane" });
    }

    // Slot pływającego banera „Cofnij” (5 s)
    this.undoSlotEl = root.createDiv({ cls: "tl-undo-slot" });
    this.renderUndoToast();
  }

  private renderAllPanes(): void {
    this.renderAccountTabs();
    this.renderFoldersPane();
    this.renderThreadsPane();
    this.renderReaderPane();
  }

  private renderFoldersPane(): void {
    if (!this.foldersPaneEl) return;
    const activeAcc = this.plugin.imapService.resolveAccount(this.activeAccountId);
    renderFolderPane({
      pane: this.foldersPaneEl,
      activeAccount: activeAcc,
      unifiedInboxActive: this.unifiedInboxActive,
      folders: this.folders,
      currentFolder: this.currentFolder,
      collapsedPaths: this.collapsedFolderPaths,
      syncing: this.syncingFolders,
      onSelectFolder: (folderPath) => void this.switchFolderInstant(folderPath),
      onToggleCollapseNode: (fullPath) => {
        if (this.collapsedFolderPaths.has(fullPath)) this.collapsedFolderPaths.delete(fullPath);
        else this.collapsedFolderPaths.add(fullPath);
        this.renderFoldersPane();
      },
      onCreateFolder: (parentPath) => this.openCreateFolderModal(parentPath || ""),
      onOpenFolderContextMenu: (evt, folder) => this.openFolderContextMenu(evt, folder),
      onDropMessagesToFolder: (payload, targetFolder) =>
        this.handleDropToFolder(payload, targetFolder),
      onToggleCollapsePane: () => {
        this.plugin.settings.foldersCollapsed = true;
        void this.plugin.saveSettings();
        this.renderShell();
        this.renderAllPanes();
      },
    });
  }

  private renderThreadsPane(): void {
    if (!this.threadsPaneEl) return;
    const rows = this.getVisibleRows();
    renderThreadListPane({
      pane: this.threadsPaneEl,
      currentFolder: this.currentFolder,
      unifiedInboxActive: this.unifiedInboxActive,
      rows,
      loadedHeaderCount: this.headers.length,
      totalOnServer: this.totalOnServer,
      hasMore: this.hasMorePages,
      loadingMore: this.loadingMore,
      syncing: this.syncingList,
      listMode: this.plugin.settings.messageListMode || "threads",
      filterQuery: this.filterQuery,
      searchScope: this.searchScope,
      serverSearchActive: this.serverSearchActive,
      quickFilters: this.quickFilters,
      selectedKey: this.selectedRowKey,
      selectedUids: this.selectedUids,
      onSelectRow: (row) => void this.openMessage(row.head, row.threadMessages, row.key),
      onToggleCheckRow: (row, shiftKey, idx) => this.handleToggleCheckRow(row, shiftKey, idx),
      onToggleStar: (h) =>
        void this.applyFlagMutation(
          h.folder,
          [h.uid],
          "\\Flagged",
          !h.flagged,
          h.accountId || this.activeAccountId
        ),
      onToggleSeen: (h) =>
        void this.applyFlagMutation(
          h.folder,
          [h.uid],
          "\\Seen",
          !h.seen,
          h.accountId || this.activeAccountId
        ),
      onQuickDelete: (h) =>
        void this.handleDeleteUids(h.folder, [h.uid], h.accountId || this.activeAccountId),
      onQuickArchive: (h) =>
        void this.handleArchiveUids(h.folder, [h.uid], h.accountId || this.activeAccountId),
      onOpenContextMenu: (evt, h) => this.openThreadContextMenu(evt, h),
      onBulkAction: (action) => void this.handleBulkAction(action),
      onChangeFilterQuery: (q) => {
        this.filterQuery = q;
        if (!q.trim() && this.serverSearchActive) {
          this.serverSearchActive = false;
          this.serverSearchResults = [];
        }
        const selStart = this.searchInputEl?.selectionStart ?? q.length;
        this.renderThreadsPane();
        if (this.searchInputEl) {
          this.searchInputEl.focus();
          this.searchInputEl.setSelectionRange(selStart, selStart);
        }
      },
      onRunServerSearch: () => void this.runServerSearch(),
      onClearServerSearch: () => {
        this.filterQuery = "";
        this.serverSearchActive = false;
        this.serverSearchResults = [];
        this.renderThreadsPane();
      },
      onChangeSearchScope: (scope) => {
        this.searchScope = scope;
        if (this.serverSearchActive) void this.runServerSearch();
        else this.renderThreadsPane();
      },
      onChangeQuickFilters: (next) => {
        this.quickFilters = next;
        this.renderThreadsPane();
      },
      onToggleListMode: () => {
        this.plugin.settings.messageListMode =
          this.plugin.settings.messageListMode === "threads" ? "list" : "threads";
        void this.plugin.saveSettings();
        this.renderThreadsPane();
      },
      onLoadMore: () => void this.loadMoreMessages(),
      onEmptyTrashOrSpam: () => this.handleEmptyTrashOrSpam(),
      searchInputRef: (el) => {
        this.searchInputEl = el;
      },
    });
  }

  private renderReaderPane(): void {
    if (!this.readerPaneEl) return;
    renderMessageReaderPane({
      pane: this.readerPaneEl,
      plugin: this.plugin,
      selectedHeader: this.selectedHeader,
      selectedEmail: this.selectedEmail,
      threadMessages: this.selectedThreadMessages,
      expandedThreadEmails: this.expandedThreadEmails,
      loadingMessage: this.loadingMessage,
      themeMode: this.plugin.settings.readerThemeMode || "original-light",
      allowRemoteImages: this.allowRemoteImagesForCurrent,
      showStrippedMarkdown: this.showStrippedMarkdown,
      showDetails: this.showMessageDetails,
      aiBarCollapsed: this.aiBarCollapsed,
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
      onToggleSeen: (email) => {
        if (!email.folder || !email.uid) return;
        void this.applyFlagMutation(
          email.folder,
          [email.uid],
          "\\Seen",
          !email.seen,
          email.accountId || this.activeAccountId
        );
      },
      onToggleStar: (email) => {
        if (!email.folder || !email.uid) return;
        void this.applyFlagMutation(
          email.folder,
          [email.uid],
          "\\Flagged",
          !email.flagged,
          email.accountId || this.activeAccountId
        );
      },
      onDelete: (email) => {
        if (!email.folder || !email.uid) return;
        void this.handleDeleteUids(
          email.folder,
          [email.uid],
          email.accountId || this.activeAccountId
        );
      },
      onRestoreFromTrash: (email) => {
        if (!email.folder || !email.uid) return;
        void this.handleRestoreFromTrashUids(
          email.folder,
          [email.uid],
          email.accountId || this.activeAccountId
        );
      },
      onArchive: (email) => {
        if (!email.folder || !email.uid) return;
        void this.handleArchiveUids(
          email.folder,
          [email.uid],
          email.accountId || this.activeAccountId
        );
      },
      onToggleSpam: (email, isSpam) => {
        if (!email.folder || !email.uid) return;
        void this.handleSpamUids(
          email.folder,
          [email.uid],
          isSpam,
          email.accountId || this.activeAccountId
        );
      },
      onMoveToFolder: (email) => {
        if (!email.folder || !email.uid) return;
        this.openMoveToFolderPicker(
          email.folder,
          [email.uid],
          email.accountId || this.activeAccountId
        );
      },
      onApplyAiMove: async (email, proposal) => {
        await this.plugin.aiBridge.applyProposalToImapMessage(
          this.plugin.imapService,
          email,
          proposal,
          true
        );
        if (email.folder && email.uid) {
          this.removeOptimisticallyFromState(
            email.folder,
            [email.uid],
            email.accountId || this.activeAccountId
          );
        }
      },
      onSetThemeMode: (mode: ReaderViewTheme) => {
        this.plugin.settings.readerThemeMode = mode;
        void this.plugin.saveSettings();
        this.renderReaderPane();
      },
      onToggleStripped: () => {
        this.showStrippedMarkdown = !this.showStrippedMarkdown;
        this.renderReaderPane();
      },
      onToggleDetails: () => {
        this.showMessageDetails = !this.showMessageDetails;
        this.renderReaderPane();
      },
      onToggleAiBar: () => {
        this.aiBarCollapsed = !this.aiBarCollapsed;
        this.renderReaderPane();
      },
      onAllowRemoteImagesOnce: () => {
        this.allowRemoteImagesForCurrent = true;
        this.renderReaderPane();
      },
      onTrustRemoteImagesSender: (senderEmail) => {
        const clean = senderEmail.trim().toLowerCase();
        if (!clean) return;
        if (!this.plugin.settings.trustedImageSenders.includes(clean)) {
          this.plugin.settings.trustedImageSenders.push(clean);
          void this.plugin.saveSettings();
        }
        this.allowRemoteImagesForCurrent = true;
        new Notice(`Zaufano nadawcy ${clean} — obrazy będą ładowane automatycznie.`);
        this.renderReaderPane();
      },
      onPreviewAttachment: (email, att) => void this.previewAttachment(email, att),
      onSaveAttachmentToVault: (email, att) => void this.saveAttachmentToVault(email, att),
      onDownloadAttachmentToDisk: (email, att) => void this.downloadAttachmentToDisk(email, att),
      onSaveAllAttachments: (email) => void this.saveAllAttachmentsToVault(email),
      onViewRawSource: (email) => {
        const raw = email.rawEmlBuffer
          ? email.rawEmlBuffer.toString("utf8")
          : `From: ${email.fromRaw}\nTo: ${email.toRaw}\nDate: ${email.dateTimeIso}\nSubject: ${email.subject}\nMessage-ID: ${email.messageId || ""}\n\n${email.textBody}`;
        new RawSourceModal(this.app, email.subject, raw).open();
      },
      onExpandThreadMessage: (h) => void this.expandThreadMessage(h),
    });
  }
}
