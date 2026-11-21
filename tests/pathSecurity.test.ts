import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeRelativeVaultPath,
  isCloudLockFile,
  isDangerousAttachmentExtension,
  sanitizeFilename,
} from '../shared/pathSecurity.js';

describe('Path Security & Filename Sanitization', () => {
  it('blokuje Path Traversal (../, ..\\, ścieżki absolutne, bajty NULL)', () => {
    const malicious = [
      '../secret.txt',
      '11 - Projekty/../../Windows/win.ini',
      '..\\..\\Users\\Admin\\.ssh\\id_rsa',
      '/etc/passwd',
      'C:\\Windows\\System32\\cmd.exe',
      'folder/plik\0.md',
      '   ',
    ];

    for (const p of malicious) {
      assert.throws(() => assertSafeRelativeVaultPath(p), `Powinno rzucić błąd dla: ${p}`);
    }
  });

  it('akceptuje i normalizuje bezpieczne ścieżki względne z polskimi znakami', () => {
    const safe = assertSafeRelativeVaultPath(
      '11 - Notes - Trinitec Projekty\\26-125 - Rozdzielnica główna\\Attachments\\Schemat żółty.pdf'
    );
    assert.equal(
      safe,
      '11 - Notes - Trinitec Projekty/26-125 - Rozdzielnica główna/Attachments/Schemat żółty.pdf'
    );
  });

  it('sanityzuje nazwy plików zachowując polskie znaki i usuwając znaki zakazane Windows/Obsidian', () => {
    assert.equal(
      sanitizeFilename('Re: [26-125] Żółta rozdzielnica / schemat *2026*? #1 ^[test]'),
      'Re- -26-125- Żółta rozdzielnica - schemat -2026-- -1 --test-'
    );
    assert.equal(sanitizeFilename('../../evil.exe'), 'evil.exe');
    assert.equal(sanitizeFilename('CON'), '_CON');
    assert.equal(sanitizeFilename('nul.txt'), '_nul.txt');
    assert.equal(sanitizeFilename('...   '), 'Bez-nazwy');
  });

  it('wykrywa niebezpieczne rozszerzenia załączników oraz podwójne rozszerzenia', () => {
    for (const bad of [
      'instalator.exe',
      'skrypt.ps1',
      'polecenie.bat',
      'uruchom.cmd',
      'makro.vbs',
      'payload.js',
      'wygaszacz.scr',
      'pakiet.msi',
      'obraz.iso',
      'Faktura_2026.pdf.exe',
    ]) {
      assert.equal(isDangerousAttachmentExtension(bad), true, `Oczekiwano true dla ${bad}`);
    }

    for (const good of ['Schemat_26-125.pdf', 'BOM.xlsx', 'zdjecie.png', 'archiwum.zip']) {
      assert.equal(isDangerousAttachmentExtension(good), false, `Oczekiwano false dla ${good}`);
    }
  });

  it('rozpoznaje tymczasowe pliki blokad chmurowych (~$*, .tmp, .lock)', () => {
    assert.equal(isCloudLockFile('~$Kosztorys.xlsx'), true);
    assert.equal(isCloudLockFile('folder/notatka.md.tmp'), true);
    assert.equal(isCloudLockFile('sync.lock'), true);
    assert.equal(isCloudLockFile('Desktop.ini'), true);
    assert.equal(isCloudLockFile('2026-11-21 - Raport.md'), false);
  });
});
