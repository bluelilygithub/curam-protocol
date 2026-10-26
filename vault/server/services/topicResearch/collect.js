'use strict';

// Topic Research: one search run. Asks every source in parallel, merges what came back (one entry per normalised address, remembering which
// sources saw it and their numbers), stores the articles and which run saw them, and records per source how it went so the Results page can
// say so. One source failing never stops the run. Sources are { id, name, label, search(keyword, since, ctx) -> { items, errors, answered?,
// extras?, costUsd?, cached? } } (see sources/base.js); the list comes from sources/index.js. See docs/topic-research.md.

const { NOOP } = require('./progress');
const { urlKind } = require('./pageKind');

const MAX_ITEMS_PER_RUN = 300;
const MAX_QUERIES = 4; // the topic's own words plus up to three extra phrasings
const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const MAX_EXTRAS = 12;

const clampDays = (d) => Math.min(MAX_DAYS, Math.max(1, Math.round(Number(d)) || DEFAULT_DAYS));
const uniq = (list) => [...new Set(list)];

const MAX_SIGNALS = ['hn_points', 'hn_comments', 'reddit_score', 'reddit_comments'];
const isNum = (n) => typeof n === 'number' && Number.isFinite(n);

/**
 * What two sources each know about the same article, put together: the BEST search position either gave (and whose it was), the HIGHEST
 * engagement numbers, Top stories if either said so, which sources saw it; for anything else the first source's value stays.
 */
function mergeSignals(a = {}, b = {}) {
  const out = { ...b, ...a };
  for (const k of MAX_SIGNALS) if (isNum(a[k]) && isNum(b[k])) out[k] = Math.max(a[k], b[k]);
  if (isNum(a.serp_rank) && isNum(b.serp_rank)) {
    const better = b.serp_rank < a.serp_rank ? b : a;
    out.serp_rank = better.serp_rank;
    if (better.serp_provider) out.serp_provider = better.serp_provider;
  } else if (isNum(b.serp_rank) && !isNum(a.serp_rank)) {
    out.serp_rank = b.serp_rank;
    if (b.serp_provider) out.serp_provider = b.serp_provider;
  }
  if (a.serp_top_story || b.serp_top_story) out.serp_top_story = true;
  const seenIn = uniq([...(a.seenIn || []), ...(b.seenIn || [])]);
  if (seenIn.length) out.seenIn = seenIn;
  return out;
}

/** One entry per address; when two sources report the same article, keep the one that knows its date and merge in what the other knew. */
function mergeItems(items) {
  const byUrl = new Map();
  for (const it of items) {
    const seen = byUrl.get(it.url);
    if (!seen) { byUrl.set(it.url, { ...it, signals: { ...it.signals } }); continue; }
    if (!seen.publishedAt && it.publishedAt) seen.publishedAt = it.publishedAt;
    if (!seen.snippet && it.snippet) seen.snippet = it.snippet;
    seen.signals = mergeSignals(seen.signals, it.signals);
  }
  const list = [...byUrl.values()];
  list.sort((a, b) => (b.publishedAt?.getTime() ?? -Infinity) - (a.publishedAt?.getTime() ?? -Infinity));
  return list.slice(0, MAX_ITEMS_PER_RUN);
}

/**
 * Ask one source about every phrasing and put the answers together as one answer from that source: the items of every phrasing (the run merges
 * duplicates later), the errors, the upstreams that replied, the cost, cached only if every answer was, and the People-also-ask lists merged.
 * One phrasing failing keeps the others (and is reported); all failing is a failure of the source.
 */
