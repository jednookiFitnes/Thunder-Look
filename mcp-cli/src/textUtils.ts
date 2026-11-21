import type { AiPolicyConfig, CategoryRule, PriorityLevel } from './config.js';

const naturalCollator = new Intl.Collator('pl', { numeric: true, sensitivity: 'base' });

export function naturalCompare(a: string, b: string): number {
  return naturalCollator.compare(a, b);
}

/**
 * Bezpieczne przetwarzanie linii tekstu z zachowaniem oryginalnych końców linii (CRLF vs LF).
 */
export function processLinesCrlfSafe(
  content: string,
  transformer: (lines: string[]) => string[]
): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const updated = transformer(lines);
  return updated.join(eol);
}

/**
 * Usuwa cytowane odpowiedzi (>, On ... wrote:, W dniu ... napisał(a):) i stopki po "-- ",
 * redukując rozmiar kontekstu AI i notatek Obsidian o 60-80%.
 */
export function stripQuotesAndSignatures(text: string): {
  cleaned: string;
  originalLength: number;
  cleanedLength: number;
  savedPercent: number;
} {
  const originalLength = text.length;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];

  const quoteStartPatterns = [
    /^On\s.+wrote:\s*$/i,
    /^W\s+dniu\s.+napisał(?:\(a\))?:\s*$/i,
    /^Dnia\s.+napisał(?:\(a\))?:\s*$/i,
    /^-{2,}\s*Original Message\s*-{2,}$/i,
    /^-{2,}\s*Wiadomość oryginalna\s*-{2,}$/i,
    /^From:\s.+$/i,
    /^Od:\s.+$/i,
  ];

  const signatureStartPatterns = [
    /^--\s*$/,
    /^Pozdrawiam(?: serdecznie)?,?\s*$/i,
    /^Z poważaniem,?\s*$/i,
    /^Best regards,?\s*$/i,
    /^Kind regards,?\s*$/i,
    /^Wysłane z (?:mojego )?(?:iPhone|iPad|Android|urządzenia)/i,
    /^Sent from my /i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('>')) {
      continue;
    }

    if (quoteStartPatterns.some((rx) => rx.test(trimmed))) {
      break;
    }

    if (i > 2 && signatureStartPatterns.some((rx) => rx.test(trimmed))) {
      break;
    }

    result.push(line);
  }

  const cleaned = result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const cleanedLength = cleaned.length;
  const savedPercent =
    originalLength > 0
      ? Math.max(0, Math.round(((originalLength - cleanedLength) / originalLength) * 100))
      : 0;

  return { cleaned, originalLength, cleanedLength, savedPercent };
}

export function sanitizeFilename(name: string, maxLen = 80): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'Bez-tematu').slice(0, maxLen).trim();
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let idx = 0;
  let value = bytes;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx++;
  }
  return `${value.toFixed(idx === 0 ? 0 : 2)} ${units[idx]}`;
}

export function priorityToEmoji(priority: PriorityLevel): string {
  switch (priority) {
    case 'high':
      return '⏫';
    case 'medium':
      return '🔼';
    case 'low':
      return '🔽';
  }
}

export function formatObsidianTaskLine(params: {
  description: string;
  dueDate?: string;
  priority?: PriorityLevel;
  sourceNoteLink?: string;
}): string {
  const parts = [`- [ ] ${params.description.trim()}`];
  if (params.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(params.dueDate)) {
    parts.push(`📅 ${params.dueDate}`);
  }
  if (params.priority) {
    parts.push(priorityToEmoji(params.priority));
  }
  if (params.sourceNoteLink) {
    const link = params.sourceNoteLink.startsWith('[[')
      ? params.sourceNoteLink
      : `[[${params.sourceNoteLink}]]`;
    parts.push(link);
  }
  return parts.join(' ');
}

export interface HeuristicTriageResult {
  projectCodes: string[];
  suggestedCategory: CategoryRule | null;
  suggestedPriority: PriorityLevel;
  suggestedImapFolder: string | null;
  suggestedVaultSubfolder: string;
  extractedTasks: Array<{
    description: string;
    dueDate?: string;
    priority: PriorityLevel;
    obsidianLine: string;
  }>;
}

/**
 * Lokalna analiza heurystyczna (zero API keys) — wspomaga CLI i dostarcza
 * wstępny kontekst dla agenta AI (np. Antigravity) połączonego przez MCP.
 */
export function runHeuristicTriage(
  subject: string,
  body: string,
  policy: AiPolicyConfig
): HeuristicTriageResult {
  const combined = `${subject}\n${body}`;
  const lower = combined.toLowerCase();

  let projectCodes: string[] = [];
  try {
    const rx = new RegExp(policy.projectCodeRegex || '\\b\\d{2}-\\d{3}\\b', 'g');
    const matches = combined.match(rx) || [];
    projectCodes = Array.from(new Set(matches));
  } catch {
    projectCodes = [];
  }

  let bestCategory: CategoryRule | null = null;
  let bestScore = 0;

  if (policy.analyses.categorization.enabled) {
    for (const cat of policy.categories) {
      let score = 0;
      for (const kw of cat.keywords) {
        if (kw && lower.includes(kw.toLowerCase())) {
          score += subject.toLowerCase().includes(kw.toLowerCase()) ? 3 : 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = cat;
      }
    }
  }

  let suggestedPriority: PriorityLevel = bestCategory?.defaultPriority || 'medium';
  if (policy.analyses.prioritization.enabled) {
    if (/(pilne|urgent|asap|awaria|przestój|natychmiast|dzisiaj|dziś)/i.test(combined)) {
      suggestedPriority = 'high';
    } else if (/(fyi|do wiadomości|informacyjnie|raport tygodniowy)/i.test(combined)) {
      suggestedPriority = 'low';
    }
  }

  const dueDateMatch = combined.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  const plDateMatch = combined.match(/\b(\d{2})\.(\d{2})\.(20\d{2})\b/);
  const dueDate = dueDateMatch
    ? dueDateMatch[1]
    : plDateMatch
    ? `${plDateMatch[3]}-${plDateMatch[2]}-${plDateMatch[1]}`
    : undefined;

  const extractedTasks: HeuristicTriageResult['extractedTasks'] = [];
  if (policy.analyses.taskExtraction.enabled) {
    const actionPatterns = [
      /(?:proszę\s+o|prosimy\s+o|należy|trzeba|do\s+wykonania|potrzebujemy|zrób|przygotuj|wyślij|sprawdź|zweryfikuj)\s+([^.!?\n]{8,140})/gi,
      /^[-*]\s+([^.\n]{8,140})$/gm,
    ];
    const seen = new Set<string>();
    for (const rx of actionPatterns) {
      let match: RegExpExecArray | null;
      while ((match = rx.exec(body)) !== null) {
        const desc = match[1].trim().replace(/\s+/g, ' ');
        const key = desc.toLowerCase();
        if (desc.length >= 8 && !seen.has(key)) {
          seen.add(key);
          extractedTasks.push({
            description: desc,
            dueDate,
            priority: suggestedPriority,
            obsidianLine: formatObsidianTaskLine({
              description: desc,
              dueDate,
              priority: suggestedPriority,
            }),
          });
          if (extractedTasks.length >= 5) break;
        }
      }
      if (extractedTasks.length >= 5) break;
    }
  }

  return {
    projectCodes,
    suggestedCategory: bestCategory,
    suggestedPriority,
    suggestedImapFolder:
      policy.analyses.folderRouting.enabled && bestCategory ? bestCategory.imapFolder : null,
    suggestedVaultSubfolder: bestCategory?.vaultSubfolder || '',
    extractedTasks,
  };
}
