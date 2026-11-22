// Risk review's verdict, worked out from what the review already returned (no model call): the counts of risky and unclear clauses
// for the reviewed party, overdue obligations, usual clauses not found, and flags that could not be matched to the document.
// It says what was flagged; it never says a contract is safe. Tested by verdict.test.mjs.

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function reviewVerdict({ clauses = [], obligations = [], coverageReport = [], partyName = null } = {}) {
  const counts = { risky: 0, unclear: 0, standard: 0 };
  let unverifiedFlags = 0;
  for (const c of clauses) {
    if (c.isContextOnly || counts[c.riskLevel] == null) continue;
    counts[c.riskLevel] += 1;
    if ((c.riskLevel === 'risky' || c.riskLevel === 'unclear') && c.verificationStatus === 'failed') unverifiedFlags += 1;
  }
  const open = obligations.filter((o) => o.userState !== 'handled');
  const overdue = open.filter((o) => o.derivedStatus === 'overdue').length;
  const upcoming = open.filter((o) => o.derivedStatus === 'upcoming').length;
  const missing = coverageReport.filter((c) => c.status === 'not_found').map((c) => String(c.clauseType).replace(/_/g, ' '));
  const forWhom = partyName ? ` for ${partyName}` : ' for your side';

  let level; let title; let sentence;
  if (counts.risky > 0) {
    level = 'risky';
    title = 'Read before you sign';
    sentence = `${plural(counts.risky, 'clause is', 'clauses are')} risky${forWhom}${counts.unclear ? `, and ${plural(counts.unclear, 'is', 'are')} unclear` : ''}. Start with the risky ones.`;  } else if (counts.unclear > 0) {
    level = 'unclear';
    title = 'Worth a closer look';
    sentence = `No clause was flagged risky${forWhom}, but ${plural(counts.unclear, 'clause needs', 'clauses need')} a closer look.`;
  } else {
    level = 'clear';
    title = 'No risky clauses flagged';
    sentence = `Nothing was flagged risky or unclear${forWhom}. That is not a guarantee: read the summary and the obligations, and check anything important with a lawyer.`;
  }

  const notes = [];
  if (overdue) notes.push({ id: 'overdue', tool: 'obligations', text: `${plural(overdue, 'obligation is', 'obligations are')} overdue.` });
  if (missing.length) notes.push({ id: 'missing', text: `Usual ${missing.length === 1 ? 'clause' : 'clauses'} not found: ${missing.join(', ')}.` });
  if (unverifiedFlags) notes.push({ id: 'unverified', text: `${plural(unverifiedFlags, 'flag')} could not be matched to the document's text; treat ${unverifiedFlags === 1 ? 'it' : 'them'} with more caution.` });

  return { level, title, sentence, counts, overdue, upcoming, notes };
}
