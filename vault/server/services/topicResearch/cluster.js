'use strict';

// Topic Research: group articles that are about the same story. Pure code, no service: each article becomes a TF-IDF vector over its title
// (counted twice), snippet and the start of its page text if it was read (with each site's own boilerplate taken out); two articles whose
// vectors are alike enough (cosine similarity) are the same story, and "alike enough" chains (A~B and B~C puts all three together). Words
// every article in the set shares (the topic itself) weigh almost nothing, so what separates two stories is what decides.
// See docs/topic-research.md.

// Chosen from the labelled headline sets in clusterFixtures.js: with the vectors below, every threshold from 0.325 to 0.525 groups all
// three sets correctly, and 0.40 sits near the middle of that range. Not tuned on real articles: check real output (docs/topic-research.md).
const DEFAULT_THRESHOLD = 0.4;
const MIN_SHARED_WORDS = 2; // two articles also need two distinctive words in common, so a result set of two or three cannot merge on one
const TEXT_CHARS = 1500;

// Page text is only a supporting witness: a word counts for half as much as the same word in the headline or snippet.
const TEXT_WEIGHT = 0.5;
// A real page carries its site with it (a "Topic:" and "Posted ..." line, a "related stories" box). Both would make every article of one site
// look alike (a live check merged three unrelated ABC stories on exactly this), so before grouping: a paragraph that turns up in the text of
// two or more articles of one site is dropped, and when three or more pages of a site were read, a word on 60% or more of them is dropped
// too (it belongs to the site, not to the story).
const CHROME_SHARE = 0.6;
const CHROME_MIN_PAGES = 3;

const STOP = new Set(('the and for with that this from have has had are was were been will would could should their there them they about after before over '
  + 'into than then when what which while who whom whose also more most some such only just like your you our out new says said say may can its not but '
  + 'all any one two how why get got off per via amid').split(/\s+/));

/** Lower-case words of three letters or more (and numbers), stop-words out, a plural "s" dropped ("pumps" and "pump" are one word). */
function tokenise(text) {
  const words = String(text || '').toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^\p{L}\p{N}]+/u);
  const out = [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    out.push(w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  }
  return out;
}

const PARAGRAPH_BREAK = /\n{2,}/;
const blocksOf = (text) => String(text || '').split(PARAGRAPH_BREAK).map((b) => b.replace(/\s+/g, ' ').trim()).filter(Boolean);

/** The words of each article's page text, with its site's own chrome taken out: Map id -> string[]. Articles with no text are not in the map. */
function pageTokens(articles) {
  const bySite = new Map();
  for (const a of articles) {
    if (!a.text) continue;
    const site = a.domain || `no-site-${a.id}`; // no site name: nothing to compare it with
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site).push(a);
  }
  const out = new Map();
  for (const list of bySite.values()) {
    const blocks = new Map(list.map((a) => [a.id, blocksOf(a.text)]));
    const seen = new Map(); // paragraph -> how many of this site's articles contain it
    for (const bs of blocks.values()) for (const b of new Set(bs)) seen.set(b, (seen.get(b) || 0) + 1);
    const tokens = new Map(list.map((a) => {
      const kept = blocks.get(a.id).filter((b) => list.length < 2 || seen.get(b) < 2).join('\n\n');
      return [a.id, tokenise(kept.slice(0, TEXT_CHARS))];
    }));
    if (list.length >= CHROME_MIN_PAGES) {
      const df = new Map();
      for (const ts of tokens.values()) for (const t of new Set(ts)) df.set(t, (df.get(t) || 0) + 1);
      const limit = Math.ceil(CHROME_SHARE * list.length);
      for (const [id, ts] of tokens) tokens.set(id, ts.filter((t) => df.get(t) < limit));
    }
    for (const [id, ts] of tokens) out.set(id, ts);
  }
  return out;
}

/**
 * One unit-length sparse vector (Map word -> weight) per article, in the same order.
 * A word found in only one article can never make two articles alike but would water down every score, so it is left out; so is a word
 * found in every article of a set of four or more (the topic itself). The rest are weighted by how rare they are, squared, so a shared
 * name (a place, a storm, a company) counts for much more than a shared everyday word.
 */
function buildVectors(articles) {
  const pages = pageTokens(articles);
  const docs = articles.map((a) => {
    const m = new Map();
    const add = (tokens, weight) => { for (const t of tokens) m.set(t, (m.get(t) || 0) + weight); };
    add(tokenise(a.title), 2);
    add(tokenise(a.snippet), 1);
    add(pages.get(a.id) || [], TEXT_WEIGHT);
    return m;
  });
  const df = new Map();
  for (const m of docs) for (const t of m.keys()) df.set(t, (df.get(t) || 0) + 1);
  const n = articles.length;
  return docs.map((m) => {
    const vec = new Map();
    let norm = 0;
    for (const [t, tf] of m) {
      const d = df.get(t);
      if (d === 1 || (n >= 4 && d === n)) continue;
      const w = (tf < 1 ? tf : 1 + Math.log(tf)) * (Math.log((n + 1) / (d + 1)) + 1) ** 2;
      vec.set(t, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of vec) vec.set(t, w / norm);
    return vec;
  });
}

/** Cosine similarity of two vectors from buildVectors, and how many words they have in common. */
function similarity(a, b) {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let dot = 0;
  let shared = 0;
  for (const [t, w] of small) { const o = big.get(t); if (o) { dot += w * o; shared += 1; } }
  return { cosine: dot, shared };
}
const cosine = (a, b) => similarity(a, b).cosine;

/**
 * @param articles [{ id, title, snippet?, text?, domain? }]
 * @returns {{ clusters: Array<Array<id>>, assign: Map<id, number> }} clusters in order of their first article; each cluster's ids in input order
 */
function clusterArticles(articles, { threshold = DEFAULT_THRESHOLD, minShared = MIN_SHARED_WORDS } = {}) {
  const n = articles.length;
  const vectors = buildVectors(articles);
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const s = similarity(vectors[i], vectors[j]);
      if (s.cosine >= threshold && s.shared >= minShared) parent[find(j)] = find(i);
    }
  }
  const byRoot = new Map();
  articles.forEach((a, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r).push(a.id);
  });
  const clusters = [...byRoot.values()];
  const assign = new Map();
  clusters.forEach((ids, ci) => ids.forEach((id) => assign.set(id, ci)));
  return { clusters, assign };
}

module.exports = { tokenise, buildVectors, pageTokens, cosine, similarity, clusterArticles, DEFAULT_THRESHOLD, MIN_SHARED_WORDS, TEXT_CHARS, TEXT_WEIGHT };
