// node server/services/codeMap/models/testSet.test.js — Code Map Models test sets (testSet.js) and attachTests (check.js). No database, no model.
'use strict';

const assert = require('assert');
const { createModelTests, pickCases, codeChecks, parseJudge, rateCandidate, verdict, clampCases, templateOf } = require('./testSet');
const { attachTests } = require('./check');

// pickCases: one per topic first, newest first, then repeats
const rows = [{ id: 1, topicId: 'a' }, { id: 2, topicId: 'a' }, { id: 3, topicId: 'b' }, { id: 4, topicId: 'c' }, { id: 5, topicId: 'b' }];
assert.deepStrictEqual(pickCases(rows, 4).map((r) => r.id), [1, 3, 4, 2]);
assert.deepStrictEqual(pickCases(rows, 2).map((r) => r.id), [1, 3]);
assert.strictEqual(clampCases(undefined), 10);
assert.strictEqual(clampCases('50'), 20);
assert.strictEqual(clampCases(1), 3);
assert.strictEqual(templateOf({ keyStorylines: {} }), 'digest');
assert.strictEqual(templateOf({ left: {} }), 'perspectives');

// codeChecks
const summary = 'The council voted on Tuesday to approve the new budget after a long debate, with the mayor casting the deciding vote.';
const goodDigest = { unbiased: { summary, sourceIndices: [1, 2] }, keyStorylines: { keyPoints: ['x'], sourceIndices: [3] } };
assert.deepStrictEqual(codeChecks(goodDigest, 'digest', 3), { ok: true, passed: 6, total: 6, problems: [] });
const badIdx = codeChecks({ ...goodDigest, keyStorylines: { keyPoints: ['x'], sourceIndices: [9] } }, 'digest', 3);
assert.strictEqual(badIdx.ok, false);
assert.deepStrictEqual(badIdx.problems, ['a source number does not match an article']);
assert.strictEqual(codeChecks(null, 'digest', 3).ok, false, 'no readable JSON fails');
const persp = codeChecks({ unbiased: { summary, sourceIndices: [1] }, left: { summary: 'l', sourceIndices: [2] }, right: { summary: '', sourceIndices: [2] }, commonGround: {} }, 'perspectives', 5);
assert.deepStrictEqual(persp.problems, ['no right summary']);
assert.strictEqual(persp.total, 8);
assert.strictEqual(codeChecks({ ...goodDigest, unbiased: { summary: 'Too short.', sourceIndices: [1] } }, 'digest', 3).problems[0], 'unbiased summary too short or too long');

// parseJudge and rateCandidate
assert.deepStrictEqual(parseJudge('```json\n{"better":"B","scoreA":3,"scoreB":9,"reason":"B is grounded"}\n```'), { better: 'B', scoreA: 3, scoreB: 5, reason: 'B is grounded' });
assert.strictEqual(parseJudge('{"better":"C"}'), null);
assert.strictEqual(parseJudge('not json'), null);
assert.strictEqual(rateCandidate({ better: 'A' }, 'A'), 'better');
assert.strictEqual(rateCandidate({ better: 'A' }, 'B'), 'worse');
assert.strictEqual(rateCandidate({ better: 'same' }, 'B'), 'same');
assert.strictEqual(rateCandidate(null, 'B'), null);

// verdict
const ok = { checks: { ok: true } };
const no = { checks: { ok: false } };
const mk = (ratings, cand = ok) => ratings.map((rating) => ({ current: ok, candidate: cand, rating }));
let v = verdict(mk(['same', 'same', 'better', 'same', 'same', 'same', 'same', 'same', 'same', 'worse']), { current: 'big', candidate: 'small', costCurrent: 1, costCandidate: 0.25 });
assert.strictEqual(v.label, 'same');
assert.match(v.text, /^Same quality: small passed the code checks on 10 of 10 cases \(big: 10 of 10\), and the judge rated it as good or better on 9 of 10 judged cases\. It cost 25% as much as big/);
assert.strictEqual(verdict(mk(['same', 'same', 'same', 'same', 'worse', 'worse']), {}).label, 'worse', '4 of 6 is under 80%');
assert.strictEqual(verdict(mk(['same', 'same', 'same', 'same']), {}).label, 'notEnough', 'fewer than 5 judged cases');
assert.strictEqual(verdict([...mk(['same', 'same', 'same', 'same', 'same']), { current: ok, candidate: no, rating: null }], {}).label, 'worse', 'fewer code checks passed');

