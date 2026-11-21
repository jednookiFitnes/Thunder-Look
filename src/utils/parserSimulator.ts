import {
  MockContact,
  MockProject,
  SampleEmail,
  SaveDestinationMode,
  SaveScopeMode,
  SimulatorConfig,
} from '../types/generator';
import { EXISTING_VAULT_MESSAGE_IDS } from '../data/defaults';
import {
  formatBytes,
  formatPolishDate,
  sanitizeFilename,
  sanitizeEmailHtml,
  stripQuotesAndSignaturesDetailed as stripQuotesAndSignatures,
  isDangerousAttachmentExtension as isDangerousAttachmentFilename,
} from '../../shared/index';

export { formatBytes, formatPolishDate, sanitizeFilename, stripQuotesAndSignatures, isDangerousAttachmentFilename };

export interface ExtractedTaskPreview {
  text: string;
  dueDate: string | null;
  priority: 'high' | 'medium' | 'low';
  markdownLine: string;
}

export interface SanitizedHtmlResult {
  html: string;
  bodyHtml: string;
  blockedRemoteImages: number;
  cspHeader: string;
}

export interface SimulationOutput {
  matchedProject: MockProject | null;
  matchMethod: 'regex' | 'contact' | 'manual' | 'none';
  matchedContact: MockContact | null;
  duplicateNotePath: string | null;
  detectedCategory: string;
  suggestedImapFolder: string;
  priorityLevel: 'high' | 'medium' | 'low';
  targetNotePath: string;
  attachmentTargetPaths: string[];
  emlTargetPath: string | null;
  extractedTasks: ExtractedTaskPreview[];
  quoteStripStats: ReturnType<typeof stripQuotesAndSignatures>;
  sanitizedHtml: SanitizedHtmlResult;
  markdownPreview: string;
  newContactPreview: string | null;
}

export function sanitizeHtmlForPreview(rawHtml: string, blockRemoteImages: boolean): SanitizedHtmlResult {
  const res = sanitizeEmailHtml(rawHtml, {
    blockRemoteImages,
    darkMode: true,
  });
  return {
    html: res.html,
    bodyHtml: res.bodyHtml,
    blockedRemoteImages: res.blockedRemoteImagesCount,
    cspHeader: res.cspHeader,
  };
}

export function detectProjectAndContact(
  email: SampleEmail,
  config: SimulatorConfig,
  projects: MockProject[],
  contacts: MockContact[],
  manualProjectCode: string | null
): {
  project: MockProject | null;
  method: 'regex' | 'contact' | 'manual' | 'none';
  contact: MockContact | null;
} {
  const contact =
    contacts.find((c) => c.email.toLowerCase() === email.fromEmail.toLowerCase()) || null;

  if (manualProjectCode) {
    const manual = projects.find((p) => p.code === manualProjectCode) || null;
    if (manual) return { project: manual, method: 'manual', contact };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(config.projectCodeRegex);
  } catch {
    regex = /\b\d{2}-\d{3}\b/;
  }

  const combined = `${email.subject}\n${email.body}`;
  const codeMatch = combined.match(regex);
  if (codeMatch) {
    const byCode = projects.find((p) => p.code === codeMatch[0]) || null;
    if (byCode) {
      return { project: byCode, method: 'regex', contact };
    }
  }

  if (contact && contact.linkedProjects.length > 0) {
    const linkedMaster = contact.linkedProjects[0];
    const byContact = projects.find((p) => p.masterNote === linkedMaster) || null;
    if (byContact) {
      return { project: byContact, method: 'contact', contact };
    }
  }

  return { project: null, method: 'none', contact };
}

export function detectCategoryAndPriority(
  email: SampleEmail,
  config: SimulatorConfig
): { category: string; imapFolder: string; priority: 'high' | 'medium' | 'low' } {
  const hay = `${email.subject} ${email.body}`.toLowerCase();

  let detectedCategory = config.defaultElectricalTopic;
  let suggestedImapFolder = config.inboxFolder;

  for (const rule of config.aiCategories) {
    const tokens = rule.keywords
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    if (tokens.some((kw) => hay.includes(kw))) {
      detectedCategory = rule.label;
      suggestedImapFolder = rule.imapFolder;
      break;
    }
  }

  let priority: 'high' | 'medium' | 'low' = 'medium';
  if (/(pilne|asap|natychmiast|krytyczn|zatrzymani|awari|dzisiaj)/i.test(hay)) {
    priority = 'high';
  } else if (/(informacyjnie|newsletter|fyi|bez pośpiechu)/i.test(hay)) {
    priority = 'low';
  }

  return { category: detectedCategory, imapFolder: suggestedImapFolder, priority };
}

