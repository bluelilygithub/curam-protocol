const { extractHtmlDocument } = require('./parseDesign');
const {
  stampRegionIds,
  extractRegionHtml,
  mergeRegionHtml,
  describeTarget,
  normalizeTargetId,
} = require('./regionIds');

function extractFragmentHtml(rawText, targetId) {
  const text = String(rawText || '').trim();
  const id = normalizeTargetId(targetId);

  const marker = extractDelimited(text, '---FRAGMENT---');
  if (marker) return ensureIdOnFragment(marker, id);

  const fenced = [...text.matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)]
    .map((m) => m[1].trim())
    .find((block) => block.length > 10);
  if (fenced) return ensureIdOnFragment(fenced, id);

  const doc = extractHtmlDocument(text);
  if (doc) {
    const inner = extractRegionHtml(doc, id);
    if (inner) return inner;
    if (doc.length < 8000) return ensureIdOnFragment(doc, id);
  }

  if (text.startsWith('<') && text.length < 12000) {
    return ensureIdOnFragment(text, id);
  }

  return null;
}

function extractDelimited(text, marker) {
  const start = text.indexOf(marker);
  if (start === -1) return null;
  return text.slice(start + marker.length).trim();
}

function ensureIdOnFragment(fragment, id) {
  const trimmed = fragment.trim();
  if (!id || new RegExp(`\\sid=["']${id}["']`, 'i').test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/^<(\w+)(\s|>)/, `<$1 id="${id}"$2`);
}

function buildTargetedWireframePrompt({ target, fragment, changeRequest }) {
  return {
    system: `You edit ONE HTML fragment for a wireframe. Return ONLY the updated fragment for #${target.id}.
Rules:
- Output ---FRAGMENT--- then the outer HTML of #${target.id} (include the root tag with id="${target.id}")
- If the change request names a child element (class, tag, or text), apply the change to that child inside the fragment
- Do NOT return the full document
- Preserve id="${target.id}" and data-tb-region if present
- No markdown fences. No commentary.`,
    user: `Target: #${target.id} (${target.label})
Change: ${changeRequest}

Current fragment:
${fragment}

Return ---FRAGMENT--- with the updated element only.`,
  };
}

function buildTargetedDesignPrompt({ target, fragment, changeRequest, currentCss }) {
  return {
    system: `You edit ONE HTML fragment from a site design. Return ONLY the updated fragment for #${target.id}.
Rules:
- Output ---FRAGMENT--- then the single element's outer HTML (root tag must keep id="${target.id}")
- Change ONLY what the user asked — preserve siblings, children structure, and copy unless asked
- Do NOT return the full page, <!DOCTYPE>, <html>, or unrelated sections
- If the change is purely visual (color, spacing, typography), prefer a ---CSS--- block scoped to #${target.id} and leave the fragment unchanged
- No markdown fences. No commentary.`,
    user: `Target region: #${target.id} (${target.label})
Change request: ${changeRequest}

Current fragment:
${fragment}

If you output CSS, add ---CSS--- after the fragment with rules scoped to #${target.id} (max 30 lines).`,
  };
}

function buildTargetedCssPrompt({ target, changeRequest, currentCss, fragment }) {
  return {
    system: `You are a CSS specialist updating ONE region of an existing site.
Rules:
- Output ONLY a ---CSS--- block with CSS rules scoped to #${target.id} and its descendants
- Always include the #${target.id} selector (or #${target.id} .child) — never omit the region id
- For wireframe colour changes on blocks, divs, and .img-ph placeholders: set background-color (not only color) on #${target.id} with !important
- For image/photo/hero/banner changes: update background-image, object-fit, aspect-ratio, or img sizing — do NOT rewrite unrelated layout
- Do NOT output HTML unless a tiny markup tweak is absolutely required
- No markdown fences. No commentary. Max 40 lines of CSS.`,
    user: `Region: #${target.id} (${target.label})
Change: ${changeRequest}

Fragment context:
${String(fragment || '').slice(0, 1200)}

Relevant style.css excerpt:
${String(currentCss || '').slice(0, 2500)}

Return ---CSS--- with the new rules only.`,
  };
}

