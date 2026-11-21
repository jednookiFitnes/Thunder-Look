import fs from 'node:fs';
import path from 'node:path';
import type { AppConfig, PriorityLevel } from './config.js';
import type { ParsedEmailFull } from './imapService.js';
import {
  assertSafeRelativeVaultPath,
  isCloudLockFile,
  isDangerousAttachmentExtension,
  sanitizeFilename,
} from '../../shared/pathSecurity.js';
import {
  formatObsidianTaskLine,
  naturalCompare,
  processLinesCrlfSafe,
} from './textUtils.js';

export interface VaultProject {
  code: string;
  folderName: string;
  relativeFolderPath: string;
  masterNotePath: string;
  masterNoteLink: string;
  client: string;
  title: string;
  status: string;
  projectType: string;
  isArchived: boolean;
}

export interface VaultContact {
  name: string;
  relativePath: string;
  emails: string[];
  client: string;
  linkedProjects: string[];
}

export interface MatchResult {
  matchedProject: VaultProject | null;
  matchedContact: VaultContact | null;
  matchReason: string;
  duplicateNotePath: string | null;
}

export class VaultService {
  constructor(private readonly config: AppConfig) {}

  private assertVaultPath(): string {
    if (!this.config.vaultPath) {
      throw new Error(
        'Brak skonfigurowanej ścieżki OBSIDIAN_VAULT_PATH. Ustaw zmienną środowiskową na katalog Twojego sejfu.'
      );
    }
    const resolved = path.resolve(this.config.vaultPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Katalog OBSIDIAN_VAULT_PATH nie istnieje: ${resolved}`);
    }
    return fs.realpathSync(resolved);
  }

  /**
   * Twarda izolacja ścieżek wewnątrz sejfu Obsidian:
   * - Waliduje ścieżkę przez shared/pathSecurity (blokuje .., NULL, znaki kontrolne i ścieżki absolutne)
   * - Weryfikuje realpathSync dla istniejących katalogów nadrzędnych, aby zablokować ucieczkę przez symlinki
   */
  private resolveSafeVaultPath(relativePath: string): string {
    const vaultRoot = this.assertVaultPath();
    const safeRel = assertSafeRelativeVaultPath(relativePath);
    const full = path.resolve(vaultRoot, safeRel);
    if (full !== vaultRoot && !full.startsWith(vaultRoot + path.sep)) {
      throw new Error(`Zablokowano ścieżkę poza katalogiem sejfu: ${relativePath}`);
    }

    // Sprawdź symlinki na najbliższym istniejącym katalogu nadrzędnym
    let probe = full;
    while (!fs.existsSync(probe) && probe !== vaultRoot) {
      const parent = path.dirname(probe);
      if (parent === probe) break;
      probe = parent;
    }
    if (fs.existsSync(probe)) {
      const realProbe = fs.realpathSync(probe);
      if (realProbe !== vaultRoot && !realProbe.startsWith(vaultRoot + path.sep)) {
        throw new Error(`Zablokowano ucieczkę symlinkiem poza katalog sejfu: ${relativePath}`);
      }
    }

    return full;
  }

  listVaultProjects(includeArchive = false): VaultProject[] {
    const vaultRoot = this.assertVaultPath();
    const projects: VaultProject[] = [];

    const scanRoot = (relDir: string, isArchived: boolean) => {
      const fullDir = path.join(vaultRoot, assertSafeRelativeVaultPath(relDir));
      if (!fs.existsSync(fullDir)) return;

      const entries = fs.readdirSync(fullDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (isCloudLockFile(entry.name)) continue;
        if (entry.name.toLowerCase() === 'kontakty' || entry.name.startsWith('.')) continue;

        const match = entry.name.match(/^(\d{2}-\d{3})\s*-\s*([^-]+?)\s*-\s*(.+)$/);
        const code = match ? match[1].trim() : '';
        const client = match ? match[2].trim() : '';
        const title = match ? match[3].trim() : entry.name;

        const relFolder = path.posix.join(relDir.replace(/\\/g, '/'), entry.name);
        const masterFileName = `_${entry.name}.md`;
        const masterRelPath = path.posix.join(relFolder, masterFileName);
        const masterFullPath = path.join(vaultRoot, masterRelPath);

        let status = isArchived ? 'completed' : 'in progress';
        let projectType = 'projekt';

        if (fs.existsSync(masterFullPath)) {
          const fm = readSimpleFrontmatter(fs.readFileSync(masterFullPath, 'utf8'));
          if (fm.status) status = fm.status;
          if (fm['electrical-project-type']) projectType = fm['electrical-project-type'];
        }

        projects.push({
          code,
          folderName: entry.name,
          relativeFolderPath: relFolder,
          masterNotePath: masterRelPath,
          masterNoteLink: `[[_${entry.name}]]`,
          client,
          title,
          status,
          projectType,
          isArchived,
        });
      }
    };

    scanRoot(this.config.vaultStructure.projectsDir, false);
    if (includeArchive) {
      scanRoot(this.config.vaultStructure.archiveDir, true);
    }

    projects.sort((a, b) => naturalCompare(a.folderName, b.folderName));
    return projects;
  }

  listVaultContacts(): VaultContact[] {
    const vaultRoot = this.assertVaultPath();
    const contactsDir = path.join(
      vaultRoot,
      assertSafeRelativeVaultPath(this.config.vaultStructure.contactsDir)
    );
    if (!fs.existsSync(contactsDir)) return [];

    const contacts: VaultContact[] = [];
    const entries = fs.readdirSync(contactsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md') || isCloudLockFile(entry.name)) continue;
      const fullPath = path.join(contactsDir, entry.name);
      const raw = fs.readFileSync(fullPath, 'utf8');
      const fm = readSimpleFrontmatter(raw);
      const emails: string[] = [];

      if (fm.contact_email) {
        emails.push(fm.contact_email.toLowerCase().trim());
      }
      const inlineEmails = raw.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      for (const em of inlineEmails) {
        const lower = em.toLowerCase();
        if (!emails.includes(lower)) emails.push(lower);
      }

      const linkedProjects: string[] = [];
      const linkMatches = raw.matchAll(/\[\[(_[^\]]+)\]\]/g);
      for (const m of linkMatches) {
        linkedProjects.push(m[1]);
      }

      contacts.push({
        name: entry.name.replace(/\.md$/, ''),
        relativePath: path.posix.join(
          this.config.vaultStructure.contactsDir.replace(/\\/g, '/'),
          entry.name
        ),
        emails,
        client: fm.client || '',
        linkedProjects,
      });
    }

    contacts.sort((a, b) => naturalCompare(a.name, b.name));
    return contacts;
  }

  findDuplicateByMessageId(messageId: string, contentHash?: string): string | null {
    const targetNeedle = messageId?.trim().replace(/^["']|["']$/g, '') || '';
    const hashNeedle = contentHash?.trim() || '';
    if (!targetNeedle && !hashNeedle) return null;

    const vaultRoot = this.assertVaultPath();
    const searchDirs = [
      path.join(vaultRoot, assertSafeRelativeVaultPath(this.config.vaultStructure.projectsDir)),
      path.join(vaultRoot, assertSafeRelativeVaultPath(this.config.vaultStructure.archiveDir)),
    ];

    const walk = (dir: string): string | null => {
      if (!fs.existsSync(dir)) return null;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (isCloudLockFile(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'Attachments') continue;
          const found = walk(full);
          if (found) return found;
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          const fd = fs.openSync(full, 'r');
          try {
            const buf = Buffer.alloc(2048);
            const bytesRead = fs.readSync(fd, buf, 0, buf.length, 0);
            const head = buf.toString('utf8', 0, bytesRead);
            if (
              (targetNeedle && head.includes('message_id:') && head.includes(targetNeedle)) ||
              (hashNeedle && head.includes('content_hash:') && head.includes(hashNeedle))
            ) {
              return path.relative(vaultRoot, full).replace(/\\/g, '/');
            }
          } finally {
            fs.closeSync(fd);
          }
        }
      }
      return null;
    };

    for (const d of searchDirs) {
      const hit = walk(d);
      if (hit) return hit;
    }
    return null;
  }

  matchProjectAndContact(params: {
    subject: string;
    body: string;
    fromEmail: string;
    messageId?: string;
    contentHash?: string;
    projectCodeRegex?: string;
  }): MatchResult {
    const projects = this.listVaultProjects(true);
    const contacts = this.listVaultContacts();

    const duplicateNotePath = this.findDuplicateByMessageId(
      params.messageId || '',
      params.contentHash
    );

    const matchedContact =
      contacts.find((c) => c.emails.includes(params.fromEmail.toLowerCase())) || null;

    const combined = `${params.subject}\n${params.body}`;
    let matchedProject: VaultProject | null = null;
    let matchReason = 'Brak automatycznego dopasowania';

    try {
      const rx = new RegExp(params.projectCodeRegex || '\\b\\d{2}-\\d{3}\\b', 'g');
      const codes = combined.match(rx) || [];
      for (const code of codes) {
        const found = projects.find((p) => p.code === code);
        if (found) {
          matchedProject = found;
          matchReason = `Dopasowano po numerze projektu ${code} w treści/temacie`;
          break;
        }
      }
    } catch {
      // ignoruj nieprawidłowy regex
    }

    if (!matchedProject && matchedContact) {
      for (const linked of matchedContact.linkedProjects) {
        const found = projects.find(
          (p) => `_${p.folderName}` === linked || p.folderName === linked
        );
        if (found) {
          matchedProject = found;
          matchReason = `Dopasowano przez kontakt ${matchedContact.name} (pole index)`;
          break;
        }
      }
      if (!matchedProject && matchedContact.client) {
        const clientLower = matchedContact.client.toLowerCase();
        const found = projects.find(
          (p) => !p.isArchived && p.client.toLowerCase() === clientLower
        );
        if (found) {
          matchedProject = found;
          matchReason = `Dopasowano po kliencie (${matchedContact.client}) z kontaktu ${matchedContact.name}`;
        }
      }
    }

    return {
      matchedProject,
      matchedContact,
      matchReason,
      duplicateNotePath,
    };
  }

  saveEmailExplicitToVault(params: {
    email: ParsedEmailFull;
    projectFolderRelativePath: string;
    subfolder?: string;
    mode: 'new-file' | 'append-note';
    targetAppendNoteRelativePath?: string;
    excerptOnly?: string;
    category?: string;
    priority?: PriorityLevel;
    saveAttachments?: boolean;
    saveEmlCopy?: boolean;
    stripQuotes?: boolean;
  }): {
    noteRelativePath: string;
    savedAttachments: string[];
    skippedDangerousAttachments: string[];
    emlRelativePath: string | null;
    duplicateWarning: string | null;
  } {
    const duplicateWarning = this.findDuplicateByMessageId(
      params.email.messageId,
      params.email.contentHash
    );
    const projectFull = this.resolveSafeVaultPath(params.projectFolderRelativePath);

    const savedAttachments: string[] = [];
    const skippedDangerousAttachments: string[] = [];
    if (params.saveAttachments && params.email.attachments.length > 0) {
      const attRelDir = path.posix.join(
        assertSafeRelativeVaultPath(params.projectFolderRelativePath),
        'Attachments'
      );
      const attFullDir = this.resolveSafeVaultPath(attRelDir);
      fs.mkdirSync(attFullDir, { recursive: true });

      const datePrefix = params.email.date.slice(0, 10);
      for (const att of params.email.attachments) {
        if (isDangerousAttachmentExtension(att.filename)) {
          skippedDangerousAttachments.push(att.filename);
          continue;
        }
        const safeName = `${datePrefix} - ${sanitizeFilename(att.filename, 100)}`;
        const attFullPath = this.resolveSafeVaultPath(path.posix.join(attRelDir, safeName));
        fs.writeFileSync(attFullPath, att.content);
        savedAttachments.push(path.posix.join(attRelDir, safeName));
      }
    }

    let emlRelativePath: string | null = null;
    if (params.saveEmlCopy && params.email.rawEml.length > 0) {
      const attRelDir = path.posix.join(
        assertSafeRelativeVaultPath(params.projectFolderRelativePath),
        'Attachments'
      );
      const attFullDir = this.resolveSafeVaultPath(attRelDir);
      fs.mkdirSync(attFullDir, { recursive: true });
      const datePrefix = params.email.date.slice(0, 10);
      const emlName = `Mail - ${datePrefix} - ${sanitizeFilename(params.email.subject, 60)}.eml`;
      emlRelativePath = path.posix.join(attRelDir, emlName);
      fs.writeFileSync(this.resolveSafeVaultPath(emlRelativePath), params.email.rawEml);
    }

    const bodyContent = params.excerptOnly?.trim()
      ? params.excerptOnly.trim()
      : params.stripQuotes !== false
      ? params.email.cleanedMarkdown || params.email.markdown
      : params.email.markdown;

    if (params.mode === 'append-note') {
      if (!params.targetAppendNoteRelativePath) {
        throw new Error('W trybie append-note musisz podać targetAppendNoteRelativePath.');
      }
      const targetFull = this.resolveSafeVaultPath(params.targetAppendNoteRelativePath);
      if (!fs.existsSync(targetFull)) {
        throw new Error(`Notatka docelowa nie istnieje: ${params.targetAppendNoteRelativePath}`);
      }

      const existing = fs.readFileSync(targetFull, 'utf8');
      const block = [
        '',
        `### ✉️ ${params.email.subject} (${params.email.date.slice(0, 10)})`,
        `- **Od:** ${params.email.from}`,
        `- **Message-ID:** \`${params.email.messageId}\``,
        ...(savedAttachments.length > 0
          ? [`- **Załączniki:** ${savedAttachments.map((a) => `[[${path.basename(a)}]]`).join(', ')}`]
          : []),
        '',
        bodyContent,
      ];

      const updated = processLinesCrlfSafe(existing, (lines) => [...lines, ...block]);
      fs.writeFileSync(targetFull, updated, 'utf8');

      return {
        noteRelativePath: params.targetAppendNoteRelativePath,
        savedAttachments,
        skippedDangerousAttachments,
        emlRelativePath,
        duplicateWarning,
      };
    }

