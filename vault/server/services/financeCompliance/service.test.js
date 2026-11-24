'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const svc = require('./service');

const now = new Date('2026-11-24T01:02:03Z');
const snapshot = {
  sourceId: 'advice-guidance', label: 'ATO advice and guidance', url: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance',
  finalUrl: 'https://www.ato.gov.au/about-ato/ato-advice-and-guidance', status: 'ok', reason: '', hash: 'hash-1',
  title: 'Advice', excerpt: 'A short excerpt.', promptText: 'A short excerpt.', fetchedAt: now.toISOString(),
};
const blocked = {
  sourceId: 'small-business-newsroom', label: 'Newsroom', url: 'https://www.ato.gov.au/businesses-and-organisations/small-business-newsroom',
  finalUrl: '', status: 'unavailable', reason: 'HTTP 403', hash: '', title: '', excerpt: '', promptText: '', fetchedAt: now.toISOString(),
};

function makePool() {
  const state = { updates: [], sources: [], usage: [] };
  const saved = {
    id: 11, userId: 7, status: 'done', trigger: 'manual', modelId: 'configured-model',
    summary: 'Model summary', report: {}, markdown: '', contentHash: '', error: '',
    createdAt: now, updatedAt: now,
  };
  state.saved = saved;
  const pool = {
    state,
    async query(sql, params) {
      if (sql.includes('INSERT INTO finance_compliance_reports')) {
        return { rows: [{ ...saved, id: params[0], userId: params[0], status: 'running', modelId: '', summary: '', report: {}, markdown: '' }] };
      }
      if (sql.includes('UPDATE finance_compliance_reports')) {
        state.updates.push(params);
        saved.status = 'done';
        saved.modelId = params[1];
        saved.summary = params[2];
        saved.report = JSON.parse(params[3]);
        saved.markdown = params[4];
        saved.contentHash = params[5];
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes('INSERT INTO finance_compliance_sources')) {
        state.sources.push(params);
        return { rows: [] };
      }
      if (sql.includes('SELECT ') && sql.includes('FROM finance_compliance_reports')) {
        return { rows: [saved] };
      }
      if (sql.includes('FROM finance_compliance_sources')) {
        return { rows: state.sources.map((p) => ({ id: p[0], sourceId: p[2], status: p[6], excerpt: p[10] })) };
      }
      throw new Error(`unexpected SQL: ${sql.replace(/\s+/g, ' ').slice(0, 100)}`);
    },
  };
  return pool;
}

(async () => {
  const adaptersIndex = fs.readFileSync(path.join(__dirname, '../recycleBin/adapters/index.js'), 'utf8');
  assert.match(adaptersIndex, /require\('\.\/financeCompliance'\)/, 'the recycle bin adapter is registered');

  const pool = makePool();
  const usage = [];
  const deps = {
    pool,
    now: () => now,
    resolveModel: async () => ({ standard: 'configured-model', light: null }),
    callModel: async (modelId, prompt, opts) => {
      assert.strictEqual(modelId, 'configured-model');
      assert.ok(prompt.includes('Finance Compliance Advisory'));
      assert.ok(prompt.includes('sourceId="advice-guidance"'), 'the prompt uses the fixed source id');
      assert.strictEqual(opts.returnUsage, true);
      assert.ok(prompt.includes('status="unavailable (HTTP 403)"'), 'unavailable sources are marked in the prompt');
      return {
        text: JSON.stringify({
          summary: 'One ATO page described a change. Verify it.',
          updates: [{ title: 'Change', sourceId: 'advice-guidance', detail: 'Described on the page.', sharesImpact: 'Check records.', action: 'Ask your accountant.', confidence: 'low' }],
          actions: ['Read the source.'], limits: [],
        }),
        inputTokens: 120,
        outputTokens: 40,
      };
    },
    logUsage: async (entry) => usage.push(entry),
    fetchSources: async () => [snapshot, blocked],
    fetchSourcesDeps: {},
    assertCap: async () => ({ spent: 0, cap: 1, estimate: 0.05, remaining: 1 }),
  };

  const started = await svc.startReports({ userIds: [7, 7, 0], trigger: 'manual', background: false, deps });
  assert.strictEqual(started.length, 1, 'user ids are unique and valid');
  assert.strictEqual(started[0].status, 'running', 'the POST answer is the running row');

  assert.strictEqual(pool.state.updates.length, 1);
  const savedReport = JSON.parse(pool.state.updates[0][3]);
  assert.strictEqual(savedReport.status, 'done');
  assert.strictEqual(savedReport.updates.length, 1);
  assert.strictEqual(savedReport.sources.length, 2, 'read and unavailable snapshots are both kept');
  assert.strictEqual(pool.state.sources.length, 2, 'one source row per report per source');
  assert.strictEqual(pool.state.sources[0][6], 'ok', 'status is persisted');
  assert.strictEqual(pool.state.sources[0][8], 'hash-1', 'hash is persisted');
  assert.strictEqual(usage.length, 1);
  assert.strictEqual(usage[0].feature, 'finance_compliance_report');
  assert.strictEqual(usage[0].inputTokens, 120);

  const list = await svc.listReports(7, { pool });
  assert.strictEqual(list.length, 1);
  const detail = await svc.getReport(7, 11, { pool });
  assert.strictEqual(detail.sources.length, 2);
  assert.strictEqual(detail.report.status, 'done');

  // Two admins in one scheduled run: each snapshot must be owned by that row's admin, not just the first.
  pool.state.sources.length = 0;
  await svc.startReports({ userIds: [7, 8], trigger: 'scheduled', background: false, deps });
  assert.deepStrictEqual(pool.state.sources.map((p) => Number(p[1])).filter((id) => id === 8), [8, 8], 'the second admin owns their snapshots');
  assert.strictEqual(pool.state.sources.filter((p) => Number(p[1]) === 7).length, 2, 'the first admin owns theirs');

  let captured = null;
  let deleted = false;
  const client = {
    async query(sql, params) {
      if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [pool.state.saved] };
      if (sql.includes('FROM finance_compliance_sources')) return { rows: [{ id: 1, sourceId: 'advice-guidance' }] };
      if (sql.includes('DELETE FROM finance_compliance_reports')) { deleted = true; return { rows: [] }; }
      throw new Error(`unexpected client SQL: ${sql.replace(/\s+/g, ' ').slice(0, 100)}`);
    },
    release() {},
  };
  const result = await svc.deleteReport(7, 11, {
    pool: { connect: async () => client },
    recycleBin: {
      RETENTION_DAYS: 30,
      async moveToBin(db, payload) { captured = payload; return 99; },
    },
  });
  assert.strictEqual(result.binId, 99);
  assert.strictEqual(result.retentionDays, 30);
  assert.ok(deleted, 'the report row is removed in the transaction');
  assert.strictEqual(captured.type, 'finance-compliance-report');
  assert.strictEqual(captured.payload.sources.length, 1, 'sources go to the bin with the report');

  console.log('financeCompliance/service: ok');
})().catch((err) => { console.error(err); process.exit(1); });
