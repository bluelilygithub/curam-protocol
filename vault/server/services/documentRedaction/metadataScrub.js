'use strict';

/**
 * Scrub identifying OOXML metadata from a loaded JSZip docx.
 * Tracked changes: fail-closed by default (architecture §8 Q4).
 * Only accept-all-then-scrub when acceptTrackedChanges === true.
 */

function tagText(xml, tagLocal) {
  const re = new RegExp(`<(?:\\w+:)?${tagLocal}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tagLocal}>`, 'i');
  const m = String(xml || '').match(re);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

function clearTagContent(xml, tagLocal) {
  const re = new RegExp(`(<(?:\\w+:)?${tagLocal}(?:\\s[^>]*)?>)[\\s\\S]*?(</(?:\\w+:)?${tagLocal}>)`, 'gi');
  return String(xml || '').replace(re, '$1$2');
}

async function scrubRelsForTargets(zip, targets, report) {
  const relFiles = Object.keys(zip.files).filter((n) => n.endsWith('.rels'));
  for (const relPath of relFiles) {
    let xml = await zip.file(relPath).async('string');
    let changed = false;
    for (const target of targets) {
      const base = target.replace(/^word\//, '');
      const re = new RegExp(`<Relationship[^>]*Target="[^"]*${base.replace('.', '\\.')}"[^>]*/>`, 'gi');
      const next = xml.replace(re, '');
      if (next !== xml) {
        xml = next;
        changed = true;
        report.removedRelationships.push({ rels: relPath, target });
      }
    }
    if (changed) zip.file(relPath, xml);
  }
}

function scrubContentTypes(xml, removedParts) {
  let out = xml;
  for (const part of removedParts) {
    const name = part.startsWith('/') ? part : `/${part}`;
    const re = new RegExp(`<Override[^>]*PartName="${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'gi');
    out = out.replace(re, '');
  }
  return out;
}

/** Accept inserts / drop deletes so tracked revisions don't leak originals. */
function acceptTrackedChangesInXml(xml) {
  let out = String(xml || '');
  out = out.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/gi, '');
  out = out.replace(/<\/?w:ins\b[^>]*>/gi, '');
  out = out.replace(/<\/?w:moveFrom\b[^>]*>/gi, '');
  out = out.replace(/<\/?w:moveTo\b[^>]*>/gi, '');
  out = out.replace(/<w:moveFromRangeStart\b[^>]*\/>/gi, '');
  out = out.replace(/<w:moveFromRangeEnd\b[^>]*\/>/gi, '');
  out = out.replace(/<w:moveToRangeStart\b[^>]*\/>/gi, '');
  out = out.replace(/<w:moveToRangeEnd\b[^>]*\/>/gi, '');
  out = out.replace(/<w:rPrChange\b[^>]*>[\s\S]*?<\/w:rPrChange>/gi, '');
  out = out.replace(/<w:delText\b[^>]*>[\s\S]*?<\/w:delText>/gi, '');
  return out;
}

function hasTrackedChangeMarkup(xml) {
  return /<w:(?:del|ins|moveFrom|moveTo)\b/i.test(xml)
    || /<w:rPrChange\b/i.test(xml)
    || /<w:delText\b/i.test(xml);
}

/**
 * Scan zip for tracked-change markup. Does not mutate.
 * @returns {Promise<{ present: boolean, parts: string[] }>}
 */
async function detectTrackedChanges(zip) {
  const parts = [];
  const wordXml = Object.keys(zip.files).filter((n) =>
    /^word\/.+\.xml$/i.test(n) && !n.includes('_rels'),
  );
  for (const part of wordXml) {
    const xml = await zip.file(part).async('string');
    if (hasTrackedChangeMarkup(xml)) parts.push(part);
  }
  return { present: parts.length > 0, parts };
}

/**
 * @param {import('jszip')} zip
 * @param {{ acceptTrackedChanges?: boolean }} [opts]
 */
async function scrubDocxMetadata(zip, opts = {}) {
  const acceptTrackedChanges = opts.acceptTrackedChanges === true;
  const report = {
    found: [],
    stripped: [],
    removedParts: [],
    removedRelationships: [],
    trackedChangesAccepted: false,
    trackedChangesBlocked: false,
    trackedChangeParts: [],
  };

  const tracked = await detectTrackedChanges(zip);
  if (tracked.present) {
    report.trackedChangeParts = tracked.parts;
    report.found.push({
      field: 'trackedChanges',
      value: '(present)',
      part: tracked.parts.join(', '),
    });
    if (!acceptTrackedChanges) {
      report.trackedChangesBlocked = true;
      const err = new Error(
        'Document contains tracked changes (revisions). Apply is fail-closed by default — '
        + 're-submit with acceptTrackedChanges: true to accept-all then scrub '
        + '(this can change visible content; review the doc first).',
      );
      err.status = 409;
      err.code = 'TRACKED_CHANGES';
      err.parts = tracked.parts;
      err.metadataReport = report;
      throw err;
    }
  }

  // core.xml
  const corePath = 'docProps/core.xml';
  if (zip.file(corePath)) {
    let xml = await zip.file(corePath).async('string');
    for (const tag of ['creator', 'lastModifiedBy', 'company']) {
      const val = tagText(xml, tag);
      if (val) {
        report.found.push({ field: tag, value: val, part: corePath });
        xml = clearTagContent(xml, tag);
        report.stripped.push(`${corePath}:${tag}`);
      }
    }
    for (const tag of ['title', 'subject', 'description', 'keywords', 'category']) {
      const val = tagText(xml, tag);
      if (val) {
        report.found.push({ field: tag, value: val, part: corePath });
        xml = clearTagContent(xml, tag);
        report.stripped.push(`${corePath}:${tag}`);
      }
    }
    if (/<(?:\w+:)?revision\b/i.test(xml)) {
      const val = tagText(xml, 'revision');
      if (val && val !== '1') {
        report.found.push({ field: 'revision', value: val, part: corePath });
        xml = xml.replace(
          /(<(?:\w+:)?revision(?:\s[^>]*)?>)[\s\S]*?(<\/(?:\w+:)?revision>)/i,
          '$11$2',
        );
        report.stripped.push(`${corePath}:revision`);
      }
    }
    zip.file(corePath, xml);
  }

  // app.xml
  const appPath = 'docProps/app.xml';
  if (zip.file(appPath)) {
    let xml = await zip.file(appPath).async('string');
    for (const tag of ['Company', 'Manager', 'Template', 'HyperlinkBase']) {
      const val = tagText(xml, tag);
      if (val) {
        report.found.push({ field: tag, value: val, part: appPath });
        xml = clearTagContent(xml, tag);
        report.stripped.push(`${appPath}:${tag}`);
      }
    }
    zip.file(appPath, xml);
  }

  // custom properties — drop entire part
  const customPath = 'docProps/custom.xml';
  if (zip.file(customPath)) {
    report.found.push({ field: 'customXmlProperties', value: '(present)', part: customPath });
    zip.remove(customPath);
    report.removedParts.push(customPath);
    report.stripped.push(customPath);
  }

  // comments
  const commentParts = Object.keys(zip.files).filter((n) =>
    /^word\/comments(-extended|-ids)?\.xml$/i.test(n)
    || /^word\/people\.xml$/i.test(n),
  );
  for (const part of commentParts) {
    report.found.push({ field: 'comments', value: '(present)', part });
    zip.remove(part);
    report.removedParts.push(part);
    report.stripped.push(part);
  }

  // tracked changes — only when explicitly accepted
  if (tracked.present && acceptTrackedChanges) {
    const wordXml = Object.keys(zip.files).filter((n) =>
      /^word\/.+\.xml$/i.test(n) && !n.includes('_rels'),
    );
    for (const part of wordXml) {
      let xml = await zip.file(part).async('string');
      if (hasTrackedChangeMarkup(xml)) {
        xml = acceptTrackedChangesInXml(xml);
        zip.file(part, xml);
        report.trackedChangesAccepted = true;
        report.stripped.push(`${part}:trackedChanges`);
      }
    }
  }

  if (report.removedParts.length) {
    await scrubRelsForTargets(zip, report.removedParts, report);
    const ct = zip.file('[Content_Types].xml');
    if (ct) {
      const xml = await ct.async('string');
      zip.file('[Content_Types].xml', scrubContentTypes(xml, report.removedParts));
    }
  }

  return report;
}

module.exports = {
  scrubDocxMetadata,
  acceptTrackedChangesInXml,
  detectTrackedChanges,
  hasTrackedChangeMarkup,
};
