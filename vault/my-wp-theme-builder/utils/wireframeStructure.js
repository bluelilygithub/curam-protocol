'use strict';

function matchAllIds(html, tag) {
  const re = new RegExp(`<${tag}[^>]*\\sid=["']([^"']+)["']`, 'gi');
  const ids = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

function extractNavLabels(html) {
  const navMatch = html.match(/<nav[\s\S]*?<\/nav>/i);
  if (!navMatch) return [];
  const labels = [];
  const linkRe = /<a[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(navMatch[0])) !== null) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text) labels.push(text);
  }
  return labels;
}

/**
 * Build a checklist the design model must not violate.
 */
function summarizeWireframeStructure(html) {
  if (!html) return { sectionIds: [], regionIds: [], navLabels: [], summary: '' };

  const sectionIds = matchAllIds(html, 'section');
  const regionIds = [
    ...matchAllIds(html, 'header'),
    ...matchAllIds(html, 'footer'),
    ...matchAllIds(html, 'nav'),
    ...matchAllIds(html, 'form'),
  ].filter((id, i, arr) => arr.indexOf(id) === i);

  const navLabels = extractNavLabels(html);

  const lines = [
    sectionIds.length ? `- Sections (keep all, same order): ${sectionIds.map((id) => `#${id}`).join(' → ')}` : '- Sections: preserve every <section> from the wireframe in the same order',
    regionIds.length ? `- Region ids (never remove/rename): ${regionIds.map((id) => `#${id}`).join(', ')}` : '- Region ids: preserve tb-header, site-navigation, tb-footer, and all data-tb-region values',
    navLabels.length ? `- Nav labels (exact text & order): ${navLabels.join(' · ')}` : '',
  ].filter(Boolean);

  return {
    sectionIds,
    regionIds,
    navLabels,
    summary: lines.join('\n'),
  };
}

function compactWireframeHtmlForDesign(html) {
  return String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style id=["']tb-pick-styles["'][^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/<style id=["']tb-iterate-overrides["'][^>]*>[\s\S]*?<\/style>\s*/gi, '')
    .replace(/\sstyle=["'][^"']*["']/gi, '')
    .replace(/>\s+</g, '><')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

module.exports = {
  summarizeWireframeStructure,
  compactWireframeHtmlForDesign,
};
