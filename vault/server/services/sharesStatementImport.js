'use strict';

// Statement upload & reconciliation (docs/shares-statement-import.md).
// Step 2: upload -> LLM extraction -> review queue -> apply. Every line is
// gated behind explicit user approval before it touches share_trades or
// share_cash_ledger — a misclassification costs a correction click, not a
// corrupted ledger. See the doc for the decisions this implements verbatim
// (dedup key, tolerance, DRP pairing, correction detection, no auto-apply).

const crypto = require('crypto');
const { pool } = require('../db');
const { extractPdfText } = require('./studyUploadExtract');
const { getModelsForUser } = require('./modelResolver');
const { callModel } = require('./callModel');
const { logUsage } = require('../utils/logUsage');

const LINE_TYPES = ['trade', 'dividend', 'interest', 'fee', 'drp', 'cash_balance', 'fx'];

// max(0.5%, AUD $1) — pinned per docs/shares-statement-import.md, not left
// for the model to invent. Revisit the literal here if it proves too
// noisy/quiet in practice; it's one constant, not a redesign.
function withinTolerance(a, b) {
  if (a == null || b == null) return false;
  const diff = Math.abs(a - b);
  return diff <= Math.max(Math.abs(a) * 0.005, 1);
}

function dedupHash({ date, symbol, lineType, amount }) {
  const key = `${date || ''}|${(symbol || '').toUpperCase()}|${lineType}|${Number(amount || 0).toFixed(2)}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

const EXTRACTION_SYSTEM_PROMPT = `You extract structured line items from a brokerage trading statement (raw PDF text, formatting/whitespace may be irregular). Broker layout is not fixed — read the actual content, don't assume a template.

For each distinct financial event on the statement, output one object:
{
  "lineType": "trade" | "dividend" | "interest" | "fee" | "drp" | "cash_balance" | "fx",
  "date": "YYYY-MM-DD — CONVERT FROM THE STATEMENT'S OWN FORMAT, see date rule below",
  "symbol": "ticker if identifiable, else null (strip any exchange/country suffix, e.g. \"TSM:US\" -> \"TSM\")",
  "exchange": "NASDAQ" | "NYSE" | "ASX" | null (null if not confidently determinable),
  "description": "the statement's own line text or a short paraphrase",
  "amount": number (AUD if statement gives AUD, else the stated currency amount),
  "currency": "AUD" | "USD" | other ISO code,
  "quantity": number or null (trades/drp only),
  "pricePerUnit": number or null (trades/drp only),
  "fxRateToAud": number or null (if the statement shows a conversion rate),
  "feesAud": number or null (trade-specific fee, if broken out),
  "grossAmountAud": number or null (dividend/drp only, before withholding),
  "withholdingTaxAud": number or null (dividend/drp only),
  "side": "buy" | "sell" | null (trades only)
}

Rules:
- **Date format**: Australian brokerage statements (observed: CMC Markets) write dates DD/MM/YYYY, not MM/DD/YYYY. "03/02/2026" is 3 February 2026, not March 2nd — do NOT default to US date-order assumptions. Many dates on a real statement are ambiguous-looking (day <=12) precisely where this matters; get it right for every line, not just the unambiguous ones (day >12), since a wrong date breaks matching against the user's existing records even when every other field is correct.
- "drp" = a dividend that was reinvested into new shares rather than paid as cash — the statement will show both a dividend amount and a share purchase together. Emit ONE drp object with both dividend and trade fields filled in, not two separate objects.
- "cash_balance" = the statement's stated closing/opening cash balance (for drift-checking against the app's own ledger) — usually one or two lines per statement.
- "fx" = an explicit currency-conversion line if the statement itemises one separately from a trade.
- US dividends often show gross amount + withholding tax deducted (commonly 15-30%) before the net AUD hits the account — populate grossAmountAud and withholdingTaxAud separately when both are visible; if only a net figure is shown, put it in "amount" and leave the other two null rather than guessing a split. Some statement types (e.g. a cash-ledger-style "Trading Account Statement") never show the gross/withholding split at all — that's a real limit of the report, not something to estimate; leave both null.
- Some brokers (observed: CMC Markets) report a trading account as a pure cash ledger: each real trade is ONE line like "Bght 20 TSM:US @ 471.4695 AUD" (buy) or "Sold 136 INTC:US @ 61.5982 AUD" (sell) — extract quantity, symbol, price and side from that single line. It is typically followed by one or more separate lines (e.g. "Wdl ACMM ..." / "Dep ACMM ...", or similarly-named internal transfer/settlement lines) referencing the SAME reference number or trade — these are internal account-clearing mechanics, not a real economic event. Do not emit them as trade/deposit/withdraw/fee lines at all; skip them entirely. The same applies to a dividend's own internal settlement transfer line immediately following it — only emit the "JNL"/dividend line itself, skip its paired transfer line.
- Numbers may contain an embedded space used as a thousands separator by the PDF's column layout (e.g. "2 208.9010" means 2208.9010, "2 736.3500" means 2736.3500) — strip internal spaces within a single number before returning it, don't misread it as two numbers or truncate it.
- Symbols are often suffixed with an exchange/country hint (e.g. "TSM:US") — strip that suffix from "symbol" (return "TSM", not "TSM:US"). Separately, if you can determine the specific listing exchange (NASDAQ vs NYSE vs ASX) from context (well-known tickers, or the statement stating it explicitly), populate an "exchange" field with exactly "NASDAQ", "NYSE", or "ASX"; if you cannot be confident which of NASDAQ/NYSE it is, leave "exchange" null rather than guessing — the app will look up the user's own trade history for that symbol to fill it in, which is more reliable than a guess.
- Ignore statement boilerplate: running headers/footers repeated on every page, disclaimers, and a final "Total" summary row — these are not line items.
- If a field genuinely isn't present on the statement, use null. Do not invent values.
- Output ONLY a JSON array of these objects, no prose, no markdown fences.`;

// If the model's output got cut off mid-array (a real risk on a long
// statement with 50+ line items, especially on a reasoning model that also
// spends budget on hidden reasoning tokens — found via a real upload:
// deepseek-v4-flash consumed 4096 reasoning tokens before writing any
// answer), salvage every complete object rather than discarding the whole
// response. Tries progressively shorter truncations from the last '}'
// backwards until one parses.
function tryRepairTruncatedJsonArray(text) {
  const closeIdxs = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '}') closeIdxs.push(i);
  for (let i = closeIdxs.length - 1; i >= 0; i--) {
    try {
      const candidate = JSON.parse(`${text.slice(0, closeIdxs[i] + 1)}]`);
      if (Array.isArray(candidate)) return candidate;
    } catch { /* try a shorter truncation */ }
  }
  return null;
}

async function extractLinesFromPdf(userId, filePath) {
  const text = await extractPdfText(filePath);
  if (!text || !text.trim()) {
    const err = new Error('Could not extract any text from this PDF');
    err.statusCode = 400;
    throw err;
  }

  const { standard: model } = await getModelsForUser(userId);
  // Sized for a long statement (50+ line items at ~150-250 JSON chars each)
  // plus headroom for reasoning-capable models that spend part of the
  // budget on hidden reasoning before the visible answer (callModel already
  // auto-retries deepseek at up to 32768 if this still isn't enough).
  const result = await callModel(model, text.slice(0, 60000), {
    system: EXTRACTION_SYSTEM_PROMPT,
    maxTokens: 12000,
    returnUsage: true,
  });
  logUsage({ userId, model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'sharesStatementImport' });

  let parsed;
  let truncated = false;
  try {
    const jsonText = result.text.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '');
    parsed = JSON.parse(jsonText);
  } catch (e) {
    parsed = tryRepairTruncatedJsonArray(result.text);
    truncated = true;
    if (!parsed) {
      console.error('[sharesStatements] extraction returned unparseable JSON, raw text (first 2000 chars):', result.text.slice(0, 2000));
      const err = new Error('Statement extraction did not return valid JSON — try again or a clearer scan');
      err.statusCode = 502;
      throw err;
    }
    console.warn(`[sharesStatements] extraction output was truncated — salvaged ${parsed.length} complete line(s), some lines at the end of the statement may be missing`);
  }
  if (!Array.isArray(parsed)) {
    const err = new Error('Statement extraction returned an unexpected shape');
    err.statusCode = 502;
    throw err;
  }
  return { lines: parsed.filter((l) => l && LINE_TYPES.includes(l.lineType)), truncated };
}

// Classifies one extracted line against existing data. Returns
// { matchStatus, matchedTradeId, matchedLedgerId, dedupHash }.
async function classifyLine(userId, line) {
  const hash = dedupHash(line);

  // Already imported (any prior import, not just this one) — never let the
  // same line reach the queue as "new" twice.
  const { rows: dupRows } = await pool.query(
    `SELECT id FROM share_statement_lines WHERE "userId"=$1 AND "dedupHash"=$2 AND "reviewDecision"='approved' LIMIT 1`,
    [userId, hash]
  );
  if (dupRows.length) return { matchStatus: 'skipped_duplicate', matchedTradeId: null, matchedLedgerId: null, dedupHash: hash };

  if (line.lineType === 'trade' && line.symbol && line.quantity && line.date) {
    const { rows } = await pool.query(
      `SELECT id, "pricePerShare", "fxRateToAud", "feesAud" FROM share_trades
       WHERE "userId"=$1 AND symbol=$2 AND quantity=$3 AND "tradedAt"::date=$4::date LIMIT 1`,
      [userId, line.symbol, line.quantity, line.date]
    );
    if (rows.length) {
      const t = rows[0];
      const feeMatch = line.feesAud == null || withinTolerance(Number(t.feesAud), line.feesAud);
      const fxMatch = line.fxRateToAud == null || t.fxRateToAud == null || withinTolerance(Number(t.fxRateToAud), line.fxRateToAud);
      return {
        matchStatus: feeMatch && fxMatch ? 'matches_existing' : 'conflict',
        matchedTradeId: t.id, matchedLedgerId: null, dedupHash: hash,
      };
    }
  }

  if (['dividend', 'interest', 'fee'].includes(line.lineType) && line.date) {
    const { rows } = await pool.query(
      `SELECT id, "amountAud" FROM share_cash_ledger
       WHERE "userId"=$1 AND type=$2 AND "createdAt"::date=$3::date LIMIT 5`,
      [userId, line.lineType, line.date]
    );
    const exact = rows.find((r) => withinTolerance(Number(r.amountAud), line.amount));
    if (exact) return { matchStatus: 'matches_existing', matchedTradeId: null, matchedLedgerId: exact.id, dedupHash: hash };
    const sameDayDifferentAmount = rows.length > 0;
    if (sameDayDifferentAmount) return { matchStatus: 'possible_correction', matchedTradeId: null, matchedLedgerId: rows[0].id, dedupHash: hash };
  }

  return { matchStatus: 'new', matchedTradeId: null, matchedLedgerId: null, dedupHash: hash };
}

async function createImport(userId, { filename, filePath, brokerHint }) {
  const { lines, truncated } = await extractLinesFromPdf(userId, filePath);

  const dates = lines.map((l) => l.date).filter(Boolean).sort();
  const periodStart = dates[0] || null;
  const periodEnd = dates[dates.length - 1] || null;

  const { rows: [imp] } = await pool.query(
    `INSERT INTO share_statement_imports ("userId", filename, "brokerHint", "periodStart", "periodEnd", status)
     VALUES ($1,$2,$3,$4,$5,'reviewing') RETURNING *`,
    [userId, filename, brokerHint || null, periodStart, periodEnd]
  );

  // Non-blocking overlap warning only — a corrected re-upload of the same
  // period is legitimate (docs/shares-statement-import.md), never rejected.
  let overlapWarning = null;
  if (periodStart && periodEnd) {
    const { rows: overlaps } = await pool.query(
      `SELECT id, filename, "periodStart", "periodEnd" FROM share_statement_imports
       WHERE "userId"=$1 AND id != $2 AND status != 'reverted'
         AND "periodStart" IS NOT NULL AND "periodEnd" IS NOT NULL
         AND "periodStart" <= $4::date AND "periodEnd" >= $3::date`,
      [userId, imp.id, periodStart, periodEnd]
    );
    if (overlaps.length) overlapWarning = `Overlaps ${overlaps.length} prior import(s): ${overlaps.map((o) => o.filename).join(', ')}`;
  }

  const insertedLines = [];
  for (const line of lines) {
    const { matchStatus, matchedTradeId, matchedLedgerId, dedupHash: hash } = await classifyLine(userId, line);
    const { rows: [row] } = await pool.query(
      `INSERT INTO share_statement_lines
        ("importId","userId","lineType","parsedFields","dedupHash","matchStatus","matchedTradeId","matchedLedgerId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [imp.id, userId, line.lineType, JSON.stringify(line), hash, matchStatus, matchedTradeId, matchedLedgerId]
    );
    insertedLines.push(row);
  }

  const truncationWarning = truncated
    ? 'The AI response was cut off before finishing — some line items near the end of the statement may be missing. Re-upload if the count looks short.'
    : null;

  return { import: imp, lines: insertedLines, overlapWarning, truncationWarning };
}

