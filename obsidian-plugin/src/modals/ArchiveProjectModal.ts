import { App, FuzzySuggestModal } from "obsidian";
import { VaultProjectMatch } from "../types";

export class ArchiveProjectModal extends FuzzySuggestModal<VaultProjectMatch> {
  private projects: VaultProjectMatch[];
  private onPick: (project: VaultProjectMatch) => void;

  constructor(
    app: App,
    projects: VaultProjectMatch[],
    onPick: (project: VaultProjectMatch) => void
  ) {
    super(app);
    this.projects = projects;
    this.onPick = onPick;
    this.setPlaceholder("Wybierz aktywny projekt do zarchiwizowania (MRU + sortowanie naturalne)...");
  }

  getItems(): VaultProjectMatch[] {
    return this.projects;
  }

  getItemText(item: VaultProjectMatch): string {
    return item.folderName;
  }

  onChooseItem(item: VaultProjectMatch): void {
    this.onPick(item);
  }
}
