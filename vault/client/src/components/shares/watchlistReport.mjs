// Pure helpers for the visual watchlist report (SharesWatchlistReport.jsx). Test: node client/src/components/shares/watchlistReport.test.mjs
// The data comes from share_research_reports.structured, validated on the server (server/services/sharesWatchlistStructure.js).

export const STRUCTURED_VERSION = 1;
export const LEVELS = ['weak', 'moderate', 'strong'];
export const COMPETITOR_GROUPS = [
  { key: 'price ceiling', label: 'Sets a price ceiling', icon: 'layers' },
  { key: 'head to head', label: 'Head to head', icon: 'crosshair' },
  { key: 'competes by category', label: 'Competes by category', icon: 'layout-grid' },
];

// Badge tones: each has an icon, so gain and loss are never shown by colour alone.
export const TONE_ICON = { gain: 'trending-up', loss: 'trending-down', warn: 'alert-triangle', neutral: 'circle-dot' };
export const TONE_COLOR = { gain: 'var(--chart-gain)', loss: 'var(--chart-loss)', warn: 'var(--chart-warn)', neutral: 'var(--color-text)' };

/** Belt and braces on top of the server's validation: anything off draws the prose view instead. */
export function isUsableStructured(s) {
  return !!(s && typeof s === 'object' && s.version === STRUCTURED_VERSION && typeof s.centralQuestion === 'string' && s.centralQuestion.trim()
    && s.verdicts && typeof s.verdicts === 'object' && Object.keys(s.verdicts).length);
}

export function consensusTone(rating) {
  return rating === 'Buy' ? 'gain' : rating === 'Sell' ? 'loss' : rating === 'Mixed' ? 'warn' : 'neutral';
}

/** From the factor counts worked out on the server: the most common level (ties go to the weaker one), as the server's label does. */
export function moatTone(counts) {
  const c = counts || {};
  const n = (l) => Number(c[l]) || 0;
  if (!n('weak') && !n('moderate') && !n('strong')) return 'neutral';
  const common = [...LEVELS].sort((a, b) => n(b) - n(a))[0];
  return { weak: 'loss', moderate: 'warn', strong: 'gain' }[common];
}

// The valuation and growth labels are short free text from the model ("Priced for perfection", "Fast but slowing"). Their tone is
// read from plain words; a label that says both ("fast but slowing") or neither is a caution or neutral, never a guess at good news.
const VALUATION_RICH = /\b(expensive|stretched|rich|premium|perfection|high|elevated|demanding|lofty|overvalued)\b/i;
const VALUATION_CHEAP = /\b(cheap|discount|undervalued|modest|low|reasonable|attractive)\b/i;
const GROWTH_UP = /\b(fast|strong|rapid|accelerating|high|robust|double[- ]digit)\b/i;
const GROWTH_DOWN = /\b(slow|slowing|declining|shrinking|negative|stalling|decelerating|falling|weak)\b/i;

export function labelTone(kind, label) {
  const t = String(label || '');
  const [good, bad] = kind === 'valuation' ? [VALUATION_CHEAP.test(t), VALUATION_RICH.test(t)] : [GROWTH_UP.test(t), GROWTH_DOWN.test(t)];
  if (kind === 'valuation') return bad ? 'warn' : good ? 'gain' : 'neutral';
  return good && bad ? 'warn' : good ? 'gain' : bad ? 'loss' : 'neutral';
}

/** % from `base` to `value`; null when either is missing or base is not positive. */
export function pctFrom(value, base) {
  const v = Number(value);
  const b = Number(base);
  if (value == null || base == null || !Number.isFinite(v) || !Number.isFinite(b) || b <= 0) return null;
  return (v / b - 1) * 100;
}

/** The "distance from the 1-year high" bar: how full (price as % of the high, 0..100) and how far below it. Null without data. */
export function peakBar(current, high) {
  const c = Number(current);
  const h = Number(high);
  if (current == null || high == null || !Number.isFinite(c) || !Number.isFinite(h) || h <= 0 || c <= 0) return null;
  return { fillPct: Math.max(0, Math.min(100, (c / h) * 100)), fromHighPct: (c / h - 1) * 100 };
}

/** Index 0..2 for the three-step meter, -1 if unknown. */
export const levelIndex = (level) => LEVELS.indexOf(String(level || '').toLowerCase());

/** Competitor entries grouped in a fixed order; entries of the same group are kept as separate rows (their notes differ). */
export function groupCompetitors(list) {
  return COMPETITOR_GROUPS.map((g) => ({ ...g, rows: (Array.isArray(list) ? list : []).filter((c) => c.group === g.key) }))
    .filter((g) => g.rows.length);
}

/** Section pills for what this report actually has. `built` lists the sections the page draws (later milestones add more). */
export function sectionPills(s, sourceCount, built = ['summary', 'moat', 'financials', 'valuation', 'risks']) {
  const has = {
    summary: !!s?.centralQuestion,
    moat: !!(s?.moat?.factors?.length || s?.moat?.conflicts?.length || s?.competitors?.length),
    financials: !!(s?.financials || s?.dataWarnings?.length),
    valuation: !!s?.valuation,
    risks: !!s?.risks?.length,
  };
  const labels = { summary: 'Summary', moat: 'Moat', financials: 'Financials', valuation: 'Valuation', risks: 'Risks' };
  const pills = built.filter((k) => has[k]).map((k) => ({ id: k, label: labels[k] }));
  if (sourceCount > 0) pills.push({ id: 'sources', label: `Sources (${sourceCount})` });
  return pills;
}
