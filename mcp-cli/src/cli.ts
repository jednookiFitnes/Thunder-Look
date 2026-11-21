#!/usr/bin/env node
import { Command } from 'commander';
import { loadAiPolicy, loadAppConfig, saveAiPolicy, type PriorityLevel } from './config.js';
import { ImapMailService } from './imapService.js';
import { runHeuristicTriage } from './textUtils.js';
import { VaultService } from './vaultService.js';

const config = loadAppConfig();
const mailService = new ImapMailService(config);
const vaultService = new VaultService(config);

const program = new Command();

program
  .name('trinitec-mail')
  .description('CLI dla Trinitec Mail & Obsidian Project Manager (roundcube.pl IMAP/SMTP + Praca Vault, zero kluczy API AI)')
  .version('1.0.0');

program
  .command('folders')
  .description('Wyświetla foldery IMAP wraz z liczbą wiadomości i rozmiarem')
  .option('--sizes', 'Policz dokładny rozmiar RFC822.SIZE każdego folderu', false)
  .action(async (opts: { sizes: boolean }) => {
    const folders = await mailService.listFolders(opts.sizes);
    console.log(JSON.stringify(folders, null, 2));
  });

program
  .command('quota')
  .description('Sprawdza zajętość skrzynki pocztowej (IMAP QUOTA + RFC822.SIZE) oraz największe wiadomości')
  .option('--top <number>', 'Liczba największych wiadomości', '20')
  .action(async (opts: { top: string }) => {
    const report = await mailService.getMailboxStorageQuota(Number(opts.top) || 20);
    console.log(JSON.stringify(report, null, 2));
  });

program
  .command('list')
  .description('Pobiera listę wiadomości z folderu IMAP (nieinwazyjny tryb EXAMINE)')
  .option('-f, --folder <folder>', 'Folder IMAP', 'INBOX')
  .option('-l, --limit <number>', 'Maksymalna liczba wiadomości', '20')
  .option('-u, --unseen', 'Tylko nieprzeczytane', false)
  .option('-q, --query <text>', 'Szukaj frazy')
  .action(async (opts: { folder: string; limit: string; unseen: boolean; query?: string }) => {
    const emails = await mailService.listEmails({
      folder: opts.folder,
      limit: Number(opts.limit) || 20,
      unseenOnly: opts.unseen,
      searchQuery: opts.query,
    });
    console.log(JSON.stringify(emails, null, 2));
  });

program
  .command('read <uid>')
  .description('Odczytuje pełną wiadomość po UID (BODY.PEEK[]) z dopasowaniem do projektu Obsidian i analizą heurystyczną')
  .option('-f, --folder <folder>', 'Folder IMAP', 'INBOX')
  .option('--raw-quotes', 'Nie usuwaj cytowanych odpowiedzi i stopek', false)
  .action(async (uidStr: string, opts: { folder: string; rawQuotes: boolean }) => {
    const policy = loadAiPolicy(config);
    const email = await mailService.readEmailByUid(opts.folder, Number(uidStr));
    const body = opts.rawQuotes ? email.markdown : email.cleanedMarkdown;
    const triage = runHeuristicTriage(email.subject, body, policy);
    const vaultMatch = config.vaultPath
      ? vaultService.matchProjectAndContact({
          subject: email.subject,
          body,
          fromEmail: email.fromEmail,
          messageId: email.messageId,
          projectCodeRegex: policy.projectCodeRegex,
        })
      : null;

    console.log(
      JSON.stringify(
        {
          uid: email.uid,
          folder: email.folder,
          messageId: email.messageId,
          subject: email.subject,
          from: email.from,
          date: email.date,
          sizeFormatted: email.sizeFormatted,
          quoteSavingsPercent: email.quoteSavingsPercent,
          attachments: email.attachments.map((a) => ({
            filename: a.filename,
            size: a.size,
            contentType: a.contentType,
          })),
          markdownBody: body,
          vaultMatch,
          triage,
        },
        null,
        2
      )
    );
  });

program
  .command('triage')
  .description('Analizuje najnowsze wiadomości pod kątem kategorii, priorytetu, projektu i zadań Obsidian Tasks (zero API keys)')
  .option('-f, --folder <folder>', 'Folder IMAP', 'INBOX')
  .option('-l, --limit <number>', 'Liczba wiadomości do analizy', '10')
  .action(async (opts: { folder: string; limit: string }) => {
    const policy = loadAiPolicy(config);
    const summaries = await mailService.listEmails({
      folder: opts.folder,
      limit: Number(opts.limit) || 10,
    });
    const results = [];
    for (const s of summaries) {
      const full = await mailService.readEmailByUid(opts.folder, s.uid);
      const body = policy.security.stripQuotesForAi ? full.cleanedMarkdown : full.markdown;
      const triage = runHeuristicTriage(full.subject, body, policy);
      const vaultMatch = config.vaultPath
        ? vaultService.matchProjectAndContact({
            subject: full.subject,
            body,
            fromEmail: full.fromEmail,
            messageId: full.messageId,
            projectCodeRegex: policy.projectCodeRegex,
          })
        : null;
      results.push({
        uid: full.uid,
        subject: full.subject,
        from: full.from,
        date: full.date,
        triage,
        vaultMatch,
      });
    }
    console.log(JSON.stringify({ policy: policy.analyses, results }, null, 2));
  });

program
  .command('projects')
  .description('Wyświetla projekty z sejfu Obsidian (OBSIDIAN_VAULT_PATH)')
  .option('--archive', 'Uwzględnij archiwum', false)
  .action((opts: { archive: boolean }) => {
    const projects = vaultService.listVaultProjects(opts.archive);
    console.log(JSON.stringify(projects, null, 2));
  });

