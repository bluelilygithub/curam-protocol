'use strict';

// Topic Research: the person's site profile and feed list, kept as one JSON value in the `settings` table
// (key topic_research_settings, per user). Validated here so the route and the tests share one set of rules.

const { DEFAULT_WEIGHTS, DEFAULT_HALF_LIFE_HOURS, SIGNALS } = require('./score');

const KEY = 'topic_research_settings';
const MAX_FEEDS = 50;
const MAX_TEXT = 300;
const SERP_PROVIDERS = ['serper', 'serpapi', 'dataforseo', 'none'];
const MAX_WEIGHT = 100;
const MIN_HALF_LIFE = 1;
const MAX_HALF_LIFE = 720;

const MAX_BUDGET = 10000;
// the monthly spending limit: MONTHLY_BUDGET_USD if it is set to a number (0 = no limit), else 20 (see spend.js)
const envBudget = process.env.MONTHLY_BUDGET_USD;
const DEFAULT_BUDGET = envBudget !== undefined && envBudget !== '' && Number.isFinite(Number(envBudget)) && Number(envBudget) >= 0 && Number(envBudget) <= MAX_BUDGET ? Number(envBudget) : 20;

const DEFAULTS = Object.freeze({
  niche: '', audience: '', tone: '', region: 'AU', feeds: [], serpProvider: 'none',
  scoringWeights: { ...DEFAULT_WEIGHTS }, halfLifeHours: DEFAULT_HALF_LIFE_HOURS, monthlyBudgetUsd: DEFAULT_BUDGET,
});

const text = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT) : '');

/** Returns { error } or { value } (the full cleaned settings object). Missing fields fall back to `base`. */
function validateSettings(input, base = DEFAULTS) {
  const b = input && typeof input === 'object' ? input : {};
  const v = { ...DEFAULTS, ...base, scoringWeights: { ...DEFAULT_WEIGHTS, ...(base && base.scoringWeights) } };
  for (const k of ['niche', 'audience', 'tone']) if (b[k] !== undefined) v[k] = text(b[k]);
  if (b.scoringWeights !== undefined) {
    if (!b.scoringWeights || typeof b.scoringWeights !== 'object' || Array.isArray(b.scoringWeights)) return { error: 'The ranking weights must be a list of numbers.' };
    const w = { ...v.scoringWeights };
    for (const s of SIGNALS) {
      if (b.scoringWeights[s.id] === undefined) continue;
      const n = Number(b.scoringWeights[s.id]);
      if (typeof b.scoringWeights[s.id] === 'boolean' || b.scoringWeights[s.id] === null || b.scoringWeights[s.id] === '' || !Number.isFinite(n) || n < 0 || n > MAX_WEIGHT) return { error: `The weight for ${s.label.toLowerCase()} must be a number from 0 to ${MAX_WEIGHT}.` };
      w[s.id] = n;
    }
    if (!SIGNALS.some((s) => w[s.id] > 0)) return { error: 'At least one ranking weight must be above zero.' };
    v.scoringWeights = w;
  }
  if (b.halfLifeHours !== undefined) {
    const n = Number(b.halfLifeHours);
    if (typeof b.halfLifeHours === 'boolean' || b.halfLifeHours === null || b.halfLifeHours === '' || !Number.isFinite(n) || n < MIN_HALF_LIFE || n > MAX_HALF_LIFE) return { error: `How fast news goes stale must be from ${MIN_HALF_LIFE} to ${MAX_HALF_LIFE} hours.` };
    v.halfLifeHours = n;
  }
  if (b.monthlyBudgetUsd !== undefined) {
    const n = Number(b.monthlyBudgetUsd);
    if (typeof b.monthlyBudgetUsd === 'boolean' || b.monthlyBudgetUsd === null || b.monthlyBudgetUsd === '' || !Number.isFinite(n) || n < 0 || n > MAX_BUDGET) return { error: `The monthly limit must be a number from 0 (no limit) to ${MAX_BUDGET}.` };
    v.monthlyBudgetUsd = Math.round(n * 100) / 100;
  }
  if (b.region !== undefined) {
    const r = typeof b.region === 'string' ? b.region.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(r)) return { error: 'The region must be a two-letter code such as AU.' };
    v.region = r;
  }
  if (b.serpProvider !== undefined) {
    if (!SERP_PROVIDERS.includes(b.serpProvider)) return { error: `The search provider must be one of: ${SERP_PROVIDERS.join(', ')}.` };
    v.serpProvider = b.serpProvider;
  }
  if (b.feeds !== undefined) {
    if (!Array.isArray(b.feeds)) return { error: 'The feed list must be a list.' };
    if (b.feeds.length > MAX_FEEDS) return { error: `Keep the feed list to ${MAX_FEEDS} feeds or fewer.` };
    const seen = new Set();
    const feeds = [];
    for (const f of b.feeds) {
      const raw = typeof f === 'string' ? f : f?.url;
      let u;
      try { u = new URL(String(raw || '').trim()); } catch { return { error: `"${String(raw || '').slice(0, 80)}" is not a web address.` }; }
      if (!/^https?:$/.test(u.protocol)) return { error: `"${String(raw).slice(0, 80)}" must start with http:// or https://.` };
      if (u.toString().length > 500) return { error: 'A feed address is too long.' };
      if (seen.has(u.toString())) continue;
      seen.add(u.toString());
      const name = typeof f === 'object' ? text(f.name).slice(0, 80) : '';
      feeds.push(name ? { url: u.toString(), name } : { url: u.toString() });
    }
    v.feeds = feeds;
  }
  return { value: v };
}

async function loadSettings(pool, userId) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2', [String(userId), KEY]);
  const fresh = () => ({ ...DEFAULTS, feeds: [], scoringWeights: { ...DEFAULT_WEIGHTS } });
  if (!rows.length) return fresh();
  let stored = rows[0].value;
  try { if (typeof stored === 'string') stored = JSON.parse(stored); } catch { stored = {}; }
  const out = validateSettings(stored);
  return out.value || fresh();
}

async function saveSettings(pool, userId, value) {
  await pool.query(
    'INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value',
    [String(userId), KEY, JSON.stringify(value)],
  );
}

module.exports = { KEY, MAX_BUDGET, DEFAULT_BUDGET, MAX_FEEDS, SERP_PROVIDERS, DEFAULTS, validateSettings, loadSettings, saveSettings };
