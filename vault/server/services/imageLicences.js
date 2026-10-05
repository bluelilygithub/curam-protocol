'use strict';

// Licence filter for plant photos (Garden Planner spec 6.2). THE HARD RULE: an image whose licence is not on the allowed list is never shown,
// cached or cut out. Every source spells licences differently, so this turns any of them into one canonical form first:
//   iNaturalist  "cc-by", "cc0", "cc-by-nc"            (no version: iNaturalist's CC BY is 4.0, per its terms and licence links)
//   ALA          "CC-BY 4.0 (Int)", "CC-BY 3.0 (Au)", "CC-BY-NC-SA 4.0 (Int)", "PDM", "UNSPECIFIED"
//   Wikimedia    "CC BY-SA 4.0", "CC0", "Public domain", "GFDL", plus a licence URL
// Allowed by default (safe for any use, commercial included): CC0 and public domain; CC BY 2.5 AU, 3.0 AU, 4.0, 4.0 AU.
// CC BY-SA (same versions) is allowed for DISPLAY ONLY: no cut-outs or modified copies, because a derivative would have to be share-alike.
// Excluded: any ND (no derivatives); any NC (non-commercial) unless ALLOW_NONCOMMERCIAL is switched on (only valid if Vault and its use are
// genuinely non-commercial); anything unrecognised ("all rights reserved", "UNSPECIFIED", GFDL, "free use"...).
// The list can be narrowed or widened with ALLOWED_LICENCES (comma separated canonical codes), e.g. to add "CC BY 3.0".

const DEFAULT_ALLOWED = ['CC0 1.0', 'Public domain', 'CC BY 2.5 AU', 'CC BY 3.0 AU', 'CC BY 4.0', 'CC BY 4.0 AU', 'CC BY-SA 2.5 AU', 'CC BY-SA 3.0 AU', 'CC BY-SA 4.0', 'CC BY-SA 4.0 AU'];

const CC_URL = 'https://creativecommons.org/licenses';

function ccUrl(parts, version, jurisdiction) {
  const slug = parts.join('-');
  return `${CC_URL}/${slug}/${version}/${jurisdiction === 'AU' ? 'au/' : ''}`;
}

/** Pull the licence apart: { kind: 'cc0' | 'pd' | 'cc' | null, by, sa, nc, nd, version, jurisdiction }. */
function parse(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return { kind: null };
  // URLs first: creativecommons.org/licenses/by-sa/4.0/ , /licenses/by/3.0/au/ , /publicdomain/zero/1.0/ , /publicdomain/mark/1.0/
  const u = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/?(\d\.\d)?\/?([a-z]{2,3})?/.exec(s);
  if (u) {
    if (u[1] === 'publicdomain') return u[2] === 'zero' ? { kind: 'cc0' } : { kind: 'pd' };
    const tokens = u[2].split('-');
    return { kind: 'cc', by: tokens.includes('by'), sa: tokens.includes('sa'), nc: tokens.includes('nc'), nd: tokens.includes('nd'), version: u[3] ?? '', jurisdiction: (u[4] ?? '').toUpperCase() };
  }
  if (/^(cc0|cc[- ]?zero|cc0[ -]?1\.0)\b/.test(s) || s === 'cc0') return { kind: 'cc0' };
  if (/^(public domain|pdm|pd)\b/.test(s) || s.includes('public domain mark')) return { kind: 'pd' };
  const m = /^cc[- ]?((?:by|sa|nc|nd)(?:[- ](?:by|sa|nc|nd))*)\b\s*(\d\.\d)?\s*\(?\s*(au|int|aus|international|unported)?\s*\)?/.exec(s.replace(/_/g, '-'));
  if (m) {
    const tokens = m[1].split(/[- ]/);
    const jur = (m[3] ?? '').toLowerCase();
    return { kind: 'cc', by: tokens.includes('by'), sa: tokens.includes('sa'), nc: tokens.includes('nc'), nd: tokens.includes('nd'), version: m[2] ?? '', jurisdiction: jur === 'au' || jur === 'aus' ? 'AU' : '' };
  }
  return { kind: null };
}

