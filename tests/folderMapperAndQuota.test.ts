import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFolderTree,
  buildImapSearchCriteria,
  calculateMailboxTotals,
  deduplicateLargestMessages,
  detectFolderRole,
  evaluateMailRules,
  isSystemFolder,
  normalizeQuotaValues,
  parseSearchQuery,
  resolveSpecialFolders,
  validateImapFolderName,
  type ClientMailRule,
  type FolderDescriptor,
} from '../shared/folderMapper.js';
import {
  getActiveAccount,
  migrateAndValidateSettings,
  syncActiveAccountToTopLevel,
  syncTopLevelToActiveAccount,
} from '../obsidian-plugin/src/utils/settingsMigration.js';

describe('Folder Mapper, Search Parser, Quota Normalization, Rules & Settings v3 Migration', () => {
  it('wykrywa role folderów specjalnych dla Gmail (PL/EN), Outlook/M365 i Roundcube/Dovecot', () => {
    assert.equal(detectFolderRole('INBOX'), 'inbox');
    assert.equal(detectFolderRole('[Gmail]/Wysłane'), 'sent');
    assert.equal(detectFolderRole('[Gmail]/Kosz'), 'trash');
    assert.equal(detectFolderRole('[Gmail]/Wszystkie'), 'all');
    assert.equal(detectFolderRole('[Gmail]/Oznaczone gwiazdką'), 'starred');
    assert.equal(detectFolderRole('Sent Items'), 'sent');
    assert.equal(detectFolderRole('Deleted Items'), 'trash');
    assert.equal(detectFolderRole('Junk Email'), 'spam');
    assert.equal(detectFolderRole('INBOX.Archiwum'), 'archive');
    assert.equal(detectFolderRole('INBOX/!zakupy/ps5 - michal'), 'custom');
    assert.equal(detectFolderRole('CustomBox', '\\Trash'), 'trash');

    const gmailFolders: FolderDescriptor[] = [
      { path: 'INBOX', messages: 120, unseen: 5, uidValidity: '1' },
      { path: '[Gmail]/Wysłane', specialUse: '\\Sent', messages: 400, unseen: 0, uidValidity: '2' },
      { path: '[Gmail]/Kosz', specialUse: '\\Trash', messages: 18, unseen: 0, uidValidity: '3' },
      { path: '[Gmail]/Spam', specialUse: '\\Junk', messages: 4, unseen: 4, uidValidity: '4' },
      { path: '[Gmail]/Wszystkie', specialUse: '\\All', messages: 17205, unseen: 12, uidValidity: '5' },
    ];
    const resolved = resolveSpecialFolders(gmailFolders, 'imap.gmail.com');
    assert.equal(resolved.inbox, 'INBOX');
    assert.equal(resolved.sent, '[Gmail]/Wysłane');
    assert.equal(resolved.trash, '[Gmail]/Kosz');
    assert.equal(resolved.spam, '[Gmail]/Spam');
    assert.equal(resolved.all, '[Gmail]/Wszystkie');
    assert.equal(resolved.archive, '[Gmail]/Wszystkie');
  });

  it('chroni foldery systemowe przed usunięciem i waliduje nazwy folderów IMAP', () => {
    assert.equal(isSystemFolder('INBOX'), true);
    assert.equal(isSystemFolder('[Gmail]'), true);
    assert.equal(isSystemFolder('[Gmail]/Kosz'), true);
    assert.equal(isSystemFolder('INBOX/Projekty/P-2026'), false);

    assert.equal(validateImapFolderName('INBOX/Projekty/2026'), null);
    assert.notEqual(validateImapFolderName(''), null);
    assert.notEqual(validateImapFolderName('Folder*Wildcard'), null);
    assert.notEqual(validateImapFolderName('Folder%Bad'), null);
    assert.notEqual(validateImapFolderName('Folder/../Evil'), null);
  });

  it('buduje hierarchiczne drzewko zagnieżdżonych podfolderów z sumowaniem nieprzeczytanych', () => {
    const folders: FolderDescriptor[] = [
      { path: 'INBOX', delimiter: '/', messages: 40, unseen: 3, uidValidity: '1' },
      { path: '[Gmail]/Kosz', delimiter: '/', specialUse: '\\Trash', messages: 5, unseen: 0, uidValidity: '2' },
      { path: 'INBOX/!zakupy', delimiter: '/', messages: 10, unseen: 1, uidValidity: '3' },
      { path: 'INBOX/!zakupy/ps5 - michal', delimiter: '/', messages: 7, unseen: 4, uidValidity: '4' },
    ];

    const tree = buildFolderTree(folders);
    assert.equal(tree.systemNodes.length, 2);
    assert.equal(tree.systemNodes[0].role, 'inbox');
    assert.equal(tree.systemNodes[1].role, 'trash');

    assert.equal(tree.customNodes.length, 1);
    const zakupy = tree.customNodes[0];
    assert.equal(zakupy.name, '!zakupy');
    assert.equal(zakupy.totalUnseen, 5);
    assert.equal(zakupy.children.length, 1);
    assert.equal(zakupy.children[0].name, 'ps5 - michal');
    assert.equal(zakupy.children[0].fullPath, 'INBOX/!zakupy/ps5 - michal');
    assert.equal(zakupy.children[0].totalUnseen, 4);
  });

  it('parsuje zapytania strukturalne i buduje natywne kryteria IMAP SEARCH oraz Gmail X-GM-RAW', () => {
    const parsed = parseSearchQuery(
      'from:jan@trinitec.pl subject:"Rozdzielnica NN" has:attachment is:unread after:2026-01-01 before:2026-06-30 faktura'
    );
    assert.equal(parsed.from, 'jan@trinitec.pl');
    assert.equal(parsed.subject, 'Rozdzielnica NN');
    assert.equal(parsed.hasAttachment, true);
    assert.equal(parsed.isUnread, true);
    assert.equal(parsed.after, '2026-01-01');
    assert.equal(parsed.before, '2026-06-30');
    assert.equal(parsed.freeText, 'faktura');

    const imapCriteria = buildImapSearchCriteria(parsed, false);
    assert.equal(imapCriteria.from, 'jan@trinitec.pl');
    assert.equal(imapCriteria.subject, 'Rozdzielnica NN');
    assert.equal(imapCriteria.seen, false);
    assert.equal(imapCriteria.text, 'faktura');
    assert.ok(imapCriteria.since instanceof Date);
    assert.ok(imapCriteria.before instanceof Date);

    const gmailCriteria = buildImapSearchCriteria(parsed, true);
    assert.equal(gmailCriteria.gmraw, parsed.raw);
  });

  it('normalizuje jednostki GETQUOTAROOT (koryguje 1024-krotne zawyżenie np. 5120 GB -> 5 GB)', () => {
    const ONE_GB = 1024 * 1024 * 1024;
    // Błędnie pomnożone × 1024 przez serwer (5120 GB limit i 1.2 TB usage przy faktycznych 1.2 GB)
    const fixed = normalizeQuotaValues({
      rawUsage: Math.round(1.2 * ONE_GB * 1024),
      rawLimit: 5 * ONE_GB * 1024,
      calculatedBytes: Math.round(1.15 * ONE_GB),
      isGmail: false,
    });
    assert.equal(fixed.limitBytes, 5 * ONE_GB);
    assert.ok(Math.abs(fixed.usedBytes - Math.round(1.2 * ONE_GB)) < 1024);

    // Poprawne wartości Gmail (15 GB limit, 4.5 GB zajęte) nie powinny być dzielone
    const normalGmail = normalizeQuotaValues({
      rawUsage: Math.round(4.5 * ONE_GB),
      rawLimit: 15 * ONE_GB,
      calculatedBytes: Math.round(4.2 * ONE_GB),
      isGmail: true,
    });
    assert.equal(normalGmail.limitBytes, 15 * ONE_GB);
    assert.equal(normalGmail.usedBytes, Math.round(4.5 * ONE_GB));
  });

  it('poprawnie sumuje łączną liczbę wiadomości dla Gmail ([Gmail]/Wszystkie + Kosz + Spam) i deduplikuje największe maile', () => {
    const totals = calculateMailboxTotals([
      { path: 'INBOX', messages: 180, unseen: 10, totalBytes: 50_000_000, largestMessageBytes: 5_000_000 },
      { path: '[Gmail]/Wysłane', specialUse: '\\Sent', messages: 42, unseen: 0, totalBytes: 30_000_000, largestMessageBytes: 12_000_000 },
      { path: '[Gmail]/Wszystkie', specialUse: '\\All', messages: 17205, unseen: 12, totalBytes: 2_500_000_000, largestMessageBytes: 12_000_000 },
      { path: '[Gmail]/Kosz', specialUse: '\\Trash', messages: 15, unseen: 0, totalBytes: 10_000_000, largestMessageBytes: 2_000_000 },
      { path: '[Gmail]/Spam', specialUse: '\\Junk', messages: 5, unseen: 5, totalBytes: 1_000_000, largestMessageBytes: 300_000 },
    ]);
    assert.equal(totals.aggregateFolderPath, '[Gmail]/Wszystkie');
    assert.equal(totals.totalMessages, 17205 + 15 + 5);
    assert.equal(totals.totalCalculatedBytes, 2_511_000_000);

    const deduped = deduplicateLargestMessages([
      {
        uid: 1001,
        folder: '[Gmail]/Wszystkie',
        messageId: '<abc-123@example.com>',
        date: '2026-05-01T10:00:00Z',
        from: 'a@b.pl',
        subject: 'Projekt CAD',
        sizeBytes: 12_500_000,
      },
      {
        uid: 45,
        folder: '[Gmail]/Wysłane',
        messageId: '<ABC-123@example.com>',
        date: '2026-05-01T10:00:00Z',
        from: 'a@b.pl',
        subject: 'Projekt CAD',
        sizeBytes: 12_500_000,
      },
      {
        uid: 2002,
        folder: 'INBOX',
        messageId: '<def-456@example.com>',
        date: '2026-05-02T10:00:00Z',
        from: 'c@d.pl',
        subject: 'Oferta PDF',
        sizeBytes: 4_200_000,
      },
    ]);
    assert.equal(deduped.length, 2);
    assert.equal(deduped[0].folder, '[Gmail]/Wysłane');
    assert.deepEqual(deduped[0].alsoInFolders, ['[Gmail]/Wszystkie']);
  });

  it('ewaluuje reguły klienckie poczty (domena, temat, załącznik -> gwiazdka, przeczytane, przeniesienie)', () => {
    const rules: ClientMailRule[] = [
      {
        id: 'r1',
        name: 'Faktury od dostawcy',
        enabled: true,
        matchAll: true,
        conditions: [
          { field: 'domain', contains: 'trinitec.pl' },
          { field: 'subject', contains: 'faktura' },
          { field: 'hasAttachment', hasAttachment: true },
        ],
        actions: { star: true, moveToFolder: 'INBOX/Faktury' },
      },
      {
        id: 'r2',
        name: 'Newsletter',
        enabled: true,
        matchAll: false,
        conditions: [{ field: 'from', contains: 'newsletter@' }],
        actions: { markRead: true },
      },
    ];

    const res = evaluateMailRules(rules, {
      fromName: 'Księgowość',
      fromEmail: 'biuro@trinitec.pl',
      subject: 'Faktura VAT 12/2026',
      hasAttachments: true,
    });
    assert.equal(res.matchedRules.length, 1);
    assert.equal(res.mergedActions.star, true);
    assert.equal(res.mergedActions.moveToFolder, 'INBOX/Faktury');
    assert.equal(res.mergedActions.markRead, undefined);
  });

  it('bezpiecznie migruje ustawienia v1/v2 (pojedyncze konto) do v3 accounts[] bez utraty danych', () => {
    const legacyV2 = {
      settingsVersion: 2,
      mailProvider: 'gmail',
      mailAuthMethod: 'password',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapSecure: true,
      imapUser: 'swierk89@gmail.com',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 465,
      smtpSecure: true,
      senderName: 'Piotr Świerk',
      emailSignature: 'Pozdrawiam, Piotr',
      activeProjectsDir: '11 - Notes - Trinitec Projekty',
      optInStrictMode: true,
    };

    const migrated = migrateAndValidateSettings(legacyV2);
    assert.equal(migrated.settingsVersion, 3);
    assert.equal(migrated.accounts.length, 1);
    assert.equal(migrated.activeAccountId, 'default');
    assert.equal(migrated.accounts[0].imapUser, 'swierk89@gmail.com');
    assert.equal(migrated.accounts[0].mailProvider, 'gmail');
    assert.equal(migrated.accounts[0].senderName, 'Piotr Świerk');
    assert.equal(migrated.imapHost, 'imap.gmail.com');
    assert.equal(migrated.activeProjectsDir, '11 - Notes - Trinitec Projekty');

    // Synchronizacja dwustronna przy zmianie aktywnego konta
    migrated.imapUser = 'zmieniony@gmail.com';
    syncTopLevelToActiveAccount(migrated);
    assert.equal(getActiveAccount(migrated).imapUser, 'zmieniony@gmail.com');

    migrated.accounts[0].senderName = 'Nowe Imię';
    syncActiveAccountToTopLevel(migrated);
    assert.equal(migrated.senderName, 'Nowe Imię');
  });
});
