#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadAiPolicy, loadAppConfig } from './config.js';
import { ImapMailService } from './imapService.js';
import { runHeuristicTriage } from './textUtils.js';
import { VaultService } from './vaultService.js';

const config = loadAppConfig();
const mailService = new ImapMailService(config);
const vaultService = new VaultService(config);

const server = new McpServer({
  name: 'trinitec-mail-project-manager',
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
    includeSizes: z.boolean().optional().default(false).describe('Czy zliczać dokładny rozmiar RFC822.SIZE dla każdego folderu.'),
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
    topLargest: z.number().int().min(1).max(100).optional().default(20).describe('Ile największych wiadomości zwrócić.'),
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
    folder: z.string().optional().default('INBOX').describe('Nazwa folderu IMAP (np. INBOX, INBOX/Do-Vaulta).'),
    limit: z.number().int().min(1).max(100).optional().default(20).describe('Maksymalna liczba wiadomości.'),
    unseenOnly: z.boolean().optional().default(false).describe('Pokaż wyłącznie nieprzeczytane.'),
    searchQuery: z.string().optional().describe('Opcjonalna fraza do wyszukania w temacie, nadawcy lub treści.'),
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

// 4. read_email_by_uid
server.tool(
  'read_email_by_uid',
  'Odczytuje pełną wiadomość po UID (BODY.PEEK[] — bez oznaczania jako przeczytana), opcjonalnie oczyszczoną z cytatów i stopek oraz z dopasowaniem projektu z sejfu Obsidian.',
  {
    folder: z.string().default('INBOX').describe('Nazwa folderu IMAP.'),
    uid: z.number().int().positive().describe('Numer UID wiadomości.'),
    stripQuotes: z.boolean().optional().describe('Czy usunąć cytowane odpowiedzi i stopki (oszczędza 60-80% kontekstu).'),
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
            projectCodeRegex: policy.projectCodeRegex,
          });
        } catch (vaultErr) {
          console.error('[trinitec-mail] Nie udało się dopasować projektu w sejfie:', vaultErr);
        }
      }

      const triage = runHeuristicTriage(email.subject, bodyForAi, policy);

      return jsonResponse({
        uid: email.uid,
        folder: email.folder,
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        subject: email.subject,
        from: email.from,
        fromEmail: email.fromEmail,
        to: email.to,
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
        markdownBody: bodyForAi,
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
  'Skanuje aktywne (i opcjonalnie zarchiwizowane) projekty z sejfu Obsidian (11 - Notes - Trinitec Projekty) i zwraca ich kody, klientów oraz notatki główne.',
  {
    includeArchive: z.boolean().optional().default(false).describe('Czy uwzględnić folder 12 - Notes - Trinitec Archiwum.'),
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
  'Zwraca aktywną politykę bezpieczeństwa (trinitec-ai-policy.json): które typy analiz AI są włączone (suggest vs auto), zdefiniowane kategorie oraz flagi bezpieczeństwa Read-Only.',
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

// 7. move_email_folder (chronione przez politykę bezpieczeństwa)
server.tool(
  'move_email_folder',
  'Przenosi wiadomość IMAP do innego folderu (np. INBOX/Zlecenia). W domyślnym trybie Read-Only zwraca bezpieczną symulację (dryRun), dopóki użytkownik nie włączy security.allowImapMove w trinitec-ai-policy.json.',
  {
    sourceFolder: z.string().default('INBOX').describe('Folder źródłowy IMAP.'),
    uid: z.number().int().positive().describe('UID wiadomości.'),
    destinationFolder: z.string().describe('Docelowy folder IMAP (np. INBOX/Zlecenia).'),
    reason: z.string().optional().describe('Uzasadnienie kategoryzacji dla użytkownika.'),
  },
  async ({ sourceFolder, uid, destinationFolder, reason }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!policy.analyses.folderRouting.enabled) {
        return jsonResponse({
          blocked: true,
          reason: 'Analiza folderRouting jest wyłączona w trinitec-ai-policy.json.',
        });
      }
      if (!policy.security.allowImapMove || policy.analyses.folderRouting.mode === 'suggest') {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny (Read-Only / suggest): nie przeniesiono wiadomości. Aby zezwolić na automatyczne przenoszenie, ustaw security.allowImapMove=true oraz analyses.folderRouting.mode="auto" w trinitec-ai-policy.json.',
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

// 8. create_obsidian_task (chronione przez politykę bezpieczeństwa)
server.tool(
  'create_obsidian_task',
  'Tworzy zadanie w formacie Obsidian Tasks (- [ ] Opis 📅 YYYY-MM-DD ⏫) w notatce głównej projektu. W trybie suggest/Read-Only zwraca gotową linię zadania do zatwierdzenia.',
  {
    targetNoteRelativePath: z.string().describe('Ścieżka względna notatki w sejfie (np. 11 - Notes - Trinitec Projekty/26-125 - .../_26-125 - ....md).'),
    description: z.string().min(3).describe('Treść zadania.'),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Opcjonalny termin w formacie YYYY-MM-DD.'),
    priority: z.enum(['high', 'medium', 'low']).optional().default('medium').describe('Priorytet zadania (high=⏫, medium=🔼, low=🔽).'),
    sourceNoteLink: z.string().optional().describe('Opcjonalny wikilink do notatki źródłowej (np. Mail - 2026-04-12 - ...).'),
  },
  async ({ targetNoteRelativePath, description, dueDate, priority, sourceNoteLink }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!policy.analyses.taskExtraction.enabled) {
        return jsonResponse({
          blocked: true,
          reason: 'Wyodrębnianie zadań (taskExtraction) jest wyłączone w trinitec-ai-policy.json.',
        });
      }

      if (!policy.security.allowVaultWrite || policy.analyses.taskExtraction.mode === 'suggest') {
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
          policyBlocked: true,
          message:
            'Tryb bezpieczny (Read-Only / suggest): zadanie nie zostało jeszcze zapisane. Zaproponuj użytkownikowi lub włącz security.allowVaultWrite=true oraz analyses.taskExtraction.mode="auto".',
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
  'Zapisuje JAWNIE WSKAZANY mail (lub zaznaczony fragment) jako notatkę Markdown w folderze projektu Obsidian lub dopisuje go do istniejącej notatki (ścisły tryb Opt-in).',
  {
    folder: z.string().default('INBOX').describe('Folder IMAP wiadomości.'),
    uid: z.number().int().positive().describe('UID wiadomości IMAP.'),
    projectFolderRelativePath: z.string().describe('Ścieżka względna folderu projektu w sejfie.'),
    subfolder: z.string().optional().describe('Opcjonalny podfolder projektu (np. Zamówienia, Rysunki).'),
    mode: z.enum(['new-file', 'append-note']).default('new-file').describe('Osobny plik na mail lub dopisanie do istniejącej notatki.'),
    targetAppendNoteRelativePath: z.string().optional().describe('Wymagane gdy mode="append-note".'),
    excerptOnly: z.string().optional().describe('Opcjonalny fragment treści do zapisania zamiast całego maila.'),
    category: z.string().optional().describe('Kategoria (np. Zlecenie, Pytanie, Raport, Oferta).'),
    priority: z.enum(['high', 'medium', 'low']).optional().default('medium'),
    saveAttachments: z.boolean().optional().default(false).describe('Czy zapisać załączniki do podfolderu Attachments/.'),
    saveEmlCopy: z.boolean().optional().describe('Czy zapisać kopię dowodową .eml obok notatki.'),
    userExplicitlyConfirmed: z.boolean().default(false).describe('Musi być true — potwierdzenie jawnej decyzji użytkownika (Opt-in).'),
  },
  async (args) => {
    try {
      const policy = loadAiPolicy(config);

      if (policy.security.optInVaultSavingOnly && !args.userExplicitlyConfirmed) {
        return jsonResponse({
          dryRun: true,
          optInRequired: true,
          message:
            'Zapis zablokowany przez regułę Opt-in: bez wyraźnej zgody użytkownika nie zapisujemy maili do sejfu. Zapytaj użytkownika o potwierdzenie, a następnie wywołaj ponownie z userExplicitlyConfirmed=true.',
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
            'Tryb bezpieczny Read-Only: zapis do sejfu wymaga ustawienia security.allowVaultWrite=true w trinitec-ai-policy.json.',
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
  'Przenosi zapisaną notatkę Markdown w sejfie Obsidian do innego folderu (np. z folderu głównego projektu do Zamówienia/).',
  {
    noteRelativePath: z.string().describe('Obecna ścieżka względna pliku .md w sejfie.'),
    destinationFolderRelativePath: z.string().describe('Docelowy folder względny w sejfie.'),
  },
  async ({ noteRelativePath, destinationFolderRelativePath }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!policy.security.allowVaultWrite || policy.analyses.folderRouting.mode === 'suggest') {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny (Read-Only / suggest): nie przeniesiono pliku w sejfie. Włącz security.allowVaultWrite=true i analyses.folderRouting.mode="auto".',
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

// 11. send_email (chronione przez politykę bezpieczeństwa)
server.tool(
  'send_email',
  'Wysyła wiadomość e-mail przez SMTP (roundcube.pl) i zapisuje kopię w folderze Sent przez IMAP APPEND. W domyślnym trybie Read-Only zwraca szkic do akceptacji.',
  {
    to: z.string().describe('Adres odbiorcy (lub lista po przecinku).'),
    cc: z.string().optional().describe('Opcjonalne DW (CC).'),
    subject: z.string().describe('Temat wiadomości.'),
    text: z.string().describe('Treść tekstowa wiadomości.'),
    inReplyTo: z.string().optional().describe('Message-ID wiadomości, na którą odpowiadasz.'),
  },
  async ({ to, cc, subject, text, inReplyTo }) => {
    try {
      const policy = loadAiPolicy(config);
      if (!policy.security.allowSmtpSend) {
        return jsonResponse({
          dryRun: true,
          policyBlocked: true,
          message:
            'Tryb bezpieczny Read-Only: wysyłka SMTP jest zablokowana (security.allowSmtpSend=false). Pokaż użytkownikowi poniższy szkic lub odblokuj flagę w trinitec-ai-policy.json.',
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
  console.error('[trinitec-mail-mcp] Serwer MCP (stdio) uruchomiony. Zero kluczy API AI.');
}

main().catch((err) => {
  console.error('[trinitec-mail-mcp] Krytyczny błąd startu:', err);
  process.exit(1);
});
