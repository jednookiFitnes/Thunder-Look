import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeEmailHtml } from '../shared/htmlSanitizer.js';

describe('HTML Email Sanitizer & XSS/Tracking Protection', () => {
  it('usuwa tagi <script>, zagnieżdżone <scr<script>ipt>, <iframe>, <object>, <embed>, <svg>', () => {
    const dirty = [
      '<p>Cześć</p>',
      '<script>alert(1)</script>',
      '<scr<script>ipt>alert(2)</scr</script>ipt>',
      '<iframe src="https://evil.test"></iframe>',
      '<object data="evil.swf"></object>',
      '<embed src="evil.bin" />',
      '<svg onload="alert(3)"><circle /></svg>',
    ].join('\n');

    const res = sanitizeEmailHtml(dirty, { blockRemoteImages: true });
    assert.ok(!/<script/i.test(res.bodyHtml), 'bodyHtml nie może zawierać <script>');
    assert.ok(!/<iframe/i.test(res.bodyHtml), 'bodyHtml nie może zawierać <iframe>');
    assert.ok(!/<object/i.test(res.bodyHtml), 'bodyHtml nie może zawierać <object>');
    assert.ok(!/<embed/i.test(res.bodyHtml), 'bodyHtml nie może zawierać <embed>');
    assert.ok(!/<svg/i.test(res.bodyHtml), 'bodyHtml nie może zawierać <svg>');
    assert.ok(res.bodyHtml.includes('<p>Cześć</p>'));
  });

  it('usuwa handlery on* (onerror, onload, onclick) oraz neutralizuje schematy javascript:/vbscript:/data:text/html', () => {
    const dirty = `
      <a href="javascript:alert('xss')" onclick="steal()">Kliknij</a>
      <img src="x" onerror="fetch('https://attacker.test')" />
      <a href="data:text/html,<script>alert(1)</script>">Zły link</a>
      <a href="https://trinitec.pl">Bezpieczny link</a>
    `;

    const res = sanitizeEmailHtml(dirty, { blockRemoteImages: true });
    assert.ok(!/onerror=/i.test(res.bodyHtml));
    assert.ok(!/onclick=/i.test(res.bodyHtml));
    assert.ok(!/javascript:/i.test(res.bodyHtml));
    assert.ok(!/data:text\/html/i.test(res.bodyHtml));
    assert.ok(res.bodyHtml.includes('rel="noopener noreferrer"'));
    assert.ok(res.bodyHtml.includes('target="_blank"'));
  });

  it('domyślnie blokuje zdalne obrazy i piksele śledzące oraz wymusza CSP img-src none', () => {
    const dirty = `
      <p>Raport dzienny</p>
      <img src="https://tracker.example.com/pixel.gif?uid=42" width="1" height="1" />
      <div style="background-image: url('https://tracker.example.com/bg.png')">Sekcja</div>
      <table background="https://tracker.example.com/table.png"><tr><td>OK</td></tr></table>
    `;

    const blocked = sanitizeEmailHtml(dirty, { blockRemoteImages: true });
    assert.equal(blocked.blockedRemoteImagesCount, 3);
    assert.ok(!blocked.bodyHtml.includes('https://tracker.example.com/pixel.gif'));
    assert.ok(blocked.cspHeader.includes("script-src 'none'"));
    assert.ok(blocked.cspHeader.includes("img-src 'none'"));
    assert.ok(blocked.html.includes('http-equiv="Content-Security-Policy"'));

    const allowed = sanitizeEmailHtml(dirty, { blockRemoteImages: false });
    assert.equal(allowed.blockedRemoteImagesCount, 0);
    assert.ok(allowed.cspHeader.includes('img-src https: http: cid: data:'));
    assert.ok(allowed.cspHeader.includes("script-src 'none'"));
  });

  it('zezwala na bezpieczne rasterowe obrazy data:image/png i cid: przy zablokowanych zdalnych obrazach', () => {
    const dirty = `<img src="data:image/png;base64,iVBORw0KGgo=" /><img src="cid:logo@trinitec" />`;
    const res = sanitizeEmailHtml(dirty, { blockRemoteImages: true });
    assert.equal(res.blockedRemoteImagesCount, 0);
    assert.ok(res.cspHeader.includes('img-src cid: data:'));
  });
});
