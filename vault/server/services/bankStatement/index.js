'use strict';

// Picks the reader for a statement's text. Each reader returns the same shape (kind, bank, product,
// account, period, balances, lines, ok, problems) so the review screen does not care which it was.

const { parseAnzPlusStatement } = require('./anzPlus');
const { parseAnzCardStatement, looksLikeAnzCard } = require('./anzCard');

function parseStatementText(text) {
  const flat = String(Array.isArray(text) ? text.join(' ') : text || '').replace(/\s+/g, ' ');
  if (looksLikeAnzCard(flat)) return parseAnzCardStatement(flat);
  const r = parseAnzPlusStatement(flat);
  return { kind: 'bank', ...r };
}

module.exports = { parseStatementText };
