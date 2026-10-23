'use strict';

// Live to-dos: a to-do line in a note can BE a task. The link is written in the note's own text, at the end of the line:
//
//     - [ ] Call Sam about the budget {task:512}
//
// so the note stays plain text (search, Ask, export and the Write editor all still work) and the line can be moved around freely.
//   - Opening a note shows each linked line as the task is NOW: ticked if the task is done, with the task's current name. (Nothing is
//     rewritten in the background: `overlay` changes what is sent to the screen, and the person's next save writes it down.)
//   - Saving a note passes only what the person CHANGED to the task: a line they ticked or unticked, or renamed, since the last saved
//     text (`diff`). A note that is out of date therefore never re-opens a task that was finished elsewhere.
//   - "Make tasks" turns unlinked to-do lines into tasks and writes the marker onto them (`makeTasks`); nothing becomes a task unless asked.
//   - A task that no longer exists just loses its marker; the line stays as an ordinary to-do.
// The pure parts (no database) are unit-tested: node server/services/noteTodos.test.js

const TODO_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/;
const BULLET_LINE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?!\[[ xX]\])(.+)$/;
const MARKER = /\s*\{task:(\d+)\}\s*$/;
const MAX_LINKS = 200;       // markers looked at in one note
const MAX_MAKE = 50;         // tasks made in one go
const MAX_TITLE = 200;

/** Every to-do line of the note: { line, checked, text (without the marker), taskId (or null) }. */
function parseTodos(body) {
  const out = [];
  String(body ?? '').split('\n').forEach((raw, line) => {
    const m = TODO_LINE.exec(raw.replace(/\r$/, ''));
    if (!m) return;
    const marker = MARKER.exec(m[4]);
    out.push({ line, checked: m[2].toLowerCase() === 'x', text: m[4].replace(MARKER, '').trim(), taskId: marker ? Number(marker[1]) : null });
  });
  return out;
}

/** How many to-dos are not tasks yet (ticked ones do not count: finished things are not worth making a task for). */
function countUnlinked(body) {
  return parseTodos(body).filter((t) => !t.taskId && !t.checked && t.text).length;
}

const rebuild = (raw, checked, text, taskId) => {
  const cr = raw.endsWith('\r') ? '\r' : '';
  const m = TODO_LINE.exec(raw.replace(/\r$/, ''));
  return `${m[1]}${checked ? 'x' : ' '}${m[3]}${text}${taskId ? ` {task:${taskId}}` : ''}${cr}`;
};

/**
 * The note as it should be SHOWN: each linked line ticked or not as its task is, with the task's own name; a marker whose task is gone is
 * dropped. `tasks` is a Map of id -> { title, status, dueDate }. Returns { body, linked } where linked is { [id]: { id, title, status, dueDate } }.
 */
function overlay(body, tasks) {
  const lines = String(body ?? '').split('\n');
  const linked = {};
  for (const t of parseTodos(body)) {
    if (!t.taskId || Object.keys(linked).length >= MAX_LINKS) continue;
    const task = tasks.get(t.taskId);
    if (!task) { lines[t.line] = rebuild(lines[t.line], t.checked, t.text, null); continue; }
    lines[t.line] = rebuild(lines[t.line], task.status === 'done', task.title, t.taskId);
    linked[t.taskId] = { id: t.taskId, title: task.title, status: task.status, dueDate: task.dueDate || null };
  }
  return { body: lines.join('\n'), linked };
}

/**
 * What the person changed between the saved text and the text they are saving, for the lines linked to tasks:
 *   statusChanges [{ taskId, done }]    titleChanges [{ taskId, title }]    newLinks [taskId]  (a marker that was not in the old text)
 */
function diff(oldBody, newBody) {
  const before = new Map();
  for (const t of parseTodos(oldBody)) if (t.taskId && !before.has(t.taskId)) before.set(t.taskId, t);
  const out = { statusChanges: [], titleChanges: [], newLinks: [] };
  const seen = new Set();
  for (const t of parseTodos(newBody)) {
    if (!t.taskId || seen.has(t.taskId) || seen.size >= MAX_LINKS) continue;
    seen.add(t.taskId);
    const old = before.get(t.taskId);
    if (!old) { out.newLinks.push(t.taskId); continue; }
    if (old.checked !== t.checked) out.statusChanges.push({ taskId: t.taskId, done: t.checked });
    if (t.text && old.text !== t.text) out.titleChanges.push({ taskId: t.taskId, title: t.text.slice(0, MAX_TITLE) });
  }
  return out;
}

