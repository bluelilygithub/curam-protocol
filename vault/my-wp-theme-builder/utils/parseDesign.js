const { enhanceWireframeDocument } = require('./wireframeEnhance');

function stripMarkdownFences(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

function parseJsonObject(rawText) {
  const trimmed = String(rawText || '').trim();
  if (!trimmed) throw new Error('Empty model response');

  const attempts = [trimmed, stripMarkdownFences(trimmed)];

  const fenceBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenceBlocks) {
    attempts.push(block[1].trim());
  }

  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // continue
    }

    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) continue;

    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (_) {
      // continue
    }
  }

  throw new Error('Could not parse JSON from model response');
}

function looksLikeCss(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\b(function|const|let|var|=>|document\.|window\.)\b/.test(trimmed)) return false;
  return /^(@import|html\s*\{|body\s*\{|:root\s*\{|\/\*)/.test(trimmed)
    || (/[\w#.\[\]:-]+\s*\{/.test(trimmed) && trimmed.includes('}'));
}

function sanitizeDesignHtml(html) {
  let extraCss = '';
  const preservedScripts = [];

  const cleaned = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/gi, (match, attrs, body) => {
    if (/\bid\s*=\s*["']tb-nav-toggle["']/i.test(attrs)) {
      preservedScripts.push(match);
      return '';
    }
    const trimmed = body.trim();
    if (looksLikeCss(trimmed)) {
      extraCss += `\n${trimmed}\n`;
    }
    return '';
  });

  let result = cleaned;
  if (preservedScripts.length && /<\/body>/i.test(result)) {
    result = result.replace(/<\/body>/i, `${preservedScripts.join('\n')}\n</body>`);
  }

  return { html: result, extraCss: extraCss.trim() };
}

function ensureScrollBehavior(css) {
  if (/scroll-behavior\s*:/i.test(css)) return css;
  return `html { scroll-behavior: smooth; }\n${css}`;
}

function assertCompleteHtmlDocument(html) {
  const trimmed = String(html || '').trim();
  const lower = trimmed.toLowerCase();
  const issues = [];

  if (trimmed.includes('<style') && !lower.includes('</style>')) {
    issues.push('unclosed <style>');
  }
  if (!lower.includes('<body')) issues.push('missing <body>');
  if (!lower.includes('</body>')) issues.push('missing </body>');
  if (!lower.includes('</html>')) issues.push('missing </html>');
  if (lower.includes('<body') && !/<(section|main|header)\b/i.test(trimmed)) {
    issues.push('body has no page sections');
  }

  if (issues.length) {
    const err = new Error(
      `Model response was truncated (${issues.join(', ')}). The preview cannot render — please try again.`
    );
    err.status = 502;
    err.truncated = true;
    err.canRetryLocal = true;
    throw err;
  }
}

function sanitizeDesignOutput(html, css) {
  const { html: cleanedHtml, extraCss } = sanitizeDesignHtml(html);
  let cleanedCss = css.trim();
  if (extraCss) {
    cleanedCss = `${cleanedCss}\n${extraCss}`;
  }
  cleanedCss = ensureScrollBehavior(cleanedCss);
  assertCompleteHtmlDocument(cleanedHtml);
  return { html: cleanedHtml, css: cleanedCss };
}

function extractFencedHtml(text) {
  const fences = [...String(text).matchAll(/```(?:html)?\s*([\s\S]*?)```/gi)];
  for (const [, body] of fences) {
    const candidate = body.trim();
    if (!/<(?:html|body|header|main|section)\b/i.test(candidate)) continue;
    const doc = candidate.match(/<!DOCTYPE[\s\S]*?<\/html>/i)?.[0]
      || candidate.match(/<html[\s\S]*?<\/html>/i)?.[0];
    if (doc) {
      return /^<!DOCTYPE/i.test(doc) ? doc.trim() : `<!DOCTYPE html>\n${doc.trim()}`;
    }
  }
  return null;
}

function normalizeHtmlDocument(html) {
  const trimmed = String(html || '').trim();
  if (!trimmed) return null;
  if (/^<!DOCTYPE/i.test(trimmed)) return trimmed;
  if (/<html\b/i.test(trimmed)) return `<!DOCTYPE html>\n${trimmed}`;
  return trimmed;
}

function extractDelimitedBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  if (start === -1) return null;
  const from = start + startMarker.length;
  if (!endMarker) return text.slice(from).trim();
  const end = text.indexOf(endMarker, from);
  if (end === -1) return text.slice(from).trim();
  return text.slice(from, end).trim();
}

function extractHtmlDocument(text) {
  const cleaned = String(text || '').trim();

  const fromDelimiter = extractDelimitedBlock(cleaned, '---HTML---', '---CSS---')
    || extractDelimitedBlock(cleaned, '---HTML---', null);
  if (fromDelimiter && /<(?:html|body|header|main)\b/i.test(fromDelimiter)) {
    return normalizeHtmlDocument(fromDelimiter);
  }

  const fenced = extractFencedHtml(cleaned);
  if (fenced) return fenced;

  const doctypeMatch = cleaned.match(/<!DOCTYPE[\s\S]*?<\/html>/i);
  if (doctypeMatch) return doctypeMatch[0].trim();

  const htmlMatch = cleaned.match(/<html[\s\S]*?<\/html>/i);
  if (htmlMatch) return `<!DOCTYPE html>\n${htmlMatch[0].trim()}`;

  return null;
}

function parseWireframeResponse(rawText) {
  const html = extractHtmlDocument(rawText);
  if (!html) {
    const err = new Error('Could not extract wireframe HTML from model response');
    err.status = 502;
    err.rawPreview = String(rawText || '').slice(0, 500);
    throw err;
  }
  const enhanced = enhanceWireframeDocument(html);
  return sanitizeDesignOutput(enhanced, '/* wireframe — styles inline */');
}

function extractCssFromHtmlDocument(html) {
  const styles = [];
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match = styleRe.exec(String(html || ''));
  while (match) {
    const block = match[1].trim();
    if (block) styles.push(block);
    match = styleRe.exec(String(html || ''));
  }
  return styles.join('\n\n');
}

function stripStyleTagsFromHtml(html) {
  return String(html || '').replace(/<style[^>]*>[\s\S]*?<\/style>\s*/gi, '');
}

function extractTrailingCss(rawText) {
  const cleaned = String(rawText || '').trim();
  const parts = cleaned.split(/<\/html>/i);
  if (parts.length < 2) return '';
  const tail = parts.slice(1).join('').replace(/^[\s\-]+/, '').trim();
  return looksLikeCss(tail) ? tail : '';
}

function parseDesignResponse(rawText, { fallbackCss = '' } = {}) {
  const cleaned = String(rawText || '').trim();
  let html = extractHtmlDocument(cleaned);
  let css = extractDelimitedBlock(cleaned, '---CSS---', null) || '';

  if (html && css) {
    return sanitizeDesignOutput(html, css);
  }

  if (html && !css) {
    const inlineCss = extractCssFromHtmlDocument(html);
    if (inlineCss) {
      return sanitizeDesignOutput(stripStyleTagsFromHtml(html), inlineCss);
    }
    const trailingCss = extractTrailingCss(cleaned);
    if (trailingCss) {
      return sanitizeDesignOutput(html, trailingCss);
    }
    if (fallbackCss?.trim()) {
      return sanitizeDesignOutput(html, fallbackCss.trim());
    }
    const err = new Error('Model returned HTML but missing ---CSS--- section');
    err.status = 502;
    err.canRetryLocal = true;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonObject(cleaned);
  } catch (err) {
    const err2 = new Error(`Could not parse model response${err.message ? ` (${err.message})` : ''}`);
    err2.status = 502;
    err2.rawPreview = cleaned.slice(0, 400);
    throw err2;
  }

  html = typeof parsed.html === 'string' ? parsed.html.trim() : '';
  css = typeof parsed.css === 'string' ? parsed.css.trim() : '';

  if (!html || !css) {
    const err = new Error('AI response missing html or css');
    err.status = 502;
    throw err;
  }

  if (!html.toLowerCase().includes('<!doctype') && !html.toLowerCase().includes('<html')) {
    const err = new Error('AI response html is not a complete document');
    err.status = 502;
    throw err;
  }

  return sanitizeDesignOutput(html, css);
}

module.exports = {
  parseDesignResponse,
  parseWireframeResponse,
  parseJsonObject,
  sanitizeDesignOutput,
  sanitizeDesignHtml,
  ensureScrollBehavior,
};
