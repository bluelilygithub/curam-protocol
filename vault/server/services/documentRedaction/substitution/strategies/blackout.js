'use strict';

/**
 * Blackout strategy — unambiguous withheld tokens.
 * Satisfies: must-be-unambiguously-withheld
 * Arithmetic consistency: satisfied for free (no fabricated numbers).
 */

const { REQUIREMENTS } = require('../target');

const id = 'blackout';
const satisfies = [REQUIREMENTS.MUST_BE_UNAMBIGUOUSLY_WITHHELD];

function tokenFor(entity, index) {
  const cat = String(entity.categoryLabel || 'VALUE')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 24) || 'VALUE';
  return `[REDACTED_${cat}_${index + 1}]`;
}

/**
 * @returns {Promise<{ map: Map<string,string>, meta: object }>}
 */
async function generate({ entities }) {
  const map = new Map();
  (entities || []).forEach((e, i) => {
    if (e.userLocked && e.seedReplacement && e.seedReplacement !== e.realValue) {
      map.set(e.entityKey, String(e.seedReplacement).trim());
    } else {
      map.set(e.entityKey, tokenFor(e, i));
    }
  });
  return {
    map,
    meta: { strategyId: id, fabricatedValues: false },
  };
}

module.exports = { id, satisfies, generate, tokenFor };
