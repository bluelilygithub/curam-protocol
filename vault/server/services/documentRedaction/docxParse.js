'use strict';

/**
 * Parse .docx (OOXML) into a location-aware document IR.
 * Locations are paragraph + run scoped so candidates can map back precisely.
 */

const JSZip = require('jszip');
const crypto = require('crypto');

function decodeXmlEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

function extractRunText(runXml) {
  const parts = [];
  const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m;
  while ((m = tRe.exec(runXml)) !== null) {
    parts.push(decodeXmlEntities(m[1]));
  }
  if (/<w:tab[\s/>]/.test(runXml)) parts.push('\t');
  if (/<w:br[\s/>]/.test(runXml) || /<w:cr[\s/>]/.test(runXml)) parts.push('\n');
  return parts.join('');
}

function parseParagraphsFromXml(xml, part, filePath) {
  const paragraphs = [];
  if (!xml) return paragraphs;
  const pRe = /<w:p[\s>][\s\S]*?<\/w:p>/g;
  let pMatch;
  let pIndex = 0;
  while ((pMatch = pRe.exec(xml)) !== null) {
    const pXml = pMatch[0];
    const runs = [];
    const rRe = /<w:r[\s>][\s\S]*?<\/w:r>/g;
    let rMatch;
    let rIndex = 0;
    let cursor = 0;
    while ((rMatch = rRe.exec(pXml)) !== null) {
      const text = extractRunText(rMatch[0]);
      if (!text) {
        rIndex += 1;
        continue;
      }
      const startOffset = cursor;
      const endOffset = cursor + text.length;
      runs.push({
        runId: `${part}-p-${pIndex}-r-${rIndex}`,
        text,
        startOffset,
        endOffset,
      });
      cursor = endOffset;
      rIndex += 1;
    }
    // Fallback: bare w:t outside runs (rare)
    if (runs.length === 0) {
      const bare = extractRunText(pXml);
      if (bare) {
        runs.push({
          runId: `${part}-p-${pIndex}-r-0`,
          text: bare,
          startOffset: 0,
          endOffset: bare.length,
        });
      }
    }
    const text = runs.map((r) => r.text).join('');
    if (!text.trim()) {
      pIndex += 1;
      continue;
    }
    paragraphs.push({
      paragraphId: `${part}-p-${pIndex}`,
      part,
      xmlPath: `${filePath}#${part}/p[${pIndex}]`,
      text,
      runs,
    });
    pIndex += 1;
  }
  return paragraphs;
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<object>} Document IR
 */
async function parseDocxBuffer(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const paragraphs = [];

  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) {
    const err = new Error('Not a valid .docx — missing word/document.xml');
    err.status = 400;
    throw err;
  }
  paragraphs.push(...parseParagraphsFromXml(docXml, 'body', 'word/document.xml'));

  const headerFiles = Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/i.test(n));
  for (const filePath of headerFiles.sort()) {
    const xml = await zip.file(filePath).async('string');
    paragraphs.push(...parseParagraphsFromXml(xml, 'header', filePath));
  }
  const footerFiles = Object.keys(zip.files).filter((n) => /^word\/footer\d*\.xml$/i.test(n));
  for (const filePath of footerFiles.sort()) {
    const xml = await zip.file(filePath).async('string');
    paragraphs.push(...parseParagraphsFromXml(xml, 'footer', filePath));
  }
  const footnotes = zip.file('word/footnotes.xml');
  if (footnotes) {
    const xml = await footnotes.async('string');
    paragraphs.push(...parseParagraphsFromXml(xml, 'footnote', 'word/footnotes.xml'));
  }
  const endnotes = zip.file('word/endnotes.xml');
  if (endnotes) {
    const xml = await endnotes.async('string');
    paragraphs.push(...parseParagraphsFromXml(xml, 'footnote', 'word/endnotes.xml'));
  }
  const comments = zip.file('word/comments.xml');
  if (comments) {
    const xml = await comments.async('string');
    paragraphs.push(...parseParagraphsFromXml(xml, 'comment', 'word/comments.xml'));
  }

  const fullText = paragraphs.map((p) => p.text).join('\n\n');
  return {
    kind: 'docx_ir_v1',
    paragraphCount: paragraphs.length,
    charCount: fullText.length,
    paragraphs,
    fullText,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

/**
 * Map a match inside a paragraph to the best-effort run location.
 */
function locateInParagraph(paragraph, startOffset, endOffset, quote) {
  const runs = paragraph.runs || [];
  let runId = null;
  for (const run of runs) {
    if (startOffset >= run.startOffset && startOffset < run.endOffset) {
      runId = run.runId;
      break;
    }
  }
  return {
    part: paragraph.part,
    paragraphId: paragraph.paragraphId,
    runId: runId || undefined,
    xmlPath: paragraph.xmlPath,
    startOffset,
    endOffset,
    quote: quote != null ? String(quote) : paragraph.text.slice(startOffset, endOffset),
  };
}

/** Find all non-overlapping occurrences of `needle` in paragraph texts. */
function findOccurrences(ir, needle) {
  const raw = String(needle || '');
  if (!raw) return [];
  const locations = [];
  for (const p of ir.paragraphs || []) {
    let from = 0;
    while (from < p.text.length) {
      const idx = p.text.indexOf(raw, from);
      if (idx === -1) break;
      locations.push(locateInParagraph(p, idx, idx + raw.length, raw));
      from = idx + Math.max(1, raw.length);
    }
  }
  return locations;
}

module.exports = {
  parseDocxBuffer,
  locateInParagraph,
  findOccurrences,
  decodeXmlEntities,
};
