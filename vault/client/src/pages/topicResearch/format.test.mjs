// Run: node client/src/pages/topicResearch/format.test.mjs
import assert from 'assert';
import { filterTopicsByLink, workflowSteps as wfs, briefJumpLinks, briefTabLabel, promptText, searchedForLine, notUsedLine, explainFailure, draftReadiness, RELEVANCE_STEP_LABELS, isShopPage, formatDate, timeAgo, statusLabel, parseFeedLines, feedLines, sourceChip, signalBadges, rankingNote, heatBadge, readNote, breakdownRows, defaultSelection, toggleSelection, selectionNote, factLabel, overlapWarning, costText, SIGNAL_FIELDS, DEFAULT_PERCENTS, DEFAULT_HALF_LIFE, toPercents, fromPercents, percentTotal, REFRESH_CHOICES, refreshLabel, orderTopics, mergeHistory, budgetBanner, spendLine, DRAFT_LENGTHS, draftLine, SEARCH_STEP_LABELS, BRIEF_STEP_LABELS, DRAFT_STEP_LABELS, stepsForModal, workflowSteps } from './format.mjs';

assert.strictEqual(formatDate(null), 'No date');
assert.strictEqual(formatDate('garbage'), 'No date');
assert.ok(/2026/.test(formatDate('2026-10-25T00:00:00Z')));

const now = Date.UTC(2026, 9, 25, 12, 0, 0);
assert.strictEqual(timeAgo(null, now), 'never');
assert.strictEqual(timeAgo('nope', now), 'never');
assert.strictEqual(timeAgo(new Date(now - 10 * 1000).toISOString(), now), 'just now');
assert.strictEqual(timeAgo(new Date(now - 5 * 60000).toISOString(), now), '5 min ago');
assert.strictEqual(timeAgo(new Date(now - 3 * 3600000).toISOString(), now), '3 h ago');
assert.strictEqual(timeAgo(new Date(now - 3 * 86400000).toISOString(), now), '3 days ago');
assert.ok(/2026|2025/.test(timeAgo(new Date(now - 40 * 86400000).toISOString(), now)));
assert.strictEqual(timeAgo(new Date(now + 5 * 60000).toISOString(), now), 'just now', 'a clock a little ahead never reads as negative');

assert.strictEqual(statusLabel('ok').level, 'good');
assert.strictEqual(statusLabel('partial').level, 'warn');
assert.strictEqual(statusLabel('failed').level, 'bad');
assert.strictEqual(statusLabel(undefined).level, 'info');

assert.deepStrictEqual(parseFeedLines('https://a.com/f\n\n  # a note\r\n https://b.com/f  '), [{ url: 'https://a.com/f' }, { url: 'https://b.com/f' }]);
assert.deepStrictEqual(parseFeedLines(''), []);
assert.strictEqual(feedLines([{ url: 'https://a.com/f' }, { url: 'https://b.com/f', name: 'B' }]), 'https://a.com/f\nhttps://b.com/f');
assert.strictEqual(feedLines(undefined), '');

assert.strictEqual(sourceChip({ label: 'Hacker News', count: 5, answered: 1, cached: false }), 'Hacker News 5');
assert.strictEqual(sourceChip({ label: 'GDELT news', count: 30, answered: 1, cached: true }), 'GDELT news 30 (saved from earlier)');
assert.strictEqual(sourceChip({ label: 'Reddit', count: 0, answered: 0 }), 'Reddit: did not answer');
assert.strictEqual(sourceChip({ label: 'Brave Search', count: 0, answered: 1 }), 'Brave Search 0', 'answered with nothing is not the same as not answering');
assert.strictEqual(sourceChip(null), '');

assert.deepStrictEqual(signalBadges(undefined), []);
assert.deepStrictEqual(signalBadges({}), []);
assert.deepStrictEqual(signalBadges({ hn_points: 1, hn_comments: 1 }).map((b) => b.text), ['Hacker News: 1 point, 1 comment']);
assert.deepStrictEqual(signalBadges({ hn_points: 0, hn_comments: 0 }), [], 'a story nobody has voted on or discussed shows nothing');
assert.deepStrictEqual(signalBadges({ reddit_score: 420, reddit_comments: 88 }).map((b) => b.text), ['Reddit: score 420, 88 comments']);
assert.deepStrictEqual(signalBadges({ serp_rank: 3, serp_provider: 'brave' }).map((b) => b.text), ['Brave #3']);
assert.deepStrictEqual(signalBadges({ serp_rank: 2, serp_provider: 'serper', serp_top_story: true }).map((b) => b.text), ['Google #2', 'In Google Top stories']);
const labels = { rss: 'RSS feeds', hackernews: 'Hacker News', gdelt: 'GDELT news' };
assert.deepStrictEqual(signalBadges({ seenIn: ['rss'] }, labels), [], 'one source is not worth a badge');
assert.deepStrictEqual(signalBadges({ seenIn: ['rss', 'gdelt', 'unknown'] }, labels).map((b) => b.text), ['Found by RSS feeds, GDELT news']);

