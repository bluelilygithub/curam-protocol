'use strict';

/**
 * Generalized strategy — buckets / ranges, not specific fabricated facts.
 * Satisfies: must-preserve-aggregate-properties
 * Arithmetic consistency: satisfied for free (no precise false numbers).
 */

const { REQUIREMENTS } = require('../target');

const id = 'generalized';
const satisfies = [REQUIREMENTS.MUST_PRESERVE_AGGREGATE_PROPERTIES];

const BANK_BUCKET = 'Major Bank';
const ORG_BUCKET = 'Large Organisation';
const PERSON_BUCKET = 'Named Individual';

function parseCurrency(real) {
  const raw = String(real || '').replace(/[^\d.]/g, '');
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function currencyBucket(n) {
  if (n == null) return '$[amount range]';
  if (n < 1_000) return 'under $1,000';
  if (n < 10_000) return '$1,000–$10,000';
  if (n < 100_000) return '$10,000–$100,000';
  if (n < 500_000) return '$100,000–$500,000';
  if (n < 1_000_000) return '$500,000–$1,000,000';
  // Million-scale: round to 0.1M bands (e.g. $1.1M–$1.2M)
  const millions = n / 1_000_000;
  const low = Math.floor(millions * 10) / 10;
  const high = low + 0.1;
  return `$${low.toFixed(1)}M–$${high.toFixed(1)}M`;
}

function percentBucket(real) {
  const n = Number(String(real).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return '[rate band]';
  const low = Math.floor(n);
  return `${low}%–${low + 1}%`;
}

function generalize(entity) {
  const cat = String(entity.categoryLabel || '').toLowerCase();
  const real = String(entity.realValue || '');

  if (/bank/.test(cat) || /bank/i.test(real)) return BANK_BUCKET;
  if (/org|company|employer/.test(cat)) return ORG_BUCKET;
  if (/person|name|client|patient/.test(cat)) return PERSON_BUCKET;
  if (/%/.test(real) || /rate|interest|percent/.test(cat)) return percentBucket(real);
  if (/^\$/.test(real.trim()) || /financial|amount|loan|capacity|surplus|income|salary|price|limit/.test(cat)) {
    return currencyBucket(parseCurrency(real));
  }
  if (/email/.test(cat) || /@/.test(real)) return '[email withheld]';
  if (/phone|mobile|tel/.test(cat)) return '[phone withheld]';
  if (/address/.test(cat)) return '[address area]';
  if (/date/.test(cat)) return '[date period]';
  return '[generalised value]';
}

async function generate({ entities }) {
  const map = new Map();
  for (const e of entities || []) {
    if (e.userLocked && e.seedReplacement && e.seedReplacement !== e.realValue) {
      map.set(e.entityKey, String(e.seedReplacement).trim());
    } else {
      map.set(e.entityKey, generalize(e));
    }
  }
  return {
    map,
    meta: { strategyId: id, fabricatedValues: false, bucketed: true },
  };
}

module.exports = {
  id,
  satisfies,
  generate,
  generalize,
  currencyBucket,
  BANK_BUCKET,
  ORG_BUCKET,
  PERSON_BUCKET,
};
