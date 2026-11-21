import { App, TFile, normalizePath } from "obsidian";
import {
  ParsedAttachment,
  ParsedEmailMessage,
  SaveDestinationMode,
  SaveScopeMode,
  TrinitecPluginSettings,
  VaultProjectMatch,
} from "../types";
import { MruStore } from "../utils/mruStore";
import {
  formatPolishDate,
  processLinesCrlfSafe,
  sanitizeFilename,
} from "../utils/textUtils";

export interface ExplicitSaveOptions {
  email: ParsedEmailMessage;
  project: VaultProjectMatch | null;
  scope: SaveScopeMode;
  selectedExcerpt?: string;
  destinationMode: SaveDestinationMode;
  appendTargetFile?: TFile | null;
  selectedAttachmentNames: string[];
  tasksMarkdown: string[];
  useQuoteStrippedBody: boolean;
  saveRawEmlCopy: boolean;
  aiCategory?: string;
  aiPriority?: string;
}

/**
 * Ścisły silnik zapisu Opt-in zgodny z AGENTS.md:
 * - Zapisuje WYŁĄCZNIE wyraźnie wskazane przez użytkownika wiadomości / fragmenty / załączniki.
 * - Aktualizacje treści wyłącznie przez app.vault.process() z zachowaniem Windows CRLF/LF.
 * - Metadane YAML wyłącznie przez app.fileManager.processFrontMatter().
 */
export class VaultWriterService {
  private app: App;
  private settings: TrinitecPluginSettings;
  private mru: MruStore;

  constructor(app: App, settings: TrinitecPluginSettings, mru: MruStore) {
    this.app = app;
    this.settings = settings;
    this.mru = mru;
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
  }

