'use strict';
// node server/services/emailFollowUp/htmlText.test.js   (no database, no network)
const assert = require('assert');
const { htmlToText, extractBodyReadable, cleanStoredForDisplay } = require('./htmlText');

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// styles, scripts, comments and the head never reach the text
{
  const html = `<html><head><title>Hi</title><style type="text/css">p { margin:0; } .x { color:#333; font-family: Arial }
  @media (max-width:600px) { .a { width:100% } }</style></head><body>
  <!--[if mte]><style>td{padding:0}</style><![endif]-->
  <script>var x = 1;</script>
  <p style="margin:0;color:red">Hello Dave,</p><p>Thanks for the quote.</p></body></html>`;
  const t = htmlToText(html);
  assert.strictEqual(t, 'Hello Dave,\n\nThanks for the quote.');
  assert.doesNotMatch(t, /margin|font-family|@media|color|var x/);
}
// the formatting that matters is kept: line breaks, paragraphs, lists, tables, rules
{
  const t = htmlToText('<p>Dear Sam,</p><p>Please send:<br>the BAS<br>the ledger</p><ul><li>Invoice 20481</li><li>Statement</li></ul><table><tr><td>Total</td><td>$1,250.00</td></tr><tr><td>Due</td><td>14 Nov</td></tr></table><div>Regards</div><div>Dave</div>');
  assert.strictEqual(t, 'Dear Sam,\n\nPlease send:\nthe BAS\nthe ledger\n\n- Invoice 20481\n- Statement\n\nTotal $1,250.00\nDue 14 Nov\n\nRegards\nDave');
}
// links keep their address when the text does not show it
{
  assert.strictEqual(htmlToText('<a href="https://acme.com/pay?id=7">Pay now</a>'), 'Pay now (https://acme.com/pay?id=7)');
  assert.strictEqual(htmlToText('<a href="https://acme.com">acme.com</a>'), 'acme.com');
  assert.strictEqual(htmlToText('<a href="mailto:dave@acme.com">Dave</a>'), 'Dave (dave@acme.com)');
  assert.strictEqual(htmlToText(`<a href="https://t.example.com/${'x'.repeat(200)}">Click</a>`), 'Click', 'a long tracking address is left out');
}
// entities, including numeric ones, and text that merely looks like a tag
{
  const t = htmlToText('<p>Fish&nbsp;&amp;&nbsp;chips &ndash; &pound;5 &#8217;ok&#x2019; 3 &lt; 5 &lt;b&gt;</p>');
  assert.strictEqual(t, 'Fish & chips – £5 ’ok’ 3 < 5 <b>');
}
// a quoted reply becomes "> " lines, nested ones deeper
{
  const t = htmlToText('<div>I agree.</div><blockquote>On Monday Dave wrote:<br>I will fix it by Friday.<blockquote>Can you fix it?</blockquote></blockquote>');
  assert.match(t, /^I agree\.\n\n> On Monday Dave wrote:\n> I will fix it by Friday\.\n> > Can you fix it\?$/);
}
// padding characters used by marketing mail are removed; an unclosed style does not leak
{
  assert.strictEqual(htmlToText('<p>Hi​‌­ there</p>'), 'Hi there');
  assert.strictEqual(htmlToText('<p>Hello</p><style>p{color:red}'), 'Hello');
}
// the Gmail payload walk: plain wins, HTML is the fallback, nested parts are searched
{
  const plain = { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64('Plain text body') } }, { mimeType: 'text/html', body: { data: b64('<p>Html body</p>') } }] };
  assert.strictEqual(extractBodyReadable(plain), 'Plain text body');
  const htmlOnly = { mimeType: 'multipart/related', parts: [{ mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/html', body: { data: b64('<style>p{margin:0}</style><p>Only HTML</p><p>Two</p>') } }] }] };
  assert.strictEqual(extractBodyReadable(htmlOnly), 'Only HTML\n\nTwo');
  assert.strictEqual(extractBodyReadable({ mimeType: 'text/html', body: { data: b64('<p>Top</p>') } }), 'Top');
  assert.strictEqual(extractBodyReadable(null), '');
}
// messages stored before: the style rules are taken out of what is shown, real text is untouched
{
  const legacy = 'p { margin: 0; } .ExternalClass { width: 100%; } @media only screen and (max-width: 600px) { .x { width: 100% !important; } } Hello Dave , thanks for the quote &nbsp; I will send it Friday .';
  const shown = cleanStoredForDisplay(legacy);
  assert.doesNotMatch(shown, /margin|ExternalClass|@media|width/);
  assert.match(shown, /^Hello Dave , thanks for the quote I will send it Friday \.$/);
  const plainText = 'Hi Dave,\n\nI will fix the hot water by Friday.\nCheers';
  assert.strictEqual(cleanStoredForDisplay(plainText), plainText, 'ordinary text is returned exactly as stored');
  assert.strictEqual(cleanStoredForDisplay('Use {braces} in a sentence: yes'), 'Use {braces} in a sentence: yes');
}

console.log('htmlText tests passed');
