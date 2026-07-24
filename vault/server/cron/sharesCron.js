'use strict';

const cron = require('node-cron');
const { pool } = require('../db');
const portfolio = require('../services/sharesPortfolio');
const marketData = require('../services/marketData');
const {
  holdingKey,
  formatPctOffDisplay,
  refreshHighWaterMarksAndAlerts,
} = require('../services/portfolioAlerts');
const { generateDailyBriefing, generateMonthlySummary, generateObservation } = require('../services/sharesNewsService');
const { reportSharesCron } = require('../services/SuggestionService');
const sendEmail = require('../utils/sendEmail');

const DROP_ALERT_KEY = 'shares_daily_drop_alert_pct';

let asxCronTask = null;
let usCronTask = null;
let newsCronTask = null;
let observationCronTask = null;
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
    UNION
    SELECT DISTINCT "userId" AS id FROM metal_purchases
  `);
  return rows.map((r) => r.id);
}

// Admin-configured daily drop threshold (%). 0 (or unset) = test mode: email the
// movement after every poll. Stored as a per-admin setting, like user_timezone.
async function getDailyDropThresholdPct() {
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s
       JOIN users u ON u.id = s."userId"
       WHERE s.key = $1 AND u."isAdmin" = TRUE
       ORDER BY u.id ASC LIMIT 1`,
      [DROP_ALERT_KEY]
    );
    const n = Number(rows[0]?.value);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

async function getAdminRecipients() {
  const { rows } = await pool.query(
    `SELECT id, email FROM users WHERE "isAdmin" = TRUE AND email IS NOT NULL AND email <> '' ORDER BY id ASC`
  );
  return rows;
}

// Portfolio day movement = holdings market value now vs the same holdings at the
// previous close (the standard "start of trading day" baseline). Cash is excluded
// because it does not move intraday. Returns null when nothing is priced yet.
function computeDayMovement(dashboard) {
  let startValueAud = 0;
  let currentValueAud = 0;
  let priced = 0;
  for (const p of dashboard.positions || []) {
    if (p.priceAud == null || p.previousCloseAud == null) continue;
    const qty = Number(p.quantity) || 0;
    startValueAud += Number(p.previousCloseAud) * qty;
    currentValueAud += Number(p.priceAud) * qty;
    priced += 1;
  }
  if (priced === 0 || startValueAud <= 0) return null;
  const changeAud = currentValueAud - startValueAud;
  const changePct = (changeAud / startValueAud) * 100;
  return { startValueAud, currentValueAud, changeAud, changePct, priced };
}

function fmtAud(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n) || 0);
}

function signedPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pctColour(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '#555';
  return v >= 0 ? '#16a34a' : '#dc2626';
}

function buildHoldingTableRows(positions, { nameKey = 'symbol', alertByKey = {} } = {}) {
  const rowKeyFor = (p) => (p.symbol && String(p.symbol).startsWith('M')
    ? p.symbol
    : holdingKey(p.symbol, p.exchange));

  const rows = [...(positions || [])]
    .filter((p) => p.priceAud != null && p.previousCloseAud != null)
    .map((p) => {
      const qty = Number(p.quantity) || 0;
      const dayAud = (Number(p.priceAud) - Number(p.previousCloseAud)) * qty;
      const key = rowKeyFor(p);
      const alert = alertByKey[key] || {};
      return { ...p, _dayAud: dayAud, _name: p[nameKey] || p.symbol, _alert: alert };
    })
    .sort((a, b) => Math.abs(b.dayChangePct || 0) - Math.abs(a.dayChangePct || 0));

  return rows.map((p) => {
    const flagStyle = p._alert.flag === '🔴' ? 'background:#fef2f2;' : p._alert.flag === '⚠️' ? 'background:#fffbeb;' : '';
    const flagCell = p._alert.flag
      ? `<span style="font-size:16px;">${p._alert.flag}</span>`
      : '<span style="color:#ccc;">—</span>';
    return `
    <tr style="${flagStyle}">
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;font-weight:600;">${p._name}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;">${fmtAud(p.priceAud)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;">${formatPctOffDisplay(p._alert.pctOffPeak)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;">${formatPctOffDisplay(p._alert.pctOffAvgCost)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:${pctColour(p.dayChangePct)};font-weight:600;">${signedPct(p.dayChangePct)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:${pctColour(p._dayAud)};font-weight:600;">${fmtAud(p._dayAud)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;color:#555;">${fmtAud(p.valueAud)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">${flagCell}</td>
    </tr>`;
  }).join('');
}

