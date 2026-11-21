import { App, TFile, TFolder, normalizePath } from "obsidian";
import {
  assertSafeRelativeVaultPath,
  isCloudLockFile,
  sanitizeFilename,
} from "../../../shared/pathSecurity";
import {
  ParsedEmailMessage,
  TrinitecPluginSettings,
  VaultContactMatch,
  VaultProjectMatch,
} from "../types";
import { MruStore } from "../utils/mruStore";
import { naturalCompare } from "../utils/textUtils";

/**
 * Dopasowanie projektów, kontaktów, wykrywanie duplikatów (message_id / content_hash)
 * oraz powiązanych notatek w wątku (thread_id / in_reply_to / references)
 * WYŁĄCZNIE przez app.metadataCache (zgodnie z AGENTS.md — brak odczytu plików z dysku w pętli).
 */
export class ProjectMatcherService {
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

  listActiveProjects(sortByMru = true): VaultProjectMatch[] {
    const rootPath = normalizePath(this.settings.activeProjectsDir);
    const rootFolder = this.app.vault.getAbstractFileByPath(rootPath);
    if (!(rootFolder instanceof TFolder)) return [];

    const projects: VaultProjectMatch[] = [];
    const regex = this.safeRegex();

    for (const child of rootFolder.children) {
      if (!(child instanceof TFolder)) continue;
      if (isCloudLockFile(child.name)) continue;
      if (child.name.toLowerCase() === "kontakty") continue;

      const codeMatch = child.name.match(regex);
      projects.push({
        folderPath: child.path,
        folderName: child.name,
        masterNoteName: `${this.settings.masterNotePrefix}${child.name}`,
        projectCode: codeMatch ? codeMatch[0] : null,
        matchMethod: "manual",
      });
    }

    if (sortByMru) {
      return this.mru.sortByMru(
        "projects",
        projects,
        (p) => p.folderPath,
        (p) => p.folderName
      );
    }

    return projects.sort((a, b) => naturalCompare(a.folderName, b.folderName));
  }

  listAllContacts(sortByMru = true): VaultContactMatch[] {
    const contactsRoot = normalizePath(this.settings.contactsDir);
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => !isCloudLockFile(f.name) && f.path.startsWith(`${contactsRoot}/`));

    const contacts: VaultContactMatch[] = [];
    for (const file of files) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      const rawEmails = fm.contact_email;
      const emails: string[] = Array.isArray(rawEmails)
        ? rawEmails.map((e: unknown) => String(e).trim().toLowerCase()).filter(Boolean)
        : typeof rawEmails === "string" && rawEmails.trim()
        ? [rawEmails.trim().toLowerCase()]
        : [];

      const rawIndex = fm.index;
      const linkedProjects: string[] = Array.isArray(rawIndex)
        ? rawIndex.map((x: unknown) => String(x).replace(/^\[\[|\]\]$/g, ""))
        : typeof rawIndex === "string"
        ? [rawIndex.replace(/^\[\[|\]\]$/g, "")]
        : [];

