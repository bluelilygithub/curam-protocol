'use strict';

const cron = require('node-cron');
const { pool } = require('../db');
const portfolio = require('../services/sharesPortfolio');
const finnhub = require('../services/finnhub');

let cronTask = null;

/** Sydney weekday — used only to log session context; quotes still fetch (delayed). */
function marketContextLabel() {
  const now = new Date();
  const sydney = new Date(now.toLocaleString('en-US', { timeZone: 'Australia/Sydney' }));
  const h = sydney.getHours();
  const d = sydney.getDay();
  const asxOpen = d >= 1 && d <= 5 && h >= 10 && h < 16;
  const nyOpen = d >= 1 && d <= 5 && (h >= 23 || h < 6);
  if (asxOpen && nyOpen) return 'ASX+NYSE';
  if (asxOpen) return 'ASX';
  if (nyOpen) return 'NYSE';
  return 'off-hours';
}

async function getActiveShareUserIds() {
  const { rows } = await pool.query(`
    SELECT DISTINCT "userId" AS id FROM share_trades
    UNION
    SELECT DISTINCT "userId" AS id FROM share_cash_ledger
  `);
  return rows.map((r) => r.id);
}

async function runSharesPoll() {
  if (!finnhub.isConfigured()) return;
  const label = marketContextLabel();
  const userIds = await getActiveShareUserIds();
  if (!userIds.length) return;

  console.log(`[shares-cron] Polling ${userIds.length} user(s) (${label})`);
  for (const userId of userIds) {
    try {
      await portfolio.recordSnapshots(userId);
    } catch (err) {
      console.error(`[shares-cron] user ${userId}:`, err.message);
    }
  }
}

function startSharesCron() {
  if (cronTask) cronTask.stop();
  cronTask = cron.schedule('*/15 * * * *', runSharesPoll, { timezone: 'Australia/Sydney' });
  console.log('[shares-cron] Scheduled quote snapshots every 15 minutes (Australia/Sydney)');
}

module.exports = { startSharesCron, runSharesPoll };
