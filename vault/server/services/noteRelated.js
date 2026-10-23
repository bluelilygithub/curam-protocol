'use strict';

// The "mud map" around notes: the projects, clients, tasks, deals and recent contact that sit next to the notes a question found.
// A rough sketch of what is connected, not a report. Everything is read, nothing changed, and every query starts from the signed-in
// person's id (projects, clients, tasks and deals by "userId"; contact history only through that person's own clients).
//
// Each item gets a short key the answer can cite and the screen can show: P1 project, C1 client, T1 task, D1 deal, A1 recent contact.
// `parent` says where an item hangs on the map (task -> project or client, project -> client, deal/contact -> client) and `notes` lists
// which of the numbered notes sit on a project or client. Pure helpers are unit-tested: node server/services/noteRelated.test.js

const LIMITS = { clients: 3, projects: 5, tasks: 20, deals: 8, activity: 8 };
const PROMPT_CHARS = 7000;
const KINDS = { client: 'C', project: 'P', task: 'T', deal: 'D', activity: 'A' };
const KEY_RE = /^[CPTDA]\d{1,3}$/;

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const day = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');
const money = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '' : `$${Number(v).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`);

/** The ids that appear most often, most frequent first (ties keep first-seen order, which is the notes' own relevance order). */
function topIds(ids, max) {
  const count = new Map();
  for (const id of ids) if (Number.isInteger(id) && id > 0) count.set(id, (count.get(id) || 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([id]) => id);
}

/**
 * Turn the fetched records into numbered items, in the order they should be read: clients, projects, open tasks, deals, contact.
 * `data` = { clients, projects, tasks, deals, activity } (arrays of rows), `sources` = [{ n, project_id, client_id }].
 */
function buildItems(data, sources = []) {
  const items = [];
  const keyOf = {};
  const counters = {};
  const add = (kind, row, fields) => {
    counters[kind] = (counters[kind] || 0) + 1;
    const key = `${KINDS[kind]}${counters[kind]}`;
    keyOf[`${kind}:${row.id}`] = key;
    const item = { key, kind, id: row.id, label: clip(fields.label, 120), detail: clip(fields.detail, 200), href: fields.href, parent: null, notes: [], status: fields.status || '' };
    items.push(item);
    return item;
  };

  for (const c of data.clients || []) {
    add('client', c, { label: c.name, detail: [c.company, c.status].filter(Boolean).join(' · '), href: `/clients/${c.id}`, status: c.status });
  }
  for (const p of data.projects || []) {
    const it = add('project', p, {
      label: p.name,
      detail: [p.clientStatus, p.targetEndDate ? `target ${day(p.targetEndDate)}` : '', p.archived_at ? 'archived' : ''].filter(Boolean).join(' · '),
      href: `/projects/${p.id}`,
    });
    it.parent = keyOf[`client:${p.clientId}`] || null;
  }
  for (const t of data.tasks || []) {
    const it = add('task', t, {
      label: t.title,
      detail: [t.status === 'done' ? 'done' : t.status === 'in-progress' ? 'in progress' : 'to do', t.priority && t.priority !== 'medium' ? `${t.priority} priority` : '', t.dueDate ? `due ${String(t.dueDate).slice(0, 10)}` : ''].filter(Boolean).join(' · '),
      href: t.projectId ? `/tasks?project=${t.projectId}` : '/tasks',
      status: t.status,
    });
    it.parent = keyOf[`project:${t.projectId}`] || keyOf[`client:${t.clientId}`] || null;
  }
  for (const d of data.deals || []) {
    const it = add('deal', d, {
      label: d.title,
      detail: [d.stage, money(d.value), d.expectedCloseDate ? `expected close ${day(d.expectedCloseDate)}` : ''].filter(Boolean).join(' · '),
      href: `/clients/${d.clientId}`,
      status: d.stage,
    });
    it.parent = keyOf[`client:${d.clientId}`] || null;
  }
  for (const a of data.activity || []) {
    const it = add('activity', a, { label: a.title || a.type, detail: `${a.type} · ${day(a.date)}`, href: `/clients/${a.clientId}` });
    it.parent = keyOf[`client:${a.clientId}`] || null;
  }

  // which numbered notes sit on which project / client
  for (const s of sources) {
    const p = items.find((i) => i.kind === 'project' && i.id === s.project_id);
    const c = items.find((i) => i.kind === 'client' && i.id === s.client_id);
    for (const target of [p, c]) if (target && !target.notes.includes(s.n)) target.notes.push(s.n);
  }
  return items;
}

/** The records as text for the answering model, one line each, within PROMPT_CHARS. Lines are data; the prompt says so. */
function describeForPrompt(items) {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const lines = [];
  let used = 0;
  for (const i of items) {
    const where = i.parent && byKey.get(i.parent) ? ` | on ${byKey.get(i.parent).label} [${i.parent}]` : '';
    const notes = i.notes.length ? ` | from note${i.notes.length > 1 ? 's' : ''} ${i.notes.map((n) => `[${n}]`).join('')}` : '';
    const noun = { client: 'client', project: 'project', task: 'task', deal: 'deal', activity: 'recent contact' }[i.kind];
    const line = `[${i.key}] ${noun} "${i.label}"${i.detail ? ` | ${i.detail}` : ''}${where}${notes}`;
    if (used + line.length > PROMPT_CHARS) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

/** What the screen keeps: no more than it shows. */
function forScreen(items, cited = []) {
  return items.map((i) => ({ key: i.key, kind: i.kind, id: i.id, label: i.label, detail: i.detail, href: i.href, parent: i.parent, notes: i.notes, cited: cited.includes(i.key) }));
}

// ---- database ---------------------------------------------------------------------------------------------------------------------

/**
 * Gather what is linked to these notes. `sources` = [{ n, project_id, client_id }] (the notes read, in order); `hint` = { clientId, projectId }
 * the question itself named. Returns the numbered items ([] when nothing is linked).
 */
async function gatherRelated(pool, userId, sources, hint = {}) {
  const projectIds = topIds([hint.projectId, ...sources.map((s) => s.project_id)].filter(Boolean), LIMITS.projects);
  let clientIds = topIds([hint.clientId, ...sources.map((s) => s.client_id)].filter(Boolean), LIMITS.clients);

  const projects = projectIds.length
    ? (await pool.query(
      `SELECT id, name, "clientId", "clientStatus", "targetEndDate"::text AS "targetEndDate", "archived_at" FROM projects WHERE "userId"=$1 AND id = ANY($2::int[])`,
      [userId, projectIds])).rows : [];
  // a project's own client belongs on the map too, even if no note names it
  clientIds = topIds([...clientIds, ...projects.map((p) => p.clientId).filter(Boolean)], LIMITS.clients + 2);
  if (!clientIds.length && !projects.length) return [];

  const clients = clientIds.length
    ? (await pool.query('SELECT id, name, company, status FROM clients WHERE "userId"=$1 AND id = ANY($2::int[])', [userId, clientIds])).rows : [];
  const ownClientIds = clients.map((c) => c.id);
  const ownProjectIds = projects.map((p) => p.id);

  const tasks = (ownProjectIds.length || ownClientIds.length)
    ? (await pool.query(
      `SELECT id, title, status, priority, "dueDate", "projectId", "clientId" FROM tasks
        WHERE "userId"=$1 AND "parentTaskId" IS NULL AND ("projectId" = ANY($2::int[]) OR "clientId" = ANY($3::int[]))
          AND (status <> 'done' OR "updatedAt" > NOW() - INTERVAL '30 days')
        ORDER BY (status = 'done'), "dueDate" NULLS LAST, id LIMIT ${LIMITS.tasks}`, [userId, ownProjectIds, ownClientIds])).rows : [];
  const deals = ownClientIds.length
    ? (await pool.query(
      `SELECT id, title, stage, value, "expectedCloseDate"::text AS "expectedCloseDate", "clientId" FROM client_deals
        WHERE "userId"=$1 AND "clientId" = ANY($2::int[]) ORDER BY (stage IN ('won','lost')), "updatedAt" DESC LIMIT ${LIMITS.deals}`, [userId, ownClientIds])).rows : [];
  const activity = ownClientIds.length
    ? (await pool.query(
      `SELECT i.id, i.type, i.title, i.date, i."clientId" FROM client_interactions i JOIN clients c ON c.id = i."clientId" AND c."userId"=$1
        WHERE i."clientId" = ANY($2::int[]) AND i.type NOT IN ('deal_stage','contact') ORDER BY i.date DESC LIMIT ${LIMITS.activity}`, [userId, ownClientIds])).rows : [];

  return buildItems({ clients, projects, tasks, deals, activity }, sources);
}

module.exports = { LIMITS, KEY_RE, topIds, buildItems, describeForPrompt, forScreen, gatherRelated };
