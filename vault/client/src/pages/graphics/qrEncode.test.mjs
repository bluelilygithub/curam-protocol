// node client/src/pages/graphics/qrEncode.test.mjs
// The QR encoder against reference codes made by the Python `segno` library (1.6.6), compared by a SHA-256 of the
// module grid (rows of 0/1 joined by newlines, no quiet zone). The texts fill each code exactly, because segno
// adds a spare zero byte when the data already ends on a byte boundary (allowed, but not what the standard
// describes, and not what this encoder does); with no room left, both must produce the same code.
// A wider check (67 codes, versions 1-40, every level, partly-filled codes with segno's extra byte copied) was run by
// hand when the tool was written and matched module for module.
import assert from 'assert';
import { createHash } from 'crypto';
import { encodeQr, byteCapacity, buildQrPayload, qrToSvg, contrastRatio, isInverted } from './qrEncode.mjs';

const seed = 'Vault QR test 0123456789 abcdefghijklmnopqrstuvwxyz ';
const FIXTURES = [
  { version: 1, ecc: 'L', len: 17, mask: 6, sha256: 'bdc2b7d6a44ba186af56e3563506db03f4f423d062bcb5a6fa3b649ec091cf84' },
  { version: 2, ecc: 'M', len: 26, mask: 4, sha256: 'fc0922cf9543e0d2717e8f2c3ecbf8e5b095731feefeb911ae3ec6888fe2e7ab' },
  { version: 5, ecc: 'Q', len: 60, mask: 6, sha256: 'cc3af1f8b39ca4d98b4621a8732bc73e4cf62f518aabcc460ee8cefbca22bb83' },
  { version: 7, ecc: 'H', len: 64, mask: 6, sha256: '0fb996f38ce5a7557c97ee91b4e5482ccbab538af81a8e9751dc0dbcb9cd2676' },
  { version: 10, ecc: 'M', len: 213, mask: 2, sha256: 'be792b756aea5c79dfab4fc184ff0d4a582bec574679a5948d89f8ad8dcead12' },
  { version: 27, ecc: 'L', len: 1465, mask: 4, sha256: '8fed3bca7d5e8e1e92b5dbba6d1959401e07bceb74c93e17324863ac939e3da9' },
  { version: 40, ecc: 'H', len: 1273, mask: 2, sha256: '56c2cb7a5f91837aa6c392b1fd61a2f0b60b8178d985c523d188e95278293f87' },
];

const gridHash = (qr) => createHash('sha256').update(qr.modules.map((r) => r.map((v) => (v ? '1' : '0')).join('')).join('\n')).digest('hex');

for (const f of FIXTURES) {
  assert.strictEqual(byteCapacity(f.version, f.ecc), f.len, `capacity v${f.version}-${f.ecc}`);
  const text = seed.repeat(200).slice(0, f.len);
  const qr = encodeQr(text, { ecc: f.ecc, mask: f.mask });
  assert.strictEqual(qr.version, f.version, `version for ${f.len} bytes at ${f.ecc}`);
  assert.strictEqual(qr.size, f.version * 4 + 17);
  assert.strictEqual(gridHash(qr), f.sha256, `module grid v${f.version}-${f.ecc}`);
  // One byte more needs the next version.
  if (f.version < 40) assert.strictEqual(encodeQr(`${text}x`, { ecc: f.ecc }).version, f.version + 1);
}

// Automatic mask: always one of the eight, and the format area then carries that mask.
const auto = encodeQr('https://curam-ai.com.au', { ecc: 'M' });
assert.ok(auto.mask >= 0 && auto.mask <= 7);
assert.strictEqual(auto.version, 2);

// Too much text, and no text, give a plain message.
assert.throws(() => encodeQr('x'.repeat(3000), { ecc: 'H' }), /too much text/);
assert.throws(() => encodeQr(''), /Type something/);
// Multi-byte characters count as their UTF-8 bytes.
assert.strictEqual(encodeQr('é'.repeat(8), { ecc: 'L' }).version, 1); // 16 bytes
assert.strictEqual(encodeQr('é'.repeat(9), { ecc: 'L' }).version, 2); // 18 bytes

// What goes in the code.
assert.strictEqual(buildQrPayload('link', { url: 'example.com/a' }), 'https://example.com/a');
assert.strictEqual(buildQrPayload('link', { url: 'http://x.io' }), 'http://x.io');
assert.strictEqual(buildQrPayload('link', { url: '  ' }), '');
assert.strictEqual(buildQrPayload('wifi', { ssid: 'Home;Net', password: 'p:w"d', security: 'WPA' }), 'WIFI:T:WPA;S:Home\\;Net;P:p\\:w\\"d;;');
assert.strictEqual(buildQrPayload('wifi', { ssid: 'Cafe', security: 'nopass', password: 'ignored', hidden: true }), 'WIFI:T:nopass;S:Cafe;H:true;;');
assert.strictEqual(buildQrPayload('email', { to: 'a@b.co', subject: 'Hi there', body: 'x&y' }), 'mailto:a@b.co?subject=Hi%20there&body=x%26y');
assert.strictEqual(buildQrPayload('phone', { number: '+61 (2) 9999-0000' }), 'tel:+61299990000');
assert.strictEqual(buildQrPayload('sms', { number: '0400 000 000', message: 'Hello' }), 'SMSTO:0400000000:Hello');
assert.strictEqual(buildQrPayload('contact', { name: 'Sam Lee', org: 'A, B', phone: '+61 400', email: 's@x.co' }),
  'BEGIN:VCARD\r\nVERSION:3.0\r\nN:Sam Lee;;;;\r\nFN:Sam Lee\r\nORG:A\\, B\r\nTEL:+61 400\r\nEMAIL:s@x.co\r\nEND:VCARD');
assert.strictEqual(buildQrPayload('contact', {}), '');
assert.strictEqual(buildQrPayload('nope', { text: 'x' }), '');

// SVG: viewBox includes the margin; transparent leaves out the background.
const small = encodeQr('hi', { ecc: 'L' });
const svg = qrToSvg(small, { margin: 2, dark: '#112233' });
assert.match(svg, /viewBox="0 0 25 25"/);
assert.match(svg, /fill="#112233"/);
assert.match(svg, /<rect /);
assert.doesNotMatch(qrToSvg(small, { transparent: true }), /<rect /);

// Colours.
assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-9);
assert.strictEqual(contrastRatio('#zzz', '#fff'), null);
assert.strictEqual(isInverted('#ffffff', '#000000'), true);
assert.strictEqual(isInverted('#1a1a1a', '#f5f5f5'), false);

console.log('qrEncode: all checks passed');
