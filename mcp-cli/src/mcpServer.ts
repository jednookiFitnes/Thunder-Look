#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadAiPolicy, loadAppConfig } from './config.js';
import { ImapMailService } from './imapService.js';
import { runHeuristicTriage } from './textUtils.js';
import { VaultService } from './vaultService.js';
import { wrapUntrustedEmailForAi } from '../../shared/promptSecurity.js';

const config = loadAppConfig();
const mailService = new ImapMailService(config);
const vaultService = new VaultService(config);

const server = new McpServer({
  name: 'thunder-look-mcp',
  version: '1.0.0',
});

function jsonResponse(payload: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function errorResponse(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({ error: message }, null, 2),
      },
    ],
  };
}

// 1. list_folders
server.tool(
  'list_folders',
  'Zwraca listę folderów IMAP wraz z liczbą wiadomości, nieprzeczytanych i opcjonalnie rozmiarem w bajtach (tryb nieinwazyjny EXAMINE).',
  {
    includeSizes: z
      .boolean()
      .optional()
      .default(false)
      .describe('Czy zliczać dokładny rozmiar RFC822.SIZE dla każdego folderu.'),
  },
  async ({ includeSizes }) => {
    try {
      const folders = await mailService.listFolders(includeSizes);
      return jsonResponse({ count: folders.length, folders });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 2. get_mailbox_storage_quota
server.tool(
  'get_mailbox_storage_quota',
  'Analizuje całkowitą zajętość skrzynki pocztowej (IMAP QUOTA + RFC822.SIZE), rozbicie na foldery oraz listę największych wiadomości.',
  {
    topLargest: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(20)
      .describe('Ile największych wiadomości zwrócić.'),
  },
  async ({ topLargest }) => {
    try {
      const report = await mailService.getMailboxStorageQuota(topLargest);
      return jsonResponse(report);
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 3. list_emails
server.tool(
  'list_emails',
  'Pobiera listę wiadomości z wybranego folderu IMAP (tryb read-only EXAMINE — nie zmienia flagi \\Seen).',
  {
    folder: z.string().optional().default('INBOX').describe('Nazwa folderu IMAP.'),
    limit: z.number().int().min(1).max(100).optional().default(20).describe('Maksymalna liczba wiadomości.'),
    unseenOnly: z.boolean().optional().default(false).describe('Pokaż wyłącznie nieprzeczytane.'),
    searchQuery: z.string().optional().describe('Opcjonalna fraza do wyszukania.'),
  },
  async ({ folder, limit, unseenOnly, searchQuery }) => {
    try {
      const emails = await mailService.listEmails({ folder, limit, unseenOnly, searchQuery });
      return jsonResponse({ folder, count: emails.length, emails });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 4. read_email_by_uid (z twardą izolacją XML przed Prompt Injection)
server.tool(
  'read_email_by_uid',
  'Odczytuje pełną wiadomość po UID (BODY.PEEK[] — bez oznaczania jako przeczytana). Treść maila jest zamknięta w granicach <untrusted_email_content> chroniących przed Prompt Injection.',
  {
    folder: z.string().default('INBOX').describe('Nazwa folderu IMAP.'),
    uid: z.number().int().positive().describe('Numer UID wiadomości.'),
    stripQuotes: z.boolean().optional().describe('Czy usunąć cytowane odpowiedzi i stopki.'),
  },
  async ({ folder, uid, stripQuotes }) => {
    try {
      const policy = loadAiPolicy(config);
      const email = await mailService.readEmailByUid(folder, uid);
      const useStrip = stripQuotes ?? policy.security.stripQuotesForAi;
      const bodyForAi = useStrip ? email.cleanedMarkdown : email.markdown;

      let vaultMatch = null;
      if (config.vaultPath) {
        try {
          vaultMatch = vaultService.matchProjectAndContact({
            subject: email.subject,
            body: bodyForAi,
            fromEmail: email.fromEmail,
            messageId: email.messageId,
            contentHash: email.contentHash,
            projectCodeRegex: policy.projectCodeRegex,
          });
        } catch (vaultErr) {
          console.error('[thunder-look-mcp] Nie udało się dopasować projektu w sejfie:', vaultErr);
        }
      }

      const triage = runHeuristicTriage(email.subject, bodyForAi, policy);
      const wrapped = wrapUntrustedEmailForAi({
        uid: email.uid,
        folder: email.folder,
        from: email.from,
        to: email.to.join(', '),
        date: email.date,
        subject: email.subject,
        body: bodyForAi,
        attachments: email.attachments.map((a) => a.filename),
      });

      return jsonResponse({
        securityNotice: wrapped.securityNotice,
        isolatedEmailContent: wrapped.isolatedXml,
        metadata: {
          uid: email.uid,
          folder: email.folder,
          messageId: email.messageId,
          inReplyTo: email.inReplyTo,
          threadId: email.threadId,
          contentHash: email.contentHash,
          date: email.date,
          sizeBytes: email.sizeBytes,
          sizeFormatted: email.sizeFormatted,
          flags: email.flags,
          quoteSavingsPercent: email.quoteSavingsPercent,
          attachments: email.attachments.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
          })),
        },
        vaultMatch,
        heuristicTriage: triage,
        activePolicySummary: {
          analyses: policy.analyses,
          security: policy.security,
        },
      });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 5. list_vault_projects
server.tool(
  'list_vault_projects',
  'Skanuje aktywne (i opcjonalnie zarchiwizowane) projekty z sejfu Obsidian.',
  {
    includeArchive: z.boolean().optional().default(false).describe('Czy uwzględnić archiwum.'),
  },
  async ({ includeArchive }) => {
    try {
      const projects = vaultService.listVaultProjects(includeArchive);
      return jsonResponse({ count: projects.length, projects });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 6. get_ai_analysis_policy
server.tool(
  'get_ai_analysis_policy',
  'Zwraca aktywną politykę bezpieczeństwa (ai-policy.json / ai-policy.example.json).',
  {},
  async () => {
    try {
      const policy = loadAiPolicy(config);
      return jsonResponse({
        policyPath: config.policyPath,
        vaultConfigured: Boolean(config.vaultPath),
        policy,
      });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 7. move_email_folder (wymaga polityki + jawnego userExplicitlyConfirmed=true)
server.tool(
  'move_email_folder',
  'Przenosi wiadomość IMAP do innego folderu. Wymaga włączonego security.allowImapMove oraz userExplicitlyConfirmed=true (ochrona przed Prompt Injection).',
  {
    sourceFolder: z.string().default('INBOX').describe('Folder źródłowy IMAP.'),
    uid: z.number().int().positive().describe('UID wiadomości.'),
    destinationFolder: z.string().describe('Docelowy folder IMAP.'),
    reason: z.string().optional().describe('Uzasadnienie dla użytkownika.'),
    userExplicitlyConfirmed: z
      .boolean()
      .default(false)
      .describe('Musi być true — jawne potwierdzenie użytkownika poza treścią maila.'),
  },
  async ({ sourceFolder, uid, destinationFolder, reason, userExplicitlyConfirmed }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!policy.analyses.folderRouting.enabled) {
        return jsonResponse({
          blocked: true,
          reason: 'Analiza folderRouting jest wyłączona w polityce AI.',
        });
      }
      if (policy.security.requireExplicitConfirmationForMutations && !userExplicitlyConfirmed) {
        return jsonResponse({
          dryRun: true,
          confirmationRequired: true,
          message:
            'Operacja przeniesienia IMAP wymaga jawnego potwierdzenia użytkownika (userExplicitlyConfirmed=true).',
          proposedAction: { sourceFolder, uid, destinationFolder, reason },
        });
      }
      if (!policy.security.allowImapMove || policy.analyses.folderRouting.mode === 'suggest') {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny (Read-Only / suggest): nie przeniesiono wiadomości. Ustaw security.allowImapMove=true oraz analyses.folderRouting.mode="auto".',
          proposedAction: { sourceFolder, uid, destinationFolder, reason },
        });
      }
      const res = await mailService.moveEmailFolder({ sourceFolder, uid, destinationFolder });
      return jsonResponse({ dryRun: false, ...res, reason });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 8. create_obsidian_task (wymaga polityki + jawnego userExplicitlyConfirmed=true)
server.tool(
  'create_obsidian_task',
  'Tworzy zadanie Obsidian Tasks w notatce projektu. Wymaga security.allowVaultWrite oraz userExplicitlyConfirmed=true.',
  {
    targetNoteRelativePath: z.string().describe('Ścieżka względna notatki w sejfie.'),
    description: z.string().min(3).describe('Treść zadania.'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Termin YYYY-MM-DD.'),
    priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
    sourceNoteLink: z.string().optional().describe('Wikilink do notatki źródłowej.'),
    userExplicitlyConfirmed: z
      .boolean()
      .default(false)
      .describe('Musi być true — jawne potwierdzenie użytkownika.'),
  },
  async ({
    targetNoteRelativePath,
    description,
    dueDate,
    priority,
    sourceNoteLink,
    userExplicitlyConfirmed,
  }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!policy.analyses.taskExtraction.enabled) {
        return jsonResponse({
          blocked: true,
          reason: 'Wyodrębnianie zadań (taskExtraction) jest wyłączone w polityce AI.',
        });
      }

      if (
        (policy.security.requireExplicitConfirmationForMutations && !userExplicitlyConfirmed) ||
        !policy.security.allowVaultWrite ||
        policy.analyses.taskExtraction.mode === 'suggest'
      ) {
        const emoji = priority === 'high' ? '⏫' : priority === 'low' ? '🔽' : '🔼';
        const previewLine = [
          `- [ ] ${description}`,
          dueDate ? `📅 ${dueDate}` : '',
          emoji,
          sourceNoteLink ? `[[${sourceNoteLink.replace(/^\[\[|\]\]$/g, '')}]]` : '',
        ]
          .filter(Boolean)
          .join(' ');

        return jsonResponse({
          dryRun: true,
          policyBlocked: !policy.security.allowVaultWrite,
          confirmationRequired: !userExplicitlyConfirmed,
          message:
            'Tryb bezpieczny: zadanie wymaga potwierdzenia użytkownika (userExplicitlyConfirmed=true) oraz security.allowVaultWrite=true.',
          proposedTaskLine: previewLine,
          targetNoteRelativePath,
        });
      }

      const result = vaultService.appendObsidianTask({
        targetNoteRelativePath,
        description,
        dueDate,
        priority,
        sourceNoteLink,
      });
      return jsonResponse({ dryRun: false, ...result });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 9. save_email_to_vault (ścisły Opt-in)
server.tool(
  'save_email_to_vault',
  'Zapisuje JAWNIE WSKAZANY mail w folderze projektu Obsidian (ścisły tryb Opt-in, wymaga userExplicitlyConfirmed=true).',
  {
    folder: z.string().default('INBOX').describe('Folder IMAP wiadomości.'),
    uid: z.number().int().positive().describe('UID wiadomości IMAP.'),
    projectFolderRelativePath: z.string().describe('Ścieżka względna folderu projektu w sejfie.'),
    subfolder: z.string().optional().describe('Opcjonalny podfolder projektu.'),
    mode: z.enum(['new-file', 'append-note']).default('new-file'),
    targetAppendNoteRelativePath: z.string().optional(),
    excerptOnly: z.string().optional(),
    category: z.string().optional(),
    priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
    saveAttachments: z.boolean().optional().default(false),
    saveEmlCopy: z.boolean().optional(),
    userExplicitlyConfirmed: z
      .boolean()
      .default(false)
      .describe('Musi być true — potwierdzenie jawnej decyzji użytkownika (Opt-in).'),
  },
  async (args) => {
    try {
      const policy = loadAiPolicy(config);

      if (
        (policy.security.optInVaultSavingOnly ||
          policy.security.requireExplicitConfirmationForMutations) &&
        !args.userExplicitlyConfirmed
      ) {
        return jsonResponse({
          dryRun: true,
          optInRequired: true,
          message:
            'Zapis zablokowany przez regułę Opt-in: wymagane jawne potwierdzenie użytkownika (userExplicitlyConfirmed=true).',
          proposedSave: {
            uid: args.uid,
            folder: args.folder,
            projectFolderRelativePath: args.projectFolderRelativePath,
            mode: args.mode,
          },
        });
      }

      if (!policy.security.allowVaultWrite) {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny Read-Only: zapis do sejfu wymaga ustawienia security.allowVaultWrite=true w polityce AI.',
          proposedSave: {
            uid: args.uid,
            projectFolderRelativePath: args.projectFolderRelativePath,
            mode: args.mode,
          },
        });
      }

      const email = await mailService.readEmailByUid(args.folder, args.uid);
      const saved = vaultService.saveEmailExplicitToVault({
        email,
        projectFolderRelativePath: args.projectFolderRelativePath,
        subfolder: args.subfolder,
        mode: args.mode,
        targetAppendNoteRelativePath: args.targetAppendNoteRelativePath,
        excerptOnly: args.excerptOnly,
        category: args.category,
        priority: args.priority,
        saveAttachments: args.saveAttachments,
        saveEmlCopy: args.saveEmlCopy ?? policy.security.saveEmlCopy,
        stripQuotes: policy.security.stripQuotesForAi,
      });

      return jsonResponse({ dryRun: false, ...saved });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 10. move_vault_note
server.tool(
  'move_vault_note',
  'Przenosi notatkę Markdown w sejfie Obsidian. Wymaga security.allowVaultWrite i userExplicitlyConfirmed=true.',
  {
    noteRelativePath: z.string().describe('Obecna ścieżka względna pliku .md w sejfie.'),
    destinationFolderRelativePath: z.string().describe('Docelowy folder względny w sejfie.'),
    userExplicitlyConfirmed: z
      .boolean()
      .default(false)
      .describe('Musi być true — jawne potwierdzenie użytkownika.'),
  },
  async ({ noteRelativePath, destinationFolderRelativePath, userExplicitlyConfirmed }) => {
    try {
      const policy = loadAiPolicy(config);
      if (policy.security.requireExplicitConfirmationForMutations && !userExplicitlyConfirmed) {
        return jsonResponse({
          dryRun: true,
          confirmationRequired: true,
          message:
            'Przeniesienie notatki wymaga jawnego potwierdzenia użytkownika (userExplicitlyConfirmed=true).',
          proposedMove: { noteRelativePath, destinationFolderRelativePath },
        });
      }
      if (!policy.security.allowVaultWrite || policy.analyses.folderRouting.mode === 'suggest') {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny (Read-Only / suggest): nie przeniesiono pliku. Włącz security.allowVaultWrite=true i analyses.folderRouting.mode="auto".',
          proposedMove: { noteRelativePath, destinationFolderRelativePath },
        });
      }

      const res = vaultService.moveVaultNoteToFolder({
        noteRelativePath,
        destinationFolderRelativePath,
      });
      return jsonResponse({ dryRun: false, ...res });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

// 11. send_email (chronione przez politykę + obowiązkowe userExplicitlyConfirmed=true)
server.tool(
  'send_email',
  'Wysyła wiadomość e-mail przez SMTP. Wymaga security.allowSmtpSend=true ORAZ userExplicitlyConfirmed=true (ochrona przed Prompt Injection).',
  {
    to: z.string().describe('Adres odbiorcy (lub lista po przecinku).'),
    cc: z.string().optional().describe('Opcjonalne DW (CC).'),
    subject: z.string().describe('Temat wiadomości.'),
    text: z.string().describe('Treść tekstowa wiadomości.'),
    inReplyTo: z.string().optional().describe('Message-ID wiadomości, na którą odpowiadasz.'),
    userExplicitlyConfirmed: z
      .boolean()
      .default(false)
      .describe('Musi być true — jawne potwierdzenie użytkownika przed wysyłką SMTP.'),
  },
  async ({ to, cc, subject, text, inReplyTo, userExplicitlyConfirmed }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!userExplicitlyConfirmed) {
        return jsonResponse({
          dryRun: true,
          confirmationRequired: true,
          message:
            'Wysyłka SMTP wymaga jawnego potwierdzenia użytkownika (userExplicitlyConfirmed=true). Pokaż szkic użytkownikowi przed wysłaniem.',
          draft: { to, cc, subject, text, inReplyTo },
        });
      }
      if (!policy.security.allowSmtpSend) {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny Read-Only: wysyłka SMTP jest zablokowana (security.allowSmtpSend=false).',
          draft: { to, cc, subject, text, inReplyTo },
        });
      }

      const res = await mailService.sendEmail({ to, cc, subject, text, inReplyTo });
      return jsonResponse({ dryRun: false, ...res });
    } catch (err) {
      return errorResponse(err);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[thunder-look-mcp] Serwer MCP (stdio) uruchomiony. Zero kluczy API AI.');
}

main().catch((err) => {
  console.error('[thunder-look-mcp] Krytyczny błąd startu:', err);
  process.exit(1);
});