      contacts.push({
        filePath: file.path,
        contactName: String(fm.contact_name || file.basename),
        emails,
        linkedProjects,
      });
    }

    if (sortByMru) {
      return this.mru.sortByMru(
        "contacts",
        contacts,
        (c) => c.emails[0] || c.filePath,
        (c) => c.contactName
      );
    }

    return contacts.sort((a, b) => naturalCompare(a.contactName, b.contactName));
  }

  findContactByEmail(emailAddress: string): VaultContactMatch | null {
    if (!emailAddress) return null;
    const target = emailAddress.trim().toLowerCase();
    return this.listAllContacts(false).find((c) => c.emails.includes(target)) || null;
  }

  /**
   * Deduplikacja po nagłówku Message-ID lub hashu treści (content_hash) przez app.metadataCache.
   */
  findExistingNoteByMessageId(messageId?: string, contentHash?: string): TFile | null {
    const targetMsgId = messageId?.trim().toLowerCase() || "";
    const targetHash = contentHash?.trim().toLowerCase() || "";
    if (!targetMsgId && !targetHash) return null;

    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isCloudLockFile(file.name)) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;
      if (
        targetMsgId &&
        typeof fm.message_id === "string" &&
        fm.message_id.trim().toLowerCase() === targetMsgId
      ) {
        return file;
      }
      if (
        targetHash &&
        typeof fm.content_hash === "string" &&
        fm.content_hash.trim().toLowerCase() === targetHash
      ) {
        return file;
      }
    }
    return null;
  }

  /**
   * Wyszukuje wcześniej zapisane notatki z tego samego wątku (thread_id / in_reply_to / references).
   */
  findThreadRelatedNotes(email: ParsedEmailMessage, excludePath?: string): TFile[] {
    const relatedIds = new Set<string>();
    if (email.threadId) relatedIds.add(email.threadId.trim().toLowerCase());
    if (email.inReplyTo) relatedIds.add(email.inReplyTo.trim().toLowerCase());
    if (email.messageId) relatedIds.add(email.messageId.trim().toLowerCase());
    for (const ref of email.references || []) {
      const cleaned = ref.trim().toLowerCase();
      if (cleaned) relatedIds.add(cleaned);
    }

    if (relatedIds.size === 0) return [];

    const matches: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (isCloudLockFile(file.name)) continue;
      if (excludePath && file.path === excludePath) continue;
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (!fm) continue;

      const fmThread = typeof fm.thread_id === "string" ? fm.thread_id.trim().toLowerCase() : "";
      const fmMsgId = typeof fm.message_id === "string" ? fm.message_id.trim().toLowerCase() : "";
      const fmReply =
        typeof fm.in_reply_to === "string" ? fm.in_reply_to.trim().toLowerCase() : "";

      if (
        (fmThread && relatedIds.has(fmThread)) ||
        (fmMsgId && relatedIds.has(fmMsgId)) ||
        (fmReply && relatedIds.has(fmReply))
      ) {
        matches.push(file);
      }
    }

    return matches.sort((a, b) => naturalCompare(a.basename, b.basename));
  }

  matchEmailToVault(email: ParsedEmailMessage): {
    project: VaultProjectMatch | null;
    contact: VaultContactMatch | null;
    duplicateNote: TFile | null;
    relatedThreadNotes: TFile[];
  } {
    const activeProjects = this.listActiveProjects(false);
    const contact = this.findContactByEmail(email.fromEmail);
    const duplicateNote = this.findExistingNoteByMessageId(email.messageId, email.contentHash);
    const relatedThreadNotes = this.findThreadRelatedNotes(email, duplicateNote?.path);
    const regex = this.safeRegex();

    // 1. Kod projektu w temacie lub treści
    const combined = `${email.subject}\n${email.textBody}`;
    const match = combined.match(regex);
    if (match) {
      const foundByCode = activeProjects.find((p) => p.projectCode === match[0]);
      if (foundByCode) {
        return {
          project: { ...foundByCode, matchMethod: "regex" },
          contact,
          duplicateNote,
          relatedThreadNotes,
        };
      }
    }

    // 2. Dziedziczenie z pola index: w kontakty/
    if (contact && contact.linkedProjects.length > 0) {
      for (const linked of contact.linkedProjects) {
        const clean = linked.replace(/^\[\[|\]\]$/g, "");
        const byMaster = activeProjects.find((p) => p.masterNoteName === clean);
        if (byMaster) {
          return {
            project: { ...byMaster, matchMethod: "contact" },
            contact,
            duplicateNote,
            relatedThreadNotes,
          };
        }
      }
    }

    return { project: null, contact, duplicateNote, relatedThreadNotes };
  }

  async createContactNote(params: {
    name: string;
    email: string;
    clientName: string;
    projectMasterNote: string | null;
  }): Promise<TFile> {
    const contactsDir = assertSafeRelativeVaultPath(this.settings.contactsDir);
    let current = "";
    for (const seg of contactsDir.split("/")) {
      current = current ? `${current}/${seg}` : seg;
      const norm = normalizePath(current);
      if (!this.app.vault.getAbstractFileByPath(norm)) {
        await this.app.vault.createFolder(norm);
      }
    }

    const safeName = sanitizeFilename(params.name) || sanitizeFilename(params.email);
    const targetPath = assertSafeRelativeVaultPath(`${contactsDir}/${safeName}.md`);
    const existing = this.app.vault.getAbstractFileByPath(targetPath);
    if (existing instanceof TFile) return existing;

    const file = await this.app.vault.create(targetPath, "");
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.index = params.projectMasterNote ? [`[[${params.projectMasterNote}]]`] : [];
      fm.contact_name = params.name;
      fm.client = [`[[${params.clientName}]]`];
      fm.contact_email = [params.email];
      fm.contact_phone = [];
      fm.contact_info = "Dodano z Thunder Look";
      fm.contact_project_info = "";
    });

    this.mru.recordUse("contacts", params.email.toLowerCase());
    return file;
  }

  private safeRegex(): RegExp {
    try {
      return new RegExp(this.settings.projectCodeRegex);
    } catch {
      return /\b\d{2}-\d{3}\b/;
    }
  }
}
