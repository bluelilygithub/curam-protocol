'use strict';

/** Extract first JSON array or object from model text (fences or raw). */
function parseModelJson(text) {
  if (!text || typeof text !== 'string') return null;
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    /* continue */
  }
  // Try the bracket that opens first: an object reply with prose around it must not come back as its first inner array.
  const tryPair = (open, close) => {
    const start = s.indexOf(open);
    const end = s.lastIndexOf(close);
    if (start === -1 || end <= start) return undefined;
    try { return JSON.parse(s.slice(start, end + 1)); } catch { return undefined; }
  };
  const objFirst = s.indexOf('{') !== -1 && (s.indexOf('[') === -1 || s.indexOf('{') < s.indexOf('['));
  const pairs = objFirst ? [['{', '}'], ['[', ']']] : [['[', ']'], ['{', '}']];
  for (const [open, close] of pairs) {
    const v = tryPair(open, close);
    if (v !== undefined) return v;
  }
  return null;
}

module.exports = { parseModelJson };
