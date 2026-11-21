import { setIcon } from "obsidian";
import { detectFolderRole } from "../../../../shared/folderMapper";
import { EmailThreadGroup, ImapMessageHeader, MessageListMode } from "../../types";
import { extractCleanSnippet, formatBytes } from "../../utils/textUtils";
import { UNIFIED_INBOX_PATH, type DroppedMailPayload } from "./FolderPane";

export interface ListQuickFilters {
  unreadOnly: boolean;
  starredOnly: boolean;
  hasAttachmentOnly: boolean;
  daysWindow: 0 | 7 | 30;
}

export type SearchScope = "folder" | "all";

const AVATAR_COLORS = [
  "#6366f1",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
];

const MONTHS_PL = [
  "sty",
  "lut",
  "mar",
  "kwi",
  "maj",
  "cze",
  "lip",
  "sie",
  "wrz",
  "paź",
  "lis",
  "gru",
];

export function getDeterministicAvatar(name: string, email: string): {
  initials: string;
  color: string;
} {
  const source = (name || email || "?").trim();
  const parts = source.replace(/["'<>]/g, "").split(/[\s._-]+/).filter(Boolean);
  const initials =
    parts.length >= 2
      ? `${parts[0][0]}${parts[1][0]}`.toUpperCase()
      : source.slice(0, 2).toUpperCase();
  let hash = 0;
  const seed = (email || name || "a").toLowerCase();
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  return { initials: initials || "?", color };
}

export function formatRelativeDatePl(dateIso?: string, fallbackYmd?: string): string {
  const parsed = dateIso ? new Date(dateIso) : fallbackYmd ? new Date(fallbackYmd) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return fallbackYmd || "";

  const now = new Date();
  const sameDay =
    parsed.getFullYear() === now.getFullYear() &&
    parsed.getMonth() === now.getMonth() &&
    parsed.getDate() === now.getDate();

  if (sameDay && dateIso) {
    const hh = String(parsed.getHours()).padStart(2, "0");
    const mm = String(parsed.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    parsed.getFullYear() === yesterday.getFullYear() &&
    parsed.getMonth() === yesterday.getMonth() &&
    parsed.getDate() === yesterday.getDate();
  if (isYesterday) return "wczoraj";

  if (parsed.getFullYear() === now.getFullYear()) {
    return `${parsed.getDate()} ${MONTHS_PL[parsed.getMonth()]}`;
  }

  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${parsed.getFullYear()}`;
}

export interface ListRowItem {
  key: string;
  head: ImapMessageHeader;
  threadMessages: ImapMessageHeader[];
  unreadCount: number;
  flagged: boolean;
  hasAttachments: boolean;
  projectCode: string | null;
  totalSizeBytes: number;
}

export function buildVisibleListRows(params: {
  headers: ImapMessageHeader[];
  threads: EmailThreadGroup[];
  listMode: MessageListMode;
  filterQuery: string;
  serverSearchActive: boolean;
  quickFilters: ListQuickFilters;
}): ListRowItem[] {
  const { headers, threads, listMode, filterQuery, serverSearchActive, quickFilters } = params;

  let rows: ListRowItem[];
  if (listMode === "threads") {
    rows = threads
      .filter((t) => t.messages.length > 0)
      .map((t) => ({
        key: t.threadKey,
        head: t.messages[0],
        threadMessages: t.messages,
        unreadCount: t.unreadCount,
        flagged: t.flagged,
        hasAttachments: Boolean(t.hasAttachments || t.messages.some((m) => m.hasAttachments)),
        projectCode: t.projectCode,
        totalSizeBytes: t.totalSizeBytes,
      }));
  } else {
    rows = headers.map((h) => ({
      key: `${h.accountId || "default"}::${h.folder}::${h.uid}`,
      head: h,
      threadMessages: [h],
      unreadCount: h.seen ? 0 : 1,
      flagged: h.flagged,
      hasAttachments: Boolean(h.hasAttachments),
      projectCode: h.detectedProjectCode,
      totalSizeBytes: h.sizeBytes,
    }));
  }

  const nowMs = Date.now();
  const q = serverSearchActive ? "" : filterQuery.trim().toLowerCase();

  return rows.filter((row) => {
    if (quickFilters.unreadOnly && row.unreadCount === 0) return false;
    if (quickFilters.starredOnly && !row.flagged) return false;
    if (quickFilters.hasAttachmentOnly && !row.hasAttachments) return false;
    if (quickFilters.daysWindow > 0) {
      const dt = row.head.internalDateIso
        ? Date.parse(row.head.internalDateIso)
        : Date.parse(row.head.date);
      if (Number.isFinite(dt)) {
        const diffDays = (nowMs - dt) / (1000 * 60 * 60 * 24);
        if (diffDays > quickFilters.daysWindow) return false;
      }
    }

    if (q) {
      const hay = [
        row.head.subject,
        row.head.fromName,
        row.head.fromEmail,
        row.head.toEmail || "",
        row.head.snippet || "",
        row.projectCode || "",
        ...row.threadMessages.map((m) => `${m.fromName} ${m.fromEmail}`),
      ]
        .join(" ")
        .toLowerCase();
      const cleanTokens = q
        .split(/\s+/)
        .filter(Boolean)
        .map((tok) => (tok.includes(":") ? tok.split(":").slice(1).join(":") : tok))
        .filter((tok) => tok && tok !== "unread" && tok !== "attachment" && tok !== "starred");
      if (cleanTokens.length > 0 && !cleanTokens.every((t) => hay.includes(t))) {
        return false;
      }
    }
    return true;
  });
}

export function renderThreadListPane(params: {
  pane: HTMLElement;
  currentFolder: string;
  unifiedInboxActive: boolean;
  rows: ListRowItem[];
  loadedHeaderCount: number;
  totalOnServer: number;
  hasMore: boolean;
  loadingMore: boolean;
  syncing: boolean;
  listMode: MessageListMode;
  filterQuery: string;
  searchScope: SearchScope;
  serverSearchActive: boolean;
  quickFilters: ListQuickFilters;
  selectedKey: string | null;
  selectedUids: Set<string>;
  onSelectRow: (row: ListRowItem) => void;
  onToggleCheckRow: (row: ListRowItem, shiftKey: boolean, index: number) => void;
  onToggleStar: (header: ImapMessageHeader) => void;
  onToggleSeen: (header: ImapMessageHeader) => void;
  onQuickDelete: (header: ImapMessageHeader) => void;
  onQuickArchive: (header: ImapMessageHeader) => void;
  onOpenContextMenu: (evt: MouseEvent, header: ImapMessageHeader) => void;
  onBulkAction: (
    action: "read" | "unread" | "star" | "move" | "archive" | "spam" | "delete" | "clear"
  ) => void;
  onChangeFilterQuery: (q: string) => void;
  onRunServerSearch: () => void;
  onClearServerSearch: () => void;
  onChangeSearchScope: (scope: SearchScope) => void;
  onChangeQuickFilters: (next: ListQuickFilters) => void;
  onToggleListMode: () => void;
  onLoadMore: () => void;
  onEmptyTrashOrSpam?: () => void;
  searchInputRef?: (el: HTMLInputElement) => void;
}): void {
  const {
    pane,
    currentFolder,
    unifiedInboxActive,
    rows,
    loadedHeaderCount,
    totalOnServer,
    hasMore,
    loadingMore,
    syncing,
    listMode,
    filterQuery,
    searchScope,
    serverSearchActive,
    quickFilters,
    selectedKey,
    selectedUids,
    onSelectRow,
    onToggleCheckRow,
    onToggleStar,
    onToggleSeen,
    onQuickDelete,
    onQuickArchive,
    onOpenContextMenu,
    onBulkAction,
    onChangeFilterQuery,
    onRunServerSearch,
    onClearServerSearch,
    onChangeSearchScope,
    onChangeQuickFilters,
    onToggleListMode,
    onLoadMore,
    onEmptyTrashOrSpam,
    searchInputRef,
  } = params;

  pane.empty();
  const folderRole = unifiedInboxActive ? "inbox" : detectFolderRole(currentFolder);

  // 1. Nagłówek listy wiadomości
  const headerBar = pane.createDiv({ cls: "tl-pane-header tl-list-header" });
  const headerLeft = headerBar.createDiv({ cls: "tl-pane-header-title" });
  const displayFolder =
    currentFolder === UNIFIED_INBOX_PATH ? "Wszystkie skrzynki" : currentFolder;
  headerLeft.createSpan({
    text: serverSearchActive ? `Wyniki (${rows.length})` : displayFolder,
    cls: "tl-list-folder-title",
    attr: { title: displayFolder },
  });
  if (!serverSearchActive) {
    headerLeft.createSpan({
      cls: "tl-list-count-muted",
      text:
        totalOnServer > loadedHeaderCount
          ? `${loadedHeaderCount} / ${totalOnServer}`
          : String(rows.length),
    });
  }
  if (syncing) {
    const spin = headerLeft.createSpan({
      cls: "tl-mini-spinner",
      attr: { "aria-label": "Synchronizacja folderu..." },
    });
    setIcon(spin, "loader-2");
  }

  const headerRight = headerBar.createDiv({ cls: "tl-pane-header-actions" });
  if ((folderRole === "trash" || folderRole === "spam") && onEmptyTrashOrSpam && rows.length > 0) {
    const emptyBtn = headerRight.createEl("button", {
      cls: "tl-btn-subtle tl-btn-danger-text",
      text: folderRole === "trash" ? "Opróżnij Kosz" : "Opróżnij Spam",
      type: "button",
    });
    emptyBtn.addEventListener("click", onEmptyTrashOrSpam);
  }

  const modeBtn = headerRight.createEl("button", {
    cls: "tl-icon-btn-sm",
    type: "button",
    attr: {
      "aria-label":
        listMode === "threads" ? "Widok wątków (kliknij: lista)" : "Widok listy (kliknij: wątki)",
      title:
        listMode === "threads"
          ? "Widok wątków (przełącz na listę)"
          : "Widok listy (przełącz na wątki)",
    },
  });
  setIcon(modeBtn, listMode === "threads" ? "messages-square" : "list");
  modeBtn.addEventListener("click", onToggleListMode);

  // 2. Pasek wyszukiwania (lokalne + IMAP SEARCH / X-GM-RAW) + szybkie pigułki filtrów
  const searchWrap = pane.createDiv({ cls: "tl-search-block" });
  const searchRow = searchWrap.createDiv({ cls: "tl-search-input-row" });
  const searchIcon = searchRow.createSpan({ cls: "tl-search-icon" });
  setIcon(searchIcon, "search");

  const input = searchRow.createEl("input", {
    type: "search",
    cls: "tl-search-input",
    placeholder: "Szukaj (Enter = IMAP, np. from:jan has:attachment)...",
  });
  input.value = filterQuery;
  searchInputRef?.(input);

  input.addEventListener("input", () => onChangeFilterQuery(input.value));
  input.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onRunServerSearch();
    } else if (e.key === "Escape") {
      input.value = "";
      onClearServerSearch();
      input.blur();
    }
  });

  const scopeBtn = searchRow.createEl("button", {
    type: "button",
    cls: `tl-scope-toggle${searchScope === "all" ? " is-active" : ""}`,
    text: searchScope === "all" ? "Cała skrzynka" : "Folder",
    attr: { title: "Przełącz zakres wyszukiwania IMAP: bieżący folder lub cała skrzynka" },
  });
  scopeBtn.addEventListener("click", () => {
    onChangeSearchScope(searchScope === "folder" ? "all" : "folder");
  });

  if (serverSearchActive) {
    const clearSearchBtn = searchRow.createEl("button", {
      type: "button",
      cls: "tl-icon-btn-sm",
      attr: { "aria-label": "Zamknij wyniki wyszukiwania", title: "Zamknij wyniki wyszukiwania" },
    });
    setIcon(clearSearchBtn, "x");
    clearSearchBtn.addEventListener("click", onClearServerSearch);
  }

  const filterRow = searchWrap.createDiv({ cls: "tl-filter-row" });
  const addFilterChip = (label: string, active: boolean, onClick: () => void) => {
    const chip = filterRow.createEl("button", {
      type: "button",
      cls: `tl-filter-chip${active ? " is-active" : ""}`,
      text: label,
    });
    chip.addEventListener("click", onClick);
  };

  addFilterChip("Nieprzeczytane", quickFilters.unreadOnly, () =>
    onChangeQuickFilters({ ...quickFilters, unreadOnly: !quickFilters.unreadOnly })
  );
  addFilterChip("Z gwiazdką", quickFilters.starredOnly, () =>
    onChangeQuickFilters({ ...quickFilters, starredOnly: !quickFilters.starredOnly })
  );
  addFilterChip("Załączniki", quickFilters.hasAttachmentOnly, () =>
    onChangeQuickFilters({
      ...quickFilters,
      hasAttachmentOnly: !quickFilters.hasAttachmentOnly,
    })
  );
  addFilterChip(
    quickFilters.daysWindow === 7 ? "7 dni" : quickFilters.daysWindow === 30 ? "30 dni" : "Okres",
    quickFilters.daysWindow > 0,
    () => {
      const nextDays: 0 | 7 | 30 =
        quickFilters.daysWindow === 0 ? 7 : quickFilters.daysWindow === 7 ? 30 : 0;
      onChangeQuickFilters({ ...quickFilters, daysWindow: nextDays });
    }
  );

  // 3. Pasek akcji masowych (Bulk Actions Bar)
  if (selectedUids.size > 0) {
    const bulkBar = pane.createDiv({ cls: "tl-bulk-bar" });
    bulkBar.createSpan({
      cls: "tl-bulk-count",
      text: `Zaznaczono: ${selectedUids.size}`,
    });

    const bulkActions = bulkBar.createDiv({ cls: "tl-bulk-actions" });
    const addBulkBtn = (
      icon: string,
      title: string,
      action: Parameters<typeof onBulkAction>[0],
      danger = false
    ) => {
      const btn = bulkActions.createEl("button", {
        type: "button",
        cls: `tl-icon-btn-sm${danger ? " is-danger" : ""}`,
        attr: { "aria-label": title, title },
      });
      setIcon(btn, icon);
      btn.addEventListener("click", () => onBulkAction(action));
    };

    addBulkBtn("mail-open", "Oznacz jako przeczytane", "read");
    addBulkBtn("mail", "Oznacz jako nieprzeczytane", "unread");
    addBulkBtn("star", "Dodaj/usuń gwiazdkę", "star");
    addBulkBtn("folder-input", "Przenieś do folderu...", "move");
    addBulkBtn("archive", "Archiwizuj", "archive");
    addBulkBtn("shield-alert", "Oznacz jako Spam", "spam");
    addBulkBtn("trash-2", "Usuń", "delete", true);
    addBulkBtn("x", "Odznacz wszystko", "clear");
  }

  // 4. Scrollowalna lista kart wiadomości (3-kolumnowy CSS Grid bez skakania na hover)
  const listEl = pane.createDiv({ cls: "tl-thread-list-scroll" });

  if (rows.length === 0) {
    const empty = listEl.createDiv({ cls: "tl-empty-state" });
    empty.setText(
      serverSearchActive
        ? "Brak wyników na serwerze IMAP dla podanego zapytania."
        : "Brak wiadomości spełniających kryteria."
    );
    return;
  }

  rows.forEach((row, index) => {
    const h = row.head;
    const rowUidKey = `${h.accountId || "default"}::${h.folder}::${h.uid}`;
    const isSelected = selectedKey === row.key || selectedKey === rowUidKey;
    const isChecked = selectedUids.has(rowUidKey);
    const isUnread = row.unreadCount > 0;

    const item = listEl.createDiv({
      cls: `tl-mail-card${isSelected ? " is-selected" : ""}${isUnread ? " is-unread" : ""}${
        isChecked ? " is-checked" : ""
      }`,
      attr: { draggable: "true" },
    });

    // Drag & Drop (1 lub wiele zaznaczonych maili na folder)
    item.addEventListener("dragstart", (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const uidsToDrag: number[] = [];
      if (isChecked && selectedUids.size > 1) {
        for (const k of selectedUids) {
          const parts = k.split("::");
          const u = Number(parts[2]);
          if (Number.isFinite(u)) uidsToDrag.push(u);
        }
      } else {
        for (const m of row.threadMessages) uidsToDrag.push(m.uid);
      }
      const payload: DroppedMailPayload = {
        sourceFolder: h.folder,
        accountId: h.accountId || "default",
        uids: Array.from(new Set(uidsToDrag)),
      };
      e.dataTransfer.setData("application/x-thunder-look-mail", JSON.stringify(payload));
      e.dataTransfer.effectAllowed = "move";
    });

    // Kolumna 1 (42 px): wycentrowana w pionie kropka nieprzeczytanej + slot 32x32 na awatar/checkbox (zero przesunięcia)
    const leftCol = item.createDiv({ cls: "tl-mail-col-left" });
    leftCol.createSpan({
      cls: `tl-unread-indicator${isUnread ? " is-visible" : ""}`,
      attr: isUnread ? { title: "Nieprzeczytana" } : {},
    });

    const avatarSlot = leftCol.createDiv({ cls: "tl-avatar-slot" });
    const av = getDeterministicAvatar(h.fromName, h.fromEmail);
    const avatarEl = avatarSlot.createDiv({
      cls: "tl-avatar",
      text: av.initials,
    });
    avatarEl.style.backgroundColor = av.color;

    const checkbox = avatarSlot.createEl("input", {
      type: "checkbox",
      cls: "tl-mail-checkbox",
      attr: { "aria-label": "Zaznacz wiadomość" },
    });
    checkbox.checked = isChecked;
    checkbox.addEventListener("click", (e: MouseEvent) => {
      e.stopPropagation();
      onToggleCheckRow(row, e.shiftKey, index);
    });

    // Kolumna 2 (elastyczna, min-width: 0): Nadawca | Temat | Czysty snippet (NIGDY bajty!)
    const midCol = item.createDiv({ cls: "tl-mail-col-mid" });

    const line1 = midCol.createDiv({ cls: "tl-mail-row-1" });
    line1.createSpan({
      cls: "tl-mail-sender",
      text: h.fromName || h.fromEmail || "Nieznany",
    });
    if (unifiedInboxActive && h.accountLabel) {
      const accBadge = line1.createSpan({
        cls: "tl-account-mini-badge",
        text: h.accountLabel,
      });
      if (h.accountColor) {
        accBadge.style.borderColor = h.accountColor;
        accBadge.style.color = h.accountColor;
      }
    }
    if (row.threadMessages.length > 1) {
      line1.createSpan({
        cls: "tl-thread-count-badge",
        text: String(row.threadMessages.length),
      });
    }

    midCol.createDiv({
      cls: "tl-mail-subject",
      text: h.subject || "(Bez tematu)",
    });

    const cleanSnippet = extractCleanSnippet(h.snippet || "", 110);
    if (cleanSnippet || row.projectCode) {
      const snippetRow = midCol.createDiv({ cls: "tl-mail-snippet" });
      if (row.projectCode) {
        snippetRow.createSpan({ cls: "tl-project-tag", text: row.projectCode });
      }
      if (cleanSnippet) {
        snippetRow.createSpan({ text: cleanSnippet });
      }
    }

    // Kolumna 3 (prawa): Data + załącznik + bezramkowa gwiazdka | na hover płynna podmiana na akcje
    const rightCol = item.createDiv({ cls: "tl-mail-col-right" });
    const metaStack = rightCol.createDiv({ cls: "tl-mail-right-meta" });

    const metaTop = metaStack.createDiv({ cls: "tl-mail-meta-top" });
    if (row.hasAttachments) {
      const clip = metaTop.createSpan({
        cls: "tl-mail-clip-icon",
        attr: { title: "Zawiera załączniki" },
      });
      setIcon(clip, "paperclip");
    }
    metaTop.createSpan({
      cls: "tl-mail-date",
      text: formatRelativeDatePl(h.internalDateIso, h.date),
      attr: { title: `${h.date} • ${formatBytes(row.totalSizeBytes)}` },
    });

    const starBtn = metaStack.createEl("button", {
      type: "button",
      cls: `tl-star-btn${row.flagged ? " is-starred" : ""}`,
      attr: {
        "aria-label": row.flagged ? "Usuń gwiazdkę" : "Oznacz gwiazdką",
        title: row.flagged ? "Usuń gwiazdkę (S)" : "Oznacz gwiazdką (S)",
      },
    });
    setIcon(starBtn, "star");
    starBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      onToggleStar(h);
    });

    const hoverActions = rightCol.createDiv({ cls: "tl-mail-hover-actions" });
    const addHoverBtn = (icon: string, title: string, handler: () => void, danger = false) => {
      const b = hoverActions.createEl("button", {
        type: "button",
        cls: `tl-icon-btn-xs${danger ? " is-danger" : ""}`,
        attr: { "aria-label": title, title },
      });
      setIcon(b, icon);
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        handler();
      });
    };
    addHoverBtn(
      isUnread ? "mail-open" : "mail",
      isUnread ? "Oznacz jako przeczytane (U)" : "Oznacz jako nieprzeczytane (U)",
      () => onToggleSeen(h)
    );
    addHoverBtn("archive", "Archiwizuj (E)", () => onQuickArchive(h));
    addHoverBtn("trash-2", "Usuń (Del)", () => onQuickDelete(h), true);

    item.addEventListener("click", (e: MouseEvent) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey) {
        e.preventDefault();
        onToggleCheckRow(row, e.shiftKey, index);
        return;
      }
      onSelectRow(row);
    });

    item.addEventListener("contextmenu", (e: MouseEvent) => {
      onOpenContextMenu(e, h);
    });
  });

  // 5. Paginacja — ukryta, gdy pobrano już wszystkie wiadomości na serwerze (np. 3/3)
  const shouldShowLoadMore =
    hasMore &&
    totalOnServer > 0 &&
    loadedHeaderCount < totalOnServer &&
    !serverSearchActive &&
    !unifiedInboxActive;

  if (shouldShowLoadMore) {
    const loadMoreWrap = listEl.createDiv({ cls: "tl-load-more-wrap" });
    const btn = loadMoreWrap.createEl("button", {
      type: "button",
      cls: "tl-load-more-btn",
      text: loadingMore ? "Ładowanie starszych wiadomości..." : "Załaduj starsze (kolejne 50)",
    });
    btn.disabled = loadingMore;
    btn.addEventListener("click", onLoadMore);

    listEl.addEventListener("scroll", () => {
      if (loadingMore) return;
      const remaining = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
      if (remaining < 120) {
        onLoadMore();
      }
    });
  }
}
