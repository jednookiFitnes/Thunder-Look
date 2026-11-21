import { setIcon } from "obsidian";
import {
  buildFolderTree,
  type FolderTreeNode,
  type SpecialFolderRole,
} from "../../../../shared/folderMapper";
import { ImapFolderSummary, MailAccountConfig } from "../../types";

export const UNIFIED_INBOX_PATH = "__UNIFIED_INBOX__";

function iconForRole(role: SpecialFolderRole, isExpanded = false): string {
  switch (role) {
    case "inbox":
      return "inbox";
    case "starred":
      return "star";
    case "sent":
      return "send";
    case "drafts":
      return "file-edit";
    case "archive":
      return "archive";
    case "all":
      return "layers";
    case "spam":
      return "shield-alert";
    case "trash":
      return "trash-2";
    default:
      return isExpanded ? "folder-open" : "folder";
  }
}

export interface DroppedMailPayload {
  sourceFolder: string;
  accountId: string;
  uids: number[];
}

export function renderFolderPane(params: {
  pane: HTMLElement;
  activeAccount: MailAccountConfig | null;
  unifiedInboxActive: boolean;
  folders: ImapFolderSummary[];
  currentFolder: string;
  collapsedPaths: Set<string>;
  syncing: boolean;
  onSelectFolder: (folderPath: string) => void;
  onToggleCollapseNode: (fullPath: string) => void;
  onCreateFolder: (parentPath?: string) => void;
  onOpenFolderContextMenu: (evt: MouseEvent, folder: ImapFolderSummary) => void;
  onDropMessagesToFolder: (payload: DroppedMailPayload, targetFolder: string) => void;
  onToggleCollapsePane: () => void;
}): void {
  const {
    pane,
    activeAccount,
    unifiedInboxActive,
    folders,
    currentFolder,
    collapsedPaths,
    syncing,
    onSelectFolder,
    onToggleCollapseNode,
    onCreateFolder,
    onOpenFolderContextMenu,
    onDropMessagesToFolder,
    onToggleCollapsePane,
  } = params;

  pane.empty();

  // Nagłówek panelu folderów (100% dedykowany drzewku folderów wybranej skrzynki)
  const header = pane.createDiv({ cls: "tl-pane-header tl-folder-pane-header" });
  const titleWrap = header.createDiv({ cls: "tl-pane-header-title" });
  if (!unifiedInboxActive && activeAccount) {
    const dot = titleWrap.createSpan({ cls: "tl-account-dot" });
    dot.style.backgroundColor = activeAccount.color;
  }
  titleWrap.createSpan({
    text: "Foldery",
    attr: {
      title: unifiedInboxActive
        ? "Widok wspólnej skrzynki odbiorczej"
        : activeAccount
        ? `${activeAccount.label} (${activeAccount.imapUser})`
        : "Foldery",
    },
  });
  if (syncing) {
    const spin = titleWrap.createSpan({
      cls: "tl-mini-spinner",
      attr: { "aria-label": "Synchronizacja folderów..." },
    });
    setIcon(spin, "loader-2");
  }

  const headerActions = header.createDiv({ cls: "tl-pane-header-actions" });
  if (!unifiedInboxActive) {
    const newFolderBtn = headerActions.createEl("button", {
      cls: "tl-icon-btn-sm",
      type: "button",
      attr: { "aria-label": "Nowy folder IMAP", title: "Nowy folder IMAP" },
    });
    setIcon(newFolderBtn, "folder-plus");
    newFolderBtn.addEventListener("click", () => onCreateFolder());
  }

  const collapseBtn = headerActions.createEl("button", {
    cls: "tl-icon-btn-sm",
    type: "button",
    attr: { "aria-label": "Zwiń panel folderów", title: "Zwiń panel folderów" },
  });
  setIcon(collapseBtn, "panel-left-close");
  collapseBtn.addEventListener("click", onToggleCollapsePane);

  const scrollArea = pane.createDiv({ cls: "tl-folder-scroll" });

  if (unifiedInboxActive) {
    const info = scrollArea.createDiv({ cls: "tl-folder-unified-note" });
    info.createSpan({
      cls: "tl-muted-xs",
      text: "Przeglądasz Odebrane ze wszystkich aktywnych kont. Wybierz zakładkę konkretnej skrzynki u góry, aby przeglądać jej foldery.",
    });
    return;
  }

  const folderItems: ImapFolderSummary[] =
    folders.length > 0
      ? folders
      : [
          {
            path: currentFolder === UNIFIED_INBOX_PATH ? "INBOX" : currentFolder,
            messages: 0,
            unseen: 0,
            uidValidity: "0",
            role: "inbox",
          },
        ];

  const { systemNodes, customNodes } = buildFolderTree(folderItems);

  const wireDropTarget = (el: HTMLElement, targetFolderPath: string) => {
    el.addEventListener("dragover", (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("application/x-thunder-look-mail")) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      el.addClass("is-drop-target");
    });
    el.addEventListener("dragleave", () => {
      el.removeClass("is-drop-target");
    });
    el.addEventListener("drop", (e: DragEvent) => {
      e.preventDefault();
      el.removeClass("is-drop-target");
      const raw = e.dataTransfer?.getData("application/x-thunder-look-mail");
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as DroppedMailPayload;
        if (parsed && Array.isArray(parsed.uids) && parsed.uids.length > 0) {
          onDropMessagesToFolder(parsed, targetFolderPath);
        }
      } catch {
        // ignore invalid drop payload
      }
    });
  };

  const renderTreeNode = (parentEl: HTMLElement, node: FolderTreeNode, depth: number) => {
    const hasChildren = node.children.length > 0;
    const isCollapsed = collapsedPaths.has(node.fullPath);
    const isActive = node.fullPath === currentFolder;

    const row = parentEl.createDiv({
      cls: `tl-folder-row${isActive ? " is-active" : ""}${!node.folder ? " is-virtual" : ""}`,
    });
    row.style.paddingLeft = `${10 + depth * 14}px`;

    if (hasChildren) {
      const chevron = row.createSpan({ cls: "tl-folder-chevron" });
      setIcon(chevron, isCollapsed ? "chevron-right" : "chevron-down");
      chevron.addEventListener("click", (e) => {
        e.stopPropagation();
        onToggleCollapseNode(node.fullPath);
      });
    } else if (!node.isSystem) {
      row.createSpan({ cls: "tl-folder-chevron-spacer" });
    }

    const iconEl = row.createSpan({ cls: "tl-folder-icon" });
    setIcon(iconEl, iconForRole(node.role, hasChildren && !isCollapsed));

    row.createSpan({
      cls: "tl-folder-name",
      text: node.name,
      attr: { title: node.fullPath },
    });

    const badgeCount = node.folder ? node.folder.unseen : isCollapsed ? node.totalUnseen : 0;
    if (badgeCount > 0) {
      row.createSpan({
        cls: "tl-unread-badge",
        text: badgeCount > 999 ? "999+" : String(badgeCount),
      });
    }

    if (node.folder) {
      const folderSummary = node.folder as ImapFolderSummary;
      row.addEventListener("click", () => onSelectFolder(folderSummary.path));
      row.addEventListener("contextmenu", (e: MouseEvent) => {
        onOpenFolderContextMenu(e, folderSummary);
      });
      wireDropTarget(row, folderSummary.path);
    } else if (hasChildren) {
      row.addEventListener("click", () => onToggleCollapseNode(node.fullPath));
    }

    if (hasChildren && !isCollapsed) {
      for (const child of node.children) {
        renderTreeNode(parentEl, child, depth + 1);
      }
    }
  };

  if (systemNodes.length > 0) {
    const sysGroup = scrollArea.createDiv({ cls: "tl-folder-group" });
    for (const node of systemNodes) {
      renderTreeNode(sysGroup, node, 0);
    }
  }

  if (customNodes.length > 0) {
    scrollArea.createDiv({ cls: "tl-folder-section-label", text: "Foldery" });
    const customGroup = scrollArea.createDiv({ cls: "tl-folder-group" });
    for (const node of customNodes) {
      renderTreeNode(customGroup, node, 0);
    }
  }
}
