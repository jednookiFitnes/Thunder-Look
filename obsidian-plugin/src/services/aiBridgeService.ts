import { execFile } from "child_process";
import { promisify } from "util";
import { App, Notice, TFile, normalizePath } from "obsidian";
import { assertSafeRelativeVaultPath } from "../../../shared/pathSecurity";
import { validateSafeRegexPattern } from "../../../shared/networkSecurity";
import { wrapUntrustedEmailForAi } from "../../../shared/promptSecurity";
import {
  AiAnalysisProposal,
  AiCategoryConfig,
  ParsedEmailMessage,
  TaskPriority,
  TrinitecPluginSettings,
} from "../types";
import { extractObsidianTasks, processLinesCrlfSafe } from "../utils/textUtils";
import { ImapService } from "./imapService";

const execFileAsync = promisify(execFile);

export function doesCategoryRuleMatch(
  rule: AiCategoryConfig,
  subject: string,
  body = ""
): boolean {
  const haystack = `${subject}\n${body}`.toLowerCase();
  if (rule.keywords.some((kw) => kw.trim().length > 0 && haystack.includes(kw.trim().toLowerCase()))) {
    return true;
  }
  if (rule.regexPattern && rule.regexPattern.trim().length > 0) {
    const check = validateSafeRegexPattern(rule.regexPattern);
    if (check.ok) {
      try {
        return new RegExp(rule.regexPattern.trim(), "i").test(`${subject}\n${body}`);
      } catch {
        return false;
      }
    }
  }
  return false;
}

/**
 * Moduł integracji z zewnętrznymi agentami AI (MCP / CLI — zero kluczy API).
 * Szanuje konfigurację aktywnych analiz, tryb Sugeruj vs Automatycznie oraz izolację Prompt Injection.
 */
export class AiBridgeService {
  private app: App;
  private settings: TrinitecPluginSettings;

  constructor(app: App, settings: TrinitecPluginSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TrinitecPluginSettings): void {
    this.settings = settings;
  }

  analyzeContent(subject: string, body: string): AiAnalysisProposal {
    const haystack = `${subject}\n${body}`.toLowerCase();

    let category = this.settings.defaultElectricalTopic;
    let suggestedImapFolder = this.settings.inboxFolder;
    let suggestedVaultTopic = this.settings.defaultElectricalTopic;

    if (this.settings.aiCategorizationEnabled) {
      for (const rule of this.settings.aiCategories) {
        if (doesCategoryRuleMatch(rule, subject, body)) {
          category = rule.label;
          suggestedImapFolder = rule.imapFolder;
          suggestedVaultTopic = rule.vaultTopic;
          break;
        }
      }
    }

    let priority: TaskPriority = "medium";
    if (this.settings.aiPrioritizationEnabled) {
      if (/(pilne|asap|natychmiast|awari|krytyczn|dzisiaj|zatrzymani)/i.test(haystack)) {
        priority = "high";
      } else if (/(informacyjnie|newsletter|fyi|bez pośpiechu)/i.test(haystack)) {
        priority = "low";
      }
    }

    const extractedTasks = this.settings.aiTaskExtractionEnabled
      ? extractObsidianTasks(body, priority)
      : [];

    return {
      category,
      suggestedImapFolder,
      suggestedVaultTopic,
      priority,
      extractedTasks,
      rationale: `Kategoria: ${category} | Priorytet: ${priority} | Zadania: ${extractedTasks.length}`,
    };
  }

  buildPromptSafeEmailContext(email: ParsedEmailMessage): {
    securityNotice: string;
    isolatedXml: string;
  } {
    return wrapUntrustedEmailForAi({
      uid: email.uid,
      folder: email.folder,
      from: email.fromRaw,
      to: email.toRaw,
      date: email.date,
      subject: email.subject,
      body: email.strippedMarkdownBody || email.textBody,
      attachments: email.attachments.map((a) => a.filename),
    });
  }

  async applyAnalysisToMarkdownNote(file: TFile, proposal: AiAnalysisProposal): Promise<void> {
    if (!this.settings.aiAnalyzeVaultNotes) {
      new Notice("Analiza notatek Markdown jest wyłączona w ustawieniach AI.");
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (this.settings.aiCategorizationEnabled) {
        fm.ai_category = proposal.category;
      }
      if (this.settings.aiPrioritizationEnabled) {
        fm.ai_priority = proposal.priority;
      }
    });

    if (this.settings.aiTaskExtractionEnabled && proposal.extractedTasks.length > 0) {
      await this.app.vault.process(file, (content) =>
        processLinesCrlfSafe(content, (lines) => {
          const existingText = lines.join("\n");
          const missing = proposal.extractedTasks.filter((t) => !existingText.includes(t));
          if (missing.length === 0) return lines;
          const hasSection = lines.some((l) => l.trim() === "# 🗓️ Zadania");
          return hasSection
            ? [...lines, ...missing]
            : [...lines, "", "# 🗓️ Zadania", ...missing];
        })
      );
    }

    new Notice(`Zastosowano analizę AI do notatki: ${file.basename}`);
  }

  async applyProposalToImapMessage(
    imapService: ImapService,
    email: ParsedEmailMessage,
    proposal: AiAnalysisProposal,
    forceApply = false
  ): Promise<void> {
    if (!email.uid || !email.folder) return;

    if (
      this.settings.aiPrioritizationEnabled &&
      (this.settings.aiPrioritizationMode === "auto" || forceApply) &&
      proposal.priority === "high"
    ) {
      await imapService.setMessageFlag(email.folder, email.uid, "\\Flagged", true);
    }

    if (
      this.settings.aiFolderRoutingEnabled &&
      (this.settings.aiFolderRoutingMode === "auto" || forceApply) &&
      proposal.suggestedImapFolder &&
      proposal.suggestedImapFolder !== email.folder
    ) {
      await imapService.moveMessage(email.folder, email.uid, proposal.suggestedImapFolder);
      new Notice(`Przeniesiono wiadomość do folderu IMAP: ${proposal.suggestedImapFolder}`);
    }
  }

  async moveNoteToObsidianFolder(file: TFile, targetFolderPath: string): Promise<void> {
    const safeFolder = assertSafeRelativeVaultPath(targetFolderPath);
    let current = "";
    for (const seg of safeFolder.split("/")) {
      current = current ? `${current}/${seg}` : seg;
      const norm = normalizePath(current);
      if (!this.app.vault.getAbstractFileByPath(norm)) {
        await this.app.vault.createFolder(norm);
      }
    }
    const targetPath = assertSafeRelativeVaultPath(`${safeFolder}/${file.name}`);
    await this.app.fileManager.renameFile(file, targetPath);
    new Notice(`Przeniesiono notatkę do: ${targetPath}`);
  }

  async invokeLocalCliTriage(folder = "INBOX"): Promise<string> {
    const exe = this.settings.cliExecutablePath.trim();
    if (!exe || /[;&|`$<>]/.test(exe)) {
      throw new Error("Niepoprawna ścieżka pliku wykonywalnego CLI (niedozwolone znaki powłoki).");
    }
    const safeFolder = folder.replace(/[\r\n\0]/g, "").trim() || "INBOX";
    const { stdout } = await execFileAsync(
      exe,
      ["triage", "--folder", safeFolder, "--json"],
      { timeout: 15_000, maxBuffer: 2 * 1024 * 1024, shell: false }
    );
    return stdout;
  }
}
