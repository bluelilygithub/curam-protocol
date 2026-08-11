'use strict';

/**
 * Portfolio Q&A grounded in the Shares agent dataset (holdings, cash, trades,
 * recent news briefings, latest portfolio note). Answers must cite stored
 * numbers — no inventing prices or P&L.
 */

const { pool } = require('../db');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const sharesPortfolio = require('./sharesPortfolio');
const { getBriefingsForUser, getLatestObservation } = require('./sharesNewsService');

const SYSTEM_PROMPT = `You are the Curam Vault Shares assistant. Answer questions using ONLY the portfolio data pack provided.

Rules:
1. Ground every figure in the data pack — do not invent prices, quantities, or P&L.
2. If the data does not contain enough to answer, say what is missing.
3. Be concise: prefer short paragraphs and bullet lists over long essays.
4. Amounts are AUD unless noted. Format money clearly (e.g. $12,450.00).
5. Do not give personalised financial advice or recommend buying/selling specific securities. You may explain what the data shows.
6. End with: "Based on your Vault Shares data — not financial advice."`;

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

async function buildDataPack(userId) {
  const [dash, briefings, observation, snapRes] = await Promise.all([
    sharesPortfolio.buildDashboard(userId),
    getBriefingsForUser(userId),
    getLatestObservation(userId),
    pool.query(
      `SELECT "totalValueAud", "holdingsValueAud", "cashAud", "costBasisAud", "recordedAt"
       FROM share_portfolio_snapshots
       WHERE "userId"=$1
       ORDER BY "recordedAt" DESC
       LIMIT 8`,
      [userId]
    ),
  ]);

  const { trades } = await sharesPortfolio.getTradesAndLedger(userId);
  const recentTrades = (trades || []).slice(0, 25);

  const lines = [];
  lines.push('=== PORTFOLIO SUMMARY ===');
  lines.push(`Total value (holdings + cash): ${fmtAud(dash.totalValueAud)}`);
  lines.push(`Holdings value: ${fmtAud(dash.holdingsValueAud)}`);
  lines.push(`Cash: ${fmtAud(dash.cashAud)}`);
  lines.push(`Cost basis: ${fmtAud(dash.costBasisAud)}`);
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

  lines.push('\n=== RECENT TRADES (up to 25) ===');
  if (!recentTrades.length) {
    lines.push('(none)');
  } else {
    for (const t of recentTrades) {
      lines.push(
        `${dateStr(t.tradedAt)} ${t.side.toUpperCase()} ${t.quantity} ${t.symbol}/${t.exchange} ` +
        `@ ${fmtAud(t.pricePerShare)} fees=${fmtAud(t.feesAud)}` +
        (t.notes ? ` notes=${String(t.notes).slice(0, 80)}` : '')
      );
    }
  }

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

  const daily = (briefings || []).filter((b) => b.type === 'daily').slice(0, 40);
  lines.push('\n=== RECENT NEWS BRIEFINGS (daily) ===');
  if (!daily.length) {
    lines.push('(none)');
  } else {
    for (const b of daily) {
      const label = b.symbol ? `${b.symbol}/${b.exchange}` : 'MARKET';
      lines.push(
        `${dateStr(b.date)} [${label}] signal=${b.signal || 'n/a'} dayMove=${fmtPct(b.priceChangePct)} — ` +
        `${String(b.content || '').slice(0, 280)}`
      );
    }
  }

  const monthly = (briefings || []).filter((b) => b.type === 'monthly_summary').slice(0, 3);
  if (monthly.length) {
    lines.push('\n=== MONTHLY SUMMARIES ===');
    for (const m of monthly) {
      lines.push(`${dateStr(m.date)}: ${String(m.content || '').slice(0, 500)}`);
    }
  }

  if (observation?.content) {
    lines.push('\n=== LATEST PORTFOLIO NOTE ===');
    lines.push(`Date: ${dateStr(observation.date)}`);
    lines.push(String(observation.content).slice(0, 3500));
  }

  return lines.join('\n');
}

async function answerSharesQuestion(userId, question, { history = [] } = {}) {
  const q = String(question || '').trim();
  if (!q) throw new Error('question is required');
  if (q.length > 2000) throw new Error('question is too long (max 2000 characters)');

  const tiers = await getModelsForUser(userId);
  const modelId = tiers.standard || tiers.light || tiers.gemini;
  if (!modelId) throw new Error('No model configured — check vault_models in Settings');

  const dataPack = await buildDataPack(userId);

  const historyBlock = (Array.isArray(history) ? history : [])
    .slice(-6)
    .map((turn) => {
      const role = turn?.role === 'assistant' ? 'Assistant' : 'User';
      return `${role}: ${String(turn?.content || '').slice(0, 800)}`;
    })
    .filter((line) => line.length > 12)
    .join('\n');

  const prompt = [
    'PORTFOLIO DATA PACK:',
    dataPack,
    historyBlock ? `\nRECENT Q&A IN THIS SESSION:\n${historyBlock}` : '',
    `\nQuestion: ${q}`,
  ].filter(Boolean).join('\n');

  const result = await callModel(modelId, prompt, {
    maxTokens: 1200,
    system: SYSTEM_PROMPT,
    returnUsage: true,
  });
  logUsage({
    userId,
    model: modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature: 'shares_ask',
  });

  const answer = String(result.text || '').trim();
  if (!answer) throw new Error('Model returned an empty answer — try again');
  return { answer, model: modelId };
}

module.exports = {
  answerSharesQuestion,
  buildDataPack,
};
