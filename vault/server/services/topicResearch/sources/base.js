'use strict';

// Topic Research: the one shape every source adapter follows, so a provider can be swapped without touching the pipeline.
//
//   adapter = { name, async search(topic, since) -> { items: RawItem[], errors: [{ source, message }], answered?: number } }
//   (`answered` = how many of its upstreams, e.g. feeds, replied; collect.js uses it to tell "nothing matched" from "nothing worked")
//
//   RawItem = { url, title, domain, publishedAt (Date|null), snippet, signals }
//
// `signals` carries a source's own numbers (later milestones: reddit_score, hn_points, serp_rank). A source that fails entirely may throw;
// one that fails in part (one bad feed out of ten) returns what it got plus the errors, so the run still shows the rest.

const { normaliseUrl, domainOf } = require('../urlNormalise');

const MAX_TITLE = 300;
const MAX_SNIPPET = 500;

const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Build a clean RawItem, or null when the item has no usable address or title. */
function makeItem({ url, title, publishedAt, snippet, signals }) {
  const clean = normaliseUrl(url);
  const t = clip(title, MAX_TITLE);
  if (!clean || !t) return null;
  let when = null;
  if (publishedAt) {
    const d = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
    if (!Number.isNaN(d.getTime())) when = d;
  }
  return { url: clean, title: t, domain: domainOf(clean), publishedAt: when, snippet: clip(snippet, MAX_SNIPPET) || null, signals: signals && typeof signals === 'object' ? signals : {} };
}

module.exports = { makeItem, MAX_TITLE, MAX_SNIPPET };
