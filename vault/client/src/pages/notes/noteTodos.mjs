// Live to-dos on the screen's side (the rules and the server half are in server/services/noteTodos.js; a test keeps the two reading lines
// the same way). Pure, so it is unit-tested: node client/src/pages/notes/noteTodos.test.mjs
// A to-do line linked to a task ends with "{task:512}". Write shows it as typed; Preview and Rich show it as a small marker.

const TODO_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*)$/;
const MARKER = /\s*\{task:(\d+)\}\s*$/;

/** To-dos that are not ticked and not tasks yet: how many "Make tasks" would make. */
export function countUnlinked(body) {
  let n = 0;
  for (const raw of String(body ?? '').split('\n')) {
    const m = TODO_LINE.exec(raw.replace(/\r$/, ''));
    if (m && m[2] === ' ' && !MARKER.test(m[4]) && m[4].trim()) n += 1;
  }
  return n;
}

/** The text without the link markers, for places that should not show them (a task's notes, a chat, a copy). */
export function stripMarkers(body) {
  return String(body ?? '').split('\n').map((raw) => (TODO_LINE.test(raw.replace(/\r$/, '')) ? raw.replace(MARKER, (_, __, off, str) => (str.endsWith('\r') ? '\r' : '')) : raw)).join('\n');
}

/** For Preview: each marker becomes a link "vault-task:N" that the view draws as a small chip (line numbers do not change). */
export function chipify(body) {
  return String(body ?? '').split('\n').map((raw) => {
    const cr = raw.endsWith('\r') ? '\r' : '';
    const line = raw.replace(/\r$/, '');
    const m = TODO_LINE.exec(line);
    const mark = m && MARKER.exec(m[4]);
    return mark ? `${line.replace(MARKER, '')} [task](vault-task:${mark[1]})${cr}` : raw;
  }).join('\n');
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What the chip says about a task: its due date in plain words, "Overdue" when it has passed, or nothing. `today` is 'YYYY-MM-DD' in the person's own date. */
export function dueLabel(task, today) {
  if (!task) return 'Task';
  const due = String(task.dueDate || '').slice(0, 10);
  if (task.status === 'done') return 'Done';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) return task.status === 'in-progress' ? 'In progress' : 'Task';
  if (due === today) return 'Due today';
  const d = new Date(`${due}T00:00:00Z`);
  const text = `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(today || '') && due < today ? `Overdue, ${text}` : `Due ${text}`;
}
