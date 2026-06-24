/**
 * Suggest editable ACF fields per page from approved HTML.
 */

const { createDesignMessage } = require('./modelCall');

const SUGGEST_SYSTEM = `You are a WordPress and ACF Pro architect.
Analyze the HTML and identify editable content fields per page section.
Return ONLY valid JSON (no markdown) in this shape:
{
  "pages": {
    "Page Name": [
      { "key": "snake_case_key", "label": "Human Label" }
    ]
  }
}
Use snake_case keys. Include headings, body copy, CTAs, images, and meta text that a client would reasonably edit.`;

function slugKey(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48) || 'field';
}

function extractPagesFromHtml(html) {
  const pages = [];
  const commentRe = /<!--\s*(?:Page|PAGE|Section):\s*([^>-]+?)\s*-->/gi;
  let match;
  while ((match = commentRe.exec(html)) !== null) {
    const name = match[1].trim();
    if (name && !pages.includes(name)) pages.push(name);
  }

  if (!pages.length) {
    const sectionRe = /<section[^>]+id=["']([^"']+)["']/gi;
    while ((match = sectionRe.exec(html)) !== null) {
      const name = match[1].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      if (!pages.includes(name)) pages.push(name);
    }
  }

  if (!pages.length) pages.push('Home');
  return pages;
}

function heuristicSuggestFields(html) {
  const pages = extractPagesFromHtml(html);
  const result = {};

  pages.forEach((page, index) => {
    const nextPage = pages[index + 1];
    const start = html.indexOf(page);
    const end = nextPage ? html.indexOf(nextPage, start + 1) : html.length;
    const chunk = start >= 0 ? html.slice(start, end) : html;

    const fields = [];
    const seen = new Set();

    const addField = (label, prefix) => {
      const key = slugKey(`${prefix}_${label}`);
      if (seen.has(key)) return;
      seen.add(key);
      fields.push({ key, label });
    };

    chunk.replace(/<h1[^>]*>([^<]+)<\/h1>/gi, (_, t) => addField(t.trim(), 'heading'));
    chunk.replace(/<h2[^>]*>([^<]+)<\/h2>/gi, (_, t) => addField(t.trim(), 'subheading'));
    chunk.replace(/<p[^>]*>([^<]{4,})<\/p>/gi, (_, t) => addField(t.trim().slice(0, 40), 'text'));
    chunk.replace(/<(?:a|button)[^>]*>([^<]{2,})<\/(?:a|button)>/gi, (_, t) => addField(t.trim(), 'cta'));
    chunk.replace(/<img[^>]+alt=["']([^"']+)["']/gi, (_, t) => addField(t.trim(), 'image'));

    if (!fields.length) {
      fields.push({ key: 'page_title', label: 'Page Title' });
      fields.push({ key: 'page_intro', label: 'Page Intro' });
    }

    result[page] = fields.slice(0, 12);
  });

  return { pages: result };
}

function parseSuggestionResponse(text) {
  const cleaned = text.replace(/```(?:json)?\s*([\s\S]*?)```/i, '$1').trim();
  const jsonStart = cleaned.indexOf('{');
  const jsonEnd = cleaned.lastIndexOf('}');
  if (jsonStart === -1) throw new Error('Invalid suggestion response');
  const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
  if (!parsed.pages || typeof parsed.pages !== 'object') {
    throw new Error('Suggestion response missing pages');
  }
  return parsed;
}

async function suggestAcfFields(html, { userId, model } = {}) {
  try {
    const { text } = await createDesignMessage({
      system: SUGGEST_SYSTEM,
      user: `Suggest editable ACF fields for each page in this HTML:\n\n${html.slice(0, 120000)}`,
      userId,
      model,
      maxTokens: 4000,
      stage: 'stage2',
    });
    return parseSuggestionResponse(text);
  } catch {
    return heuristicSuggestFields(html);
  }
}

module.exports = {
  suggestAcfFields,
  heuristicSuggestFields,
};