// ---- ticking articles for a brief
const many = Array.from({ length: 15 }, (_, i) => ({ id: 100 + i }));
assert.deepStrictEqual([...defaultSelection(many)], [100, 101, 102, 103, 104, 105, 106, 107, 108, 109], 'the best ten');
assert.deepStrictEqual([...defaultSelection(many.slice(0, 4))], [100, 101, 102, 103]);
assert.deepStrictEqual([...defaultSelection([])], []);
{
  const mix = [{ id: 1 }, { id: 2, pageKind: 'product' }, { id: 3, pageKind: 'article' }, { id: 4, pageKind: 'listing' }, { id: 5, pageKind: null }];
  assert.deepStrictEqual([...defaultSelection(mix)], [1, 3, 5], 'shop pages are not ticked to begin with');
  assert.deepStrictEqual([...defaultSelection(mix, 2)], [1, 3], 'and do not use up the best-ten places');
  assert.deepStrictEqual([isShopPage({ pageKind: 'product' }), isShopPage({ pageKind: 'listing' }), isShopPage({ pageKind: 'article' }), isShopPage({}), isShopPage(null)], [true, true, false, false, false]);
  const rows2 = breakdownRows([
    { id: 'match', label: 'Topic match', available: true, raw: 0.27, points: 5.3 },
    { id: 'shop', label: 'Shop page', available: true, raw: 'product', value: 0.4, points: -12 },
    { id: 'shop', label: 'Shop page', available: true, raw: 'listing', value: 0.4, points: -3 },
  ]);
  assert.strictEqual(rows2[0].text, '27% about the topic');
  assert.ok(/shop page \(a product\).*multiplied by 0\.4/.test(rows2[1].text) && /a list of products/.test(rows2[2].text));
  assert.strictEqual(rows2[1].points, -12, 'the shop-page row takes points off');
}
assert.deepStrictEqual([...defaultSelection(undefined)], []);
let sel = new Set([1, 2]);
assert.deepStrictEqual([...toggleSelection(sel, 3)], [1, 2, 3]);
assert.deepStrictEqual([...toggleSelection(sel, 2)], [1]);
assert.deepStrictEqual([...sel], [1, 2], 'the old set is not changed');
const full = new Set(Array.from({ length: 12 }, (_, i) => i + 1));
assert.strictEqual(toggleSelection(full, 99), full, 'a thirteenth cannot be ticked');
assert.strictEqual(toggleSelection(full, 5).size, 11, 'but one can always be unticked');
assert.deepStrictEqual(selectionNote(0), { text: 'Tick at least one article to write a brief from.', ok: false });
assert.strictEqual(selectionNote(1).ok, true);
assert.ok(/mostly restate them/.test(selectionNote(2).text));
assert.deepStrictEqual(selectionNote(5), { text: '5 articles ticked.', ok: true });
assert.deepStrictEqual(selectionNote(13).ok, false);
assert.strictEqual(factLabel({ singleSource: true, outletCount: 1 }), 'Single source');
assert.strictEqual(factLabel({ singleSource: false, outletCount: 3 }), '3 outlets');
assert.strictEqual(factLabel(undefined), '0 outlets');
assert.strictEqual(overlapWarning([]), '');
assert.strictEqual(overlapWarning(undefined), '');
assert.strictEqual(overlapWarning([{}]), 'One place in this brief repeats wording from a source. Rewrite it in your own words before you use it.');
assert.strictEqual(overlapWarning([{}, {}, {}]), '3 places in this brief repeat wording from a source. Rewrite them in your own words before you use them.');
assert.strictEqual(costText(0), '');
assert.strictEqual(costText(0.004), 'under 1 cent');
assert.strictEqual(costText(0.1234), 'about $0.12');
assert.strictEqual(costText('0.5'), 'about $0.50');
assert.strictEqual(costText(null), '');

