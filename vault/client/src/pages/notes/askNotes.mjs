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
];

/**
 * An answer with its [1] [2] citations turned into links the screen can make into buttons ("#src-1"). A [n] that is already a link
 * is left alone, and so are brackets that are not a number.
 */
export function citeLinks(answer) {
  return String(answer ?? '').replace(/\[(\d{1,3})\](?!\()/g, '[$1](#src-$1)');
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
