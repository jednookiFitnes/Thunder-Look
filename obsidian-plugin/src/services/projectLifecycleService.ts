import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { TrinitecPluginSettings, VaultProjectMatch } from "../types";
import { sanitizeFilename } from "../utils/textUtils";

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

    const folderName = `${code} - ${client} - ${title}`;
    const projectPath = normalizePath(`${this.settings.activeProjectsDir}/${folderName}`);

    if (this.app.vault.getAbstractFileByPath(projectPath)) {
      throw new Error(`Folder projektu „${folderName}” już istnieje.`);
    }

    await this.ensureFolder(this.settings.activeProjectsDir);
    await this.app.vault.createFolder(projectPath);

    for (const sub of this.settings.projectSubfolders) {
      const subPath = normalizePath(`${projectPath}/${sub}`);
      if (!this.app.vault.getAbstractFileByPath(subPath)) {
        await this.app.vault.createFolder(subPath);
      }
    }

    const masterName = `${this.settings.masterNotePrefix}${folderName}.md`;
    const masterPath = normalizePath(`${projectPath}/${masterName}`);
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
    const folder = this.app.vault.getAbstractFileByPath(project.folderPath);
    if (!(folder instanceof TFolder)) {
      throw new Error("Nie znaleziono katalogu projektu do zarchiwizowania.");
    }

    const masterPath = normalizePath(`${project.folderPath}/${project.masterNoteName}.md`);
    const masterFile = this.app.vault.getAbstractFileByPath(masterPath);
    if (masterFile instanceof TFile) {
      await this.app.fileManager.processFrontMatter(masterFile, (fm) => {
        fm.status = "archive";
      });
    }

    const archiveRoot = normalizePath(this.settings.archiveProjectsDir);
    await this.ensureFolder(archiveRoot);

    const destPath = normalizePath(`${archiveRoot}/${project.folderName}`);
    await this.app.fileManager.renameFile(folder, destPath);
    new Notice(`Zarchiwizowano projekt do: ${destPath}`);
    return destPath;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }
}
