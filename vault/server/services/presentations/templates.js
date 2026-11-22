'use strict';

// Reading colours and fonts out of an uploaded PowerPoint theme. This is deliberately shallow: a .pptx/.potx holds a whole
// design system in its masters, and copying that faithfully would mean a second slide engine. We take the few values Presentations
// can actually use — colours and font names — and let the person pick one of our layouts.

const JSZip = require('jszip');
const { sanitizeCustomTheme, PresentationError, text } = require('./schema');

const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_IMPORT_BYTES = 12 * 1024 * 1024;

function decodeXml(s) {
  return String(s || '').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Pull a usable Presentations theme out of the theme XML of a .pptx/.potx, or throw a 400 with a plain message. */
async function themeFromPptx(buffer, deps = {}) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new PresentationError('That theme file is empty.', 400);
  if (buffer.length > MAX_IMPORT_BYTES) throw new PresentationError('That theme file is too large (max 12MB).', 400);
  const loader = deps.JSZip || JSZip;
  let zip;
  try { zip = await loader.loadAsync(buffer); } catch { throw new PresentationError('That is not a readable PowerPoint theme file.', 400); }
  const names = Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/i.test(n)).sort();
  if (!names.length) throw new PresentationError('That PowerPoint file has no theme to read.', 400);
  let xml = '';
  try { xml = await zip.file(names[0]).async('string'); } catch { throw new PresentationError('That theme could not be read.', 400); }

  const colours = [...xml.matchAll(/<a:srgbClr\s+val="([0-9a-fA-F]{6})"/g)].map((m) => `#${m[1]}`);
  const scheme = xml.match(/<a:clrScheme\b[\s\S]*?<\/a:clrScheme>/i)?.[0] || '';
  const schemeColours = [...scheme.matchAll(/<a:(dk1|lt1|dk2|lt2|accent1|accent2|accent3)\b[\s\S]*?val="([0-9a-fA-F]{6})"/gi)]
    .map((m) => ({ role: m[1].toLowerCase(), hex: `#${m[2]}` }));
  const byRole = Object.fromEntries(schemeColours.map((c) => [c.role, c.hex]));
  const fonts = [...xml.matchAll(/<a:(major|minor)Font>[\s\S]*?<a:latin\s+typeface="([^"]+)"/gi)]
    .map((m) => ({ role: m[1].toLowerCase(), face: decodeXml(m[2]) }));
  const unique = [...new Set(colours)].filter((c) => HEX.test(c));
  if (!unique.length) throw new PresentationError('No colours were found in that theme.', 400);

  const picked = {
    label: text(fonts.find((f) => f.role === 'major')?.face || 'Imported theme', 60),
    bg: byRole.lt1 || unique[0],
    text: byRole.dk1 || unique[1] || unique[0],
    primary: byRole.accent1 || unique[2] || unique[1] || unique[0],
    muted: byRole.dk2 || unique[3] || unique[1] || unique[0],
    font: text(fonts.find((f) => f.role === 'major')?.face || fonts[0]?.face || 'Arial, sans-serif', 120),
    showLogo: false,
  };
  return sanitizeCustomTheme(picked);
}

module.exports = { MAX_IMPORT_BYTES, themeFromPptx };
