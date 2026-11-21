import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertSafeSmtpHeaderValue,
  resolveServerHostFromDomain,
  sanitizeSmtpHeader,
  validateImapHostname,
  validateSafeRegexPattern,
  validateWebImapPort,
} from '../shared/networkSecurity.js';
import { isBlockedPrivateIp } from '../serverImapTest.js';

describe('Network Security, SMTP Header Injection & Roundcube Domain Resolution', () => {
  it('odrzuca próby SMTP Header Injection (\\r, \\n, \\0)', () => {
    assert.throws(() => assertSafeSmtpHeaderValue('To', 'klient@firma.pl\r\nBcc: attacker@evil.test'));
    assert.throws(() => assertSafeSmtpHeaderValue('Subject', 'Temat\nX-Injected: 1'));
    assert.throws(() => assertSafeSmtpHeaderValue('In-Reply-To', '<id@domain>\0'));

    assert.equal(
      assertSafeSmtpHeaderValue('Subject', '  Oferta 26-125 — rozdzielnica  '),
      'Oferta 26-125 — rozdzielnica'
    );
    assert.equal(sanitizeSmtpHeader('Linia1\r\nLinia2'), 'Linia1 Linia2');
  });

  it('normalizuje pole Serwer / Domena z ekranu Roundcube (np. trinitec.pl)', () => {
    assert.deepEqual(resolveServerHostFromDomain('trinitec.pl'), {
      host: 'trinitec.pl',
      detectedPort: null,
      detectedSecure: null,
    });
    assert.deepEqual(resolveServerHostFromDomain('ssl://trinitec.pl:993'), {
      host: 'trinitec.pl',
      detectedPort: 993,
      detectedSecure: true,
    });
    assert.deepEqual(resolveServerHostFromDomain('https://poczta.trinitec.pl/roundcube'), {
      host: 'poczta.trinitec.pl',
      detectedPort: null,
      detectedSecure: null,
    });
    assert.deepEqual(resolveServerHostFromDomain('imap://mail.trinitec.pl:143'), {
      host: 'mail.trinitec.pl',
      detectedPort: 143,
      detectedSecure: false,
    });
  });

  it('blokuje lokalne hosty i prywatne adresy IP (ochrona SSRF) oraz niestandardowe porty', () => {
    assert.ok(validateImapHostname('localhost') !== null);
    assert.ok(validateImapHostname('db.internal') !== null);
    assert.ok(validateImapHostname('printer.local') !== null);
    assert.equal(validateImapHostname('trinitec.pl'), null);
    assert.equal(validateImapHostname('imap.gmail.com'), null);

    for (const priv of ['127.0.0.1', '10.0.0.5', '172.16.0.1', '192.168.1.10', '169.254.169.254', '::1', '::ffff:127.0.0.1']) {
      assert.equal(isBlockedPrivateIp(priv), true, `Powinno zablokować prywatne IP: ${priv}`);
    }
    assert.equal(isBlockedPrivateIp('8.8.8.8'), false);

    assert.equal(validateWebImapPort(993), null);
    assert.equal(validateWebImapPort(143), null);
    assert.ok(validateWebImapPort(22) !== null);
    assert.ok(validateWebImapPort(3306) !== null);
    assert.ok(validateWebImapPort(6379) !== null);
  });

  it('wykrywa niebezpieczne wzorce regex podatne na ReDoS', () => {
    assert.equal(validateSafeRegexPattern('(a+)+$').ok, false);
    assert.equal(validateSafeRegexPattern('(.*)*foo').ok, false);
    assert.equal(validateSafeRegexPattern('[niezamkniety').ok, false);
    assert.equal(validateSafeRegexPattern('\\b\\d{2}-\\d{3}\\b').ok, true);
    assert.equal(validateSafeRegexPattern('(oferta|zamówienie|bom)').ok, true);
  });
});
