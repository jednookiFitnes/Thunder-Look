import { ImapFolderSummary } from "../../types";

export function renderFolderPane(params: {
  pane: HTMLElement;
  folders: ImapFolderSummary[];
  currentFolder: string;
  headerCount: number;
  onSelectFolder: (folderPath: string) => void;
}): void {
  const { pane, folders, currentFolder, headerCount, onSelectFolder } = params;
  pane.empty();
  pane.createDiv({
    cls: "tl-pane-header",
    text: `Foldery (${folders.length || 1})`,
  });

  const folderItems =
    folders.length > 0
      ? folders
      : [{ path: currentFolder, messages: headerCount, unseen: 0, uidValidity: "0" }];

  for (const f of folderItems) {
    const row = pane.createDiv({
      cls: `tl-folder-item${f.path === currentFolder ? " is-active" : ""}`,
    });
    row.createSpan({ text: f.path });
    row.createSpan({
      cls: "tl-status-text",
      text: f.unseen > 0 ? `${f.unseen}/${f.messages}` : String(f.messages),
    });
    row.addEventListener("click", () => onSelectFolder(f.path));
  }
}