export function extractTasksFromText(
  text: string,
  defaultPriority: 'high' | 'medium' | 'low'
): ExtractedTaskPreview[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const triggers = /(proszę|prośba|trzeba|należy|odesłać|potwierdzić|zweryfikować|przesłanie|dostarcz)/i;
  const dateRegex = /\b(20\d{2}-\d{2}-\d{2})\b/;
  const tasks: ExtractedTaskPreview[] = [];

  for (const line of lines) {
    if (triggers.test(line) && line.length >= 18) {
      const cleaned = line.replace(/^(\d+[.)]\s*|[-*•]\s*)/, '').trim();
      const dateMatch = cleaned.match(dateRegex);
      const dueDate = dateMatch ? dateMatch[1] : null;
      const isUrgent = /(piln|asap|natychmiast|zamknąć)/i.test(cleaned) || defaultPriority === 'high';
      const priority: 'high' | 'medium' | 'low' = isUrgent ? 'high' : defaultPriority;
      const priorityIcon = priority === 'high' ? ' ⏫' : priority === 'medium' ? ' 🔼' : ' 🔽';
      const dateSuffix = dueDate ? ` 📅 ${dueDate}` : '';
      tasks.push({
        text: cleaned,
        dueDate,
        priority,
        markdownLine: `- [ ] ${cleaned}${dateSuffix}${priorityIcon}`,
      });
    }
  }

  return tasks;
}