function isCssFocusedRequest(changeRequest) {
  const text = String(changeRequest || '').toLowerCase();

  const structureWords = /\b(add section|remove section|delete section|new section|new block|duplicate|move (the |this )?(section|block|row|column)|replace (all )?text|change (the )?copy|rewrite|add (a |an )?(button|link|image|heading|paragraph|form|menu item))\b/;
  if (structureWords.test(text)) return false;

  const styleWords = /\b(color|colour|padding|margin|font|size|background|border|width|height|align|spacing|gap|rounded|shadow|opacity|flex|grid|bold|italic|underline|center|left|right|px|rem|em|vh|vw|%|red|blue|green|white|black|grey|gray|navy|teal|orange|purple|pink|yellow|brown|beige|cream|larger|smaller|bigger|lighter|darker|uppercase|lowercase|line-height|letter-spacing|transparent|solid|hidden|visible|display|z-index|overflow|sticky|fixed|absolute|relative|theme|hue|bright|dark|thin|thick|wider|narrower|capitalize|semibold|weight|rgb|hsl|hex|#[0-9a-f]{3,8}|make it|style|css|hover|focus|transition|transform|rotate|scale|overline|strikethrough|nowrap|wrap|serif|sans|monospace|image|images|photo|photos|picture|pictures|img|hero|banner|thumbnail|thumbnails|avatar|logo|icon|cover|visual|media|photograph|illustration|graphic|placeholder|object-fit|background-image|crop|aspect)\b/;

  const visualTweak = /\b(change|swap|replace|update|switch|use|set|show|hide|different|another|new)\b[\w\s#'`.-]{0,56}\b(image|images|photo|photos|picture|pictures|img|hero|banner|thumbnail|background|logo|icon|graphic|illustration|placeholder)\b/;
  const visualTweakReverse = /\b(hero|banner|header|footer|card|gallery)\b[\w\s#'`.-]{0,32}\b(image|photo|picture|img|background|visual)\b/;

  return styleWords.test(text) || visualTweak.test(text) || visualTweakReverse.test(text);
}

function extractTargetFromRequest(changeRequest) {
  const trimmed = String(changeRequest || '').trim();
  if (!trimmed) return '';

  // IDs may contain hyphens (e.g. tb-header) — only treat `.`, `—`, `:`, or ` - ` as separators after the id
  const patterns = [
    /^#?([a-zA-Z][\w-]+)\s*\.\s*/,
    /^#?([a-zA-Z][\w-]+)\s+[-—:]\s+/,
    /^#?([a-zA-Z][\w-]+)\s*[-—:]\s+/,
    /^#?([a-zA-Z][\w-]+)\s+-\s+/,
    /^#?([a-zA-Z][\w-]+)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }

  const hash = trimmed.match(/#([a-zA-Z][\w-]+)/);
  return hash ? hash[1] : '';
}

function buildPageCssPrompt({ changeRequest, currentCss }) {
  return {
    system: `You are a CSS specialist updating an existing site stylesheet.
Rules:
- Output ONLY a ---CSS--- block with the CSS rules needed
- For image/photo/hero/banner changes: update background-image, object-fit, aspect-ratio, or img selectors
- Do NOT output HTML
- No markdown fences. No commentary. Max 50 lines.`,
    user: `Change request: ${changeRequest}

Current style.css:
${String(currentCss || '').slice(0, 3500)}

Return ---CSS--- with the new or updated rules only.`,
  };
}

function appendGlobalCss(currentCss, newCss) {
  const block = String(newCss || '').trim();
  if (!block) return currentCss;
  const marker = '/* tb-global-css-tweak */';
  const base = String(currentCss || '').replace(
    new RegExp(`${marker}[\\s\\S]*?/\\* /tb-global-css-tweak \\*/`, 'g'),
    ''
  ).trim();
  const scoped = `${marker}\n${block}\n/* /tb-global-css-tweak */`;
  return base ? `${base}\n\n${scoped}` : scoped;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCssFromModelResponse(rawResponse) {
  const css = extractDelimited(String(rawResponse || ''), '---CSS---')
    || (String(rawResponse || '').trim().startsWith('/*') || /@media|^\s*[.#\w]/m.test(rawResponse)
      ? String(rawResponse).trim()
      : '');
  return String(css || '').trim();
}

function strengthenWireframeTargetCss(css, targetId, changeRequest = '') {
  const id = String(targetId || '').replace(/^#/, '').trim();
  if (!id || !css) return css;

  let block = String(css).trim();
  if (!new RegExp(`#${escapeRegExp(id)}\\b`).test(block)) {
    block = `#${id} {\n${block}\n}`;
  }

  block = block.replace(
    /(background(?:-color)?|color|fill|border(?:-color)?|outline(?:-color)?)\s*:\s*([^;!}]+)(?!\s*!important)/gi,
    '$1: $2 !important'
  );

  const wantsBackground = /\b(background|bg|backdrop)\b/i.test(changeRequest)
    || (/\b(colou?r|fill)\b/i.test(changeRequest) && !/\b(text|font|type|foreground|typography|words?)\b/i.test(changeRequest));
  const hasBackground = /background(?:-color)?\s*:/i.test(block);
  if (wantsBackground && !hasBackground) {
    const named = changeRequest.match(/\b(yellow|red|blue|green|orange|purple|pink|grey|gray|white|black|beige|cream|teal|navy)\b/i);
    const hex = changeRequest.match(/#([0-9a-f]{3,8})\b/i);
    const fill = hex ? `#${hex[1]}` : (named ? named[1].toLowerCase() : 'yellow');
    block = `${block}\n#${id} { background-color: ${fill} !important; }`;
  }

  return block;
}

function injectPickCssIntoWireframeHtml(html, targetId, cssRules) {
  const id = String(targetId || '').replace(/^#/, '').trim();
  const rules = String(cssRules || '').trim();
  if (!html || !id || !rules) return html;

  const block = `/* tb-pick-css: #${id} */\n${rules}\n/* /tb-pick-css: #${id} */`;
  const pattern = new RegExp(`/\\* tb-pick-css: #${escapeRegExp(id)} \\*/[\\s\\S]*?/\\* /tb-pick-css: #${escapeRegExp(id)} \\*/\\s*`, 'g');
  let out = html.replace(pattern, '');

  const styleRe = /<style id=["']tb-pick-styles["'][^>]*>([\s\S]*?)<\/style>/i;
  const existing = out.match(styleRe);
  const combined = existing ? `${existing[1].trim()}\n\n${block}` : block;
  const styleTag = `<style id="tb-pick-styles">\n${combined}\n</style>`;

  if (existing) {
    return out.replace(styleRe, styleTag);
  }
  if (/<\/head>/i.test(out)) {
    return out.replace(/<\/head>/i, `${styleTag}\n</head>`);
  }
  return `${styleTag}\n${out}`;
}

function extractPickCssFromHtml(html = '') {
  const text = String(html || '');
  const parts = [];
  const pattern = /\/\* tb-pick-css: ([^*]+) \*\/([\s\S]*?)\/\* \/tb-pick-css: \1 \*\//g;
  let match = pattern.exec(text);
  while (match) {
    const block = match[2].trim();
    if (block) parts.push(block);
    match = pattern.exec(text);
  }
  return parts.join('\n\n');
}

function extractAllIteratePreviewCss({ css = '', html = '' } = {}) {
  return [extractIteratePreviewCss(css), extractPickCssFromHtml(html)]
    .filter(Boolean)
    .join('\n\n');
}

function mergeTargetedCss(currentCss, targetId, newCss) {
  const block = String(newCss || '').trim();
  if (!block) return currentCss;
  const marker = `/* tb-target: #${targetId} */`;
  const endMarker = `/* /tb-target: #${targetId} */`;
  const escapedId = targetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`/\\* tb-target: #${escapedId} \\*/[\\s\\S]*?/\\* /tb-target: #${escapedId} \\*/`, 'g');
  const base = String(currentCss || '').replace(pattern, '').trim();
  const scoped = `${marker}\n${block}\n${endMarker}`;
  return base ? `${base}\n\n${scoped}` : scoped;
}

function applyCssOnlyIteration(currentCss, targetId, rawResponse, { changeRequest = '', wireframe = false } = {}) {
  const css = extractCssFromModelResponse(rawResponse);
  if (!css || css.length < 8) return null;
  const strengthened = wireframe
    ? strengthenWireframeTargetCss(css, targetId, changeRequest)
    : css;
  return mergeTargetedCss(currentCss, targetId, strengthened);
}

/**
 * Pull tb-target / global iterate blocks out of style.css for inline preview injection.
 * Wireframe previews do not always load style.css as a linked file.
 */
function extractIteratePreviewCss(css = '') {
  const text = String(css || '');
  const parts = [];

  const targetPattern = /\/\* tb-target: ([^*]+) \*\/([\s\S]*?)\/\* \/tb-target: \1 \*\//g;
  let match = targetPattern.exec(text);
  while (match) {
    const block = match[2].trim();
    if (block) parts.push(block);
    match = targetPattern.exec(text);
  }

  const globalMatch = text.match(/\/\* tb-global-css-tweak \*\/([\s\S]*?)\/\* \/tb-global-css-tweak \*\//);
  if (globalMatch?.[1]?.trim()) {
    parts.push(globalMatch[1].trim());
  }

  return parts.join('\n\n');
}

function parseDirectCssColor(changeRequest) {
  const text = String(changeRequest || '');
  const hex = text.match(/#([0-9a-f]{3,8})\b/i);
  if (hex) return `#${hex[1]}`;
  const rgb = text.match(/\brgba?\([^)]+\)/i);
  if (rgb) return rgb[0];

  const toNamed = text.match(/\b(?:colou?r|background(?:-colou?r)?)\s+(?:to\s+)?([a-z]+)\b/i)
    || text.match(/\bto\s+([a-z]+)\b/i);
  const named = [
    'yellow', 'red', 'blue', 'green', 'orange', 'purple', 'pink', 'grey', 'gray',
    'white', 'black', 'beige', 'cream', 'teal', 'navy', 'gold', 'silver', 'maroon',
    'cyan', 'magenta', 'lime', 'olive', 'brown', 'coral', 'ivory', 'khaki', 'tan',
    'violet', 'indigo', 'aqua', 'fuchsia', 'salmon', 'turquoise',
  ];
  if (toNamed && named.includes(toNamed[1].toLowerCase())) {
    return toNamed[1].toLowerCase();
  }

  const anyNamed = text.match(new RegExp(`\\b(${named.join('|')})\\b`, 'i'));
  return anyNamed ? anyNamed[1].toLowerCase() : null;
}

function parseColorPatchIntent(changeRequest) {
  const t = String(changeRequest || '').toLowerCase();

  if (/\b(text|font|type|foreground|typography|words?)\b/.test(t)) {
    return { properties: ['color'], applyToChildren: true };
  }
  if (/\b(background|bg|backdrop)\b/.test(t)) {
    return { properties: ['background-color'], applyToChildren: false };
  }
  if (/\b(border|outline)\b/.test(t)) {
    return { properties: ['border-color'], applyToChildren: false };
  }
  if (/\b(colou?r|fill)\b/.test(t)) {
    return { properties: ['background-color'], applyToChildren: false };
  }
  return { properties: ['background-color'], applyToChildren: false };
}

function isSimpleColorPatchRequest(changeRequest) {
  const color = parseDirectCssColor(changeRequest);
  if (!color) return false;
  const t = String(changeRequest || '').toLowerCase();
  return /\b(colou?r|background|fill)\b/.test(t)
    || /\b(change|set|make|turn|update|swap)\b/.test(t);
}

function buildDirectTargetColorCss(targetId, color, intent = null) {
  const id = normalizeTargetId(targetId);
  const { properties, applyToChildren } = intent || parseColorPatchIntent('');
  const decls = properties.map((prop) => `${prop}: ${color} !important`).join('; ');

  if (applyToChildren && properties.includes('color')) {
    return `#${id}, #${id} * {\n  color: ${color} !important;\n}`;
  }
  return `#${id} {\n  ${decls};\n}`;
}

function injectPickInlineStyle(html, targetId, color, intent = null) {
  const id = normalizeTargetId(targetId);
  if (!id || !color) return html;

  const { properties } = intent || parseColorPatchIntent('');
  const decl = properties.map((prop) => `${prop}: ${color} !important`).join('; ');
  const stripRes = properties.map((prop) => new RegExp(`${prop.replace('-', '\\-')}\\s*:\\s*[^;]+;?`, 'gi'));
  const openRe = new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*\\sid=["']${escapeRegExp(id)}["'])([^>]*)>`, 'i');

  return html.replace(openRe, (match, before, after) => {
    const attrs = `${before}${after}`;
    if (/\sstyle=["']/i.test(attrs)) {
      const updated = attrs.replace(
        /\sstyle=(["'])([\s\S]*?)\1/i,
        (styleMatch, quote, styles) => {
          let next = styles;
          for (const re of stripRes) {
            next = next.replace(re, '');
          }
          next = next.trim();
          if (next && !next.endsWith(';')) next += ';';
          return ` style=${quote}${next}${next ? ' ' : ''}${decl}${quote}`;
        }
      );
      return `${updated}>`;
    }
    return `${before}${after} style="${decl}">`;
  });
}

function applyWireframeVisualPatch(html, currentCss, targetId, cssBlock, color, intent) {
  const id = normalizeTargetId(targetId);
  const mergedCss = mergeTargetedCss(currentCss, id, cssBlock);
  let outHtml = injectPickCssIntoWireframeHtml(html, id, cssBlock);
  if (color) {
    outHtml = injectPickInlineStyle(outHtml, id, color, intent);
  }
  return { html: outHtml, css: mergedCss };
}

function tryDirectColorCssPatch(html, currentCss, targetId, changeRequest, { wireframe = false } = {}) {
  if (!isSimpleColorPatchRequest(changeRequest)) return null;
  const color = parseDirectCssColor(changeRequest);
  const id = normalizeTargetId(targetId);
  if (!color || !id) return null;

  const intent = parseColorPatchIntent(changeRequest);
  const cssBlock = buildDirectTargetColorCss(id, color, intent);
  if (wireframe) {
    return applyWireframeVisualPatch(html, currentCss, id, cssBlock, color, intent);
  }
  return { html, css: mergeTargetedCss(currentCss, id, cssBlock) };
}

function applyWireframeCssIteration(html, currentCss, targetId, rawResponse, changeRequest = '') {
  const css = extractCssFromModelResponse(rawResponse);
  if (!css || css.length < 8) return null;
  const strengthened = strengthenWireframeTargetCss(css, targetId, changeRequest);
  const color = parseDirectCssColor(changeRequest);
  if (color) {
    const intent = parseColorPatchIntent(changeRequest);
    return applyWireframeVisualPatch(html, currentCss, targetId, strengthened, color, intent);
  }
  const mergedCss = mergeTargetedCss(currentCss, targetId, strengthened);
  const outHtml = injectPickCssIntoWireframeHtml(html, targetId, strengthened);
  return { html: outHtml, css: mergedCss };
}

function parseTargetedDesignResponse(rawText, targetId) {
  const fragment = extractFragmentHtml(rawText, targetId);
  if (!fragment) {
    const err = new Error('Could not extract targeted fragment from model response');
    err.status = 502;
    throw err;
  }

  const css = extractDelimited(String(rawText || ''), '---CSS---') || '';
  return { fragment, css: css.trim() };
}

function softenCssImportant(css) {
  return String(css || '').replace(/\s*!important/gi, '');
}

function extractPickCssBlockForId(html, id) {
  const re = new RegExp(`/\\* tb-pick-css: #${escapeRegExp(id)} \\*/([\\s\\S]*?)/\\* /tb-pick-css: #${escapeRegExp(id)} \\*/`);
  const match = String(html || '').match(re);
  return match?.[1]?.trim() || '';
}

function extractTargetCssBlockForId(css, id) {
  const re = new RegExp(`/\\* tb-target: #${escapeRegExp(id)} \\*/([\\s\\S]*?)/\\* /tb-target: #${escapeRegExp(id)} \\*/`);
  const match = String(css || '').match(re);
  return match?.[1]?.trim() || '';
}

function mergeDeclarationBlocks(...blocks) {
  const props = new Map();
  for (const block of blocks) {
    if (!block) continue;
    let decls = block;
    const ruleMatch = block.match(/#[^{]+\{([\s\S]*)\}/);
    if (ruleMatch) decls = ruleMatch[1];
    for (const part of decls.split(';')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const colon = trimmed.indexOf(':');
      if (colon === -1) continue;
      const prop = trimmed.slice(0, colon).trim().toLowerCase();
      props.set(prop, trimmed);
    }
  }
  const lines = [...props.values()];
  return lines.length ? `${lines.join(';\n  ')};` : '';
}

function buildConsolidatedTargetRule(id, parts) {
  const decls = mergeDeclarationBlocks(...parts);
  if (!decls) return '';
  return `#${id} {\n  ${decls}\n}`;
}

function collectIterateTargetIds(html, css) {
  const ids = new Set();
  const pickRe = /\sid=["']([^"']+)["']/gi;
  let match = pickRe.exec(String(html || ''));
  while (match) {
    if (/^tb-pick-/i.test(match[1])) ids.add(match[1]);
    match = pickRe.exec(String(html || ''));
  }
  const targetRe = /\/\* tb-target: #([^*]+) \*\//g;
  match = targetRe.exec(String(css || ''));
  while (match) {
    const id = match[1].trim();
    if (id) ids.add(id);
    match = targetRe.exec(String(css || ''));
  }
  const pickCssRe = /\/\* tb-pick-css: #([^*]+) \*\//g;
  match = pickCssRe.exec(String(html || ''));
  while (match) {
    const id = match[1].trim();
    if (id) ids.add(id);
    match = pickCssRe.exec(String(html || ''));
  }
  return [...ids];
}

function extractPickInlineStyles(html) {
  const found = new Map();
  const re = /<[a-z][a-z0-9]*\b[^>]*>/gi;
  let match = re.exec(String(html || ''));
  while (match) {
    const tag = match[0];
    const idMatch = tag.match(/\sid=["']([^"']+)["']/i);
    const styleMatch = tag.match(/\sstyle=["']([^"']*)["']/i);
    if (idMatch && styleMatch && /^tb-pick-/i.test(idMatch[1])) {
      found.set(idMatch[1], styleMatch[1]);
    }
    match = re.exec(String(html || ''));
  }
  return found;
}

function removePickInlineStyles(html) {
  return String(html || '').replace(
    /(<[a-z][a-z0-9]*\b[^>]*\sid=["']tb-pick-[^"']+["'])([^>]*)>/gi,
    (full, start, rest) => {
      const cleaned = rest.replace(/\sstyle=["'][^"']*["']/gi, '');
      return `${start}${cleaned}>`;
    }
  );
}

function removePickStylesBlock(html) {
  return String(html || '').replace(/<style id=["']tb-pick-styles["'][^>]*>[\s\S]*?<\/style>\s*/gi, '');
}

function removeIterateOverrideBlock(html) {
  return String(html || '').replace(/<style id=["']tb-iterate-overrides["'][^>]*>[\s\S]*?<\/style>\s*/gi, '');
}

/**
 * On wireframe approve: merge inline pick styles + tb-pick-styles blocks into style.css,
 * then strip iterate scaffolding from HTML.
 */
function consolidateWireframeIterateStyles(html, css) {
  const inlineMap = extractPickInlineStyles(html);
  const targetIds = collectIterateTargetIds(html, css);
  let outCss = String(css || '').trim() || '/* wireframe */';
  let outHtml = html;
  let consolidated = 0;

  for (const rawId of targetIds) {
    const id = normalizeTargetId(rawId);
    const parts = [
      softenCssImportant(extractTargetCssBlockForId(outCss, id)),
      softenCssImportant(extractPickCssBlockForId(outHtml, id)),
    ];
    const inline = inlineMap.get(id);
    if (inline) parts.push(softenCssImportant(inline));

    const rule = buildConsolidatedTargetRule(id, parts);
    if (!rule) continue;

    outCss = mergeTargetedCss(outCss, id, rule);
    consolidated += 1;
  }

  outHtml = removePickStylesBlock(outHtml);
  outHtml = removeIterateOverrideBlock(outHtml);
  outHtml = removePickInlineStyles(outHtml);

  return { html: outHtml, css: outCss, consolidated };
}

function applyTargetedIteration(html, targetId, rawResponse, { isWireframe = false } = {}) {
  const stamped = stampRegionIds(html);
  const id = normalizeTargetId(targetId);
  const target = describeTarget(stamped, id);
  if (!target) {
    const err = new Error(`No region found for target #${id}. Use Pick element or an id from the page.`);
    err.status = 400;
    throw err;
  }

  const { fragment, css } = isWireframe
    ? { fragment: extractFragmentHtml(rawResponse, id), css: '' }
    : parseTargetedDesignResponse(rawResponse, id);

  if (!fragment) {
    const err = new Error('Could not extract targeted fragment from model response');
    err.status = 502;
    throw err;
  }

  const merged = mergeRegionHtml(stamped, id, fragment);
  if (!merged) {
    const err = new Error(`Failed to merge fragment into #${id}`);
    err.status = 502;
    throw err;
  }

  return { html: merged, css, target };
}

module.exports = {
  buildTargetedWireframePrompt,
  buildTargetedDesignPrompt,
  buildTargetedCssPrompt,
  buildPageCssPrompt,
  isCssFocusedRequest,
  extractTargetFromRequest,
  mergeTargetedCss,
  appendGlobalCss,
  applyCssOnlyIteration,
  extractIteratePreviewCss,
  extractPickCssFromHtml,
  extractAllIteratePreviewCss,
  strengthenWireframeTargetCss,
  injectPickCssIntoWireframeHtml,
  applyWireframeCssIteration,
  tryDirectColorCssPatch,
  isSimpleColorPatchRequest,
  parseDirectCssColor,
  parseColorPatchIntent,
  injectPickInlineStyle,
  consolidateWireframeIterateStyles,
  extractFragmentHtml,
  parseTargetedDesignResponse,
  applyTargetedIteration,
};
