'use strict';

// Topic Research: does a feed item talk about the topic? Every word of the topic must appear (as the start of a word, so "pump" finds
// "pumps"). Words are matched in the title and summary only. Pure. See docs/topic-research.md.

const STOP = new Set(['a', 'an', 'the', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'at', 'by', 'is', 'are', 'with']);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-case search stems for a topic ("Heat pumps Queensland" -> heat, pump, queensland). */
function topicTerms(keyword) {
  const words = String(keyword || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w && !STOP.has(w));
  return [...new Set(words.map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)))];
}

/** A function that says whether a text mentions every topic word. A topic with no usable words matches nothing. */
function makeMatcher(keyword) {
  const terms = topicTerms(keyword);
  if (!terms.length) return () => false;
  const res = terms.map((t) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(t)}`, 'iu'));
  return (text) => {
    const s = String(text || '');
    return res.every((re) => re.test(s));
  };
}

module.exports = { topicTerms, makeMatcher };