async function getImports(userId) {
  const { rows } = await pool.query(
    `SELECT si.*,
       COUNT(sl.id)::int AS "lineCount",
       COUNT(sl.id) FILTER (WHERE sl."reviewDecision"='pending')::int AS "pendingCount"
     FROM share_statement_imports si
     LEFT JOIN share_statement_lines sl ON sl."importId" = si.id
     WHERE si."userId"=$1
     GROUP BY si.id
     ORDER BY si."uploadedAt" DESC`,
    [userId]
  );
  return rows;
}

async function getImportDetail(userId, importId) {
  const { rows: [imp] } = await pool.query(
    `SELECT * FROM share_statement_imports WHERE id=$1 AND "userId"=$2`, [importId, userId]
  );
  if (!imp) return null;
  const { rows: lines } = await pool.query(
    `SELECT * FROM share_statement_lines WHERE "importId"=$1 ORDER BY id ASC`, [importId]
  );
  return { import: imp, lines };
}

async function updateLineFields(userId, lineId, parsedFields) {
  const { rows: [line] } = await pool.query(
    `SELECT * FROM share_statement_lines WHERE id=$1 AND "userId"=$2`, [lineId, userId]
  );
  if (!line) return null;
  if (line.reviewDecision !== 'pending') {
    const err = new Error('Line already reviewed — cannot edit');
    err.statusCode = 400;
    throw err;
  }
  const merged = { ...line.parsedFields, ...parsedFields };
  const { rows: [updated] } = await pool.query(
    `UPDATE share_statement_lines SET "parsedFields"=$1 WHERE id=$2 RETURNING *`,
    [JSON.stringify(merged), lineId]
  );
  return updated;
}

