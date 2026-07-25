'use strict';

/**
 * Apply text replacements into a .docx via JSZip + paragraph-level rewrite.
 * Locations use paragraphId / xmlPath from Milestone 1 IR.
 */

const JSZip = require('jszip');
const { scrubDocxMetadata } = require('./metadataScrub');
const { decodeXmlEntities } = require('./docxParse');

function encodeXmlText(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function parseParagraphIndex(paragraphId) {
  const m = String(paragraphId || '').match(/-p-(\d+)$/);
  return m ? Number(m[1]) : null;
}

function fileFromLocation(loc) {
  if (loc.xmlPath) {
    const file = String(loc.xmlPath).split('#')[0];
    if (file) return file;
  }
  const part = loc.part || 'body';
  if (part === 'body') return 'word/document.xml';
  if (part === 'footnote') return 'word/footnotes.xml';
  if (part === 'comment') return 'word/comments.xml';
  return null;
}

/** Split paragraph XML into ordered <w:p>...</w:p> blocks (non-overlapping). */
function splitParagraphs(xml) {
  const blocks = [];
  const re = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    blocks.push({ start: m.index, end: m.index + m[0].length, xml: m[0] });
  }
  return blocks;
}

/** Extract concatenated visible text the same way docxParse does (approx). */
function paragraphVisibleText(pXml) {
  const parts = [];
  const rRe = /<w:r[\s>][\s\S]*?<\/w:r>/g;
  let rMatch;
  let any = false;
  while ((rMatch = rRe.exec(pXml)) !== null) {
    any = true;
    const runXml = rMatch[0];
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(runXml)) !== null) parts.push(decodeXmlEntities(t[1]));
    if (/<w:tab[\s/>]/.test(runXml)) parts.push('\t');
    if (/<w:br[\s/>]/.test(runXml) || /<w:cr[\s/>]/.test(runXml)) parts.push('\n');
  }
  if (!any) {
    const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
    let t;
    while ((t = tRe.exec(pXml)) !== null) parts.push(decodeXmlEntities(t[1]));
  }
  return parts.join('');
}

/**
 * Rewrite paragraph text: put newText into the first w:t, clear remaining w:t.
 * Preserves paragraph props and first-run formatting.
 */
function setParagraphText(pXml, newText) {
  const encoded = encodeXmlText(newText);
  let first = true;
  let out = pXml.replace(/<w:t(\s[^>]*)?>([\s\S]*?)<\/w:t>/g, (full, attrs = '') => {
    if (first) {
      first = false;
      const needsPreserve = /^\s|\s$/.test(newText) || newText.includes('\t');
      let a = attrs || '';
      if (needsPreserve && !/xml:space=/.test(a)) {
        a = `${a} xml:space="preserve"`;
      }
      return `<w:t${a}>${encoded}</w:t>`;
    }
    return `<w:t${attrs || ''}></w:t>`;
  });
  if (first) {
    // No w:t — inject a run before </w:p>
    const run = `<w:r><w:t xml:space="preserve">${encoded}</w:t></w:r>`;
    out = out.replace(/<\/w:p>/, `${run}</w:p>`);
  }
  return out;
}

function applyReplacementsToText(text, reps) {
  // reps: { startOffset, endOffset, synthetic, quote? }
  const sorted = [...reps].sort((a, b) => b.startOffset - a.startOffset);
  let out = text;
  for (const r of sorted) {
    const start = Number(r.startOffset);
    const end = Number(r.endOffset);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    if (start < 0 || end > out.length) continue;
    // Prefer quote match if provided (guards against stale offsets)
    if (r.quote != null && out.slice(start, end) !== r.quote) {
      const idx = out.indexOf(r.quote);
      if (idx >= 0) {
        out = out.slice(0, idx) + r.synthetic + out.slice(idx + r.quote.length);
        continue;
      }
    }
    out = out.slice(0, start) + r.synthetic + out.slice(end);
  }
  return out;
}

/**
 * @param {Buffer} originalBuffer
 * @param {Array<{ paragraphId, xmlPath?, part?, startOffset, endOffset, quote?, synthetic }>} replacements
 * @param {{ acceptTrackedChanges?: boolean }} [opts]
 * @returns {Promise<{ buffer: Buffer, metadataReport: object, paragraphsTouched: number }>}
 */
async function applyReplacementsToDocx(originalBuffer, replacements, opts = {}) {
  const zip = await JSZip.loadAsync(originalBuffer);

  // Group by file + paragraph index
  const byFile = new Map();
  for (const r of replacements || []) {
    const file = fileFromLocation(r);
    const pIndex = parseParagraphIndex(r.paragraphId);
    if (!file || pIndex == null) continue;
    const key = `${file}::${pIndex}`;
    if (!byFile.has(file)) byFile.set(file, new Map());
    const paraMap = byFile.get(file);
    if (!paraMap.has(pIndex)) paraMap.set(pIndex, []);
    paraMap.get(pIndex).push(r);
  }

  let paragraphsTouched = 0;

  for (const [filePath, paraMap] of byFile.entries()) {
    const f = zip.file(filePath);
    if (!f) continue;
    let xml = await f.async('string');
    const blocks = splitParagraphs(xml);
    // Rebuild from end so indices stay valid
    const indices = [...paraMap.keys()].sort((a, b) => b - a);
    for (const pIndex of indices) {
      if (pIndex < 0 || pIndex >= blocks.length) continue;
      const block = blocks[pIndex];
      const visible = paragraphVisibleText(block.xml);
      const reps = paraMap.get(pIndex);
      const nextText = applyReplacementsToText(visible, reps);
      if (nextText === visible) continue;
      const newP = setParagraphText(block.xml, nextText);
      xml = xml.slice(0, block.start) + newP + xml.slice(block.end);
      // refresh block ends after this edit for remaining lower indices — we go descending so OK
      paragraphsTouched += 1;
      // Update blocks[pIndex] length for safety if we ever go ascending — not needed
    }
    zip.file(filePath, xml);
  }

  const metadataReport = await scrubDocxMetadata(zip, {
    acceptTrackedChanges: opts.acceptTrackedChanges === true,
  });
  const buffer = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
  return { buffer, metadataReport, paragraphsTouched };
}

module.exports = {
  applyReplacementsToDocx,
  applyReplacementsToText,
  setParagraphText,
  encodeXmlText,
};
