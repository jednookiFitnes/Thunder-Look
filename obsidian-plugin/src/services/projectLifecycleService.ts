import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import {
  assertSafeRelativeVaultPath,
  sanitizeFilename,
} from "../../../shared/pathSecurity";
import { TrinitecPluginSettings, VaultProjectMatch } from "../types";

export class ProjectLifecycleService {
  private app: App;
  private settings: TrinitecPluginSettings;

  constructor(app: App, settings: TrinitecPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
  }

  async createProject(params: {
    projectCode: string;
    clientName: string;
    projectTitle: string;
    projectType: "projekt" | "oferta";
  }): Promise<TFile> {
    const code = sanitizeFilename(params.projectCode);
    const client = sanitizeFilename(params.clientName);
    const title = sanitizeFilename(params.projectTitle);

    const folderName = sanitizeFilename(`${code} - ${client} - ${title}`);
    const activeRoot = assertSafeRelativeVaultPath(this.settings.activeProjectsDir);
    const projectPath = assertSafeRelativeVaultPath(`${activeRoot}/${folderName}`);

    if (this.app.vault.getAbstractFileByPath(projectPath)) {
      throw new Error(`Folder projektu „${folderName}” już istnieje.`);
    }

    await this.ensureFolderRecursive(projectPath);

    for (const sub of this.settings.projectSubfolders) {
      const safeSub = sanitizeFilename(sub);
      if (!safeSub) continue;
      await this.ensureFolderRecursive(`${projectPath}/${safeSub}`);
    }

    const masterName = sanitizeFilename(`${this.settings.masterNotePrefix}${folderName}`);
    const masterPath = assertSafeRelativeVaultPath(`${projectPath}/${masterName}.md`);
    const baseFileName =
      this.settings.baseFilePath.split("/").pop() || "_base_trinitec_projekty.base";

    const body = `# :luc_book: Notatki\n![[${baseFileName}#Embeded]]\n`;
    const file = await this.app.vault.create(masterPath, body);

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.tags = [];
      fm.client = `[[${params.clientName.trim()}]]`;
      fm.status = "in progress";
      fm["electrical-project-type"] = params.projectType;
    });

    return file;
  }

  async archiveProject(project: VaultProjectMatch): Promise<string> {
    const safeProjectPath = assertSafeRelativeVaultPath(project.folderPath);
    const folder = this.app.vault.getAbstractFileByPath(safeProjectPath);
    if (!(folder instanceof TFolder)) {
      throw new Error("Nie znaleziono katalogu projektu do zarchiwizowania.");
    }

    const masterPath = assertSafeRelativeVaultPath(
      `${safeProjectPath}/${project.masterNoteName}.md`
    );
    const masterFile = this.app.vault.getAbstractFileByPath(masterPath);
    if (masterFile instanceof TFile) {
      await this.app.fileManager.processFrontMatter(masterFile, (fm) => {
        fm.status = "archive";
      });
    }

    const archiveRoot = assertSafeRelativeVaultPath(this.settings.archiveProjectsDir);
    await this.ensureFolderRecursive(archiveRoot);

    const destPath = assertSafeRelativeVaultPath(`${archiveRoot}/${sanitizeFilename(project.folderName)}`);
    await this.app.fileManager.renameFile(folder, destPath);
    new Notice(`Zarchiwizowano projekt do: ${destPath}`);
    return destPath;
  }

  private async ensureFolderRecursive(folderPath: string): Promise<void> {
    const safe = assertSafeRelativeVaultPath(folderPath);
    let current = "";
    for (const seg of safe.split("/")) {
      current = current ? `${current}/${seg}` : seg;
      const normalized = normalizePath(current);
      if (!this.app.vault.getAbstractFileByPath(normalized)) {
        await this.app.vault.createFolder(normalized);
      }
    }
  }
}
