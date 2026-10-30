'use strict';

// Draft assembly (case model Rule 7.1: retrieve first, then draft).
// A draft is built ONLY from (claim text, anchor) tuples taken from the ledger row and its cited span, using fixed
// sentence templates. No model writes any prose here, so the wording is repeatable and every sentence has a source.
// The model's only job in this feature is reading messages into ledger rows (extract.js).

const { RuleError } = require('./common');

/**
 * @param {object} row ledger row (needs an anchor and the quoted span)
 * @param {{to: string[], cc?: string[], subject?: string, inReplyTo?: string, references?: string[], partyLabel?: string, threadIds?: string[]}} ctx
 */
function buildNudgeDraft(row, ctx) {
  const anchor = row.anchors && row.anchors[row.anchors.length - 1];
  if (!anchor || !row.quote) throw new RuleError('7.1', `row ${row.id} has no anchored quote to draft from`);
  const label = ctx.partyLabel || row.partyLabel || row.party;
  const claims = [];

  // an email address is not a greeting: use it only when it is a name
  claims.push({ kind: 'courtesy', text: String(label).includes('@') ? 'Hi,' : `Hi ${label},` });

  if (row.direction === 'i_owe') {
    claims.push({ kind: 'fact', text: `I wrote: "${row.quote}"`, anchor });
  } else {
    claims.push({ kind: 'fact', text: `You wrote: "${row.quote}"`, anchor });
  }

  if (row.due && row.due.status === 'exact') {
    claims.push({
      kind: 'fact',
      text: `I have the due date as ${row.due.date}.`,
      anchor,
      derived: { field: 'due', value: row.due.date },
    });
  }

  claims.push({
    kind: 'courtesy',
    text: row.direction === 'i_owe'
      ? 'I will confirm once this is done. Thank you.'
      : 'Could you let me know where this stands? Thank you.',
  });

  const body = claims.map((c) => c.text).join('\n\n');
  const subject = ctx.subject || `Following up: ${row.items.join(', ')}`;
  return {
    subject,
    body,
    to: ctx.to || [],
    cc: ctx.cc || [],
    bcc: [],
    inReplyTo: ctx.inReplyTo || null,
    references: ctx.references || [],
    claims,
    rowIds: [row.id],
    threadIds: ctx.threadIds || [],
  };
}

module.exports = { buildNudgeDraft };
