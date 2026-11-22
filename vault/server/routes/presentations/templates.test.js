'use strict';

// node server/routes/presentations/templates.test.js — pure theme-import checks, no server or database.

const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { themeFromPptx } = require('../../services/presentations/templates');
const { sanitizeCustomTheme, resolveTheme } = require('../../services/presentations/schema');

const THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Test">
  <a:themeElements>
    <a:clrScheme name="Test"><a:dk1><a:srgbClr val="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="333333"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="CC0000"/></a:accent1></a:clrScheme>
    <a:fontScheme name="Test"><a:majorFont><a:latin typeface="My Heading"/></a:majorFont><a:minorFont><a:latin typeface="My Body"/></a:minorFont></a:fontScheme>
  </a:themeElements>
</a:theme>`;

async function run() {
  const zip = new JSZip();
  zip.file('ppt/theme/theme1.xml', THEME_XML);
  zip.file('ppt/slides/slide1.xml', '<p:sld/>');
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const theme = await themeFromPptx(buffer, { JSZip });
  assert.equal(theme.bg, '#FFFFFF');
  assert.equal(theme.text, '#111111');
  assert.equal(theme.primary, '#CC0000');
  assert.equal(theme.muted, '#333333');
  assert.equal(theme.font, 'My Heading');
  assert.equal(theme.label, 'My Heading');
  assert.match(theme.id, /^custom-/);

  const saved = sanitizeCustomTheme({ id: 'paper', label: 'Mine', bg: 'not-a-colour', titleSize: 1000 });
  assert.notEqual(saved.id, 'paper', 'browser-supplied ids are not trusted');
  assert.equal(saved.bg, '#ffffff');
  assert.equal(saved.titleSize, 72);
  assert.equal(resolveTheme(saved).id, saved.id, 'a saved custom theme keeps its own id');
  assert.equal(resolveTheme(saved).bg, '#ffffff', 'a saved custom theme keeps sanitised colours');

  const empty = new JSZip();
  empty.file('notes.txt', 'nothing here');
  const emptyBuffer = await empty.generateAsync({ type: 'nodebuffer' });
  await assert.rejects(() => themeFromPptx(emptyBuffer, { JSZip }), /no theme/i);
  await assert.rejects(() => themeFromPptx(Buffer.from('not a zip'), { JSZip }), /not a readable/i);
  await assert.rejects(() => themeFromPptx(Buffer.alloc(0)), /empty/i);
}

run().then(() => console.log('presentations template tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
