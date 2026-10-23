'use strict';

// The filters of the Notes list as one reusable piece, so the list and "Ask your notes" mean exactly the same by "the notes in this
// view". Builds the WHERE for a query made of the list's parameters (q, project_id, client_id, unfiled, untagged, reminder, tags,
// from, to, field). The SQL it makes expects the aliases n (notes), p (projects) and c (clients) from NOTE_JOINS.

const { normalizeTags } = require('./noteTags');

const DATE_COLUMNS = { updated: 'n.updated_at', created: 'n.created_at' };

const NOTE_JOINS = `FROM notes n
      LEFT JOIN projects p ON p.id = n.project_id AND p."userId" = n.user_id
      LEFT JOIN clients  c ON c.id = n.client_id AND c."userId" = n.user_id`;

/**
 * { where: [sql...], params: [...], dateCol } for this person's notes narrowed by `query`, or { error } for a value that cannot be read.
 * `where` always starts with the owner check, so nothing here can ever reach another person's notes.
 */
function buildFilters(userId, query = {}) {
  const dateCol = DATE_COLUMNS[query.field] || DATE_COLUMNS.updated;
  const where = ['n.user_id=$1'];
  const params = [userId];
  const add = (value) => { params.push(value); return `$${params.length}`; };

  const { q, project_id, client_id, unfiled, untagged, from, to } = query;
  if (project_id) where.push(`n.project_id=${add(Number(project_id) || 0)}`);
  if (client_id) where.push(`n.client_id=${add(Number(client_id) || 0)}`);
  if (unfiled === '1') where.push('n.project_id IS NULL AND n.client_id IS NULL');
  if (untagged === '1') where.push('NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id)');
  const reminderFilter = {
    due: 'n.remind_at <= NOW() AND n.reminder_done_at IS NULL',
    upcoming: 'n.remind_at > NOW() AND n.reminder_done_at IS NULL',
    any: 'n.remind_at IS NOT NULL AND n.reminder_done_at IS NULL',
  }[query.reminder];
  if (reminderFilter) where.push(reminderFilter);
  const wantTags = query.tags ? normalizeTags(String(query.tags).split(',')) : [];
  if (wantTags.length) {
    // every one of the tags, not any of them: more tags narrows the list
    where.push(`n.id IN (SELECT note_id FROM note_tags WHERE user_id=$1 AND tag = ANY(${add(wantTags)}::text[]) GROUP BY note_id HAVING COUNT(DISTINCT tag) = ${wantTags.length})`);
  }
  for (const [value, op, label] of [[from, '>=', 'from'], [to, '<', 'to']]) {
    if (!value) continue;
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return { error: `${label} is not a valid date` };
    where.push(`${dateCol} ${op} ${add(when.toISOString())}`);
  }
  if (q) {
    // % and _ typed by the person are text, not wildcards
    const term = add(`%${String(q).replace(/[\\%_]/g, '\\$&')}%`);
    where.push(`(n.title ILIKE ${term} OR n.body ILIKE ${term} OR p.name ILIKE ${term} OR c.name ILIKE ${term}
      OR EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id = n.id AND nt.tag ILIKE ${term}))`);
  }
  return { where, params, dateCol, add };
}

module.exports = { DATE_COLUMNS, NOTE_JOINS, buildFilters };
