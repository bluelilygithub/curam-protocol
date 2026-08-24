'use strict';

const FEATURE_ACCESS_DEFAULTS = {
  clients: true,
  goals: true,
  habitsSidebar: true,
  memberModelSelection: false,
  chains: true,
  graph: true,
  debate: true,
  compare: true,
  finance: true,
  usage: true,
  mood: true,
  newsDigest: true,
  student: true,
  shares: true,
  youtube: true,
  graphics: true,
  videos: true,
  recipes: true,
  pdf: true,
  themeBuilder: true,
  wellbeing: true,
  gmailIntel: true,
  domains: true,
  productScout: true,
  propertyScenario: true,
  documentRedaction: true,
  googleAds: true,
  seo: true,
  html: true,
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

module.exports = {
  FEATURE_ACCESS_DEFAULTS,
  FEATURE_ACCESS_KEYS,
  flagsFromSettingRows,
};
