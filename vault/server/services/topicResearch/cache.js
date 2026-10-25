'use strict';

// Topic Research: keep what a paid or rate-limited source answered for 24 hours, so reading the same topic again costs nothing. Kept per
// person, per source and per topic (words, region, language, days). A "Search again" press passes `refresh` and skips the saved answer.
// A source that answered nothing at all is never saved (the next try should really ask again). See docs/topic-research.md.

const TTL_MS = 24 * 60 * 60 * 1000;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000; // older rows are tidied away whenever one is written

const cacheKey = (sourceId, keyword, { region = '', language = '', days = 0 } = {}) =>
  `${sourceId}:${String(keyword).trim().toLowerCase()}:${String(region).toUpperCase()}:${String(language).toLowerCase()}:${days}`;

const pack = (out) => ({
  ...out,
  items: (out.items || []).map((it) => ({ ...it, publishedAt: it.publishedAt ? it.publishedAt.toISOString() : null })),
});
const unpack = (p) => ({
  ...p,
  items: (p.items || []).map((it) => ({ ...it, publishedAt: it.publishedAt ? new Date(it.publishedAt) : null })),
});

/**
 * @param run  async () => { items, errors, answered, extras?, costUsd? }
 * @returns the same shape plus `cached` (true when served from a saved answer, in which case costUsd is 0)
 */
async function cached({ pool, userId, key, refresh = false, now = Date.now, run }) {
  if (!refresh) {
    const { rows } = await pool.query('SELECT payload, "createdAt" FROM topic_research_cache WHERE "userId" = $1 AND key = $2', [userId, key]);
    const row = rows[0];
    if (row && now() - new Date(row.createdAt).getTime() < TTL_MS) {
      let payload = row.payload;
      if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch { payload = null; } }
      if (payload) return { ...unpack(payload), costUsd: 0, cached: true };
    }
  }
  const out = await run();
  if ((out.answered || 0) > 0) {
    const at = new Date(now());
    await pool.query(
      `INSERT INTO topic_research_cache ("userId", key, payload, "createdAt") VALUES ($1, $2, $3, $4)
       ON CONFLICT ("userId", key) DO UPDATE SET payload = EXCLUDED.payload, "createdAt" = EXCLUDED."createdAt"`,
      [userId, key, JSON.stringify(pack(out)), at],
    );
    await pool.query('DELETE FROM topic_research_cache WHERE "userId" = $1 AND "createdAt" < $2', [userId, new Date(now() - KEEP_MS)]);
  }
  return { ...out, cached: false };
}

/** Wrap a source so its answers are kept. The source's own search is unchanged; this needs ctx.pool and ctx.userId. */
function withCache(source, { now = Date.now } = {}) {
  return {
    ...source,
    async search(keyword, since, ctx = {}) {
      if (!ctx.pool || ctx.userId == null) return source.search(keyword, since, ctx);
      const key = cacheKey(source.id, keyword, ctx);
      return cached({ pool: ctx.pool, userId: ctx.userId, key, refresh: ctx.refresh, now, run: () => source.search(keyword, since, ctx) });
    },
  };
}

module.exports = { cached, withCache, cacheKey, TTL_MS };
