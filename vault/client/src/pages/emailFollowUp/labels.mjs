// Plain-words labels for Email Follow-Up. Pure, so a test can check them (labels.test.mjs).

export function directionLabel(row) {
  if (row.direction === 'i_owe') return 'You owe this';
  if (row.direction === 'they_owe') return 'They owe you';
  return 'Between others';
}

export function statusLabel(status) {
  return ({
    open: 'open', met: 'done', waived: 'waived', superseded: 'replaced by a newer ask',
    unverified: 'no recent news: still open?', suspended: 'suspended (someone else took over)',
  })[status] || status;
}

/** A deadline in words. A date the tool could not work out says so and says what is missing; it never shows a guess. */
export function dueLabel(due) {
  if (!due) return 'no deadline given';
  if (due.status === 'exact') return `due ${due.date}`;
  const missing = (due.missing || []).filter(Boolean);
  return `deadline needs you${missing.length ? ` (${missing.join('; ')})` : ''}${due.raw ? `: they said "${due.raw}"` : ''}`;
}

export function tabHint(id) {
  return ({
    ledger: 'Everything owed in this case, with the words it came from',
    mail: 'The email threads attached to this case',
    drafts: 'Follow-up text waiting for you to read, approve and copy',
    coverage: 'What the tool read, what it could not see, and what you must check',
  })[id] || '';
}
