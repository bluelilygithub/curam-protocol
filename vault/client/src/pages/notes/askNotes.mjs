// Pure helpers for "Ask your notes". Unit-tested: node client/src/pages/notes/askNotes.test.mjs

export const SCOPES = [
  { id: 'all', label: 'All my notes' },
  { id: 'filters', label: 'This list' },
  { id: 'note', label: 'This note' },
];

export const STARTERS = [
  'What did I decide in my notes from last week?',
  'What to-dos have I left unfinished?',
  'Summarise what I have written about my clients lately.',
  'What did I note down about money or budgets?',
  'What projects, tasks and clients are linked to my recent notes?',
];

/**
 * An answer with its [1] [2] citations turned into links the screen can make into buttons ("#src-1"). A [n] that is already a link
 * is left alone, and so are brackets that are not a number.
 */
export function citeLinks(answer) {
  return String(answer ?? '')
    .replace(/\[(\d{1,3})\](?!\()/g, '[$1](#src-$1)')
    .replace(/\[([CPTDA]\d{1,3})\](?!\()/g, '[$1](#rel-$1)'); // a linked record: [T2] a task, [P1] a project, [C1] a client, [D1] a deal, [A1] recent contact
}

/** The last few turns as the server wants them (role + text), skipping unanswered or failed ones. */
export function historyFor(messages, max = 6) {
  const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || m.pending || m.error || !m.answer) continue;
    out.push({ role: 'user', content: String(m.question || '') }, { role: 'assistant', content: String(m.answer) });
  }
  return out.slice(-max);
}

export const RELATED_KINDS = {
  client: { icon: 'building', noun: 'Client' },
  project: { icon: 'folder', noun: 'Project' },
  task: { icon: 'check-square', noun: 'Task' },
  deal: { icon: 'briefcase', noun: 'Deal' },
  activity: { icon: 'message-circle', noun: 'Recent contact' },
};

const KIND_ORDER = ['client', 'project', 'task', 'deal', 'activity'];

/**
 * The linked records as an outline for the "mud map": clients first, each with its projects (and their tasks), then the tasks, deals and
 * recent contact that sit straight on the client. Anything whose parent is not in the list becomes a top-level entry, so nothing is lost.
 * Returns [{ item, children: [...] }].
 */
export function buildMap(items) {
  const list = Array.isArray(items) ? items : [];
  const nodes = new Map(list.map((item) => [item.key, { item, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.item.parent && node.item.parent !== node.item.key ? nodes.get(node.item.parent) : null;
    (parent ? parent.children : roots).push(node);
  }
  const rank = (n) => KIND_ORDER.indexOf(n.item.kind);
  const sort = (arr) => { arr.sort((a, b) => rank(a) - rank(b)); arr.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}