async function searchAllQueries(source, queries, since, ctx) {
  if (queries.length === 1) return source.search(queries[0], since, ctx);
  const settled = await Promise.allSettled(queries.map((q) => source.search(q, since, ctx)));
  const ok = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value || {});
  if (!ok.length) throw settled[0].reason;
  const label = source.label || source.name;
  // the same fault from the same source, once per phrasing, is one fault to the person reading the page
  const errors = [];
  const note = (e) => { if (!errors.some((x) => x.source === e.source && x.message === e.message)) errors.push(e); };
  ok.forEach((v) => (v.errors || []).forEach(note));
  settled.forEach((r) => { if (r.status === 'rejected') note({ source: label, message: String(r.reason?.message || 'This source failed').slice(0, 200) }); });
  const extras = ok.map((v) => v.extras).filter(Boolean);
  return {
    items: ok.flatMap((v) => v.items || []),
    errors,
    answered: ok.reduce((n, v) => n + (Number.isInteger(v.answered) ? v.answered : 1), 0),
    costUsd: ok.reduce((n, v) => n + (v.cached ? 0 : Number(v.costUsd) || 0), 0),
    cached: ok.every((v) => v.cached),
    extras: extras.length ? mergeExtras(extras) : undefined,
  };
}

/** Combine the People-also-ask and related-search lists several sources may have returned. */
function mergeExtras(list) {
  const paa = new Map();
  const related = new Set();
  for (const e of list) {
    for (const q of e?.peopleAlsoAsk || []) if (q?.question && !paa.has(q.question.toLowerCase())) paa.set(q.question.toLowerCase(), q);
    for (const r of e?.relatedSearches || []) if (r) related.add(r);
  }
  return { peopleAlsoAsk: [...paa.values()].slice(0, MAX_EXTRAS), relatedSearches: [...related].slice(0, MAX_EXTRAS) };
}

/**
 * @param refresh true = skip any saved (cached) answers, as a manual "Search again" does
 * @returns {Promise<{ runId:number, status:'ok'|'partial'|'failed', errors:Array<{source:string,message:string}>, count:number, sources:Array, extras:object, costUsd:number }>}
 *   status: ok = everything answered; partial = something answered and something did not; failed = nothing answered (or no sources set up).
 *   A source may report `answered` (how many of its upstreams replied); without it, a source that did not throw counts as one.
 */
