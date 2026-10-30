'use strict';

// The coverage statement (case model Rule 11.3): what was read, what the tool could NOT see, what the person must
// verify themselves. Computed from the case's sources and rows, never typed. A ledger that quietly misses the portal
// message is worse than no ledger, so the miss is printed rather than implied.

function plural(n, word) { return `${n} ${word}${n === 1 ? '' : 's'}`; }

function coverageStatement({ sources = [], rows = [], sentWatermark = null, governing = [], attachmentCount = 0 }) {
  const messages = sources.filter((s) => s.kind !== 'document');
  const docs = sources.filter((s) => s.kind === 'document');
  const readMessages = messages.filter((s) => s.parseStatus === 'parsed');
  const readDocs = docs.filter((s) => s.parseStatus === 'parsed');
  const notRead = docs.filter((s) => s.parseStatus !== 'parsed');

  const notVisible = [
    'Anything said by phone, in person, or in a portal, chat app or other mailbox.',
    'Any email that was not attached to this case. Nothing attaches itself.',
  ];

  // Attachments: say how many were read, and group the ones that were not by their reason (Rule 2.6: each has a stated reason).
  if (attachmentCount && !docs.length) {
    notVisible.push(`${plural(attachmentCount, 'attachment')} on the attached mail ${attachmentCount === 1 ? 'has' : 'have'} not been fetched yet, so none were read.`);
  } else if (docs.length) {
    notVisible.push(`${readDocs.length} of ${plural(docs.length, 'attachment')} fetched ${readDocs.length === 1 ? 'was' : 'were'} read (text only).`);
    if (attachmentCount > docs.length) notVisible.push(`${plural(attachmentCount - docs.length, 'more attachment')} on the attached mail ${attachmentCount - docs.length === 1 ? 'has' : 'have'} not been fetched yet.`);
    const groups = new Map();
    for (const d of notRead) {
      const key = `${d.parseStatus === 'failed' ? 'could not be read' : 'not read'}: ${d.parseReason || 'no reason recorded'}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    for (const [reason, n] of groups) notVisible.push(`${plural(n, 'attachment')} ${reason}.`);
  }
  for (const s of messages.filter((m) => m.parseStatus !== 'parsed')) notVisible.push(`${s.label || s.id}: ${s.parseStatus === 'failed' ? 'could not be read' : 'kept for reference only'} (${s.parseReason || 'no reason recorded'}).`);
  if (!sentWatermark || !sentWatermark.completed) notVisible.push('Your Sent mail has not been checked for this case yet, so replies you already sent may be missing.');

  const verify = [];
  for (const r of rows) {
    if (r.status === 'unverified') verify.push(`"${r.items.join(', ')}" (${r.partyLabel || r.party}) has had no recent evidence: confirm whether it is still open.`);
    if (r.status === 'open' && r.conflictWith) verify.push(`"${r.items.join(', ')}": ${r.conflictQuestion || 'two sources disagree on the figure'}`);
    if (r.status === 'open' && r.due && r.due.status !== 'exact') verify.push(`"${r.items.join(', ')}": the deadline needs a person (${(r.due.missing || []).join('; ') || 'wording unclear'}; said "${r.due.raw || ''}").`);
    if (r.status === 'open' && r.authority === 'unconfirmed') verify.push(`"${r.items.join(', ')}": ${r.partyLabel || r.party} took this over but their authority is unconfirmed.`);
    if (r.status === 'open' && r.claimType === 'conditional') verify.push(`"${r.items.join(', ')}": depends on "${r.condition}", which has not been shown to be met.`);
  }
  verify.push('Every deadline shown is taken from the messages. The tool never decides a deadline was met or a legal window is open.');

  const dates = messages.map((s) => s.receivedAt).filter(Boolean).sort();
  return {
    read: {
      messages: readMessages.length,
      attachments: readDocs.length,
      from: dates[0] || null,
      to: dates[dates.length - 1] || null,
      governingDocuments: governing.length,
    },
    notVisible,
    verify,
    text: [
      `Read: ${plural(readMessages.length, 'message')}${readDocs.length ? ` and ${plural(readDocs.length, 'attachment')}` : ''}${dates.length ? ` (${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)})` : ''}.`,
      'Not visible to this tool:', ...notVisible.map((n) => `- ${n}`),
      'You need to verify:', ...verify.map((v) => `- ${v}`),
    ].join('\n'),
  };
}

module.exports = { coverageStatement };
