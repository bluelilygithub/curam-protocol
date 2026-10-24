// The AI actions offered on an open note, and the pure pieces around them. Unit-tested: node client/src/pages/notes/noteAiActions.test.mjs

export const AI_ACTIONS = [
  { id: 'summary', label: 'Summarise', icon: 'file-text', working: 'Reading your note and writing a short summary…', hint: 'A few sentences you can add to the top' },
  { id: 'todos', label: 'Pull out to-dos', icon: 'list-checks', working: 'Looking for things to do in your note…', hint: 'Pick which become tasks' },
  { id: 'tidy', label: 'Tidy up', icon: 'wand', working: 'Tidying your note. This can take a few seconds…', hint: 'Fix spelling, repeats and layout' },
  { id: 'tags', label: 'Suggest tags', icon: 'tag', working: 'Choosing tags…', hint: 'Reuses the tags you already have' },
  { id: 'title', label: 'Suggest a title', icon: 'pen-line', working: 'Thinking of a title…', hint: 'A short title from the text' },
  { id: 'file', label: 'Suggest project and client', icon: 'folder', working: 'Looking at your projects and clients…', hint: 'Chosen only from your own, and only if it clearly fits' },
];

/** The person's own calendar day as YYYY-MM-DD (not UTC), so "tomorrow" in a note means their tomorrow. */
export function todayLocal(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Where AI text goes in the note: 'top' (before), 'bottom' (after) or 'replace'. Returns the new body. */
export function applyText(body, mode, text) {
  const current = String(body || '');
  const add = String(text || '').trim();
  if (!add) return current;
  if (mode === 'replace') return add;
  if (mode === 'top') return current ? `${add}\n\n${current}` : add;
  return current ? `${current.replace(/\s+$/, '')}\n\n${add}` : add;
}

/** The body of POST /api/tasks for one to-do, tied to the note's project and client. */
export function taskPayload(item, note) {
  const from = note?.title && note.title !== 'Untitled' ? `From note: ${note.title}` : 'From a note';
  return {
    title: String(item.title || '').trim().slice(0, 200),
    notes: item.who ? `${from}\nFor: ${item.who}` : from,
    projectId: note?.project_id || null,
    clientId: note?.client_id || null,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(item.due || '') ? item.due : null,
  };
}