function buildHoldingsTable(positions, label, { nameKey = 'symbol', alertByKey = {} } = {}) {
  const stockRows = buildHoldingTableRows(positions, { nameKey, alertByKey });
  return `
  <h3 style="margin:0 0 8px;font-size:14px;color:#555;text-transform:uppercase;letter-spacing:.05em;">${label}</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
    <thead>
      <tr style="background:#f0f0ec;">
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">Holding</th>
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">Price</th>
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">% off Peak</th>
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">% off Cost</th>
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">Day %</th>
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">Day $</th>
        <th style="padding:7px 10px;text-align:left;font-size:12px;color:#888;font-weight:600;">Value</th>
        <th style="padding:7px 10px;text-align:center;font-size:12px;color:#888;font-weight:600;">Alert</th>
      </tr>
    </thead>
    <tbody>${stockRows || '<tr><td colspan="8" style="padding:12px 10px;color:#888;">No priced holdings.</td></tr>'}</tbody>
  </table>`;
}

function buildPortfolioSummaryTable(movement, label) {
  if (!movement) return '';
  const pct = movement.changePct;
  return `
  <h3 style="margin:0 0 8px;font-size:14px;color:#555;text-transform:uppercase;letter-spacing:.05em;">${label}</h3>
  <table style="width:100%;border-collapse:collapse;margin-bottom:24px;background:#f9f9f7;border-radius:8px;">
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#555;">Day change</td>
      <td style="padding:12px 16px;font-weight:700;font-size:20px;color:${pctColour(pct)};text-align:right;">
        ${signedPct(pct)} &nbsp; <span style="font-size:15px;">${fmtAud(movement.changeAud)}</span>
      </td>
    </tr>
    <tr>
      <td style="padding:8px 16px;font-size:13px;color:#555;">Open value (prev close)</td>
      <td style="padding:8px 16px;text-align:right;">${fmtAud(movement.startValueAud)}</td>
    </tr>
    <tr>
      <td style="padding:8px 16px 12px;font-size:13px;color:#555;">Current value</td>
      <td style="padding:8px 16px 12px;text-align:right;">${fmtAud(movement.currentValueAud)}</td>
    </tr>
  </table>`;
}

function buildHourlyHtml({ movement, threshold, testMode, positions, alertByKey }) {
  const pct = movement?.changePct;
  const now = new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' });
  const hasShares = movement && (positions || []).length > 0;
  const alerts = alertByKey || {};

  return `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:720px;color:#1a1a1a;">

  <h2 style="margin:0 0 4px;font-size:18px;">
    Portfolio Update — ${now} ET
  </h2>
  <p style="margin:0 0 20px;font-size:13px;color:#888;">
    ${testMode
      ? 'Test mode — sent after every market poll.'
      : `Alert: shares portfolio dropped ${Math.abs(pct).toFixed(2)}% today (threshold ${threshold}%).`}
  </p>

  ${hasShares ? buildPortfolioSummaryTable(movement, 'Shares') : ''}
  ${hasShares ? buildHoldingsTable(positions, 'Share holdings', { alertByKey: alerts }) : ''}

  ${!hasShares ? '<p style="color:#888;">No priced holdings.</p>' : ''}

  <p style="margin-top:20px;font-size:11px;color:#aaa;">Observations only — not financial advice. Metals are reported in the daily Portfolio Note.</p>
</div>`;
}

