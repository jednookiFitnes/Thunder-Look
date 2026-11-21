import { App, FuzzySuggestModal } from "obsidian";
import { ImapFolderSummary } from "../types";

export class MoveToFolderModal extends FuzzySuggestModal<ImapFolderSummary> {
  private folders: ImapFolderSummary[];
  private onChoose: (folder: ImapFolderSummary) => void;

  constructor(
    app: App,
    folders: ImapFolderSummary[],
    onChoose: (folder: ImapFolderSummary) => void,
    placeholder = "Wybierz docelowy folder IMAP..."
  ) {
    super(app);
    this.folders = folders;
    this.onChoose = onChoose;
    this.setPlaceholder(placeholder);
  }

  getItems(): ImapFolderSummary[] {
    return this.folders;
  }

  getItemText(item: ImapFolderSummary): string {
    return `${item.path} (${item.messages})`;
  }

  onChooseItem(item: ImapFolderSummary): void {
    this.onChoose(item);
  }
}
