// What "Download a page's CSS" hands over, built from what the server found (server/services/restyle/scrapeCss.js): one combined CSS file,
// a plain report of the page's design settings (Markdown and JSON), file names for a zip, and the page's top colours as brand colours.
// Pure functions, tested in server/services/restyle/restyleScrape.test.js.

import { toHex } from './editModel.mjs';

const SOURCE_LABEL = { linked: 'linked from the page', embedded: 'written inside the page', imported: 'imported by another style file' };

export const sourceLabel = (source) => SOURCE_LABEL[source] || source;

export function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A name safe to save a file under, in order and without duplicates: "02-main.css". */
export function fileNameFor(file, index) {
  const base = String(file.filename || 'styles').replace(/\.css$/i, '').replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'styles';
  return `${String(index + 1).padStart(2, '0')}-${base}.css`;
}

const note = (text) => `/* ${String(text).replace(/\*\//g, '* /')} */`;

/** Every file in one, in the order the page applies them, each under a comment saying where it came from. */
export function combineCss(files, { url = '', title = '' } = {}) {
  const head = [`${note(`CSS of ${title ? `"${title}" ` : ''}${url || 'the page'}`)}`, note(`${files.length} style file${files.length === 1 ? '' : 's'}, in the order the page applies them. Addresses inside are complete, so this works saved on its own.`)];
  const body = files.map((f) => `${note(`===== ${f.filename} (${sourceLabel(f.source)}${f.url ? `: ${f.url}` : ''}${f.media ? `; for ${f.media}` : ''}) =====`)}\n${f.css.trim()}`);
  return `${head.join('\n')}\n\n${body.join('\n\n')}\n`;
}

const table = (rows, columns) => {
  if (!rows.length) return '_None found._\n';
  const header = `| ${columns.map((c) => c.label).join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |`;
  return `${header}\n${rows.map((r) => `| ${columns.map((c) => String(c.get(r)).replace(/\|/g, '\\|')).join(' | ')} |`).join('\n')}\n`;
};
const valueCount = [{ label: 'Value', get: (r) => `\`${r.value}\`` }, { label: 'Times used', get: (r) => r.count }];

/** A plain report of the design settings the page's CSS sets, for a designer or developer to read. */
export function settingsMarkdown(result, { date = new Date() } = {}) {
  const s = result.summary;
  const out = [
    `# Design settings of ${result.title || result.finalUrl || result.url}`, '',
    `Page: ${result.finalUrl || result.url}`, `Read on ${date.toISOString().slice(0, 10)} with the Vault CSS tool.`,
    `${s.stats.files} style file${s.stats.files === 1 ? '' : 's'}, ${sizeLabel(s.stats.bytes)}, ${s.stats.rules} rules, ${s.stats.declarations} settings.`, '',
    '## Style files', '', table(result.files, [
      { label: 'File', get: (f) => f.filename }, { label: 'Where from', get: (f) => sourceLabel(f.source) },
      { label: 'Size', get: (f) => sizeLabel(f.bytes) }, { label: 'Address', get: (f) => f.url || '(inside the page)' },
    ]),
    '## Colours', '', table(s.colors, valueCount),
    '## Fonts', '', table(s.fontFamilies, valueCount),
    '## Font files', '', table(s.fontFaces, [
      { label: 'Font', get: (f) => f.family }, { label: 'Weight', get: (f) => f.weight || '' }, { label: 'Files', get: (f) => f.sources.join(', ') },
    ]),
    '## Text sizes', '', table(s.fontSizes, valueCount),
    '## Font weights', '', table(s.fontWeights, valueCount),
    '## Line spacing', '', table(s.lineHeights, valueCount),
    '## Spacing (margins, padding and gaps)', '', table(s.spacing, valueCount),
    '## Rounded corners', '', table(s.radii, valueCount),
    '## Shadows', '', table(s.shadows, valueCount),
    '## Variables', '', table(s.variables, [{ label: 'Name', get: (v) => `\`${v.name}\`` }, { label: 'Value', get: (v) => `\`${v.value}\`` }, { label: 'Uses', get: (v) => v.uses }]),
    '## Screen-size breakpoints', '', table(s.breakpoints, valueCount),
    '## Animations', '', table(s.keyframes, [{ label: 'Name', get: (k) => `\`${k.value}\`` }]),
  ];
  if (result.flags && result.flags.length) out.push('## Notes', '', ...result.flags.map((f) => `- ${f}`), '');
  return `${out.join('\n')}\n`;
}

/** The same settings as data (without the CSS text itself, which is in the .css files). */
export function settingsJson(result) {
  return JSON.stringify({
    url: result.url, finalUrl: result.finalUrl, title: result.title, rendered: result.rendered,
    files: result.files.map((f) => ({ filename: f.filename, url: f.url, source: f.source, importedBy: f.importedBy || null, media: f.media || null, bytes: f.bytes })),
    settings: result.summary,
  }, null, 2);
}

/** The page's most-used colours as plain #rrggbb, to offer as brand colours (a colour with see-through or in a form the colour box cannot take is skipped). */
export function topColours(summary, max = 6) {
  const out = [];
  for (const c of summary.colors) {
    const hex = toHex(c.value);
    if (hex && !out.includes(hex)) out.push(hex);
    if (out.length >= max) break;
  }
  return out;
}
