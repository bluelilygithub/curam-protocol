'use strict';
const assert = require('assert');
const R = require('./noteRelated');

(async () => {
  assert.deepStrictEqual(R.topIds([3, 4, 4, 5, 4, 3, 0, null, 'x'], 2), [4, 3], 'most frequent first, junk ignored');
  assert.deepStrictEqual(R.topIds([7, 8, 9], 2), [7, 8], 'ties keep the first-seen (most relevant) order');

  const data = {
    clients: [{ id: 9, name: 'Acme Pty Ltd', company: 'Acme', status: 'active' }, { id: 10, name: 'Beta', company: null, status: 'prospect' }],
    projects: [{ id: 4, name: 'Website relaunch', clientId: 9, clientStatus: 'in delivery', targetEndDate: '2026-12-01', archived_at: null }, { id: 5, name: 'Loose project', clientId: null }],
    tasks: [
      { id: 21, title: 'Chase invoice', status: 'todo', priority: 'high', dueDate: '2026-10-30', projectId: 4, clientId: null },
      { id: 22, title: 'Call Sam', status: 'in-progress', priority: 'medium', dueDate: null, projectId: null, clientId: 9 },
      { id: 23, title: 'Old thing', status: 'done', priority: 'low', dueDate: null, projectId: 5, clientId: null },
    ],
    deals: [{ id: 31, title: 'Retainer', stage: 'proposal', value: '12000.00', expectedCloseDate: '2026-11-15', clientId: 9 }],
    activity: [{ id: 41, type: 'call', title: 'Kickoff call', date: new Date('2026-10-01T00:00:00Z'), clientId: 9 }],
  };
  const sources = [{ n: 1, project_id: 4, client_id: 9 }, { n: 2, project_id: 4, client_id: null }, { n: 3, project_id: null, client_id: 10 }];
  const items = R.buildItems(data, sources);
  const by = Object.fromEntries(items.map((i) => [i.key, i]));
  assert.deepStrictEqual(items.map((i) => i.key), ['C1', 'C2', 'P1', 'P2', 'T1', 'T2', 'T3', 'D1', 'A1'], 'numbered by kind, in reading order');
  assert.strictEqual(by.P1.parent, 'C1', 'a project hangs on its client');
  assert.strictEqual(by.P2.parent, null);
  assert.strictEqual(by.T1.parent, 'P1', 'a task hangs on its project');
  assert.strictEqual(by.T2.parent, 'C1', 'or straight on its client');
  assert.strictEqual(by.T3.parent, 'P2');
  assert.strictEqual(by.D1.parent, 'C1');
  assert.strictEqual(by.A1.parent, 'C1');
  assert.deepStrictEqual(by.P1.notes, [1, 2], 'which numbered notes sit on the project');
  assert.deepStrictEqual(by.C1.notes, [1]);
  assert.deepStrictEqual(by.C2.notes, [3]);
  assert.strictEqual(by.T1.detail, 'to do · high priority · due 2026-10-30');
  assert.strictEqual(by.T2.detail, 'in progress');
  assert.strictEqual(by.T3.detail, 'done · low priority');
  assert.strictEqual(by.D1.detail, 'proposal · $12,000 · expected close 2026-11-15');
  assert.strictEqual(by.A1.detail, 'call · 2026-10-01');
  assert.strictEqual(by.C1.href, '/clients/9');
  assert.strictEqual(by.P1.href, '/projects/4');
  assert.strictEqual(by.T1.href, '/tasks?project=4');
  assert.strictEqual(by.T2.href, '/tasks');
  assert.strictEqual(by.D1.href, '/clients/9');
  assert.deepStrictEqual(R.buildItems({}, []), []);

  // ---- the text the model reads: one line per record, with its key, where it hangs and which notes it came from
  const text = R.describeForPrompt(items);
  assert.match(text, /^\[C1\] client "Acme Pty Ltd" \| Acme · active \| from note \[1\]$/m);
  assert.match(text, /^\[T1\] task "Chase invoice" \| to do · high priority · due 2026-10-30 \| on Website relaunch \[P1\]$/m);
  assert.match(text, /^\[P1\] project "Website relaunch" \| in delivery · target 2026-12-01 \| on Acme Pty Ltd \[C1\] \| from notes \[1\]\[2\]$/m);
  assert.strictEqual(text.split('\n').length, items.length);
  const long = R.buildItems({ tasks: Array.from({ length: 200 }, (_, i) => ({ id: i + 1, title: `Task ${i} ${'x'.repeat(100)}`, status: 'todo', priority: 'medium' })) });
  assert.ok(R.describeForPrompt(long).length <= 7100, 'the text is bounded');
  assert.ok(R.buildItems({ tasks: [{ id: 1, title: 'a\n\nb  '.repeat(100), status: 'todo' }] })[0].label.length <= 120, 'a long title is cut and put on one line');

  // ---- what the screen keeps
  const screen = R.forScreen(items, ['T1']);
  assert.strictEqual(screen.find((i) => i.key === 'T1').cited, true);
  assert.strictEqual(screen.find((i) => i.key === 'T2').cited, false);
  assert.deepStrictEqual(Object.keys(screen[0]).sort(), ['cited', 'detail', 'href', 'id', 'key', 'kind', 'label', 'notes', 'parent']);
  assert.ok(R.KEY_RE.test('T12') && !R.KEY_RE.test('X1') && !R.KEY_RE.test('T'));

  // ---- gathering, with a fake database: every query is for this person, and the model's hint counts even with no notes on it
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM projects/.test(sql)) return { rows: data.projects.filter((p) => params[1].includes(p.id)) };
      if (/FROM clients WHERE/.test(sql)) return { rows: data.clients.filter((c) => params[1].includes(c.id)) };
      if (/FROM tasks/.test(sql)) return { rows: data.tasks };
      if (/FROM client_deals/.test(sql)) return { rows: data.deals };
      if (/FROM client_interactions/.test(sql)) return { rows: data.activity };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    },
  };
  const got = await R.gatherRelated(pool, 7, sources, {});
  assert.ok(seen.every((s) => s.params[0] === 7), 'every query starts from the person');
  assert.ok(seen.every((s) => /"userId"=\$1/.test(s.sql)), 'and says so in the SQL');
  assert.ok(got.some((i) => i.key === 'T1') && got.some((i) => i.key === 'D1'));
  seen.length = 0;
  assert.deepStrictEqual(await R.gatherRelated(pool, 7, [{ n: 1, project_id: null, client_id: null }], {}), [], 'notes with nothing filed on them: nothing to map');
  assert.strictEqual(seen.length, 0, 'and no queries made');
  const hinted = await R.gatherRelated(pool, 7, [], { clientId: 9 });
  assert.ok(hinted.some((i) => i.kind === 'client' && i.id === 9), 'a client the question named is mapped even with no note on it');
  const taskSql = seen.find((s) => /FROM tasks/.test(s.sql)).sql;
  assert.match(taskSql, /"parentTaskId" IS NULL/, 'top-level tasks only');
  assert.match(taskSql, /status <> 'done' OR "updatedAt" > NOW\(\) - INTERVAL '30 days'/, 'finished tasks only when recent');
  assert.match(seen.find((s) => /FROM client_interactions/.test(s.sql)).sql, /JOIN clients c ON c\.id = i\."clientId" AND c\."userId"=\$1/, "contact history only through the person's own clients");

  console.log('noteRelated tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