// A missing exchange must never silently default to 'ASX' — that would
// mis-book every US trade whose extraction couldn't tell NASDAQ from NYSE
// (found via a real CMC statement: symbols are suffixed ":US" with no
// further disambiguation). Prefer the user's own trade history for that
// symbol; if there's no prior trade to learn from, refuse rather than guess.
async function resolveExchange(userId, symbol, extractedExchange, currency) {
  if (extractedExchange) return extractedExchange;
  const { rows } = await pool.query(
    `SELECT exchange FROM share_trades WHERE "userId"=$1 AND symbol=$2 ORDER BY "tradedAt" DESC LIMIT 1`,
    [userId, symbol]
  );
  if (rows.length) return rows[0].exchange;
  if (currency === 'AUD') return 'ASX'; // only default when currency itself confirms it
  const err = new Error(`Cannot determine exchange for ${symbol} — no prior trade to infer from. Edit the line and set it manually.`);
  err.statusCode = 400;
  throw err;
}

// Writes one approved line to the real ledger. DRP writes two rows (cash
// ledger + trade), both tagged with sourceImportId/sourceStatementLineId,
// reviewed and applied as a single unit.
async function approveLine(userId, lineId) {
  const { rows: [line] } = await pool.query(
    `SELECT * FROM share_statement_lines WHERE id=$1 AND "userId"=$2`, [lineId, userId]
  );
  if (!line) return null;
  if (line.reviewDecision !== 'pending') {
    const err = new Error(`Line already ${line.reviewDecision}`);
    err.statusCode = 400;
    throw err;
  }
  const f = line.parsedFields;

  if (line.lineType === 'trade') {
    if (!f.symbol || !f.quantity || !f.pricePerUnit || !f.date) {
      const err = new Error('Trade line missing symbol/quantity/price/date — edit before approving');
      err.statusCode = 400;
      throw err;
    }
    const exchange = await resolveExchange(userId, f.symbol, f.exchange, f.currency || 'AUD');
    await pool.query(
      `INSERT INTO share_trades
        ("userId",symbol,exchange,side,quantity,"pricePerShare",currency,"fxRateToAud","feesAud","tradedAt",notes,"sourceImportId","sourceStatementLineId")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [userId, f.symbol, exchange, f.side || 'buy', f.quantity, f.pricePerUnit,
       f.currency || 'AUD', f.fxRateToAud || null, f.feesAud || 0, f.date,
       f.description || 'Imported from statement', line.importId, line.id]
    );
  } else if (['dividend', 'interest', 'fee'].includes(line.lineType)) {
    const amountAud = f.grossAmountAud != null ? f.grossAmountAud : f.amount;
    if (!amountAud) {
      const err = new Error('Line missing an amount — edit before approving');
      err.statusCode = 400;
      throw err;
    }
    await pool.query(
      `INSERT INTO share_cash_ledger ("userId",type,"amountAud","withholdingTaxAud",note,"sourceImportId","sourceStatementLineId")
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, line.lineType, amountAud, f.withholdingTaxAud || null,
       f.description || `Imported from statement (${f.symbol || ''})`.trim(), line.importId, line.id]
    );
  } else if (line.lineType === 'drp') {
    if (!f.symbol || !f.quantity || !f.pricePerUnit || !f.date) {
      const err = new Error('DRP line missing symbol/quantity/price/date — edit before approving');
      err.statusCode = 400;
      throw err;
    }
    const amountAud = f.grossAmountAud != null ? f.grossAmountAud : f.amount;
    await pool.query(
      `INSERT INTO share_cash_ledger ("userId",type,"amountAud","withholdingTaxAud",note,"sourceImportId","sourceStatementLineId")
       VALUES ($1,'dividend',$2,$3,$4,$5,$6)`,
      [userId, amountAud || (f.quantity * f.pricePerUnit), f.withholdingTaxAud || null,
       `DRP reinvestment (${f.symbol})`, line.importId, line.id]
    );
    const drpExchange = await resolveExchange(userId, f.symbol, f.exchange, f.currency || 'AUD');
    await pool.query(
      `INSERT INTO share_trades
        ("userId",symbol,exchange,side,quantity,"pricePerShare",currency,"fxRateToAud","feesAud","tradedAt",notes,"sourceImportId","sourceStatementLineId")
       VALUES ($1,$2,$3,'buy',$4,$5,$6,$7,0,$8,$9,$10,$11)`,
      [userId, f.symbol, drpExchange, f.quantity, f.pricePerUnit,
       f.currency || 'AUD', f.fxRateToAud || null, f.date, 'DRP reinvestment', line.importId, line.id]
    );
  }
  // cash_balance / fx lines are informational only — nothing to write, just mark reviewed.

  const { rows: [updated] } = await pool.query(
    `UPDATE share_statement_lines SET "reviewDecision"='approved', "appliedAt"=NOW() WHERE id=$1 RETURNING *`,
    [lineId]
  );
  return updated;
}

