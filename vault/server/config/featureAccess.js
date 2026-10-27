'use strict';

const FEATURE_ACCESS_DEFAULTS = {
  clients: true,
  goals: true,
  habitsSidebar: true,
  memberModelSelection: false,
  // Rarely used tool: hidden from menus by default. Chat still uses memory directly (memory
  // recall), so this flag gates only the menu entry and page, never the API.
  memory: false,
  finance: true,
  usage: true,
  mood: true,
  newsDigest: true,
  student: true,
  shares: true,
  youtube: true,
  graphics: true,
  videos: true,
  music: true,
  recipes: true,
  pdf: true,
  wellbeing: true,
  gmailIntel: true,
  domains: true,
  productScout: true,
  propertyScenario: true,
  documentRedaction: true,
  contractReview: true,
  googleAds: true,
  seo: true,
  html: true,
  searchConsole: true,
  webExtractor: true,
  fonts: true,
  restyle: true,
  browserAgent: true,
  roomPlanner: true,
  gardenPlanner: true,
  routeTracer: true,
  // a work in progress with unverified values: off until an admin switches it on (Settings -> Feature Access)
  cellarPlanner: false,
  // being built milestone by milestone (docs/topic-research.md): off until an admin switches it on
  topicResearch: false,
  // holds logins: off until an admin switches it on (Settings -> Feature Access)
  passwordVault: false,
  measurements: true,
  fitness: true,
  burnerMail: true,
  dnsLookup: true,
};

const FEATURE_ACCESS_KEYS = Object.keys(FEATURE_ACCESS_DEFAULTS);

function parseFlagValue(raw) {
  const v = String(raw || '').trim().toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

/** Merge workspace_settings rows. Until googleAds is saved, inherit the old seo flag. */
function flagsFromSettingRows(rows) {
  const flags = { ...FEATURE_ACCESS_DEFAULTS };
  const seen = new Set();
  for (const r of rows || []) {
    const featureKey = String(r.key || '').replace(/^feature_/, '');
    if (!FEATURE_ACCESS_KEYS.includes(featureKey)) continue;
    seen.add(featureKey);
    flags[featureKey] = parseFlagValue(r.value);
  }
  if (!seen.has('googleAds') && seen.has('seo')) {
    flags.googleAds = flags.seo;
  }
  return flags;
}

/**
 * Apply a per-user narrowing on top of workspace flags. An override can only turn a
 * feature OFF for that user — it can never grant one the workspace has disabled.
 */
function applyUserOverrides(workspaceFlags, overrides) {
  const flags = { ...workspaceFlags };
  if (!overrides || typeof overrides !== 'object') return flags;
  for (const key of FEATURE_ACCESS_KEYS) {
    if (overrides[key] === false) flags[key] = false;
  }
  return flags;
}

/**
 * Flags for an accountant login. An accountant is the owner's read-only reader, not a workspace member, so the workspace's
 * member switches do not apply: Finance is always on, Shares is on only when the owner ticked it for that accountant
 * (featureOverrides.shares === true), and everything else is off. (Before this, switching Finance off for members also
 * emptied the accountant's Finance.)
 */
function accountantFlags(overrides) {
  const flags = {};
  for (const key of FEATURE_ACCESS_KEYS) flags[key] = false;
  flags.finance = true;
  flags.shares = !!overrides && typeof overrides === 'object' && overrides.shares === true;
  return flags;
}

module.exports = {
  accountantFlags,
  FEATURE_ACCESS_DEFAULTS,
  FEATURE_ACCESS_KEYS,
  flagsFromSettingRows,
  applyUserOverrides,
};