async function sendDropAlertEmail(to, { movement, threshold, testMode, positions, alertByKey }) {
  const sharePct = movement?.changePct;
  const subject = testMode
    ? `Portfolio update ${signedPct(sharePct)} (test mode)`
    : `Shares alert — portfolio down ${Math.abs(sharePct).toFixed(2)}% today`;
  const html = buildHourlyHtml({ movement, threshold, testMode, positions, alertByKey });
  await sendEmail({ to, subject, html });
}

// Runs after each US market poll. Emails admins when the daily drop reaches the
// configured threshold; in test mode (threshold 0) it emails the movement every run.
// Metals spot + reporting are daily-only (Portfolio Note) — not fetched here.
async function checkDailyDropAlerts() {
  const threshold = await getDailyDropThresholdPct();
  const testMode = threshold <= 0;
  const tz = await getWorkspaceTimezone();

  let admins;
  try {
    admins = await getAdminRecipients();
  } catch (err) {
    console.error('[shares-cron] drop-alert: admin lookup failed:', err.message);
    return;
  }
  if (!admins.length) return;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  for (const admin of admins) {
    try {
      const dashboard = await portfolio.buildDashboard(admin.id);
      const movement = computeDayMovement(dashboard);

      const { alertByKey } = await refreshHighWaterMarksAndAlerts(admin.id, {
        sharePositions: dashboard.positions || [],
        asOfDate: today,
      });

      if (!movement) continue;

      const dropPct = -movement.changePct;
      if (!testMode && dropPct < threshold) continue;

      await sendDropAlertEmail(admin.email, {
        movement,
        threshold,
        testMode,
        positions: dashboard.positions || [],
        alertByKey,
      });
      console.log(`[shares-cron] drop-alert sent to ${admin.email} (shares ${movement.changePct.toFixed(2)}%, threshold ${threshold}%)`);
    } catch (err) {
      console.error(`[shares-cron] drop-alert user ${admin.id}:`, err.message);
    }
  }
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
  if (observationCronTask) observationCronTask.stop();
  if (summaryMonthCronTask) summaryMonthCronTask.stop();

  const tz = await getWorkspaceTimezone();

  // ASX: 5 AM and 1 PM (Alpha Vantage — 25 req/day, so 2 polls/day)
  asxCronTask = cron.schedule(
    '0 5,13 * * *',
    () => runSharesPoll(['ASX']),
    { timezone: tz }
  );

  // US markets: on the hour, every hour the NYSE regular session is open
  // (09:30–16:00 ET, Mon–Fri). Scheduled in ET so DST is handled automatically;
  // 10:00–16:00 covers each top-of-hour while open plus the 16:00 close.
  // Note: US market holidays are not excluded (Finnhub has no daily cap).
  usCronTask = cron.schedule(
    '0 10-16 * * 1-5',
    async () => {
      await runSharesPoll(['NYSE', 'NASDAQ']);
      await checkDailyDropAlerts();
    },
    { timezone: 'America/New_York' }
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

  // Portfolio observation agent: 7 AM daily — a holistic narrative briefing
  // (portfolio + AI/tech sector + market context) emailed to each portfolio owner.
  // Runs after the 4 AM per-stock briefing and after the overnight US close.
  observationCronTask = cron.schedule(
    '0 7 * * *',
    async () => {
      const userIds = await getActiveShareUserIds();
      for (const userId of userIds) {
        try {
          await generateObservation(userId);
        } catch (err) {
          console.error(`[shares-cron] observation user ${userId}:`, err.message);
          await reportSharesCron('briefing-failed', { userId, error: err.message, context: 'sharesCron observation' });
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

  console.log(`[shares-cron] ASX: 5 AM + 1 PM (${tz}) | US: hourly 10:00–16:00 ET Mon–Fri | News: 4 AM | Observation: 7 AM | Monthly summary: 1st 4:30 AM (${tz})`);
}

module.exports = { startSharesCron, runSharesPoll, checkDailyDropAlerts };