async function rejectLine(userId, lineId) {
  const { rows: [updated] } = await pool.query(
    `UPDATE share_statement_lines SET "reviewDecision"='rejected'
     WHERE id=$1 AND "userId"=$2 AND "reviewDecision"='pending' RETURNING *`,
    [lineId, userId]
  );
  return updated || null;
}

// Deletes every share_trades/share_cash_ledger row this import wrote, and
// marks the import reverted. Rows created manually keep sourceImportId NULL
// so they're never touched by this.
async function revertImport(userId, importId) {
  const { rows: [imp] } = await pool.query(
    `SELECT * FROM share_statement_imports WHERE id=$1 AND "userId"=$2`, [importId, userId]
  );
  if (!imp) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM share_trades WHERE "sourceImportId"=$1 AND "userId"=$2`, [importId, userId]);
    await client.query(`DELETE FROM share_cash_ledger WHERE "sourceImportId"=$1 AND "userId"=$2`, [importId, userId]);
    const { rows: [updated] } = await client.query(
      `UPDATE share_statement_imports SET status='reverted' WHERE id=$1 RETURNING *`, [importId]
    );
    await client.query('COMMIT');
    return updated;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  LINE_TYPES,
  createImport,
  getImports,
  getImportDetail,
  updateLineFields,
  approveLine,
  rejectLine,
  revertImport,
};
