import { EmailThreadGroup, ImapMessageHeader } from "../../types";
import { formatBytes } from "../../utils/textUtils";

export function renderThreadListPane(params: {
  pane: HTMLElement;
  currentFolder: string;
  threads: EmailThreadGroup[];
  filterQuery: string;
  selectedUid: number | null;
  onSelectMessage: (header: ImapMessageHeader) => void;
  onOpenContextMenu: (evt: MouseEvent, header: ImapMessageHeader) => void;
}): void {
  const {
    pane,
    currentFolder,
    threads,
    filterQuery,
    selectedUid,
    onSelectMessage,
    onOpenContextMenu,
  } = params;

  pane.empty();
  const q = filterQuery.trim().toLowerCase();
  const visible = q
    ? threads.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.messages.some(
            (m) =>
              m.fromName.toLowerCase().includes(q) ||
              m.fromEmail.toLowerCase().includes(q) ||
              (m.detectedProjectCode || "").toLowerCase().includes(q)
          )
      )
    : threads;

  pane.createDiv({
    cls: "tl-pane-header",
    text: `${currentFolder} · Wątki: ${visible.length}`,
  });

  if (visible.length === 0) {
    const empty = pane.createDiv({ cls: "tl-reader" });
    empty.createDiv({
      cls: "tl-status-text",
      text: "Brak wiadomości do wyświetlenia. Kliknij „Odśwież IMAP”, aby pobrać listę z serwera.",
    });
    return;
  }

  for (const thread of visible) {
    const headMsg = thread.messages[0];
    if (!headMsg) continue;
    const isSelected = selectedUid === headMsg.uid;
    const item = pane.createDiv({
      cls: `tl-thread-item${isSelected ? " is-selected" : ""}${
        thread.unreadCount > 0 ? " is-unread" : ""
      }`,
    });

    const titleRow = item.createDiv({ cls: "tl-meta-row" });
    titleRow.createSpan({
      cls: "tl-thread-subject",
      text: `${thread.flagged ? "★ " : ""}${thread.subject}`,
    });
    if (thread.messages.length > 1) {
      titleRow.createSpan({ text: `(${thread.messages.length})` });
    }

    const meta = item.createDiv({ cls: "tl-meta-row" });
    meta.createSpan({
      text: `${headMsg.fromName}${thread.projectCode ? ` · ${thread.projectCode}` : ""}`,
    });
    meta.createSpan({ text: `${thread.latestDate} · ${formatBytes(thread.totalSizeBytes)}` });

    // Weryfikacja lewego przycisku myszy (e.button === 0) zgodnie z AGENTS.md
    item.addEventListener("mousedown", (e: MouseEvent) => {
      if (e.button !== 0) return;
      onSelectMessage(headMsg);
    });

    item.addEventListener("contextmenu", (e: MouseEvent) => {
      onOpenContextMenu(e, headMsg);
    });
  }
}