    const safeProjectRel = assertSafeRelativeVaultPath(params.projectFolderRelativePath);
    const targetDirRel = params.subfolder
      ? path.posix.join(safeProjectRel, sanitizeFilename(params.subfolder, 60))
      : safeProjectRel;
    const targetDirFull = this.resolveSafeVaultPath(targetDirRel);
    fs.mkdirSync(targetDirFull, { recursive: true });

    const dateStr = params.email.date.slice(0, 10);
    const projectFolderName = path.basename(projectFull);
    const baseName = `Mail - ${dateStr} - ${sanitizeFilename(params.email.subject, 70)}`;
    let noteRelPath = path.posix.join(targetDirRel, `${baseName}.md`);
    let noteFullPath = this.resolveSafeVaultPath(noteRelPath);

    let suffix = 2;
    while (fs.existsSync(noteFullPath)) {
      noteRelPath = path.posix.join(targetDirRel, `${baseName} (${suffix}).md`);
      noteFullPath = this.resolveSafeVaultPath(noteRelPath);
      suffix++;
    }

    const attachmentYaml =
      savedAttachments.length > 0
        ? `\nattachments:\n${savedAttachments.map((a) => `  - "[[${path.basename(a)}]]"`).join('\n')}`
        : '\nattachments: []';

    const emlYaml = emlRelativePath ? `\neml_source: "[[${path.basename(emlRelativePath)}]]"` : '';

