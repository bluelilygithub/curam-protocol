'use strict';

const cron = require('node-cron');
const { pool } = require('../db');
const portfolio = require('../services/sharesPortfolio');
const marketData = require('../services/marketData');
const { generateDailyBriefing, generateMonthlySummary } = require('../services/sharesNewsService');
const { reportSharesCron } = require('../services/SuggestionService');

let asxCronTask = null;
let usCronTask = null;
let newsCronTask = null;
let summaryMonthCronTask = null;

async function getWorkspaceTimezone() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`
    );
    return rows[0]?.value?.trim() || 'Australia/Sydney';
  } catch {
    return 'Australia/Sydney';
  }
}

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
    if (exchanges.includes('ASX')) {
      await reportSharesCron('asx:no-api-key', {});
    }
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
      await reportSharesCron('poll-failed', {
        userId,
        exchanges: label,
        error: err.message,
        context: `sharesCron ${label}`,
      });
    }
  }
}

async function startSharesCron() {
  if (asxCronTask) asxCronTask.stop();
  if (usCronTask) usCronTask.stop();
  if (newsCronTask) newsCronTask.stop();
  if (summaryMonthCronTask) summaryMonthCronTask.stop();

  const tz = await getWorkspaceTimezone();

  // ASX: 5 AM and 1 PM (Alpha Vantage — 25 req/day, so 2 polls/day)
  asxCronTask = cron.schedule(
    '0 5,13 * * *',
    () => runSharesPoll(['ASX']),
    { timezone: tz }
  );

  // US markets: every 2 hours, 12 times per day (Finnhub — no daily cap)
  usCronTask = cron.schedule(
    '0 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
    () => runSharesPoll(['NYSE', 'NASDAQ']),
    { timezone: tz }
  );

  // News briefings: 4 AM daily (after overnight US session closes)
  newsCronTask = cron.schedule(
    '0 4 * * *',
    async () => {
      const userIds = await getActiveShareUserIds();
      for (const userId of userIds) {
        try {
          await generateDailyBriefing(userId);
        } catch (err) {
          console.error(`[shares-cron] news briefing user ${userId}:`, err.message);
          await reportSharesCron('briefing-failed', { userId, error: err.message });
        }
      }
    },
    { timezone: tz }
  );

  // 30-day summary: 1st of each month at 4:30 AM (after daily briefing finishes)
  summaryMonthCronTask = cron.schedule(
    '30 4 1 * *',
    async () => {
      const userIds = await getActiveShareUserIds();
      for (const userId of userIds) {
        try {
          await generateMonthlySummary(userId);
        } catch (err) {
          console.error(`[shares-cron] monthly summary user ${userId}:`, err.message);
          await reportSharesCron('briefing-failed', {
            userId,
            error: err.message,
            context: 'sharesCron monthly summary',
          });
        }
      }
    },
    { timezone: tz }
  );

  console.log(`[shares-cron] ASX: 5 AM + 1 PM | US: every 2 h | News: 4 AM | Monthly summary: 1st 4:30 AM (tz: ${tz})`);
}

module.exports = { startSharesCron, runSharesPoll };
