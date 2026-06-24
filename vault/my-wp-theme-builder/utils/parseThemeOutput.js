/**
 * Parse model responses for theme file generation.
 */

function stripMarkdownFences(text) {
  const fenced = text.match(/```(?:json|php|css|markdown)?\s*([\s\S]*?)```/i);
  return fenced ? fenced[1].trim() : text.trim();
}

function parseJsonResponse(rawText) {
  const cleaned = stripMarkdownFences(rawText);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    const err = new Error('Model response was not valid JSON');
    err.status = 502;
    throw err;
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

function extractPhp(raw) {
  const cleaned = stripMarkdownFences(raw);
  const match = cleaned.match(/<\?php[\s\S]*/);
  return match ? match[0].trim() : cleaned;
}

function extractCss(raw) {
  return stripMarkdownFences(raw);
}

module.exports = {
  stripMarkdownFences,
  parseJsonResponse,
  extractPhp,
  extractCss,
};
