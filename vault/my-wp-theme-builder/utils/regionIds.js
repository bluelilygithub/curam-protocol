/**
 * Stable region IDs for targeted iteration — not design-specific.
 * Users pick #tb-search, #contact, etc. and we patch only that fragment.
 */

const REGION_LABELS = {
  'tb-header': 'Header',
  'tb-footer': 'Footer',
  'tb-search': 'Search form',
  'tb-map': 'Map placeholder',
  'tb-social': 'Social links',
  'tb-reviews': 'Google Reviews',
  'site-navigation': 'Main navigation',
  home: 'Home section',
  about: 'About section',
  services: 'Services section',
  blog: 'Blog section',
  portfolio: 'Portfolio section',
  contact: 'Contact section',
};

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function labelForId(id) {
  if (!id) return 'Element';
  return REGION_LABELS[id] || id.replace(/-/g, ' ');
}

function hasIdAttr(tagHtml, id) {
  return new RegExp(`\\sid=["']${escapeRegExp(id)}["']`, 'i').test(tagHtml);
}

function setIdOnTag(openTag, id) {
  if (hasIdAttr(openTag, id)) return openTag;
  if (/\sid=["']/i.test(openTag)) {
    return openTag.replace(/\sid=["'][^"']*["']/i, ` id="${id}"`);
  }
  return openTag.replace(/<(\w+)/, `<$1 id="${id}"`);
}

function stampTagByPattern(html, pattern, id, dataRegion) {
  return html.replace(pattern, (match, openTag) => {
    let tag = setIdOnTag(openTag, id);
    if (dataRegion && !/\bdata-tb-region=/i.test(tag)) {
      tag = tag.replace(/<(\w+)/, `<$1 data-tb-region="${dataRegion}"`);
    }
    return tag;
  });
}

/**
 * Add stable ids to major regions if the model omitted them.
 */
function stampRegionIds(html) {
  if (!html) return html;

  let out = html;

  if (/<header\b/i.test(out) && !/\bid=["']tb-header["']/i.test(out)) {
    out = out.replace(/<header(\s[^>]*)>/i, (m, attrs) => {
      if (/\bid=/i.test(attrs)) return m;
      return `<header id="tb-header" data-tb-region="header"${attrs}>`;
    });
  }

  if (/<footer\b/i.test(out) && !/\bid=["']tb-footer["']/i.test(out)) {
    out = out.replace(/<footer(\s[^>]*)>/i, (m, attrs) => {
      if (/\bid=/i.test(attrs)) return m;
      return `<footer id="tb-footer" data-tb-region="footer"${attrs}>`;
    });
  }

  if (/\bclass=["'][^"']*tb-search/i.test(out) && !/\bid=["']tb-search["']/i.test(out)) {
    out = out.replace(/<form(\s[^>]*class=["'][^"']*tb-search[^"']*["'][^>]*)>/i, (m, attrs) => {
      if (/\bid=/i.test(attrs)) return m;
      return `<form id="tb-search" data-tb-region="search"${attrs}>`;
    });
  }

  if (/\b(?:map-ph|tb-map)\b/i.test(out) && !/\bid=["']tb-map["']/i.test(out)) {
    out = out.replace(/<div(\s[^>]*class=["'][^"']*(?:map-ph|tb-map)[^"']*["'][^>]*)>/i, (m, attrs) => {
      if (/\bid=/i.test(attrs)) return m;
      return `<div id="tb-map" data-tb-region="map"${attrs}>`;
    });
  }

  if (/\bclass=["'][^"']*tb-social/i.test(out) && !/\bid=["']tb-social["']/i.test(out)) {
    out = out.replace(/<div(\s[^>]*class=["'][^"']*tb-social[^"']*["'][^>]*)>/i, (m, attrs) => {
      if (/\bid=/i.test(attrs)) return m;
      return `<div id="tb-social" data-tb-region="social"${attrs}>`;
    });
  }

  if (/\bclass=["'][^"']*tb-reviews/i.test(out) && !/\bid=["']tb-reviews["']/i.test(out)) {
    out = out.replace(/<section(\s[^>]*class=["'][^"']*tb-reviews[^"']*["'][^>]*)>/i, (m, attrs) => {
      if (/\bid=/i.test(attrs)) return m;
      return `<section id="tb-reviews" data-tb-region="reviews"${attrs}>`;
    });
  }

  out = out.replace(/<section(\s[^>]*\bid=["']([^"']+)["'][^>]*)>/gi, (m, attrs, id) => {
    if (/\bdata-tb-region=/i.test(attrs)) return m;
    return `<section data-tb-region="${id}"${attrs}>`;
  });

  return out;
}

function normalizeTargetId(targetId) {
  return String(targetId || '').trim().replace(/^#/, '');
}

function findElementBounds(html, targetId) {
  const id = normalizeTargetId(targetId);
  if (!id) return null;

  const openRe = new RegExp(`<([a-zA-Z][\\w-]*)\\b([^>]*\\sid=["']${escapeRegExp(id)}["'][^>]*)>`, 'i');
  const openMatch = openRe.exec(html);
  if (!openMatch) return null;

  const tag = openMatch[1].toLowerCase();
  const start = openMatch.index;
  const openEnd = start + openMatch[0].length;

  if (VOID_TAGS.has(tag) || /\/\s*>$/.test(openMatch[0])) {
    return { id, tag, start, end: openEnd, outer: openMatch[0] };
  }

  const closeTag = `</${tag}>`;
  let depth = 1;
  let i = openEnd;

  while (depth > 0 && i < html.length) {
    const nextOpen = html.toLowerCase().indexOf(`<${tag}`, i);
    const nextClose = html.toLowerCase().indexOf(closeTag, i);
    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const snippet = html.slice(nextOpen, nextOpen + tag.length + 1);
      if (!/\/\s*>$/.test(snippet) && !snippet.includes('/>')) {
        depth += 1;
      }
      i = nextOpen + tag.length + 1;
    } else {
      depth -= 1;
      i = nextClose + closeTag.length;
    }
  }

  return { id, tag, start, end: i, outer: html.slice(start, i) };
}

function extractRegionHtml(html, targetId) {
  const bounds = findElementBounds(html, targetId);
  return bounds ? bounds.outer : null;
}

function mergeRegionHtml(html, targetId, newOuterHtml) {
  const bounds = findElementBounds(html, targetId);
  if (!bounds) return null;
  const fragment = String(newOuterHtml || '').trim();
  if (!fragment) return null;
  return `${html.slice(0, bounds.start)}${fragment}${html.slice(bounds.end)}`;
}

function describeTarget(html, targetId) {
  const id = normalizeTargetId(targetId);
  const bounds = findElementBounds(html, id);
  if (!bounds) return null;

  const regionMatch = bounds.outer.match(/\bdata-tb-region=["']([^"']+)["']/i);
  const ariaMatch = bounds.outer.match(/\baria-label=["']([^"']+)["']/i);

  return {
    id,
    tag: bounds.tag,
    label: ariaMatch?.[1] || labelForId(regionMatch?.[1] || id),
    region: regionMatch?.[1] || id,
    htmlLength: bounds.outer.length,
  };
}

function listInspectableRegions(html) {
  const ids = new Set();
  const re = /\sid=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return [...ids].sort().map((id) => describeTarget(html, id)).filter(Boolean);
}

function stampIdOnOuter(outerHtml, newId) {
  return outerHtml.replace(/^<([a-zA-Z][\w-]*)(\s[^>]*)>/, (match, tag, attrs = '') => {
    if (/\sid=["']/i.test(attrs)) {
      return `<${tag}${attrs.replace(/\sid=["'][^"']*["']/i, ` id="${newId}"`)}>`;
    }
    return `<${tag} id="${newId}"${attrs}>`;
  });
}

function findTopLevelChildElements(innerHtml) {
  const children = [];
  let i = 0;
  const len = innerHtml.length;

  while (i < len) {
    while (i < len && /\s/.test(innerHtml[i])) i += 1;
    if (i >= len) break;

    if (innerHtml.startsWith('<!--', i)) {
      const end = innerHtml.indexOf('-->', i);
      i = end === -1 ? len : end + 3;
      continue;
    }

    if (innerHtml[i] !== '<') {
      i += 1;
      continue;
    }

    const openMatch = /^<([a-zA-Z][\w-]*)\b([^>]*)>/s.exec(innerHtml.slice(i));
    if (!openMatch) {
      i += 1;
      continue;
    }

    const tag = openMatch[1].toLowerCase();
    const fullOpen = openMatch[0];
    const start = i;
    i += fullOpen.length;

    if (VOID_TAGS.has(tag) || /\/\s*>$/.test(fullOpen)) {
      children.push({ start, end: i, outer: innerHtml.slice(start, i), tag });
      continue;
    }

    const closeTag = `</${tag}>`;
    let depth = 1;
    while (depth > 0 && i < len) {
      const nextOpen = innerHtml.toLowerCase().indexOf(`<${tag}`, i);
      const nextClose = innerHtml.toLowerCase().indexOf(closeTag, i);
      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        const snippet = innerHtml.slice(nextOpen, nextOpen + tag.length + 1);
        if (!/\/\s*>$/.test(snippet) && !snippet.includes('/>')) {
          depth += 1;
        }
        i = nextOpen + tag.length + 1;
      } else {
        depth -= 1;
        i = nextClose + closeTag.length;
      }
    }

    children.push({ start, end: i, outer: innerHtml.slice(start, i), tag });
  }

  return children;
}

function classesMatch(outerHtml, classList) {
  const wanted = (classList || []).filter(Boolean);
  if (!wanted.length) return true;
  const match = outerHtml.match(/\bclass=["']([^"']*)["']/i);
  if (!match) return false;
  const classes = match[1].split(/\s+/).filter(Boolean);
  return wanted.every((cls) => classes.includes(cls));
}

function pickChildElement(innerHtml, step) {
  const children = findTopLevelChildElements(innerHtml);
  if (!children.length) return null;

  const tag = String(step?.tag || '').toLowerCase();
  const childIndex = Number(step?.childIndex);
  const classList = Array.isArray(step?.classList) ? step.classList : [];

  if (Number.isInteger(childIndex) && children[childIndex] && (!tag || children[childIndex].tag === tag)) {
    const candidate = children[childIndex];
    if (!tag || candidate.tag === tag) {
      if (classesMatch(candidate.outer, classList)) return candidate;
    }
  }

  return children.find((child) => {
    if (tag && child.tag !== tag) return false;
    return classesMatch(child.outer, classList);
  }) || null;
}

/**
 * Stamp id on a nested element using DOM locator steps (tag/class/index), with childPath fallback.
 */
function stampIdAtLocator(html, anchorId, locator, newId) {
  const anchor = normalizeTargetId(anchorId);
  const pickId = normalizeTargetId(newId);
  const steps = Array.isArray(locator) ? locator : [];
  const childPath = Array.isArray(locator?.childPath) ? locator.childPath : null;

  if (!anchor || !pickId) return null;
  if (childPath?.length) {
    const byPath = stampIdAtChildPath(html, anchor, childPath, pickId);
    if (byPath && findElementBounds(byPath, pickId)) return byPath;
  }
  if (!steps.length) return null;

  const bounds = findElementBounds(html, anchor);
  if (!bounds || VOID_TAGS.has(bounds.tag)) return null;

  const openEnd = bounds.outer.indexOf('>') + 1;
  const closeTag = `</${bounds.tag}>`;
  const closeStart = bounds.outer.toLowerCase().lastIndexOf(closeTag);
  if (closeStart === -1) return null;

  let segment = bounds.outer;
  let innerStart = openEnd;
  let innerEnd = closeStart;

  for (let depth = 0; depth < steps.length; depth += 1) {
    const inner = segment.slice(innerStart, innerEnd);
    const child = pickChildElement(inner, steps[depth]);
    if (!child) return null;

    if (depth === steps.length - 1) {
      const stampedChild = stampIdOnOuter(child.outer, pickId);
      const newInner = `${inner.slice(0, child.start)}${stampedChild}${inner.slice(child.end)}`;
      const newSegment = `${segment.slice(0, innerStart)}${newInner}${segment.slice(innerEnd)}`;
      return `${html.slice(0, bounds.start)}${newSegment}${html.slice(bounds.end)}`;
    }

    segment = child.outer;
    const childOpenEnd = segment.indexOf('>') + 1;
    const childCloseTag = `</${child.tag}>`;
    const childCloseStart = segment.toLowerCase().lastIndexOf(childCloseTag);
    if (childCloseStart === -1) return null;
    innerStart = childOpenEnd;
    innerEnd = childCloseStart;
  }

  return null;
}

/**
 * Stamp id on a nested element located by child indices from an anchored parent.
 */
function stampIdAtChildPath(html, anchorId, childPath, newId) {
  const anchor = normalizeTargetId(anchorId);
  const pickId = normalizeTargetId(newId);
  const path = Array.isArray(childPath) ? childPath.map((n) => Number(n)) : [];
  if (!anchor || !pickId || !path.length) return null;

  const bounds = findElementBounds(html, anchor);
  if (!bounds || VOID_TAGS.has(bounds.tag)) return null;

  const openEnd = bounds.outer.indexOf('>') + 1;
  const closeTag = `</${bounds.tag}>`;
  const closeStart = bounds.outer.toLowerCase().lastIndexOf(closeTag);
  if (closeStart === -1) return null;

  let segment = bounds.outer;
  let innerStart = openEnd;
  let innerEnd = closeStart;

  for (let depth = 0; depth < path.length; depth += 1) {
    const inner = segment.slice(innerStart, innerEnd);
    const children = findTopLevelChildElements(inner);
    const idx = path[depth];
    if (!Number.isInteger(idx) || idx < 0 || !children[idx]) return null;

    const child = children[idx];
    if (depth === path.length - 1) {
      const stampedChild = stampIdOnOuter(child.outer, pickId);
      const newInner = `${inner.slice(0, child.start)}${stampedChild}${inner.slice(child.end)}`;
      const newSegment = `${segment.slice(0, innerStart)}${newInner}${segment.slice(innerEnd)}`;
      return `${html.slice(0, bounds.start)}${newSegment}${html.slice(bounds.end)}`;
    }

    segment = child.outer;
    const childOpenEnd = segment.indexOf('>') + 1;
    const childCloseTag = `</${child.tag}>`;
    const childCloseStart = segment.toLowerCase().lastIndexOf(childCloseTag);
    if (childCloseStart === -1) return null;
    innerStart = childOpenEnd;
    innerEnd = childCloseStart;
  }

  return null;
}

module.exports = {
  REGION_LABELS,
  labelForId,
  stampRegionIds,
  normalizeTargetId,
  findElementBounds,
  extractRegionHtml,
  mergeRegionHtml,
  describeTarget,
  listInspectableRegions,
  stampIdAtChildPath,
  stampIdAtLocator,
};