export function buildSimulationOutput(params: {
  email: SampleEmail;
  config: SimulatorConfig;
  projects: MockProject[];
  contacts: MockContact[];
  manualProjectCode: string | null;
  saveScope: SaveScopeMode;
  saveDestination: SaveDestinationMode;
  selectedExcerpt: string;
  selectedAttachments: string[];
  appendNoteFilename: string;
  includeTasks: boolean;
  stripQuotes: boolean;
  saveEmlCopy: boolean;
  blockRemoteImages: boolean;
}): SimulationOutput {
  const {
    email,
    config,
    projects,
    contacts,
    manualProjectCode,
    saveScope,
    saveDestination,
    selectedExcerpt,
    selectedAttachments,
    appendNoteFilename,
    includeTasks,
    stripQuotes,
    saveEmlCopy,
    blockRemoteImages,
  } = params;

  const { project, method, contact } = detectProjectAndContact(
    email,
    config,
    projects,
    contacts,
    manualProjectCode
  );
  const { category, imapFolder, priority } = detectCategoryAndPriority(email, config);
  const quoteStripStats = stripQuotesAndSignatures(email.body);
  const sanitizedHtml = sanitizeHtmlForPreview(email.htmlBody, blockRemoteImages);
  const duplicateNotePath = EXISTING_VAULT_MESSAGE_IDS[email.messageId] || null;

  const fullText = stripQuotes ? quoteStripStats.cleaned : email.body.trim();
  const bodySource =
    saveScope === 'selection' && selectedExcerpt.trim().length > 0
      ? selectedExcerpt.trim()
      : saveScope === 'attachments-only'
      ? `_Zapisano wyłącznie wybrane załączniki z wiadomości „${email.subject}”._`
      : fullText;

  const extractedTasks = includeTasks
    ? extractTasksFromText(
        saveScope === 'selection' && selectedExcerpt.trim() ? selectedExcerpt : fullText,
        priority
      )
    : [];

  const projectDir = project
    ? `${config.activeProjectsDir}/${project.folderName}`
    : `${config.activeProjectsDir}/_Nieprzypisane`;

  const attachmentBaseDir =
    config.attachmentsTarget === 'project-attachments' && project
      ? `${projectDir}/Attachments`
      : config.globalAssetsDir;

  const activeAttachments = email.attachments.filter((a) =>
    selectedAttachments.includes(a.filename)
  );
  const attachmentTargetPaths = activeAttachments.map(
    (a) => `${attachmentBaseDir}/${sanitizeFilename(a.filename)}`
  );

  const sanitizedSubject = sanitizeFilename(email.subject);
  const generatedFileName = config.fileNamePattern
    .replace('{YYYY-MM-DD}', email.date)
    .replace('{Subject}', sanitizedSubject);

  const emlFileName = `Mail - ${email.date} - ${sanitizedSubject.slice(0, 60)}.eml`;
  const emlTargetPath = saveEmlCopy ? `${attachmentBaseDir}/${emlFileName}` : null;

  const targetNotePath =
    saveDestination === 'append-note' && appendNoteFilename
      ? `${projectDir}/${appendNoteFilename}`
      : `${projectDir}/${generatedFileName}`;

  const datePl = formatPolishDate(email.date);
  const attachmentEmbeds =
    activeAttachments.length > 0
      ? `\n\n## Załączniki\n${activeAttachments
          .map((a) => `- ![[${sanitizeFilename(a.filename)}]]`)
          .join('\n')}`
      : '';

  const tasksSection =
    extractedTasks.length > 0
      ? `\n\n# 🗓️ Zadania\n${extractedTasks.map((t) => t.markdownLine).join('\n')}`
      : '';

  let markdownPreview = '';
  if (saveDestination === 'new-file') {
    const indexBlock = project
      ? `index:\n  - "[[${project.masterNote}]]"`
      : `index: []`;
    const attachmentsYaml =
      activeAttachments.length > 0
        ? `attachments:\n${activeAttachments
            .map((a) => `  - "[[${sanitizeFilename(a.filename)}]]"`)
            .join('\n')}`
        : `attachments: []`;
    const emlYaml = emlTargetPath ? `\neml_source: "[[${emlFileName}]]"` : '';

    markdownPreview = `---
${indexBlock}
date: ${email.date}
message_id: "${email.messageId}"
thread_id: "${email.messageId}"
electrical_topic:
  - ${config.defaultElectricalTopic}
ai_category: ${category}
ai_priority: ${priority}
from: "${email.fromName} <${email.fromEmail}>"
to: "${email.toName} <${email.toEmail}>"
subject: "${email.subject.replace(/"/g, '\\"')}"
save_scope: ${saveScope}
${attachmentsYaml}${emlYaml}
status:
---
# ${datePl} - Od ${email.fromName}

${bodySource}${attachmentEmbeds}${tasksSection}
`;
  } else {
    markdownPreview = `<!-- Dopisano na końcu istniejącej notatki (CRLF-safe): ${targetNotePath} -->

---

## ${datePl} - Od ${email.fromName} (${email.subject})
> **Od:** ${email.fromName} <${email.fromEmail}>  
> **Message-ID:** \`${email.messageId}\` | **Kategoria AI:** ${category} | **Zakres:** ${saveScope}

${bodySource}${attachmentEmbeds}${tasksSection}
`;
  }

  let newContactPreview: string | null = null;
  if (!contact) {
    const guessedClient = email.fromEmail.split('@')[1]?.split('.')[0] || 'Klient';
    const clientCap = guessedClient.charAt(0).toUpperCase() + guessedClient.slice(1);
    const projectIndexLine = project ? `\n  - "[[${project.masterNote}]]"` : '';
    newContactPreview = `# Ścieżka: ${config.contactsDir}/${sanitizeFilename(email.fromName)}.md
---
index:${projectIndexLine || ' []'}
contact_name: ${email.fromName}
client:
  - "[[${clientCap}]]"
contact_email:
  - ${email.fromEmail}
contact_phone: []
contact_info: Dodano automatycznie z korespondencji
contact_project_info:
---
`;
  }

  return {
    matchedProject: project,
    matchMethod: method,
    matchedContact: contact,
    duplicateNotePath,
    detectedCategory: category,
    suggestedImapFolder: imapFolder,
    priorityLevel: priority,
    targetNotePath,
    attachmentTargetPaths,
    emlTargetPath,
    extractedTasks,
    quoteStripStats,
    sanitizedHtml,
    markdownPreview,
    newContactPreview,
  };
}
