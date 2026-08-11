'use strict';

/**
 * Portfolio Q&A grounded in the Shares agent dataset (holdings, cash, trades,
 * recent news briefings, latest portfolio note). Answers must cite stored
 * numbers — no inventing prices or P&L.
 */

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser, pickTextModel } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const sharesPortfolio = require('./sharesPortfolio');
const { getBriefingsForUser, getLatestObservation } = require('./sharesNewsService');

const SYSTEM_PROMPT = `You are the Curam Vault Shares assistant. Answer questions using ONLY the portfolio data pack provided.

Rules:
1. Ground every figure in the data pack — do not invent prices, quantities, or P&L.
2. If the data does not contain enough to answer, say what is missing.
3. Be concise: prefer short paragraphs and bullet lists over long essays.
4. Amounts are AUD unless noted. Format money clearly (e.g. $12,450.00).
5. You MAY explain hypothetical liquidation and historical rate-of-return figures that appear in the data pack (e.g. "IF SOLD ALL TODAY"). That is describing stored maths, not personalised advice to buy or sell.
6. Do not recommend buying or selling specific securities.
7. Always produce a substantive answer. Never reply with only a refusal or an empty message.
8. End with: "Based on your Vault Shares data — not financial advice."`;

function fmtAud(n) {
  if (n == null || Number.isNaN(Number(n))) return 'n/a';
  return `$${Number(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return 'n/a';
  const v = Number(n);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function dateStr(v) {
  if (!v) return '';
  return String(v).slice(0, 10);
}

function yearsBetween(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return ms / (365.25 * 24 * 60 * 60 * 1000);
}

/**
 * Lifetime share-trade return if open holdings were sold at current mark-to-market.
 * Uses trade cash flows (buys spent vs sells received) + current holdings value.
 */
function computeLiquidationReturn(trades, dash) {
  const list = Array.isArray(trades) ? trades : [];
  let buyCostAud = 0;
  let sellProceedsAud = 0;
  let firstBuyAt = null;
  let lastTradeAt = null;

  for (const t of list) {
    const aud = Math.abs(Number(sharesPortfolio.tradeCashImpactAud(t)) || 0);
    const at = t.tradedAt ? new Date(t.tradedAt) : null;
    if (at && !Number.isNaN(at.getTime())) {
      if (!lastTradeAt || at > lastTradeAt) lastTradeAt = at;
      if (t.side === 'buy' && (!firstBuyAt || at < firstBuyAt)) firstBuyAt = at;
    }
    if (t.side === 'buy') buyCostAud += aud;
    else if (t.side === 'sell') sellProceedsAud += aud;
  }

  const holdingsValueAud = Number(dash?.holdingsValueAud) || 0;
  const openCostBasisAud = Number(dash?.costBasisAud) || 0;
  const unrealizedPnlAud = dash?.unrealizedPnlAud != null ? Number(dash.unrealizedPnlAud) : holdingsValueAud - openCostBasisAud;
  const realizedPnlAud = dash?.totalRealizedPnlAud != null ? Number(dash.totalRealizedPnlAud) : null;

  const ifSoldAllProceedsAud = sellProceedsAud + holdingsValueAud;
  const lifetimeProfitAud = ifSoldAllProceedsAud - buyCostAud;
  const simpleReturnPct = buyCostAud > 0 ? (lifetimeProfitAud / buyCostAud) * 100 : null;

  const now = new Date();
  const holdingYears = firstBuyAt ? yearsBetween(firstBuyAt, now) : null;
  let annualizedReturnPct = null;
  if (buyCostAud > 0 && ifSoldAllProceedsAud > 0 && holdingYears && holdingYears >= 1 / 365) {
    // CAGR only when proceeds are positive
    annualizedReturnPct = (Math.pow(ifSoldAllProceedsAud / buyCostAud, 1 / holdingYears) - 1) * 100;
  }

  return {
    buyCostAud,
    sellProceedsAud,
    holdingsValueAud,
    openCostBasisAud,
    unrealizedPnlAud,
    realizedPnlAud,
    ifSoldAllProceedsAud,
    lifetimeProfitAud,
    simpleReturnPct,
    annualizedReturnPct,
    holdingYears,
    firstBuyAt: firstBuyAt ? firstBuyAt.toISOString() : null,
    asOf: now.toISOString(),
    hasQuotes: holdingsValueAud > 0 || (dash?.positions || []).some((p) => p.priceAud != null),
  };
}

function formatLiquidationBlock(stats) {
  const lines = [
    '=== IF SOLD ALL TODAY (precomputed — use these for rate-of-return questions) ===',
    `Total paid for all buys (incl. fees): ${fmtAud(stats.buyCostAud)}`,
    `Cash already received from sells (net of fees): ${fmtAud(stats.sellProceedsAud)}`,
    `Current open holdings mark-to-market: ${fmtAud(stats.holdingsValueAud)}`,
    `Open positions cost basis: ${fmtAud(stats.openCostBasisAud)}`,
    `Unrealised P&L on open book: ${fmtAud(stats.unrealizedPnlAud)} (${fmtPct(stats.openCostBasisAud > 0 ? (stats.unrealizedPnlAud / stats.openCostBasisAud) * 100 : null)})`,
    `Realised P&L from closed sells: ${fmtAud(stats.realizedPnlAud)}`,
    `If sold all open holdings at current prices, lifetime proceeds (past sells + MTM): ${fmtAud(stats.ifSoldAllProceedsAud)}`,
    `Lifetime profit vs all buy cost: ${fmtAud(stats.lifetimeProfitAud)}`,
    `Simple rate of return (lifetime profit / all buy cost): ${fmtPct(stats.simpleReturnPct)}`,
    `Holding period since first buy: ${stats.holdingYears != null ? `${stats.holdingYears.toFixed(2)} years` : 'n/a'} (first buy ${dateStr(stats.firstBuyAt) || 'n/a'})`,
    `Annualised (CAGR) if sold all today: ${fmtPct(stats.annualizedReturnPct)}`,
    `Notes: Simple return ignores cash timing beyond first-buy→now CAGR. Cash deposits/withdrawals outside share trades are excluded. Fees are included in buy cost and netted from sell proceeds.`,
  ];
  if (!stats.hasQuotes && stats.holdingsValueAud === 0 && stats.openCostBasisAud > 0) {
    lines.push('WARNING: Open holdings have no live quotes — mark-to-market may be incomplete.');
  }
  return lines.join('\n');
}

function buildDeterministicReturnAnswer(stats) {
  if (!stats || !(stats.buyCostAud > 0)) {
    return [
      'There is not enough trade history to compute a lifetime rate of return yet (no buy cost recorded).',
      '',
      'Based on your Vault Shares data — not financial advice.',
    ].join('\n');
  }

  const lines = [
    'If you sold all open share holdings at today’s mark-to-market prices, here is the lifetime return implied by your trade history:',
    '',
    `• Total paid across all buys: ${fmtAud(stats.buyCostAud)}`,
    `• Already received from past sells: ${fmtAud(stats.sellProceedsAud)}`,
    `• Current holdings value (if sold now): ${fmtAud(stats.holdingsValueAud)}`,
    `• Lifetime proceeds (past sells + current MTM): ${fmtAud(stats.ifSoldAllProceedsAud)}`,
    `• Lifetime profit: ${fmtAud(stats.lifetimeProfitAud)}`,
    `• Simple rate of return: ${fmtPct(stats.simpleReturnPct)}`,
  ];
  if (stats.holdingYears != null) {
    lines.push(`• Holding period since first buy (${dateStr(stats.firstBuyAt)}): ${stats.holdingYears.toFixed(2)} years`);
  }
  if (stats.annualizedReturnPct != null) {
    lines.push(`• Annualised return (CAGR): ${fmtPct(stats.annualizedReturnPct)}`);
  }
  lines.push(
    '',
    'This uses share trade cash flows only (buys, sells, fees) plus current quotes for open positions. It is not time-weighted for deposits/withdrawals outside trades.',
    '',
    'Based on your Vault Shares data — not financial advice.'
  );
  return lines.join('\n');
}

function looksLikeReturnQuestion(q) {
  return /\b(rate of return|return|roi|cagr|profit|if i sold|sold all|liquidate|lifetime|performance|how much (have|would) i)\b/i.test(q);
}

function looksLikeEmptyOrRefusal(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length < 40) return true;
  return /^(i('m| am) (sorry|unable|not able)|i cannot|i can't|as an ai|i'm not able to provide financial advice)\b/i.test(t)
    && t.length < 280;
}

async function buildDataPack(userId, { compact = false } = {}) {
  const [dash, briefings, observation, snapRes] = await Promise.all([
    sharesPortfolio.buildDashboard(userId),
    compact ? Promise.resolve([]) : getBriefingsForUser(userId),
    compact ? Promise.resolve(null) : getLatestObservation(userId),
    pool.query(
      `SELECT "totalValueAud", "holdingsValueAud", "cashAud", "costBasisAud", "recordedAt"
       FROM share_portfolio_snapshots
       WHERE "userId"=$1
       ORDER BY "recordedAt" DESC
       LIMIT $2`,
      [userId, compact ? 3 : 8]
    ),
  ]);

  const { trades } = await sharesPortfolio.getTradesAndLedger(userId);
  const allTrades = trades || [];
  const recentTrades = allTrades.slice(0, compact ? 40 : 60);
  const liq = computeLiquidationReturn(allTrades, dash);

  const lines = [];
  lines.push(formatLiquidationBlock(liq));

  lines.push('\n=== PORTFOLIO SUMMARY ===');
  lines.push(`Total value (holdings + cash): ${fmtAud(dash.totalValueAud)}`);
  lines.push(`Holdings value: ${fmtAud(dash.holdingsValueAud)}`);
  lines.push(`Cash: ${fmtAud(dash.cashAud)}`);
  lines.push(`Cost basis (open): ${fmtAud(dash.costBasisAud)}`);
  lines.push(`Unrealised P&L: ${fmtAud(dash.unrealizedPnlAud)} (${fmtPct(dash.unrealizedPnlPct)})`);
  lines.push(`Realised P&L (all closed sells): ${fmtAud(dash.totalRealizedPnlAud)}`);
  if (dash.usdAud) lines.push(`USD→AUD rate used: ${Number(dash.usdAud).toFixed(4)}`);
  if (dash.quotedAt) lines.push(`Quotes as of: ${dash.quotedAt}`);
  if (dash.quoteError) lines.push(`Quote warning: ${dash.quoteError}`);

  lines.push('\n=== OPEN POSITIONS ===');
  if (!dash.positions?.length) {
    lines.push('(none)');
  } else {
    for (const p of dash.positions) {
      lines.push(
        `${p.symbol}/${p.exchange}: qty=${p.quantity}, avgCost=${fmtAud(p.avgCostAud)}, ` +
        `price=${fmtAud(p.priceAud)}, value=${fmtAud(p.valueAud)}, ` +
        `unrealised=${fmtAud(p.pnlAud)} (${fmtPct(p.pnlPct)}), day=${fmtPct(p.dayChangePct)}`
      );
    }
  }

  if (!compact) {
    lines.push('\n=== REALISED P&L (recent sells, up to 15) ===');
    const realized = (dash.realized || []).slice(0, 15);
    if (!realized.length) {
      lines.push('(none)');
    } else {
      for (const r of realized) {
        lines.push(
          `${dateStr(r.tradedAt)} ${r.symbol}/${r.exchange}: sold ${r.quantity} @ ${fmtAud(r.sellPriceAud)}, ` +
          `P&L ${fmtAud(r.pnlAud)} (${fmtPct(r.pnlPct)})`
        );
      }
    }
  }

  lines.push(`\n=== TRADES (${recentTrades.length} most recent of ${allTrades.length}) ===`);
  if (!recentTrades.length) {
    lines.push('(none)');
  } else {
    for (const t of recentTrades) {
      lines.push(
        `${dateStr(t.tradedAt)} ${t.side.toUpperCase()} ${t.quantity} ${t.symbol}/${t.exchange} ` +
        `@ ${fmtAud(t.pricePerShare)} fees=${fmtAud(t.feesAud)}`
      );
    }
  }

  if (!compact) {
    lines.push('\n=== RECENT PORTFOLIO SNAPSHOTS ===');
    if (!snapRes.rows.length) {
      lines.push('(none)');
    } else {
      for (const s of snapRes.rows) {
        lines.push(
          `${new Date(s.recordedAt).toISOString()} total=${fmtAud(s.totalValueAud)} ` +
          `holdings=${fmtAud(s.holdingsValueAud)} cash=${fmtAud(s.cashAud)} cost=${fmtAud(s.costBasisAud)}`
        );
      }
    }

    const daily = (briefings || []).filter((b) => b.type === 'daily').slice(0, 20);
    lines.push('\n=== RECENT NEWS BRIEFINGS (daily) ===');
    if (!daily.length) {
      lines.push('(none)');
    } else {
      for (const b of daily) {
        const label = b.symbol ? `${b.symbol}/${b.exchange}` : 'MARKET';
        lines.push(
          `${dateStr(b.date)} [${label}] signal=${b.signal || 'n/a'} dayMove=${fmtPct(b.priceChangePct)} — ` +
          `${String(b.content || '').slice(0, 220)}`
        );
      }
    }

    if (observation?.content) {
      lines.push('\n=== LATEST PORTFOLIO NOTE ===');
      lines.push(`Date: ${dateStr(observation.date)}`);
      lines.push(String(observation.content).slice(0, 2500));
    }
  }

  return { text: lines.join('\n'), liquidation: liq };
}

async function callAskModel(userId, modelId, prompt, feature = 'shares_ask') {
  const result = await callModel(modelId, prompt, {
    maxTokens: 2000,
    system: SYSTEM_PROMPT,
    returnUsage: true,
  });
  logUsage({
    userId,
    model: modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature,
  });
  if (result.diagnostics?.empty) {
    console.warn('[sharesAsk] empty model response', JSON.stringify(result.diagnostics));
  }
  return String(result.text || '').trim();
}

function mapQaRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    model: row.model || null,
    createdAt: row.createdAt,
  };
}

async function saveQa(userId, { question, answer, model }) {
  const { rows } = await pool.query(
    `INSERT INTO share_qa ("userId", question, answer, model)
     VALUES ($1, $2, $3, $4)
     RETURNING id, question, answer, model, "createdAt"`,
    [userId, question, answer, model || null]
  );
  return mapQaRow(rows[0]);
}

async function listQa(userId, { limit = 100 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  const { rows } = await pool.query(
    `SELECT id, question, answer, model, "createdAt"
     FROM share_qa
     WHERE "userId"=$1
     ORDER BY "createdAt" DESC
     LIMIT $2`,
    [userId, lim]
  );
  return rows.map(mapQaRow);
}

async function deleteQa(userId, ids) {
  const list = (Array.isArray(ids) ? ids : [ids])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!list.length) return { deleted: 0 };
  const { rowCount } = await pool.query(
    `DELETE FROM share_qa WHERE "userId"=$1 AND id = ANY($2::int[])`,
    [userId, list]
  );
  return { deleted: rowCount || 0 };
}

async function answerSharesQuestion(userId, question, { history = [] } = {}) {
  const q = String(question || '').trim();
  if (!q) throw new Error('question is required');
  if (q.length > 2000) throw new Error('question is too long (max 2000 characters)');

  const tiers = await getModelsForUser(userId);
  const primaryModel = pickTextModel(tiers, 'standard');
  if (!primaryModel) throw new Error('No model configured — check vault_models in Settings');

  const preferCompact = looksLikeReturnQuestion(q);
  const pack = await buildDataPack(userId, { compact: preferCompact });

  const historyBlock = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((turn) => {
      const role = turn?.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(turn?.content || '').slice(0, 800)}`;
    })
    .filter((line) => line.length > 12)
    .join('\n');

  const buildPrompt = (dataText) => [
    'PORTFOLIO DATA PACK:',
    dataText,
    historyBlock ? `\nRECENT Q&A IN THIS SESSION:\n${historyBlock}` : '',
    `\nQuestion: ${q}`,
    '',
    'Answer the question using the data pack. If it is about selling all holdings or rate of return, use the IF SOLD ALL TODAY section.',
  ].filter(Boolean).join('\n');

  let answer = await callAskModel(userId, primaryModel, buildPrompt(pack.text));
  let modelUsed = primaryModel;

  if (looksLikeEmptyOrRefusal(answer)) {
    const compactPack = preferCompact ? pack : await buildDataPack(userId, { compact: true });
    const retryPrompt = [
      'Answer this portfolio question using ONLY the numbers below. Write 2–6 short paragraphs or bullets. Do not refuse.',
      '',
      compactPack.text.slice(0, 14000),
      '',
      `Question: ${q}`,
    ].join('\n');
    answer = await callAskModel(userId, primaryModel, retryPrompt, 'shares_ask_retry');
  }

  if (looksLikeEmptyOrRefusal(answer)) {
    const alt = [tiers.light, tiers.gemini, tiers.deepseek, tiers.standard]
      .filter(Boolean)
      .find((id) => id !== primaryModel);
    if (alt) {
      const compactPack = preferCompact ? pack : await buildDataPack(userId, { compact: true });
      answer = await callAskModel(
        userId,
        alt,
        [
          'Answer using ONLY these portfolio figures. Do not refuse.',
          compactPack.text.slice(0, 12000),
          `Question: ${q}`,
        ].join('\n\n'),
        'shares_ask_alt'
      );
      modelUsed = alt;
    }
  }

  if (looksLikeEmptyOrRefusal(answer)) {
    if (looksLikeReturnQuestion(q)) {
      answer = buildDeterministicReturnAnswer(pack.liquidation);
      modelUsed = 'deterministic';
    } else {
      throw new Error('Model returned an empty answer — try again');
    }
  }

  const saved = await saveQa(userId, { question: q, answer, model: modelUsed });
  return { id: saved.id, answer, model: modelUsed, createdAt: saved.createdAt };
}

module.exports = {
  answerSharesQuestion,
  buildDataPack,
  listQa,
  deleteQa,
  computeLiquidationReturn,
};