// ---- a date said or typed in the line: "by Friday", "tomorrow", "in 3 days", "12 Nov", "2026-11-12" ----
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

/**
 * The due date a line asks for, as 'YYYY-MM-DD', given today's date in the person's own calendar ('YYYY-MM-DD'); or null.
 * A weekday means its next occurrence (a Friday said on a Friday is the following one); "next Friday" is the Friday of next week (weeks run Monday to Sunday).
 */
function parseDue(text, today) {
  const t = String(text || '').toLowerCase();
  const m0 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!m0) return null;
  const now = new Date(Date.UTC(Number(m0[1]), Number(m0[2]) - 1, Number(m0[3])));
  if (Number.isNaN(now.getTime())) return null;
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(t);
  if (m) { const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))); return iso(d) === m[0] ? m[0] : null; }
  if (/\b(today|tonight)\b/.test(t)) return iso(now);
  if (/\btomorrow\b/.test(t)) return iso(addDays(now, 1));
  m = /\bin (\d{1,3}) (day|days|week|weeks)\b/.exec(t);
  if (m) return iso(addDays(now, Number(m[1]) * (m[2].startsWith('week') ? 7 : 1)));
  m = new RegExp(`\\b(next )?(${DAYS.join('|')})\\b`).exec(t);
  if (m) {
    const target = DAYS.indexOf(m[2]);
    const dow = now.getUTCDay();
    if (m[1]) {
      const mondayThisWeek = addDays(now, -((dow + 6) % 7));
      return iso(addDays(mondayThisWeek, 7 + ((target + 6) % 7)));
    }
    return iso(addDays(now, ((target - dow + 7) % 7) || 7));
  }
  m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${MONTHS.join('|')})[a-z]*\\b`).exec(t) || null;
  const m2 = m ? null : new RegExp(`\\b(${MONTHS.join('|')})[a-z]* (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(t);
  const dayNum = m ? Number(m[1]) : m2 ? Number(m2[2]) : null;
  const monthIdx = m ? MONTHS.indexOf(m[2]) : m2 ? MONTHS.indexOf(m2[1]) : -1;
  if (dayNum && monthIdx >= 0) {
    let d = new Date(Date.UTC(now.getUTCFullYear(), monthIdx, dayNum));
    if (d.getUTCMonth() !== monthIdx) return null; // 31 Feb
    if (d < now) d = new Date(Date.UTC(now.getUTCFullYear() + 1, monthIdx, dayNum));
    return d.getUTCMonth() === monthIdx ? iso(d) : null;
  }
  return null;
}

/** Put a marker on a to-do line (or a plain bullet, which becomes a to-do), replacing any marker already there. */
function markLine(raw, taskId) {
  const cr = raw.endsWith('\r') ? '\r' : '';
  const line = raw.replace(/\r$/, '');
  const todo = TODO_LINE.exec(line);
  if (todo) return `${todo[1]}${todo[2]}${todo[3]}${todo[4].replace(MARKER, '').trim()} {task:${taskId}}${cr}`;
  const bullet = BULLET_LINE.exec(line);
  if (bullet) return `${bullet[1]}- [ ] ${bullet[2].replace(MARKER, '').trim()} {task:${taskId}}${cr}`;
  return raw;
}

/** Lines of the note that are bullets (not to-dos) whose text equals `title`, ignoring case: the way a voice note's "To do:" list is found. */
function findBullet(body, title, skip = new Set()) {
  const want = String(title || '').trim().toLowerCase();
  const lines = String(body ?? '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const m = BULLET_LINE.exec(lines[i].replace(/\r$/, ''));
    if (m && m[2].replace(MARKER, '').trim().toLowerCase() === want) return i;
  }
  return -1;
}

// ---- the database side (every query starts from the person's own id) ----