assert.deepStrictEqual(SIGNAL_FIELDS.map((f) => f.id), ['rank', 'size', 'engagement', 'recency', 'source', 'match']);
assert.deepStrictEqual(toPercents({ rank: 0.3, size: 0.25, engagement: 0.2, recency: 0.15, source: 0.1 }), { rank: '30', size: '25', engagement: '20', recency: '15', source: '10', match: '0' });
assert.deepStrictEqual(toPercents(undefined), { rank: '0', size: '0', engagement: '0', recency: '0', source: '0', match: '0' });
assert.deepStrictEqual(fromPercents({ rank: '30', size: '25', engagement: '', recency: 'abc', source: '-5' }), { rank: 0.3, size: 0.25, engagement: 0, recency: 0, source: 0, match: 0 }, 'blank, nonsense and negative boxes are 0');
assert.deepStrictEqual(fromPercents(DEFAULT_PERCENTS), { rank: 0.25, size: 0.2, engagement: 0.15, recency: 0.15, source: 0.05, match: 0.2 });
assert.strictEqual(percentTotal(DEFAULT_PERCENTS), 100);
assert.strictEqual(percentTotal({ rank: '50', size: 'x', engagement: '25' }), 75);
assert.strictEqual(DEFAULT_HALF_LIFE, 48);

assert.strictEqual(rankingNote(null), '');
assert.strictEqual(rankingNote({ dropped: [] }), '');
assert.strictEqual(rankingNote({ dropped: [{ id: 'rank', label: 'Search rank', why: 'no Google or Brave results are in this search' }] }),
  'Left out of the ranking this time: search rank (no Google or Brave results are in this search). The other signals count for more instead.');