    const noteMarkdown = [
      '---',
      'type: email',
      `index: ["[[_${projectFolderName}]]"]`,
      `subject: "${escapeYaml(params.email.subject)}"`,
      `from: "${escapeYaml(params.email.from)}"`,
      `from_email: "${escapeYaml(params.email.fromEmail)}"`,
      `to: [${params.email.to.map((t) => `"${escapeYaml(t)}"`).join(', ')}]`,
      `date: ${params.email.date}`,
      `message_id: "${escapeYaml(params.email.messageId)}"`,
      ...(params.email.inReplyTo ? [`in_reply_to: "${escapeYaml(params.email.inReplyTo)}"`] : []),
      `thread_id: "${escapeYaml(params.email.threadId)}"`,
      `content_hash: "${escapeYaml(params.email.contentHash)}"`,
      `imap_folder: "${escapeYaml(params.email.folder)}"`,
      `imap_uid: ${params.email.uid}`,
      `category: "${escapeYaml(params.category || 'Korespondencja')}"`,
      `priority: "${params.priority || 'medium'}"`,
      `saved_mode: "${params.excerptOnly ? 'excerpt' : 'full'}"`,
      `tags: [email, thunder-look]`,
      `${attachmentYaml.trimStart()}${emlYaml}`,
      '---',
      '',
      `# ${params.email.subject}`,
      '',
      `> **Od:** ${params.email.from}  `,
      `> **Do:** ${params.email.to.join(', ') || '—'}  `,
      `> **Data:** ${params.email.date.slice(0, 16).replace('T', ' ')}  `,
      `> **Projekt:** [[_${projectFolderName}]]`,
      '',
      '## Treść wiadomości',
      '',
      bodyContent,
      ...(savedAttachments.length > 0
        ? [
            '',
            '## Załączniki',
            '',
            ...savedAttachments.map((a) => `- [[${path.basename(a)}]]`),
          ]
        : []),
      '',
    ].join('\n');