  async saveExplicitEmail(options: ExplicitSaveOptions): Promise<TFile> {
    const {
      email,
      project,
      scope,
      selectedExcerpt,
      destinationMode,
      appendTargetFile,
      selectedAttachmentNames,
      tasksMarkdown,
      useQuoteStrippedBody,
      saveRawEmlCopy,
      aiCategory,
      aiPriority,
    } = options;

    if (project) {
      this.mru.recordUse("projects", project.folderPath);
    }

    const projectFolder = project
      ? project.folderPath
      : normalizePath(`${this.settings.activeProjectsDir}/_Korespondencja_Nieprzypisana`);
    await this.ensureFolder(projectFolder);

    // 1. Zapis wyłącznie wybranych załączników
    const savedAttachments: string[] = [];
    const attachmentsToSave = email.attachments.filter((a) =>
      selectedAttachmentNames.includes(a.filename)
    );

    const attachDir =
      this.settings.attachmentsTarget === "project-attachments" && project
        ? normalizePath(`${project.folderPath}/Attachments`)
        : normalizePath(this.settings.globalAssetsDir);

    if (attachmentsToSave.length > 0 || (saveRawEmlCopy && email.rawEmlBuffer)) {
      await this.ensureFolder(attachDir);
    }

    for (const att of attachmentsToSave) {
      const storedName = await this.writeBinaryUnique(attachDir, att.filename, att.content);
      savedAttachments.push(storedName);
    }

    // 2. Opcjonalny zapis źródłowego pliku .eml dla celów dowodowych (wzorzec Mailstone)
    let savedEmlName: string | null = null;
    if (saveRawEmlCopy && email.rawEmlBuffer) {
      const emlFileName = `${email.date} - ${sanitizeFilename(email.subject)}.eml`;
      savedEmlName = await this.writeBinaryUnique(attachDir, emlFileName, email.rawEmlBuffer);
      savedAttachments.push(savedEmlName);
    }

    const fullOrStripped = useQuoteStrippedBody
      ? email.strippedMarkdownBody
      : email.markdownBody;

    const bodyContent =
      scope === "selection" && selectedExcerpt?.trim()
        ? selectedExcerpt.trim()
        : scope === "attachments-only"
        ? `_Zapisano wybrane załączniki z wiadomości „${email.subject}”._`
        : fullOrStripped;

    const datePl = formatPolishDate(email.date);
    const attachmentLines =
      savedAttachments.length > 0
        ? ["", "## Załączniki", ...savedAttachments.map((f) => `- ![[${f}]]`)]
        : [];
    const taskLines =
      tasksMarkdown.length > 0 ? ["", "# 🗓️ Zadania", ...tasksMarkdown] : [];

    // 3A. Dopisanie do istniejącej notatki (CRLF-safe app.vault.process)
    if (destinationMode === "append-note" && appendTargetFile) {
      this.mru.recordUse("append-notes", appendTargetFile.path);
      const headerMeta = [
        "",
        "---",
        "",
        `## ${datePl} - Od ${email.fromName} (${email.subject})`,
        `> **Od:** ${email.fromRaw}  `,
        `> **Data:** ${email.date}${aiCategory ? ` | **Kategoria:** ${aiCategory}` : ""}${
          email.messageId ? ` | **ID:** \`${email.messageId}\`` : ""
        }`,
        "",
        ...bodyContent.split(/\r?\n/),
        ...attachmentLines,
        ...taskLines,
      ];

      await this.app.vault.process(appendTargetFile, (existingData) =>
        processLinesCrlfSafe(existingData, (lines) => [...lines, ...headerMeta])
      );
      return appendTargetFile;
    }

    // 3B. Nowy osobny plik Markdown + frontmatter przez app.fileManager.processFrontMatter
    const sanitizedSubj = sanitizeFilename(email.subject);
    const baseFileName = this.settings.fileNamePattern
      .replace("{YYYY-MM-DD}", email.date)
      .replace("{Subject}", sanitizedSubj);

    const targetPath = await this.resolveUniquePath(
      normalizePath(`${projectFolder}/${baseFileName}`)
    );

    const bodyLines = [
      `# ${datePl} - Od ${email.fromName}`,
      "",
      ...bodyContent.split(/\r?\n/),
      ...attachmentLines,
      ...taskLines,
      "",
    ];

    const createdFile = await this.app.vault.create(targetPath, bodyLines.join("\n"));

    await this.app.fileManager.processFrontMatter(createdFile, (fm) => {
      fm.index = project ? [`[[${project.masterNoteName}]]`] : [];
      fm.date = email.date;
      fm.electrical_topic = [this.settings.defaultElectricalTopic];
      if (aiCategory) fm.ai_category = aiCategory;
      if (aiPriority) fm.ai_priority = aiPriority;
      fm.from = email.fromRaw;
      fm.to = email.toRaw;
      fm.subject = email.subject;
      if (email.messageId) fm.message_id = email.messageId;
      if (email.inReplyTo) fm.in_reply_to = email.inReplyTo;
      if (savedEmlName) fm.source_eml = `[[${savedEmlName}]]`;
      fm.attachments = savedAttachments.map((f) => `[[${f}]]`);
      fm.status = "";
    });

    return createdFile;
  }

  async saveAttachmentOnlyToProject(
    attachment: ParsedAttachment,
    project: VaultProjectMatch | null
  ): Promise<string> {
    const dir =
      this.settings.attachmentsTarget === "project-attachments" && project
        ? normalizePath(`${project.folderPath}/Attachments`)
        : normalizePath(this.settings.globalAssetsDir);
    await this.ensureFolder(dir);
    return await this.writeBinaryUnique(dir, attachment.filename, attachment.content);
  }

  private async writeBinaryUnique(
    folder: string,
    filename: string,
    content: Buffer
  ): Promise<string> {
    const safe = sanitizeFilename(filename);
    const fullPath = await this.resolveUniquePath(normalizePath(`${folder}/${safe}`));
    const arrayBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength
    ) as ArrayBuffer;
    await this.app.vault.createBinary(fullPath, arrayBuf);
    return fullPath.split("/").pop() || safe;
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const normalized = normalizePath(folderPath);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  private async resolveUniquePath(desiredPath: string): Promise<string> {
    if (!this.app.vault.getAbstractFileByPath(desiredPath)) return desiredPath;
    const dot = desiredPath.lastIndexOf(".");
    const base = dot > -1 ? desiredPath.slice(0, dot) : desiredPath;
    const ext = dot > -1 ? desiredPath.slice(dot) : "";
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(`${base} (${counter})${ext}`)) {
      counter++;
    }
    return `${base} (${counter})${ext}`;
  }
}