program
  .command('move <uid> <destinationFolder>')
  .description('Przenosi wiadomość IMAP do innego folderu (wymaga allowImapMove lub --force)')
  .option('-f, --folder <folder>', 'Folder źródłowy IMAP', 'INBOX')
  .option('--force', 'Wymuś wykonanie poza trybem Read-Only', false)
  .action(async (uidStr: string, destinationFolder: string, opts: { folder: string; force: boolean }) => {
    const policy = loadAiPolicy(config);
    if (!opts.force && !policy.security.allowImapMove) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            message: 'Tryb Read-Only aktywny. Użyj --force lub ustaw security.allowImapMove=true w trinitec-ai-policy.json.',
            proposedMove: { uid: Number(uidStr), from: opts.folder, to: destinationFolder },
          },
          null,
          2
        )
      );
      return;
    }
    const res = await mailService.moveEmailFolder({
      sourceFolder: opts.folder,
      uid: Number(uidStr),
      destinationFolder,
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command('save <uid>')
  .description('Zapisuje jawnie wskazany mail do folderu projektu w sejfie Obsidian (ścisły Opt-in)')
  .requiredOption('-p, --project <relativePath>', 'Ścieżka względna folderu projektu w sejfie')
  .option('-f, --folder <folder>', 'Folder IMAP', 'INBOX')
  .option('--subfolder <name>', 'Podfolder w projekcie (np. Zamówienia)')
  .option('--append <notePath>', 'Dopisz do istniejącej notatki zamiast tworzyć nowy plik')
  .option('--attachments', 'Zapisz załączniki w Attachments/', false)
  .option('--eml', 'Zapisz kopię dowodową .eml', false)
  .action(
    async (
      uidStr: string,
      opts: {
        project: string;
        folder: string;
        subfolder?: string;
        append?: string;
        attachments: boolean;
        eml: boolean;
      }
    ) => {
      const email = await mailService.readEmailByUid(opts.folder, Number(uidStr));
      const res = vaultService.saveEmailExplicitToVault({
        email,
        projectFolderRelativePath: opts.project,
        subfolder: opts.subfolder,
        mode: opts.append ? 'append-note' : 'new-file',
        targetAppendNoteRelativePath: opts.append,
        saveAttachments: opts.attachments,
        saveEmlCopy: opts.eml,
      });
      console.log(JSON.stringify(res, null, 2));
    }
  );

program
  .command('to-task')
  .description('Dodaje zadanie Obsidian Tasks do notatki projektu')
  .requiredOption('-n, --note <relativePath>', 'Ścieżka względna notatki docelowej w sejfie')
  .requiredOption('-t, --text <description>', 'Treść zadania')
  .option('-d, --due <YYYY-MM-DD>', 'Termin wykonania')
  .option('--priority <level>', 'Priorytet: high | medium | low', 'medium')
  .option('--source <wikilink>', 'Opcjonalny link do notatki źródłowej')
  .action(
    (opts: {
      note: string;
      text: string;
      due?: string;
      priority: PriorityLevel;
      source?: string;
    }) => {
      const res = vaultService.appendObsidianTask({
        targetNoteRelativePath: opts.note,
        description: opts.text,
        dueDate: opts.due,
        priority: opts.priority,
        sourceNoteLink: opts.source,
      });
      console.log(JSON.stringify(res, null, 2));
    }
  );

program
  .command('send')
  .description('Wysyła e-mail przez SMTP i zapisuje kopię w Sent (wymaga allowSmtpSend lub --force)')
  .requiredOption('--to <email>', 'Odbiorca')
  .requiredOption('--subject <subject>', 'Temat')
  .requiredOption('--body <text>', 'Treść')
  .option('--cc <email>', 'DW')
  .option('--force', 'Wymuś wysyłkę poza trybem Read-Only', false)
  .action(async (opts: { to: string; subject: string; body: string; cc?: string; force: boolean }) => {
    const policy = loadAiPolicy(config);
    if (!opts.force && !policy.security.allowSmtpSend) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            message: 'Wysyłka SMTP zablokowana przez politykę Read-Only. Użyj --force lub ustaw security.allowSmtpSend=true.',
            draft: opts,
          },
          null,
          2
        )
      );
      return;
    }
    const res = await mailService.sendEmail({
      to: opts.to,
      cc: opts.cc,
      subject: opts.subject,
      text: opts.body,
    });
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command('policy')
  .description('Wyświetla lub aktualizuje flagi w trinitec-ai-policy.json')
  .option('--allow-imap-move <bool>', 'Zezwól na przenoszenie IMAP (true/false)')
  .option('--allow-vault-write <bool>', 'Zezwól na zapis do sejfu (true/false)')
  .option('--allow-smtp-send <bool>', 'Zezwól na wysyłkę SMTP (true/false)')
  .action(
    (opts: { allowImapMove?: string; allowVaultWrite?: string; allowSmtpSend?: string }) => {
      const policy = loadAiPolicy(config);
      let modified = false;
      if (opts.allowImapMove !== undefined) {
        policy.security.allowImapMove = opts.allowImapMove === 'true';
        modified = true;
      }
      if (opts.allowVaultWrite !== undefined) {
        policy.security.allowVaultWrite = opts.allowVaultWrite === 'true';
        modified = true;
      }
      if (opts.allowSmtpSend !== undefined) {
        policy.security.allowSmtpSend = opts.allowSmtpSend === 'true';
        modified = true;
      }
      if (modified) {
        saveAiPolicy(config, policy);
      }
      console.log(JSON.stringify({ policyPath: config.policyPath, modified, policy }, null, 2));
    }
  );

program.parseAsync(process.argv).catch((err) => {
  console.error('[trinitec-mail-cli] Błąd:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