    fs.writeFileSync(noteFullPath, noteMarkdown, 'utf8');

    return {
      noteRelativePath: noteRelPath,
      savedAttachments,
      skippedDangerousAttachments,
      emlRelativePath,
      duplicateWarning,
    };
  }

  appendObsidianTask(params: {
    targetNoteRelativePath: string;
    description: string;
    dueDate?: string;
    priority?: PriorityLevel;
    sourceNoteLink?: string;
  }): { targetNoteRelativePath: string; taskLine: string } {
    const fullPath = this.resolveSafeVaultPath(params.targetNoteRelativePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Notatka docelowa nie istnieje: ${params.targetNoteRelativePath}`);
    }

    const taskLine = formatObsidianTaskLine({
      description: params.description,
      dueDate: params.dueDate,
      priority: params.priority,
      sourceNoteLink: params.sourceNoteLink,
    });

    const content = fs.readFileSync(fullPath, 'utf8');
    const updated = processLinesCrlfSafe(content, (lines) => {
      const headingIdx = lines.findIndex((l) => /^##\s+(Zadania|Tasks|ToDo)/i.test(l.trim()));
      if (headingIdx !== -1) {
        const nextLines = [...lines];
        nextLines.splice(headingIdx + 1, 0, taskLine);
        return nextLines;
      }
      return [...lines, '', '## Zadania', taskLine];
    });

    fs.writeFileSync(fullPath, updated, 'utf8');
    return {
      targetNoteRelativePath: params.targetNoteRelativePath,
      taskLine,
    };
  }

  moveVaultNoteToFolder(params: {
    noteRelativePath: string;
    destinationFolderRelativePath: string;
  }): { from: string; to: string } {
    const srcFull = this.resolveSafeVaultPath(params.noteRelativePath);
    if (!fs.existsSync(srcFull) || !srcFull.endsWith('.md')) {
      throw new Error(`Nie znaleziono notatki Markdown: ${params.noteRelativePath}`);
    }

    const safeDestDir = assertSafeRelativeVaultPath(params.destinationFolderRelativePath);
    const destDirFull = this.resolveSafeVaultPath(safeDestDir);
    fs.mkdirSync(destDirFull, { recursive: true });

    const fileName = sanitizeFilename(path.basename(srcFull, '.md')) + '.md';
    const destRel = path.posix.join(safeDestDir, fileName);
    const destFull = this.resolveSafeVaultPath(destRel);

    fs.renameSync(srcFull, destFull);
    return {
      from: params.noteRelativePath,
      to: destRel,
    };
  }
}

function readSimpleFrontmatter(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return result;
  const endIdx = normalized.indexOf('\n---', 4);
  if (endIdx === -1) return result;
  const fmBlock = normalized.slice(4, endIdx);

  for (const line of fmBlock.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const val = line
      .slice(colon + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key) result[key] = val;
  }
  return result;
}

function escapeYaml(input: string): string {
  return input.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ');
}