/** The person's own tasks among these ids: Map id -> { id, title, status, dueDate }. Anyone else's task id simply is not found. */
async function loadTasks(pool, userId, ids) {
  const list = [...new Set(ids)].filter(Number.isInteger).slice(0, MAX_LINKS);
  if (!list.length) return new Map();
  const { rows } = await pool.query('SELECT id, title, status, "dueDate" FROM tasks WHERE id = ANY($1::int[]) AND "userId"=$2', [list, userId]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** A note's text as it should be shown: { body, linked } (see overlay). Notes with no links are returned untouched without a query. */
async function overlayForUser(pool, userId, body) {
  const ids = parseTodos(body).map((t) => t.taskId).filter(Boolean);
  if (!ids.length) return { body, linked: {} };
  return overlay(body, await loadTasks(pool, userId, ids));
}

/**
 * After a save: pass the person's changes on to the linked tasks (ticked, unticked, renamed) and remember which note a newly linked task came
 * from. `changeStatus(userId, taskId, status)` is the tasks route's own status change, so recurrence and the other follow-ups behave exactly
 * as if the task had been ticked in Tasks. Never throws: the note is already saved.
 */
async function syncFromNote(pool, userId, noteId, oldBody, newBody, { changeStatus, log } = {}) {
  try {
    const d = diff(oldBody, newBody);
    if (!d.statusChanges.length && !d.titleChanges.length && !d.newLinks.length) return d;
    for (const c of d.statusChanges) await changeStatus?.(userId, c.taskId, c.done ? 'done' : 'todo');
    for (const c of d.titleChanges) await pool.query('UPDATE tasks SET title=$1, "updatedAt"=NOW() WHERE id=$2 AND "userId"=$3 AND title<>$1', [c.title, c.taskId, userId]);
    if (d.newLinks.length) await pool.query('UPDATE tasks SET "sourceNoteId"=$1 WHERE id = ANY($2::int[]) AND "userId"=$3 AND "sourceNoteId" IS NULL', [noteId, d.newLinks, userId]);
    return d;
  } catch (err) {
    log?.error?.({ err }, '[note todos sync]');
    return null;
  }
}

/**
 * Make tasks from a note's to-dos, inside the caller's transaction (`db` is its client). The note row must already be locked by the caller.
 *   by line   { lines: [index...] }  (or nothing: every to-do that is not ticked and not yet a task)
 *   by title  { items: [{ title, due? }] }  (a voice note's list: the matching "- title" line becomes the to-do, or a new line is added)
 * Each task gets the note's project and client, "From note: <title>", and a due date if the line says one ("by Friday"). Returns the new text
 * and what was made: { body, created: [{ id, title, dueDate }] }.
 */
async function makeTasks(db, userId, note, { lines, items, today } = {}) {
  const text = String(note.body ?? '');
  const rows = text.split('\n');
  const made = [];
  const from = note.title && note.title !== 'Untitled' ? `From note: ${note.title}` : 'From a note';
  const create = async (title, dueHint) => {
    const clean = String(title || '').trim().slice(0, MAX_TITLE);
    if (!clean) return null;
    const due = dueHint || parseDue(clean, today);
    const { rows: [t] } = await db.query(
      `INSERT INTO tasks (title, notes, status, priority, "projectId", "clientId", "dueDate", "userId", "sourceNoteId", "updatedAt")
       VALUES ($1, $2, 'todo', 'medium', $3, $4, $5, $6, $7, NOW()) RETURNING id, title, "dueDate"`,
      [clean, from, note.project_id || null, note.client_id || null, due || null, userId, note.id]
    );
    made.push(t);
    return t;
  };

  if (Array.isArray(items)) {
    const used = new Set();
    for (const item of items.slice(0, MAX_MAKE)) {
      const title = String(item?.title ?? '').trim();
      if (!title) continue;
      const at = findBullet(text, title, used);
      const t = await create(title, /^\d{4}-\d{2}-\d{2}$/.test(item?.due || '') ? item.due : null);
      if (!t) continue;
      if (at >= 0) { used.add(at); rows[at] = markLine(rows[at], t.id); } else rows.push(`- [ ] ${t.title} {task:${t.id}}`);
    }
  } else {
    const wanted = Array.isArray(lines) ? new Set(lines.filter(Number.isInteger)) : null;
    for (const todo of parseTodos(text)) {
      if (made.length >= MAX_MAKE) break;
      if (todo.taskId || todo.checked || !todo.text) continue;
      if (wanted && !wanted.has(todo.line)) continue;
      const t = await create(todo.text, null);
      if (t) rows[todo.line] = markLine(rows[todo.line], t.id);
    }
  }
  return { body: rows.join('\n'), created: made.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate })) };
}

module.exports = { MAX_LINKS, MAX_MAKE, MAX_TITLE, parseTodos, countUnlinked, overlay, diff, parseDue, markLine, findBullet, loadTasks, overlayForUser, syncFromNote, makeTasks };
