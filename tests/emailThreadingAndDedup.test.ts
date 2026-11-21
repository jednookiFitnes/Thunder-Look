import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCanonicalThreadId,
  computeContentHash,
  extractObsidianTasks,
  normalizeSubjectForThread,
  processLinesCrlfSafe,
  stripQuotesAndSignaturesDetailed,
} from '../shared/textUtils.js';

describe('Email Threading, Deduplication, Quote Stripping & CRLF Preservation', () => {
  it('wyznacza spójne thread_id dla całego wątku wg RFC 5322 (References → In-Reply-To → Message-ID)', () => {
    const rootMsgId = '<msg-001@trinitec.pl>';
    const replyMsgId = '<msg-002@klient.pl>';
    const thirdMsgId = '<msg-003@trinitec.pl>';

    const t1 = buildCanonicalThreadId({ messageId: rootMsgId, subject: '26-125 Oferta' });
    const t2 = buildCanonicalThreadId({
      messageId: replyMsgId,
      inReplyTo: rootMsgId,
      references: [rootMsgId],
      subject: 'Re: 26-125 Oferta',
    });
    const t3 = buildCanonicalThreadId({
      messageId: thirdMsgId,
      inReplyTo: replyMsgId,
      references: [rootMsgId, replyMsgId],
      subject: 'Odp: Re: 26-125 Oferta',
    });

    assert.equal(t1, rootMsgId);
    assert.equal(t2, rootMsgId);
    assert.equal(t3, rootMsgId);
    assert.equal(normalizeSubjectForThread('Re: Odp: Fwd: [26-125] Oferta'), '[26-125] oferta');
  });

  it('wylicza deterministyczny contentHash dla deduplikacji niezależnie od prefiksów Re:/Odp: i CRLF', () => {
    const h1 = computeContentHash({
      fromEmail: 'Jan.Kowalski@Firma.pl',
      subject: 'Re: 26-125 Schemat',
      date: '2026-11-21T10:15:00Z',
      body: 'Proszę o potwierdzenie listy BOM.\r\nDziękuję.',
    });
    const h2 = computeContentHash({
      fromEmail: 'jan.kowalski@firma.pl',
      subject: '26-125 Schemat',
      date: '2026-11-21T18:00:00Z',
      body: 'Proszę o potwierdzenie listy BOM.\nDziękuję.',
    });
    const h3 = computeContentHash({
      fromEmail: 'jan.kowalski@firma.pl',
      subject: '26-125 Schemat',
      date: '2026-11-21T18:00:00Z',
      body: 'Inna treść wiadomości.',
    });

    assert.equal(h1, h2);
    assert.notEqual(h1, h3);
    assert.equal(h1.length, 16);
  });

  it('oczyszcza cytaty i stopki oraz wyodrębnia zadania Obsidian Tasks z datami', () => {
    const raw = [
      'Cześć Piotr,',
      '1. Proszę odesłać zaktualizowaną listę BOM do 2026-11-25 — pilne przed produkcją.',
      '2. Trzeba potwierdzić rysunek szafy do 28.11.2026.',
      '',
      'Pozdrawiam serdecznie,',
      'Anna Nowak',
      'Kierownik Projektu',
      '',
      'W dniu 2026-11-20 14:22 Piotr Świerk napisał:',
      '> Poprzednia długa wiadomość w wątku',
    ].join('\n');

    const stripped = stripQuotesAndSignaturesDetailed(raw);
    assert.ok(stripped.cleaned.includes('Proszę odesłać zaktualizowaną listę BOM'));
    assert.ok(!stripped.cleaned.includes('Poprzednia długa wiadomość'));
    assert.ok(!stripped.cleaned.includes('Kierownik Projektu'));
    assert.ok(stripped.savedPercent > 20);

    const tasks = extractObsidianTasks(stripped.cleaned, 'medium');
    assert.equal(tasks.length, 2);
    assert.ok(tasks[0].includes('📅 2026-11-25') && tasks[0].includes('⏫'));
    assert.ok(tasks[1].includes('📅 2026-11-28') && tasks[1].includes('🔼'));
  });

  it('zachowuje końce linii CRLF na Windows podczas modyfikacji notatek', () => {
    const crlfDoc = 'Linia 1\r\nLinia 2\r\n';
    const updated = processLinesCrlfSafe(crlfDoc, (lines) => [...lines, 'Linia 3']);
    assert.ok(updated.includes('\r\n'));
    assert.equal(updated, 'Linia 1\r\nLinia 2\r\n\r\nLinia 3');
  });
});
