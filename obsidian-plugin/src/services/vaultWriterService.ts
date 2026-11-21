import crypto from "node:crypto";
import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
  assertSafeRelativeVaultPath,
  isCloudLockFile,
  sanitizeFilename,
} from "../../../shared/pathSecurity";
import {
  ParsedAttachment,
  ParsedEmailMessage,
  SaveDestinationMode,
  SaveScopeMode,
  TrinitecPluginSettings,
  VaultProjectMatch,
} from "../types";
import { MruStore } from "../utils/mruStore";
import { formatPolishDate, processLinesCrlfSafe } from "../utils/textUtils";

export interface ExplicitSaveOptions {
  email: ParsedEmailMessage;
  project: VaultProjectMatch | null;
  scope: SaveScopeMode;
  selectedExcerpt?: string;
  destinationMode: SaveDestinationMode;
  appendTargetFile?: TFile | null;
  updateExistingFile?: TFile | null;
  selectedAttachmentNames: string[];
  tasksMarkdown: string[];
  useQuoteStrippedBody: boolean;
  saveRawEmlCopy: boolean;
  aiCategory?: string;
  aiPriority?: string;
  relatedThreadNotes?: TFile[];
}

function isCloudLockError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes("EBUSY") ||
    msg.includes("EPERM") ||
    msg.includes("EACCES") ||
    msg.includes("LOCKED") ||
    msg.includes("RESOURCE BUSY")
  );
}

async function withCloudLockRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt >= maxRetries || !isCloudLockError(err)) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 150 * Math.pow(2, attempt - 1)));
    }
  }
  throw lastErr;
}