function family(p) {
  if (p.kind === 'cc0') return 'CC0 1.0';
  if (p.kind === 'pd') return 'Public domain';
  return `CC BY${p.nc ? '-NC' : ''}${p.nd ? '-ND' : ''}${p.sa ? '-SA' : ''}`;
}

/**
 * @param {string} raw        the licence as the source gave it (code, name or URL)
 * @param {object} [o]
 * @param {boolean} [o.allowNonCommercial]  default from env ALLOW_NONCOMMERCIAL === 'true'
 * @param {string[]} [o.allowed]             canonical codes; default from env ALLOWED_LICENCES, else the spec list
 * @param {string} [o.sourceDefaultVersion]  version to assume when the source does not state one (iNaturalist: '4.0')
 * @returns {{ code: string|null, url: string|null, allowed: boolean, displayOnly: boolean, nonCommercial: boolean, reason: string }}
 */
function classifyLicence(raw, o = {}) {
  const env = o.env ?? process.env;
  const allowNC = o.allowNonCommercial ?? env.ALLOW_NONCOMMERCIAL === 'true';
  const allowed = o.allowed ?? (env.ALLOWED_LICENCES ? env.ALLOWED_LICENCES.split(',').map((x) => x.trim()).filter(Boolean) : DEFAULT_ALLOWED);
  const p = parse(raw);
  if (p.kind === null) return { code: null, url: null, allowed: false, displayOnly: false, nonCommercial: false, reason: 'unrecognised licence' };
  if (p.kind === 'cc0') return { code: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', allowed: allowed.includes('CC0 1.0'), displayOnly: false, nonCommercial: false, reason: allowed.includes('CC0 1.0') ? 'ok' : 'not on the allowed list' };
  if (p.kind === 'pd') return { code: 'Public domain', url: 'https://creativecommons.org/publicdomain/mark/1.0/', allowed: allowed.includes('Public domain'), displayOnly: false, nonCommercial: false, reason: allowed.includes('Public domain') ? 'ok' : 'not on the allowed list' };
  if (!p.by) return { code: null, url: null, allowed: false, displayOnly: false, nonCommercial: false, reason: 'unrecognised licence' };
  const version = p.version || o.sourceDefaultVersion || '';
  const fam = family(p);
  const code = [fam, version, p.jurisdiction].filter(Boolean).join(' ');
  const parts = ['by', p.nc ? 'nc' : null, p.nd ? 'nd' : null, p.sa ? 'sa' : null].filter(Boolean);
  const url = version ? ccUrl(parts, version, p.jurisdiction) : null;
  const base = { code, url, nonCommercial: p.nc, displayOnly: p.sa };
  if (!version) return { ...base, allowed: false, displayOnly: false, reason: 'licence version not stated' };
  if (p.nd) return { ...base, allowed: false, displayOnly: false, reason: 'no-derivatives (ND) licences are excluded' };
  if (p.nc && !allowNC) return { ...base, allowed: false, displayOnly: false, reason: 'non-commercial (NC) licences are excluded' };
  // a non-commercial licence, when switched on, is judged on its version like any other: CC BY-NC 4.0 is allowed if ALLOW_NONCOMMERCIAL
  const lookup = p.nc ? code.replace('-NC', '') : code; // the allow-list names the commercial family; NC rides on ALLOW_NONCOMMERCIAL
  if (!allowed.includes(lookup)) return { ...base, allowed: false, displayOnly: false, reason: `${code} is not on the allowed list` };
  return { ...base, allowed: true, reason: p.nc ? 'allowed only because non-commercial use is switched on' : p.sa ? 'allowed for display only (share-alike)' : 'ok' };
}

/** A photo may be cut out or otherwise modified only if its licence allows derivatives without share-alike. */
const mayModify = (c) => c.allowed && !c.displayOnly && !c.nonCommercial;

module.exports = { classifyLicence, mayModify, parseLicence: parse, DEFAULT_ALLOWED };
