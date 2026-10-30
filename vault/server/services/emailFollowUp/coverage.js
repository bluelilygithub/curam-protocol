'use strict';

// The coverage statement (case model Rule 11.3): what was read, what the tool could NOT see, what the person must
// verify themselves. Computed from the case's sources and rows, never typed. A ledger that quietly misses the portal
// message is worse than no ledger, so the miss is printed rather than implied.

function coverageStatement({ sources = [], rows = [], sentWatermark = null, governing = [], attachmentCount = 0 }) {
  const read = sources.filter((s) => s.parseStatus === 'parsed');
  const refOnly = sources.filter((s) => s.parseStatus === 'reference_only');
  const failed = sources.filter((s) => s.parseStatus === 'failed');

  const notVisible = [
    'Anything said by phone, in person, or in a portal, chat app or other mailbox.',
    'Any email that was not attached to this case. Nothing attaches itself.',
    attachmentCount
      ? `${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'} on the attached mail (their contents are not read in this version).`
      : 'The contents of attachments: this version reads email text only.',
  ];
  for (const s of refOnly) notVisible.push(`${s.label || s.id}: kept for reference only (${s.parseReason || 'no reason recorded'}).`);
  for (const s of failed) notVisible.push(`${s.label || s.id}: could not be read (${s.parseReason || 'no reason recorded'}).`);
  if (!sentWatermark || !sentWatermark.completed) notVisible.push('Your Sent mail has not been checked for this case yet, so replies you already sent may be missing.');

  const verify = [];
  for (const r of rows) {
    if (r.status === 'unverified') verify.push(`"${r.items.join(', ')}" (${r.partyLabel || r.party}) has had no recent evidence: confirm whether it is still open.`);
    if (r.status === 'open' && r.due && r.due.status !== 'exact') verify.push(`"${r.items.join(', ')}": the deadline needs a person (${(r.due.missing || []).join('; ') || 'wording unclear'}; said "${r.due.raw || ''}").`);
    if (r.status === 'open' && r.authority === 'unconfirmed') verify.push(`"${r.items.join(', ')}": ${r.partyLabel || r.party} took this over but their authority is unconfirmed.`);
    if (r.status === 'open' && r.claimType === 'conditional') verify.push(`"${r.items.join(', ')}": depends on "${r.condition}", which has not been shown to be met.`);
  }
  verify.push('Every deadline shown is taken from the messages. The tool never decides a deadline was met or a legal window is open.');

  const dates = sources.map((s) => s.receivedAt).filter(Boolean).sort();
  return {
    read: {
      messages: read.length,
      from: dates[0] || null,
      to: dates[dates.length - 1] || null,
      governingDocuments: governing.length,
    },
    notVisible,
    verify,
    text: [
      `Read: ${read.length} message${read.length === 1 ? '' : 's'}${dates.length ? ` (${dates[0].slice(0, 10)} to ${dates[dates.length - 1].slice(0, 10)})` : ''}.`,
      'Not visible to this tool:', ...notVisible.map((n) => `- ${n}`),
      'You need to verify:', ...verify.map((v) => `- ${v}`),
    ].join('\n'),
  };
}

module.exports = { coverageStatement };
