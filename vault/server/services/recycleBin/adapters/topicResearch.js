'use strict';

// How the recycle bin handles a Topic Research topic. The delete route (server/routes/topicResearchRouter.js) snapshots the topic, its
// runs and the run-to-article links and calls moveToBin(); this says how to put it back. The articles themselves were never deleted
// (they belong to the person, not the topic), so the restored runs point at them again. See docs/recycle-bin.md.

const { register, RestoreError } = require('../index');
const { insertRow } = require('../rowRestore');

const MAX_TOPICS_PER_USER = 200; // same limit the create route enforces

register('topic-research-topic', {
  label: 'Research topic',
  async restore(db, userId, payload) {
    const t = payload?.topic;
    if (!t || !t.keyword) throw new Error('This deleted topic has nothing to restore.');
    const { rows } = await db.query('SELECT COUNT(*) AS n FROM topic_research_topics WHERE "userId" = $1', [userId]);
    if (Number(rows[0]?.n ?? 0) >= MAX_TOPICS_PER_USER) throw new RestoreError(`You already have ${MAX_TOPICS_PER_USER} saved topics. Delete some to bring this one back.`, 409);
    const same = await db.query('SELECT 1 FROM topic_research_topics WHERE "userId" = $1 AND lower(keyword) = lower($2)', [userId, t.keyword]);
    if (same.rows.length) throw new RestoreError('You have already saved a topic with those words.', 409);
    const topicId = await insertRow(db, 'topic_research_topics', t, { userId });
    const runIds = new Map();
    for (const r of payload.runs || []) {
      // eslint-disable-next-line no-await-in-loop
      runIds.set(r.id, await insertRow(db, 'topic_research_runs', r, {
        // JSONB values go in as text: the driver would turn a JavaScript array into a Postgres array instead of JSON
        userId, override: {
          topicId, errorsJson: JSON.stringify(r.errorsJson ?? []),
          weightsJson: r.weightsJson == null ? null : JSON.stringify(r.weightsJson),
          sourcesJson: r.sourcesJson == null ? null : JSON.stringify(r.sourcesJson),
          extrasJson: r.extrasJson == null ? null : JSON.stringify(r.extrasJson),
          heatJson: r.heatJson == null ? null : JSON.stringify(r.heatJson),
        },
      }));
    }
    for (const ra of payload.runArticles || []) {
      const runId = runIds.get(ra.runId);
      if (!runId) continue;
      // eslint-disable-next-line no-await-in-loop
      const there = await db.query('SELECT 1 FROM topic_research_articles WHERE id = $1 AND "userId" = $2', [ra.articleId, userId]);
      if (!there.rows.length) continue; // the article has gone since: the run comes back without that line
      // eslint-disable-next-line no-await-in-loop
      await insertRow(db, 'topic_research_run_articles', ra, {
        userId, override: { runId, signalsJson: JSON.stringify(ra.signalsJson ?? {}), breakdownJson: ra.breakdownJson == null ? null : JSON.stringify(ra.breakdownJson) },
      });
    }
    const briefIds = new Map();
    for (const b of payload.briefs || []) {
      const runId = runIds.get(b.runId);
      if (!runId) continue;
      // eslint-disable-next-line no-await-in-loop
      briefIds.set(b.id, await insertRow(db, 'topic_research_briefs', b, { userId, override: { runId, ...briefJson(b) } }));
    }
    for (const d of payload.drafts || []) {
      const briefId = briefIds.get(d.briefId);
      if (!briefId) continue;
      // eslint-disable-next-line no-await-in-loop
      await insertRow(db, 'topic_research_drafts', d, { userId, override: { briefId, ...draftJson(d) } });
    }
    return { entityId: topicId };
  },
});

// JSONB values go in as text (the driver would turn a JavaScript array into a Postgres array)
const briefJson = (b) => ({
  selectedArticleIds: JSON.stringify(b.selectedArticleIds ?? []),
  contentJson: JSON.stringify(b.contentJson ?? {}),
  overlapJson: JSON.stringify(b.overlapJson ?? []),
});

// JSONB values go in as text, as for briefs
const draftJson = (d) => ({
  contentJson: JSON.stringify(d.contentJson ?? {}),
  overlapJson: JSON.stringify(d.overlapJson ?? []),
});

// A research brief on its own (deleted from the Brief page). It belongs to a search; if that search has gone, it cannot come back alone.
register('topic-research-brief', {
  label: 'Research brief',
  async restore(db, userId, payload) {
    const b = payload?.brief;
    if (!b || !b.contentJson) throw new Error('This deleted brief has nothing to restore.');
    const run = await db.query('SELECT 1 FROM topic_research_runs WHERE id = $1 AND "userId" = $2', [b.runId, userId]);
    if (!run.rows.length) throw new RestoreError('The search this brief was written from has been deleted. Restore that topic first.', 409);
    const entityId = await insertRow(db, 'topic_research_briefs', b, { userId, override: briefJson(b) });
    for (const d of payload.drafts || []) {
      // eslint-disable-next-line no-await-in-loop
      await insertRow(db, 'topic_research_drafts', d, { userId, override: { briefId: entityId, ...draftJson(d) } });
    }
    return { entityId };
  },
});

// A draft on its own (deleted from the Draft page). It belongs to a brief; if that brief has gone, it cannot come back alone.
register('topic-research-draft', {
  label: 'Article draft',
  async restore(db, userId, payload) {
    const d = payload?.draft;
    if (!d || !d.contentJson) throw new Error('This deleted draft has nothing to restore.');
    const brief = await db.query('SELECT 1 FROM topic_research_briefs WHERE id = $1 AND "userId" = $2', [d.briefId, userId]);
    if (!brief.rows.length) throw new RestoreError('The research brief this draft was written from has been deleted. Restore that brief first.', 409);
    const entityId = await insertRow(db, 'topic_research_drafts', d, { userId, override: draftJson(d) });
    return { entityId };
  },
});