assert.ok(/search rank \(.*\); story size \(/.test(rankingNote({ dropped: [{ label: 'Search rank', why: 'a' }, { label: 'Story size', why: 'b' }] })));

assert.strictEqual(heatBadge(null), null);
assert.strictEqual(heatBadge({}), null);
assert.strictEqual(heatBadge({ label: 'Rising', clusters48h: 3 }).text, '▲ Rising');
assert.ok(/3 stories have an article from the last two days/.test(heatBadge({ label: 'Rising', clusters48h: 3 }).tip));
assert.ok(/1 story has/.test(heatBadge({ label: 'Steady', clusters48h: 1 }).tip));
assert.ok(/First search/.test(heatBadge({ label: 'New', clusters48h: 0 }).tip));
assert.strictEqual(heatBadge({ label: 'Falling' }).text, '▼ Falling');

assert.strictEqual(readNote('ok'), 'Page read');
assert.strictEqual(readNote(null), 'Headline and snippet only');
assert.strictEqual(readNote('robots'), 'The site asks not to be read');
assert.strictEqual(readNote('something-new'), 'Headline and snippet only');

assert.deepStrictEqual(breakdownRows(null), []);
const rows = breakdownRows([
  { id: 'rank', label: 'Search rank', available: false, why: 'no Google or Brave results are in this search', points: 0 },
  { id: 'size', label: 'Story size', available: true, raw: 3, points: 21.4 },
  { id: 'engagement', label: 'Engagement', available: true, raw: 0, points: 0 },
  { id: 'recency', label: 'Recency', available: true, raw: '2026-10-24T03:00:00.000Z', points: 12.6 },
  { id: 'source', label: 'Outlet weight', available: true, raw: 0.9, points: 9 },
]);
assert.deepStrictEqual(rows.map((r) => [r.id, r.off, r.points]), [['rank', true, null], ['size', false, 21.4], ['engagement', false, 0], ['recency', false, 12.6], ['source', false, 9]]);
assert.strictEqual(rows[0].text, 'Left out: no Google or Brave results are in this search');
assert.strictEqual(rows[1].text, '3 outlets');
assert.strictEqual(rows[2].text, 'None');
assert.ok(/2026/.test(rows[3].text));
assert.strictEqual(rows[4].text, 'Your weight 0.9');
assert.strictEqual(breakdownRows([{ id: 'size', label: 'x', available: true, raw: 1, points: 1 }])[0].text, '1 outlet');
assert.strictEqual(breakdownRows([{ id: 'rank', label: 'x', available: true, raw: 3, points: 1 }])[0].text, 'Position 3');
assert.strictEqual(breakdownRows([{ id: 'rank', label: 'x', available: true, raw: null, points: 0 }])[0].text, 'Not in the results');
assert.strictEqual(breakdownRows([{ id: 'recency', label: 'x', available: true, raw: null, points: 3 }])[0].text, 'No date (counted as middling)');

// ---- watchlist, history, spending
assert.deepStrictEqual(REFRESH_CHOICES.map((c) => c.hours), [6, 12, 24, 48, 168], 'the same choices the server accepts');
assert.strictEqual(refreshLabel(6), 'Every 6 hours');
assert.strictEqual(refreshLabel(168), 'Every week');
assert.strictEqual(refreshLabel(7), 'Every day', 'an unknown value shows the usual one');
{
  const list = [{ id: 1, onWatchlist: false }, { id: 2, onWatchlist: true, lastRun: { finishedAt: '2026-10-24T00:00:00Z' } }, { id: 3, onWatchlist: true, lastRun: { finishedAt: '2026-10-25T00:00:00Z' } }, { id: 4, onWatchlist: true }, { id: 5, onWatchlist: false }];
  const copy = JSON.stringify(list);
  assert.deepStrictEqual(orderTopics(list).map((t) => t.id), [3, 2, 4, 1, 5], 'watched first, newest refresh first, never-searched last among them; the rest keep their order');
  assert.strictEqual(JSON.stringify(list), copy, 'the list is not changed');
  assert.deepStrictEqual(orderTopics(null), []);
}
{
  const rows = mergeHistory(
    [{ id: 1, startedAt: '2026-10-20T00:00:00Z' }, { id: 2, startedAt: '2026-10-25T00:00:00Z' }],
    [{ id: 9, createdAt: '2026-10-22T00:00:00Z' }, { id: 8, createdAt: '2026-10-25T00:00:00Z' }],
  );
  assert.deepStrictEqual(rows.map((r) => r.kind + r.id), ['brief8', 'run2', 'brief9', 'run1'], 'newest first, a brief before the search it came from at the same moment');
  assert.deepStrictEqual(mergeHistory(null, undefined), []);
{
  const rows = mergeHistory([{ id: 1, startedAt: '2026-10-25T00:00:00Z' }], [{ id: 2, createdAt: '2026-10-25T00:00:00Z' }], [{ id: 3, createdAt: '2026-10-25T00:00:00Z' }, { id: 4, createdAt: '2026-10-26T00:00:00Z' }]);
  assert.deepStrictEqual(rows.map((r) => r.kind + r.id), ['draft4', 'draft3', 'brief2', 'run1'], 'drafts join the list; at one moment draft, then brief, then search');
}
assert.deepStrictEqual(DRAFT_LENGTHS.map((l) => l.id), ['short', 'medium', 'long'], 'the same choices the server accepts');
assert.strictEqual(draftLine({ words: 812, gapCount: 0, overlapCount: 0 }), '812 words');
assert.strictEqual(draftLine({ words: 812, gapCount: 1, overlapCount: 2 }), '812 words · 1 place to fill · 2 copy warnings');
assert.strictEqual(draftLine({ words: 5, gapCount: 3, overlapCount: 1 }), '5 words · 3 places to fill · 1 copy warning');
assert.strictEqual(draftLine({}), '0 words');
}
assert.strictEqual(budgetBanner(null), '');
assert.strictEqual(budgetBanner({ over: false, spentUsd: 1, limitUsd: 20 }), '');
assert.ok(budgetBanner({ over: true, spentUsd: 21.5, limitUsd: 20 }).includes('($21.50) has reached your limit of $20.00'));
assert.strictEqual(spendLine({ spentUsd: 1.2, limitUsd: 20 }), '$1.20 of $20.00 used this month');
assert.strictEqual(spendLine({ spentUsd: 1.2, limitUsd: 0 }), '$1.20 used this month (no limit)');
assert.strictEqual(spendLine(null), '');

// ---- progress steps and the workflow bar
assert.deepStrictEqual([SEARCH_STEP_LABELS.length, BRIEF_STEP_LABELS.length, DRAFT_STEP_LABELS.length], [4, 3, 3]);
{
  const m = stepsForModal([
    { id: 'sources', label: 'Asking your sources', status: 'done', detail: '5 sources asked' },
    { id: 'save', label: 'Saving what they found', status: 'active', detail: '40 articles' },
    { id: 'read', label: 'Reading the best pages', status: 'pending', detail: '' },
    { id: 'rank', label: 'Grouping stories and ranking', status: 'error', detail: 'broke' },
    { id: 'x', label: 'Skipped one', status: 'skipped', detail: '' },
  ]);
  assert.deepStrictEqual(m.map((s) => s.status), ['done', 'active', 'pending', 'error', 'done']);
  assert.strictEqual(m[0].label, 'Asking your sources · 5 sources asked');
  assert.strictEqual(m[1].label, 'Saving what they found · 40 articles');
  assert.strictEqual(m[2].label, 'Reading the best pages', 'a pending step shows no note');
  assert.strictEqual(m[4].label, 'Skipped one');
  assert.deepStrictEqual(stepsForModal(null), []);
  assert.deepStrictEqual(stepsForModal([{}]).map((s) => [s.id, s.label, s.status]), [['step-0', '', 'done']], 'a junk step does not throw');
}
assert.deepStrictEqual(workflowSteps('topics').map((s) => s.state), ['current', 'todo', 'todo', 'todo']);
assert.deepStrictEqual(workflowSteps('results').map((s) => s.state), ['done', 'current', 'todo', 'todo']);
assert.deepStrictEqual(workflowSteps('brief').map((s) => s.state), ['done', 'done', 'current', 'todo']);
assert.deepStrictEqual(workflowSteps('draft').map((s) => s.state), ['done', 'done', 'done', 'current']);
assert.deepStrictEqual(workflowSteps('nonsense').map((s) => s.state), ['current', 'todo', 'todo', 'todo'], 'an unknown view is the start');
assert.deepStrictEqual(workflowSteps('draft').map((s) => s.label), ['Search', 'Results', 'Brief', 'Draft']);

// ---- draft readiness: is there enough in the brief to write from?
{
  const fact = (text, single = false) => ({ fact: text, sources: ['u'], singleSource: single });
  const sec = (heading, notes = [], level = 2) => ({ level, heading, notes });
  const good = {
    keyFacts: [fact('Refrigeration must reject heat to the room'), fact('Front venting hides the grille in joinery'), fact('Insulation and door seals decide cooling load'), fact('Service access should be planned before building')],
    outline: [sec('Introduction'), sec('Heat rejection and ventilation'), sec('Joinery and venting'), sec('Insulation and seals'), sec('Service access'), sec('Conclusion')],
  };
  const g = draftReadiness(good);
  assert.deepStrictEqual([g.level, g.facts, g.sections, g.unsupported, g.message], ['ok', 4, 4, 0, ''], 'an opening and a close need no fact; each subject section has one');
  // 9 subject sections, 6 with nothing behind them: thin
  const thin = {
    keyFacts: [fact('Refrigeration must reject heat'), fact('Front venting hides the grille'), fact('Seals matter'), fact('Service access matters')],
    outline: [sec('Heat rejection'), sec('Venting'), sec('Compressor ratings'), sec('Duty cycles'), sec('Ambient limits'), sec('Australian climate'), sec('Pricing in dollars'), sec('Sizing to volume'), sec('Warranty on joinery')],
  };
  const t = draftReadiness(thin);
  assert.deepStrictEqual([t.level, t.sections, t.unsupported], ['thin', 9, 7], 'only heat and venting are covered: 7 of 9 have nothing (seals and service matter are not outline sections here)');
  assert.ok(t.message.startsWith('7 of 9 sections of the outline have no supporting fact in this brief.'));
  assert.ok(/needs your input/.test(t.message) && /rough check from word overlap/.test(t.message));
  // exactly half unsupported is thin; one under is fine
  const half = { keyFacts: good.keyFacts, outline: [sec('Heat rejection'), sec('Venting'), sec('Compressor ratings'), sec('Pricing in dollars')] };
  assert.strictEqual(draftReadiness(half).level, 'thin', '2 of 4 is half');
  const under = { keyFacts: good.keyFacts, outline: [sec('Heat rejection'), sec('Venting'), sec('Insulation'), sec('Pricing in dollars')] };
  assert.deepStrictEqual([draftReadiness(under).level, draftReadiness(under).unsupported], ['ok', 1], '1 of 4 is fine');
  // too few facts is thin whatever the outline says, and the sentence says so (singular too)
  const few = draftReadiness({ keyFacts: [fact('Refrigeration must reject heat')], outline: [sec('Heat rejection')] });
  assert.deepStrictEqual([few.level, /only 1 sourced fact\./.test(few.message)], ['thin', true]);
  assert.ok(/only 3 sourced facts\./.test(draftReadiness({ keyFacts: good.keyFacts.slice(0, 3), outline: good.outline }).message));
  // a sub-heading is not counted as a section of its own; plural and singular words match; a section's notes count
  const sub = draftReadiness({ keyFacts: good.keyFacts, outline: [sec('Heat rejection'), sec('Pricing', [], 3), sec('Fittings', ['grilles hidden by venting'])] });
  assert.deepStrictEqual([sub.sections, sub.unsupported], [2, 0], 'level-3 headings are skipped; "venting" in the notes finds the venting fact');
  assert.deepStrictEqual([draftReadiness({ keyFacts: good.keyFacts, outline: [sec('Seal')] }).unsupported, draftReadiness({ keyFacts: good.keyFacts, outline: [sec('Seals')] }).unsupported], [0, 0], 'seal and seals both find "seals"');
  // junk in, no throw
  for (const junk of [null, undefined, {}, { keyFacts: 'x', outline: 4 }, { keyFacts: [null], outline: [null] }]) assert.doesNotThrow(() => draftReadiness(junk));
  assert.strictEqual(draftReadiness(null).level, 'thin', 'nothing in a brief is thin');
  assert.strictEqual(draftReadiness({ keyFacts: good.keyFacts, outline: [] }).level, 'ok', 'four facts and no outline: nothing to contradict them');
  assert.ok(Math.abs(draftReadiness({ keyFacts: [fact('a b c d', true), fact('e f g h', true), fact('i j k l'), fact('m n o p')], outline: [] }).singleShare - 0.5) < 1e-9);
  assert.strictEqual(RELEVANCE_STEP_LABELS.length, 1);
}

// ---- failed requests: our own message wins; a gateway's silence is explained
{
  assert.strictEqual(explainFailure({ status: 400 }, { error: 'Tick at least one article.' }, 'Could not write the draft.'), 'Tick at least one article.', 'our own message always wins, even on a 5xx');
  assert.strictEqual(explainFailure({ status: 500 }, { error: 'Could not write that draft.' }, 'x'), 'Could not write that draft.');
  assert.strictEqual(explainFailure({ status: 502 }, { error: '  ' }, 'Could not write the draft.').startsWith('The server did not answer properly'), true, 'a blank error from a 5xx is not an error');
  const gateway = explainFailure({ status: 502 }, { status: 'error', code: 502, message: 'Application failed to respond' }, 'Could not write the draft.');
  assert.match(gateway, /did not answer properly \(HTTP 502\)/);
  assert.match(gateway, /restarting after an update/);
  assert.match(gateway, /It may still have finished: check the list below or History/);
  assert.match(explainFailure({ status: 504 }, {}, 'x'), /HTTP 504/, 'an empty reply from a gateway');
  assert.match(explainFailure({ status: 200 }, {}, 'x'), /did not answer properly/, 'no usable reply at all');
  assert.match(explainFailure(undefined, undefined, 'x'), /did not answer properly\./, 'nothing to go on: no status shown');
  assert.strictEqual(explainFailure({ status: 404 }, { message: 'nope' }, 'Could not write the draft.'), 'Could not write the draft.', 'a 4xx with its own shape keeps the plain fallback');
}

// ---- what was asked
{
  const p = { model: 'model-x', system: 'RULES', user: 'REQUEST\nwith material', retry: null };
  const txt = promptText(p);
  assert.ok(txt.startsWith('MODEL: model-x'));
  assert.ok(txt.indexOf('RULES') < txt.indexOf('REQUEST'), 'the rules come before the request');
  assert.ok(txt.includes('=== SYSTEM') && txt.includes('=== USER') && !txt.includes('SECOND TRY'));
  assert.ok(promptText({ ...p, retry: '\n\nYour previous answer could not be used' }).includes('=== SECOND TRY: this was added to the request ===\n\n\nYour previous answer could not be used'), 'a second try\'s extra text is shown after');
  assert.strictEqual(promptText(null), '');
  assert.strictEqual(promptText('nope'), '');
  assert.ok(promptText({ system: 's', user: 'u' }).startsWith('MODEL: not recorded'));

  assert.strictEqual(searchedForLine(['storm', 'hurricane'], 'storm'), 'Searched for: \u201cstorm\u201d \u00b7 \u201churricane\u201d');
  assert.strictEqual(searchedForLine(['storm'], 'storm'), 'Searched for: \u201cstorm\u201d', 'a single phrasing is shown too');
  assert.strictEqual(searchedForLine([], 'motors for walk in wine cabinets'), 'Searched for: \u201cmotors for walk in wine cabinets\u201d', 'an older run with no record falls back to the topic');
  assert.strictEqual(searchedForLine(undefined, ''), '');

  assert.strictEqual(notUsedLine([]), '');
  assert.strictEqual(notUsedLine(undefined), '');
  assert.strictEqual(notUsedLine([{ label: 'Reddit', reason: 'Needs REDDIT_CLIENT_ID.' }, { label: 'Google results (Serper)', reason: '' }, null, {}]), 'Not used this time: Reddit (Needs REDDIT_CLIENT_ID.) \u00b7 Google results (Serper)');
  assert.ok(notUsedLine([{ label: 'X', reason: 'y'.repeat(300) }]).endsWith('...)'), 'a long reason is cut');
}

// ---- navigation (milestone 9)
{
  assert.deepStrictEqual(wfs('results', ['brief']).map((s) => s.state), ['done', 'current', 'later', 'todo'], 'a brief that exists is reachable from the results');
  assert.deepStrictEqual(wfs('brief', ['brief', 'draft']).map((s) => s.state), ['done', 'done', 'current', 'later']);
  assert.deepStrictEqual(wfs('results', ['search', 'sources']).map((s) => s.state), ['done', 'current', 'todo', 'todo'], 'a stage behind or at you is never "later"');
  assert.deepStrictEqual(wfs('topics', 'nonsense').map((s) => s.state), ['current', 'todo', 'todo', 'todo'], 'junk for reached is ignored');
  assert.deepStrictEqual(briefJumpLinks({ keyFacts: [1], gaps: [], suggestedAngles: [1], outline: [1] }).map((x) => x[0]), ['tr-facts', 'tr-angles', 'tr-outline', 'tr-sources'], 'an empty section has no link');
  assert.deepStrictEqual(briefJumpLinks(null), [['tr-sources', 'Sources']]);
  assert.ok(briefTabLabel({ chosenAngle: 'Sizing the cooling unit', createdAt: '2026-10-26T01:00:00Z' }).startsWith('Sizing the cooling unit · '));
  assert.ok(briefTabLabel({ chosenAngle: 'x'.repeat(80), createdAt: '2026-10-26T01:00:00Z' }).length < 60, 'a long angle is cut');
  assert.ok(briefTabLabel({ angle: 'typed angle', createdAt: '2026-10-26T01:00:00Z' }).startsWith('typed angle'), 'falls back to the angle asked for');
  assert.ok(briefTabLabel({}).startsWith('Brief'));
}

// ---- filtering saved topics by client or project
{
  const topics = [
    { id: 1, link: { client: { id: 10, name: 'Acme' }, project: null } },
    { id: 2, link: { client: { id: 10, name: 'Acme', viaProject: true }, project: { id: 5, name: 'Site' } } },
    { id: 3, link: { client: null, project: { id: 6, name: 'Solo' } } },
    { id: 4, link: { client: null, project: null } },
    { id: 5 },
  ];
  const ids = (f) => filterTopicsByLink(topics, f).map((t) => t.id);
  assert.deepStrictEqual(ids({}), [1, 2, 3, 4, 5], 'no filter shows everything');
  assert.deepStrictEqual(ids({ clientId: 10 }), [1, 2], 'a client shows its own topics and those of its projects');
  assert.deepStrictEqual(ids({ projectId: 6 }), [3]);
  assert.deepStrictEqual(ids({ clientId: 10, projectId: 5 }), [2], 'both narrow it');
  assert.deepStrictEqual(ids({ clientId: 10, projectId: 6 }), [], 'a mismatch gives nothing');
  assert.deepStrictEqual(ids({ clientId: '10' }), [1, 2], 'an id from a select (text) still matches');
  assert.deepStrictEqual(filterTopicsByLink(null, { clientId: 1 }), []);
}

console.log('topicResearch format: all passed');
