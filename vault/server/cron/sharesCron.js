'use strict';

const cron = require('node-cron');
const { pool } = require('../db');
const portfolio = require('../services/sharesPortfolio');
const marketData = require('../services/marketData');
const { generateDailyBriefing } = require('../services/sharesNewsService');

let asxCronTask = null;
let usCronTask = null;
let newsCronTask = null;

async function getActiveShareUserIds() {
  const { rows } = await pool.query(`
    SELECT DISTINCT "userId" AS id FROM share_trades
    UNION
    SELECT DISTINCT "userId" AS id FROM share_cash_ledger
  `);
  return rows.map((r) => r.id);
}

async function runSharesPoll(exchanges) {
  const label = exchanges.join('+');
  if (!exchanges.some((ex) => marketData.canFetchExchange(ex))) {
    console.log(`[shares-cron] Skipping ${label} poll — no API key configured`);
    return;
  }

  const userIds = await getActiveShareUserIds();
  if (!userIds.length) return;

  console.log(`[shares-cron] Polling ${label} for ${userIds.length} user(s)`);
  for (const userId of userIds) {
    try {
      await portfolio.recordSnapshots(userId, exchanges);
    } catch (err) {
      console.error(`[shares-cron] ${label} user ${userId}:`, err.message);
    }
  }
}

function startSharesCron() {
  if (asxCronTask) asxCronTask.stop();
  if (usCronTask) usCronTask.stop();

  // ASX: 5 AM and 1 PM Sydney time (Alpha Vantage — 25 req/day, so 2 polls/day)
  asxCronTask = cron.schedule(
    '0 5,13 * * *',
    () => runSharesPoll(['ASX']),
    { timezone: 'Australia/Sydney' }
  );

  // US markets: every 2 hours, 12 times per day (Finnhub — no daily cap)
  usCronTask = cron.schedule(
    '0 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
    () => runSharesPoll(['NYSE', 'NASDAQ']),
    { timezone: 'Australia/Sydney' }
  );

  // News briefings: 4 AM daily Sydney time (after overnight US session closes)
  newsCronTask = cron.schedule(
    '0 4 * * *',
    async () => {
      const userIds = await getActiveShareUserIds();
      for (const userId of userIds) {
        try {
          await generateDailyBriefing(userId);
        } catch (err) {
          console.error(`[shares-cron] news briefing user ${userId}:`, err.message);
        }
      }
    },
    { timezone: 'Australia/Sydney' }
  );

  console.log('[shares-cron] ASX: 5 AM + 1 PM | US: every 2 h | News: 4 AM (Sydney)');
}

module.exports = { startSharesCron, runSharesPoll };