/**
 * Ścisły silnik zapisu Opt-in Thunder Look zgodny z AGENTS.md:
 * - Zapisuje WYŁĄCZNIE wyraźnie wskazane przez użytkownika wiadomości / fragmenty / załączniki.
 * - Atomowe metadane YAML wyłącznie przez app.fileManager.processFrontMatter().
 * - Aktualizacje treści wyłącznie przez app.vault.process() z zachowaniem Windows CRLF/LF.
 * - Odporność na chwilowe blokady plików Google Drive / OneDrive (retry EBUSY/EPERM/EACCES).
 * - Deduplikacja załączników po SHA-256 i ochrona przed Path Traversal.
 * - Automatyczne wikilinki między wiadomościami w tym samym wątku.
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

  async testDestinationWritability(): Promise<{
    ok: boolean;
    folderPath: string;
    message: string;
    hint?: string;
  }> {
    const folderPath = assertSafeRelativeVaultPath(this.settings.activeProjectsDir);
    try {
      await this.ensureFolderRecursive(folderPath);
      const probePath = normalizePath(`${folderPath}/.thunder-look-probe-${Date.now()}.tmp`);
      await withCloudLockRetry(async () => {
        await this.app.vault.adapter.write(probePath, "ok");
        await this.app.vault.adapter.remove(probePath);
      });
      return {
        ok: true,
        folderPath,
        message: `Folder „${folderPath}” istnieje i jest zapisywalny przez Vault API.`,
      };
    } catch (err) {
      return {
        ok: false,
        folderPath,
        message: `Nie można zapisać w folderze „${folderPath}”: ${
          err instanceof Error ? err.message : String(err)
        }`,
        hint: "Sprawdź uprawnienia folderu w OneDrive/Google Drive oraz poprawność ścieżki względnej w ustawieniach sejfu.",
      };
    }
  }

  async saveExplicitEmail(options: ExplicitSaveOptions): Promise<TFile> {
    const {
      email,
      project,
      scope,
      selectedExcerpt,
      destinationMode,
      appendTargetFile,
      updateExistingFile,
      selectedAttachmentNames,
      tasksMarkdown,
      useQuoteStrippedBody,
      saveRawEmlCopy,
      aiCategory,
      aiPriority,
      relatedThreadNotes = [],
    } = options;

    if (project) {
      this.mru.recordUse("projects", project.folderPath);
    }

    const projectFolder = assertSafeRelativeVaultPath(
      project
        ? project.folderPath
        : `${this.settings.activeProjectsDir}/_Korespondencja_Nieprzypisana`
    );
    await this.ensureFolderRecursive(projectFolder);

    // 1. Zapis wyłącznie wybranych załączników (z limitem rozmiaru i deduplikacją SHA-256)
    const maxBytes = Math.max(1, this.settings.maxAttachmentSizeMb || 25) * 1024 * 1024;
    const savedAttachments: string[] = [];
    const attachmentsToSave = email.attachments.filter((a) =>
      selectedAttachmentNames.includes(a.filename)
    );

    const attachDir = assertSafeRelativeVaultPath(
      this.settings.attachmentsTarget === "project-attachments" && project
        ? `${project.folderPath}/Attachments`
        : this.settings.globalAssetsDir
    );

    if (attachmentsToSave.length > 0 || (saveRawEmlCopy && email.rawEmlBuffer)) {
      await this.ensureFolderRecursive(attachDir);
    }

    for (const att of attachmentsToSave) {
      if (att.size > maxBytes) {
        throw new Error(
          `Załącznik „${att.filename}” przekracza limit rozmiaru (${this.settings.maxAttachmentSizeMb} MB). Odznacz go lub zwiększ limit w ustawieniach.`
        );
      }
      const storedName = await this.writeBinaryDeduplicated(attachDir, att.filename, att.content);
      savedAttachments.push(storedName);
    }

    // 2. Opcjonalny zapis źródłowego pliku .eml dla celów dowodowych
    let savedEmlName: string | null = null;
    if (saveRawEmlCopy && email.rawEmlBuffer) {
      const emlFileName = `${email.date} - ${sanitizeFilename(email.subject)}.eml`;
      savedEmlName = await this.writeBinaryDeduplicated(
        attachDir,
        emlFileName,
        email.rawEmlBuffer
      );
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
    const threadLines =
      relatedThreadNotes.length > 0
        ? [
            "",
            "## Powiązane w wątku",
            ...relatedThreadNotes.map((f) => `- [[${f.basename}]]`),
          ]
        : [];

    // 3A. Świadoma aktualizacja istniejącej notatki-duplikatu
    if (updateExistingFile) {
      await withCloudLockRetry(() =>
        this.app.vault.process(updateExistingFile, (existing) => {
          const updatedBody = [
            `# ${datePl} - Od ${email.fromName}`,
            "",
            ...bodyContent.split(/\r?\n/),
            ...attachmentLines,
            ...taskLines,
            ...threadLines,
            "",
          ];
          // Zachowaj blok YAML jeśli istnieje — frontmatter zaktualizujemy atomowo poniżej
          const fmMatch = existing.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/);
          const prefix = fmMatch ? fmMatch[0] : "";
          const eol = existing.includes("\r\n") ? "\r\n" : "\n";
          return `${prefix}${updatedBody.join(eol)}`;
        })
      );

      await this.applyEmailFrontmatter(updateExistingFile, {
        email,
        project,
        aiCategory,
        aiPriority,
        savedEmlName,
        savedAttachments,
      });

      await this.backlinkRelatedThreadNotes(relatedThreadNotes, updateExistingFile);
      return updateExistingFile;
    }

    // 3B. Dopisanie do istniejącej notatki (CRLF-safe app.vault.process)
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
        ...threadLines,
      ];

      await withCloudLockRetry(() =>
        this.app.vault.process(appendTargetFile, (existingData) =>
          processLinesCrlfSafe(existingData, (lines) => [...lines, ...headerMeta])
        )
      );
      return appendTargetFile;
    }

    // 3C. Nowy osobny plik Markdown + atomowe frontmatter przez app.fileManager.processFrontMatter
    const sanitizedSubj = sanitizeFilename(email.subject);
    const rawFileName = this.settings.fileNamePattern
      .replace("{YYYY-MM-DD}", email.date)
      .replace("{Subject}", sanitizedSubj);
    const safeFileName = sanitizeFilename(
      rawFileName.toLowerCase().endsWith(".md") ? rawFileName.slice(0, -3) : rawFileName
    );

    const targetPath = await this.resolveUniquePath(
      assertSafeRelativeVaultPath(`${projectFolder}/${safeFileName}.md`)
    );

    const bodyLines = [
      `# ${datePl} - Od ${email.fromName}`,
      "",
      ...bodyContent.split(/\r?\n/),
      ...attachmentLines,
      ...taskLines,
      ...threadLines,
      "",
    ];

    const createdFile = await withCloudLockRetry(() =>
      this.app.vault.create(targetPath, bodyLines.join("\n"))
    );

    await this.applyEmailFrontmatter(createdFile, {
      email,
      project,
      aiCategory,
      aiPriority,
      savedEmlName,
      savedAttachments,
    });

    await this.backlinkRelatedThreadNotes(relatedThreadNotes, createdFile);
    return createdFile;
  }

  private async applyEmailFrontmatter(
    file: TFile,
    params: {
      email: ParsedEmailMessage;
      project: VaultProjectMatch | null;
      aiCategory?: string;
      aiPriority?: string;
      savedEmlName: string | null;
      savedAttachments: string[];
    }
  ): Promise<void> {
    const { email, project, aiCategory, aiPriority, savedEmlName, savedAttachments } = params;
    await withCloudLockRetry(() =>
      this.app.fileManager.processFrontMatter(file, (fm) => {
        fm.index = project ? [`[[${project.masterNoteName}]]`] : [];
        fm.date = email.date;
        fm.electrical_topic = [this.settings.defaultElectricalTopic];
        if (aiCategory) fm.ai_category = aiCategory;
        if (aiPriority) fm.ai_priority = aiPriority;
        fm.from = email.fromRaw;
        fm.to = email.toRaw;
        if (email.ccRaw) fm.cc = email.ccRaw;
        fm.subject = email.subject;
        if (email.messageId) fm.message_id = email.messageId;
        if (email.inReplyTo) fm.in_reply_to = email.inReplyTo;
        if (email.threadId) fm.thread_id = email.threadId;
        if (email.contentHash) fm.content_hash = email.contentHash;
        if (savedEmlName) fm.source_eml = `[[${savedEmlName}]]`;
        fm.attachments = savedAttachments.map((f) => `[[${f}]]`);
        if (fm.status === undefined) fm.status = "";
      })
    );
  }

  private async backlinkRelatedThreadNotes(relatedNotes: TFile[], currentFile: TFile): Promise<void> {
    const wikilink = `- [[${currentFile.basename}]]`;
    for (const rel of relatedNotes) {
      if (rel.path === currentFile.path) continue;
      try {
        await withCloudLockRetry(() =>
          this.app.vault.process(rel, (content) =>
            processLinesCrlfSafe(content, (lines) => {
              if (lines.some((l) => l.includes(`[[${currentFile.basename}]]`))) {
                return lines;
              }
              const sectionIdx = lines.findIndex((l) => l.trim() === "## Powiązane w wątku");
              if (sectionIdx >= 0) {
                const copy = [...lines];
                copy.splice(sectionIdx + 1, 0, wikilink);
                return copy;
              }
              return [...lines, "", "## Powiązane w wątku", wikilink];
            })
          )
        );
      } catch {
        // Nie przerywaj zapisu głównej notatki, jeśli sąsiednia notatka jest chwilowo zablokowana
      }
    }
  }

  async saveAttachmentOnlyToProject(
    attachment: ParsedAttachment,
    project: VaultProjectMatch | null
  ): Promise<string> {
    const maxBytes = Math.max(1, this.settings.maxAttachmentSizeMb || 25) * 1024 * 1024;
    if (attachment.size > maxBytes) {
      throw new Error(
        `Załącznik „${attachment.filename}” przekracza limit ${this.settings.maxAttachmentSizeMb} MB.`
      );
    }

    const dir = assertSafeRelativeVaultPath(
      this.settings.attachmentsTarget === "project-attachments" && project
        ? `${project.folderPath}/Attachments`
        : this.settings.globalAssetsDir
    );
    await this.ensureFolderRecursive(dir);
    return await this.writeBinaryDeduplicated(dir, attachment.filename, attachment.content);
  }

  /**
   * Deduplikacja załączników po SHA-256 w folderze docelowym:
   * jeśli identyczny plik już istnieje w folderze Attachments/_Assets, zwraca jego istniejącą nazwę zamiast duplikować.
   */
  private async writeBinaryDeduplicated(
    folder: string,
    filename: string,
    content: Buffer
  ): Promise<string> {
    const safe = sanitizeFilename(filename);
    const incomingHash = crypto.createHash("sha256").update(content).digest("hex");

    const folderObj = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (folderObj instanceof TFolder) {
      for (const child of folderObj.children) {
        if (!(child instanceof TFile)) continue;
        if (isCloudLockFile(child.name)) continue;
        if (child.stat.size !== content.byteLength) continue;
        try {
          const existingBuf = await this.app.vault.readBinary(child);
          const existingHash = crypto
            .createHash("sha256")
            .update(Buffer.from(existingBuf))
            .digest("hex");
          if (existingHash === incomingHash) {
            return child.name;
          }
        } catch {
          // ignore unreadable candidate
        }
      }
    }

    const fullPath = await this.resolveUniquePath(
      assertSafeRelativeVaultPath(`${folder}/${safe}`)
    );
    const arrayBuf = content.buffer.slice(
      content.byteOffset,
      content.byteOffset + content.byteLength
    ) as ArrayBuffer;

    await withCloudLockRetry(() => this.app.vault.createBinary(fullPath, arrayBuf));
    return fullPath.split("/").pop() || safe;
  }

  async ensureFolderRecursive(folderPath: string): Promise<void> {
    const safePath = assertSafeRelativeVaultPath(folderPath);
    const segments = safePath.split("/");
    let current = "";
    for (const seg of segments) {
      current = current ? `${current}/${seg}` : seg;
      const normalized = normalizePath(current);
      if (!this.app.vault.getAbstractFileByPath(normalized)) {
        try {
          await withCloudLockRetry(() => this.app.vault.createFolder(normalized));
        } catch (err) {
          // Jeśli folder został utworzony równolegle, ignorujemy
          if (!this.app.vault.getAbstractFileByPath(normalized)) {
            throw err;
          }
        }
      }
    }
  }

  private async resolveUniquePath(desiredPath: string): Promise<string> {
    const normalized = normalizePath(desiredPath);
    if (!this.app.vault.getAbstractFileByPath(normalized)) return normalized;
    const dot = normalized.lastIndexOf(".");
    const base = dot > -1 ? normalized.slice(0, dot) : normalized;
    const ext = dot > -1 ? normalized.slice(dot) : "";
    let counter = 2;
    while (this.app.vault.getAbstractFileByPath(`${base} (${counter})${ext}`)) {
      counter++;
    }
    return `${base} (${counter})${ext}`;
  }
}
