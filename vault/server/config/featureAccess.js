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
  // Translate and Guitar routes are not gated by requireFeature; the key lets the admin switch the menu entry off (client list parity)
  translate: true,
  guitar: true,
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
  // reads attached Gmail threads into a commitments ledger and prepares cited follow-up text to copy (docs/email-follow-up.md): off until an admin switches it on
  emailFollowUp: false,
  // the Vault Shelf Windows app pushes clipboard items into Notes, Invoice Review, the CRM inbox and a redaction check: off until an admin switches it on
  shelf: false,
};

const FEATURE_ACCESS_KEYS = Object.keys(FEATURE_ACCESS_DEFAULTS);

// How finished each surface is, so "is this safe to rely on?" has one answer (docs/hardening.md):
//   ga      finished and in everyday use
//   preview built but not proven (unverified data, never run against the real service, or still being built milestone by milestone)
//   parked  kept, not being developed
// A flag missing from this list counts as ga. The Feature Access panel shows the status; it changes no behaviour.
const LIFECYCLE_VALUES = ['ga', 'preview', 'parked'];
const FEATURE_LIFECYCLE = {
  cellarPlanner: 'preview',   // real-job validation and the rod fabricator's rack values are pending
  topicResearch: 'preview',   // built milestone by milestone; drafts, source check and suggestions not yet run against a real model
  emailFollowUp: 'preview',   // not run against a real model or mailbox
  shelf: 'preview',           // Windows app: installer unsigned, no guide chat yet
  passwordVault: 'preview',   // new, holds logins: off until an admin switches it on
  memory: 'parked',           // rarely used; hidden from menus by default
};
const lifecycleOf = (key) => FEATURE_LIFECYCLE[key] || 'ga';

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
  FEATURE_LIFECYCLE,
  LIFECYCLE_VALUES,
  lifecycleOf,
  flagsFromSettingRows,
  applyUserOverrides,
};
