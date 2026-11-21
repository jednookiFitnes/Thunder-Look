import type { AiPolicyConfig, CategoryRule, PriorityLevel } from './config.js';
import {
  formatBytes,
  formatObsidianTaskLine,
  naturalCompare,
  priorityToEmoji,
  processLinesCrlfSafe,
  stripQuotesAndSignaturesDetailed,
} from '../../shared/textUtils.js';
import { sanitizeFilename } from '../../shared/pathSecurity.js';
import { validateSafeRegexPattern } from '../../shared/networkSecurity.js';

export {
  formatBytes,
  formatObsidianTaskLine,
  naturalCompare,
  priorityToEmoji,
  processLinesCrlfSafe,
  sanitizeFilename,
};

export function stripQuotesAndSignatures(text: string): {
  cleaned: string;
  originalLength: number;
  cleanedLength: number;
  savedPercent: number;
} {
  const res = stripQuotesAndSignaturesDetailed(text);
  return {
    cleaned: res.cleaned,
    originalLength: res.originalLength,
    cleanedLength: res.cleanedLength,
    savedPercent: res.savedPercent,
  };
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
 * wstępny kontekst dla agenta AI połączonego przez MCP.
 */
export function runHeuristicTriage(
  subject: string,
  body: string,
  policy: AiPolicyConfig
): HeuristicTriageResult {
  const combined = `${subject}\n${body}`;
  const lower = combined.toLowerCase();

  let projectCodes: string[] = [];
  const regexStr = policy.projectCodeRegex || '\\b\\d{2}-\\d{3}\\b';
  if (validateSafeRegexPattern(regexStr).ok) {
    try {
      const rx = new RegExp(regexStr, 'g');
      const matches = combined.match(rx) || [];
      projectCodes = Array.from(new Set(matches));
    } catch {
      projectCodes = [];
    }
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
      if (cat.regexPattern && validateSafeRegexPattern(cat.regexPattern).ok) {
        try {
          if (new RegExp(cat.regexPattern, 'i').test(combined)) {
            score += 4;
          }
        } catch {
          // ignore
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