async function runCollect({ pool, userId, topic, sources, days, refresh = false, now = () => Date.now(), report = NOOP, queries }) {
  const span = clampDays(days);
  // the topic's own words first, then any extra phrasings the person ticked (never more than MAX_QUERIES, never the same twice)
  const asked = [];
  for (const q of [topic.keyword, ...(Array.isArray(queries) ? queries : [])]) {
    if (typeof q === 'string' && q.trim() && !asked.some((x) => x.toLowerCase() === q.trim().toLowerCase())) asked.push(q.trim());
  }
  asked.length = Math.min(asked.length, MAX_QUERIES);
  const since = new Date(now() - span * 86400000);
  const { rows: [run] } = await pool.query(
    `INSERT INTO topic_research_runs ("userId", "topicId", status) VALUES ($1, $2, 'running') RETURNING id`,
    [userId, topic.id],
  );
  const errors = [];
  try {
    if (!sources.length) errors.push({ source: 'search', message: 'No sources are set up yet. Add some RSS feeds in Settings.' });
    const ctx = { refresh, region: topic.region, language: topic.language, userId, pool, days: span };
    // each source is timed on its own: all of them start together, so timing after they have all finished would show the slowest for everyone
    const total = sources.length;
    let finished = 0;
    report.start('sources', `Asking ${total} source${total === 1 ? '' : 's'}${asked.length > 1 ? ` about ${asked.length} phrasings` : ''}`);
    const settled = await Promise.all(sources.map(async (s) => {
      const t0 = now();
      let out;
      try { out = { ok: true, value: await searchAllQueries(s, asked, since, ctx), ms: Math.max(0, now() - t0) }; } catch (reason) { out = { ok: false, reason, ms: Math.max(0, now() - t0) }; }
      finished += 1;
      report.detail('sources', `${finished} of ${total} answered (latest: ${s.label || s.name})`);
      return out;
    }));
    report.done('sources', `${total} source${total === 1 ? '' : 's'} asked`);
    const items = [];
    const extrasList = [];
    const summary = [];
    let answered = 0; // upstreams (a feed, an API) that really replied, even with nothing to show
    let costUsd = 0;
    settled.forEach((r, i) => {
      const s = sources[i];
      const id = s.id || s.name;
      const label = s.label || s.name;
      const ms = r.ms;
      if (r.ok) {
        const v = r.value || {};
        const got = (v.items || []).map((it) => ({ ...it, signals: { ...it.signals, seenIn: [id] } }));
        items.push(...got);
        errors.push(...(v.errors || []));
        if (v.extras) extrasList.push(v.extras);
        const a = Number.isInteger(v.answered) ? v.answered : 1;
        answered += a;
        const cost = v.cached ? 0 : Number(v.costUsd) || 0;
        costUsd += cost;
        summary.push({ id, label, count: got.length, cached: !!v.cached, answered: a, costUsd: cost, ms });
      } else {
        errors.push({ source: label, message: String(r.reason?.message || 'This source failed').slice(0, 200) });
        summary.push({ id, label, count: 0, cached: false, answered: 0, costUsd: 0, ms });
      }
    });
    const merged = mergeItems(items);
    const extras = mergeExtras(extrasList);
    report.start('save', `${merged.length} article${merged.length === 1 ? '' : 's'}`);
    for (const it of merged) {
      // eslint-disable-next-line no-await-in-loop
      const { rows: [art] } = await pool.query(
        `INSERT INTO topic_research_articles ("userId", url, title, domain, "publishedAt", snippet, "pageKind")
              VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT ("userId", url) DO UPDATE SET
              "pageKind" = COALESCE(topic_research_articles."pageKind", EXCLUDED."pageKind"),
              title = EXCLUDED.title,
              "publishedAt" = COALESCE(EXCLUDED."publishedAt", topic_research_articles."publishedAt"),
              snippet = COALESCE(EXCLUDED.snippet, topic_research_articles.snippet)
         RETURNING id`,
        [userId, it.url, it.title, it.domain, it.publishedAt, it.snippet, urlKind(it.url)], // a product or list address is known before the page is read
      );
      // eslint-disable-next-line no-await-in-loop
      await pool.query(
        `INSERT INTO topic_research_run_articles ("runId", "articleId", "signalsJson") VALUES ($1, $2, $3)
         ON CONFLICT ("runId", "articleId") DO NOTHING`,
        [run.id, art.id, JSON.stringify(it.signals || {})],
      );
    }
    report.done('save', `${merged.length} article${merged.length === 1 ? '' : 's'} saved`);
    const status = answered === 0 ? 'failed' : (errors.length === 0 ? 'ok' : 'partial');
    await pool.query(
      `UPDATE topic_research_runs SET status = $1, "finishedAt" = NOW(), "errorsJson" = $2, "sourcesJson" = $3, "extrasJson" = $4, "apiCostEstimate" = $5, "queriesJson" = $8
        WHERE id = $6 AND "userId" = $7`,
      [status, JSON.stringify(errors), JSON.stringify(summary), JSON.stringify(extras), costUsd, run.id, userId, JSON.stringify(asked)],
    );
    return { runId: run.id, status, errors, count: merged.length, sources: summary, extras, costUsd, queries: asked };
  } catch (err) {
    await pool.query(
      `UPDATE topic_research_runs SET status = 'failed', "finishedAt" = NOW(), "errorsJson" = $1 WHERE id = $2 AND "userId" = $3`,
      [JSON.stringify([...errors, { source: 'run', message: 'The search stopped unexpectedly.' }]), run.id, userId],
    ).catch(() => {});
    throw err;
  }
}

module.exports = { runCollect, searchAllQueries, MAX_QUERIES, mergeItems, mergeSignals, mergeExtras, clampDays, MAX_ITEMS_PER_RUN, DEFAULT_DAYS, MAX_DAYS };