// a whole run with stand-ins
(async () => {
  const table = [];
  const pool = {
    async query(sql, p = []) {
      if (/FROM news_digest_topics/.test(sql)) {
        return { rows: [1, 2, 3, 4, 5, 6].map((i) => ({ id: i, topicId: i, title: `Topic ${i}`, date: '2026-11-20', articles: [1, 2, 3].map((n) => ({ title: `A${n}`, source: 'S', summary: 's' })), analysis: { keyStorylines: {} } })) };
      }
      if (/^INSERT INTO code_map_model_tests/.test(sql)) { table.push({ id: table.length + 1, userId: p[0], tool: p[1], status: 'running', current: p[2], candidate: p[3], judge: p[4] }); return { rows: [{ id: table.length }] }; }
      if (/^UPDATE code_map_model_tests SET status = 'done'/.test(sql)) { Object.assign(table[p[0] - 1], { status: 'done', summary: p[1], result: p[2], costUsd: p[5], finishedAt: '2026-11-25T01:00:00Z' }); return { rows: [] }; }
      if (/^UPDATE code_map_model_tests SET status = 'failed'/.test(sql)) { Object.assign(table[p[0] - 1], { status: 'failed', error: p[1] }); return { rows: [] }; }
      if (/^DELETE/.test(sql)) return { rows: [] };
      if (/WHERE status = 'done' ORDER BY id DESC LIMIT 1/.test(sql)) return { rows: table.filter((r) => r.status === 'done').slice(-1) };
      if (/WHERE id = \$1/.test(sql)) return { rows: table.filter((r) => r.id === p[0]) };
      return { rows: table.slice().reverse() };
    },
  };
  const calls = [];
  const answer = JSON.stringify(goodDigest);
  const t = createModelTests({
    pool,
    getModels: async () => ({ standard: 'judge-m', light: 'small' }),
    getCatalog: async () => ['big', 'small', 'judge-m'],
    newsModels: async () => ({ primaryModelId: 'big', fallbackModelId: 'small' }),
    context: async () => [],
    callModel: async (model, prompt) => {
      calls.push(model);
      if (model === 'judge-m') {
        assert.match(prompt, /Answer A:/);
        assert.doesNotMatch(prompt, /"sources"/, 'the judge does not see the resolved sources');
        return { text: '{"better":"same","scoreA":4,"scoreB":4,"reason":"close"}', inputTokens: 100, outputTokens: 20 };
      }
      return { text: answer, inputTokens: 1000, outputTokens: model === 'big' ? 400 : 300 };
    },
    logUsage: (x) => assert.strictEqual(x.feature, 'code_map_models_test'),
    cost: (m, i, o) => ({ big: 0.01, small: 0.002, 'judge-m': 0.005 }[m] * (i + o) / 1000),
    rand: () => 0.3,
    log: () => ({ error: (e) => { throw e.err; }, warn: () => {} }),
  });

  const e = await t.estimate(7, { cases: 5 });
  assert.strictEqual(e.current, 'big');
  assert.strictEqual(e.candidate, 'small', 'the light model is the suggested candidate');
  assert.deepStrictEqual(e.candidates, ['small', 'judge-m']);
  assert.strictEqual(e.cases, 5);
  assert.strictEqual(e.calls, 15);
  assert.ok(e.approxCostUsd > 0);

  await assert.rejects(t.start(7, { candidate: 'big' }), /not the current one/);
  const id = await t.start(7, { candidate: 'small', cases: 5 });
  await assert.rejects(t.start(7, { candidate: 'small' }), (err) => err.status === 409);
  await t.whenDone(id);
  const done = await t.get(id);
  assert.strictEqual(done.status, 'done', done.error);
  const s = done.summary;
  assert.strictEqual(s.label, 'same');
  assert.strictEqual(s.cases, 5);
  assert.strictEqual(calls.length, 15, '2 answers and 1 judge call per case');
  const res = done.result;
  assert.strictEqual(res.cases[0].candidateSlot, 'A');
  assert.strictEqual(res.cases[0].rating, 'same');

  // attachTests: the tool row gets its newest test; a matching newer-model finding gets the result in its evidence and detail
  const report = {
    tools: [{ tool: 'newsDigest', findings: [] }, { tool: 'notes', findings: [] }],
    findings: [
      { kind: 'newerModel', tool: '(workspace)', detail: 'Try it.', evidence: { current: 'big', candidate: 'small' } },
      { kind: 'newerModel', tool: '(workspace)', detail: 'Other.', evidence: { current: 'x', candidate: 'y' } },
    ],
  };
  attachTests(report, [{ id: 1, tool: 'newsDigest', current: 'big', candidate: 'small', summary: s, finishedAt: '2026-11-25T01:00:00Z' }]);
  assert.strictEqual(report.tools[0].test.label, 'same');
  assert.strictEqual(report.tools[0].test.date, '2026-11-25');
  assert.strictEqual(report.tools[1].test, null);
  assert.match(report.findings[0].detail, /^Try it\. Test set on News digest \(2026-11-25\): Same quality/);
  assert.strictEqual(report.findings[0].evidence.test.candidate, 'small');
  assert.strictEqual(report.findings[1].evidence.test, undefined, 'another pair of models is left alone');

  console.log('testSet.test.js: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
