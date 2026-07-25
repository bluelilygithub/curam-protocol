'use strict';

/**
 * Orthogonal arithmetic / relationship consistency constraint.
 *
 * NOT a fourth strategy. Only actively changes behaviour when the active
 * strategy is `realistic` AND the target requirement is
 * `must-remain-arithmetically-consistent` (or arithmeticConsistent flag).
 *
 * Blackout + generalized satisfy this requirement for free by construction
 * (no fabricated precise numbers that can disagree).
 *
 * Implemented relationship (minimum demo — not a general constraint solver):
 *   income_surplus_capacity
 *   Formula:
 *     surplus'  = round(income'  * (surplus_real  / income_real))   when income present
 *     capacity' = round(surplus' * (capacity_real / surplus_real))  when surplus present
 *
 * Gaps after this (flagged for follow-up):
 * - No general constraint graph / solver
 * - No automatic discovery of novel relationships from the document
 * - Only currency-shaped entities with category/role hints participate
 * - Multi-borrower / multi-loan graphs not handled
 */

const RELATIONSHIP_ID = 'income_surplus_capacity';

function parseMoney(value) {
  const n = Number(String(value || '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function formatMoneyLike(template, amount) {
  const n = Math.max(1, Math.round(amount));
  const formatted = n.toLocaleString('en-US');
  if (String(template || '').includes('$')) return `$${formatted}`;
  return formatted;
}

/**
 * Classify entity into income | surplus | capacity | null using category + value cues.
 */
function classifyRole(entity) {
  const cat = String(entity.categoryLabel || '').toLowerCase();
  const real = String(entity.realValue || '');
  if (!parseMoney(real) && !/^\$/.test(real.trim())) return null;

  if (/income|salary|wage|gross|pay/.test(cat)) return 'income';
  if (/surplus/.test(cat)) return 'surplus';
  if (/capacity|borrowing/.test(cat)) return 'capacity';
  if (/buffer/.test(cat)) return 'surplus'; // treat buffer as surplus-like in this demo link

  // Heuristic fallbacks from surface wording in category
  if (/income|salary/.test(real.toLowerCase())) return 'income';
  return null;
}

/**
 * Apply linked generation for income → surplus → capacity on top of an existing map.
 * Mutates and returns the map.
 *
 * @param {Map<string,string>} map
 * @param {Array<object>} entities
 * @returns {{ map, applied: boolean, relationshipId, links: object[], gap: string }}
 */
function applyIncomeSurplusCapacity(map, entities) {
  const byRole = { income: [], surplus: [], capacity: [] };
  for (const e of entities || []) {
    if (e.userLocked) continue;
    const role = classifyRole(e);
    if (!role) continue;
    byRole[role].push(e);
  }

  const links = [];
  const hasLink = byRole.income.length && byRole.surplus.length
    || byRole.surplus.length && byRole.capacity.length
    || byRole.income.length && byRole.capacity.length;

  if (!hasLink) {
    return {
      map,
      applied: false,
      relationshipId: RELATIONSHIP_ID,
      links,
      gap: 'No income/surplus/capacity triad (or pair) detected among approved entities — constraint idle.',
    };
  }

  // Pick primary of each role (first approved)
  const income = byRole.income[0] || null;
  const surplus = byRole.surplus[0] || null;
  const capacity = byRole.capacity[0] || null;

  const incomeReal = income ? parseMoney(income.realValue) : null;
  const surplusReal = surplus ? parseMoney(surplus.realValue) : null;
  const capacityReal = capacity ? parseMoney(capacity.realValue) : null;

  let incomeSyn = income ? parseMoney(map.get(income.entityKey)) : null;
  if (income && (incomeSyn == null || incomeSyn === incomeReal)) {
    incomeSyn = Math.max(1, Math.round((incomeReal || 100000) * 0.91));
    map.set(income.entityKey, formatMoneyLike(income.realValue, incomeSyn));
  }

  let surplusSyn = surplus ? parseMoney(map.get(surplus.entityKey)) : null;
  if (surplus) {
    if (income && incomeReal && surplusReal && incomeSyn) {
      surplusSyn = Math.max(1, Math.round(incomeSyn * (surplusReal / incomeReal)));
    } else if (surplusSyn == null || surplusSyn === surplusReal) {
      surplusSyn = Math.max(1, Math.round((surplusReal || 10000) * 0.91));
    }
    map.set(surplus.entityKey, formatMoneyLike(surplus.realValue, surplusSyn));
    if (income) {
      links.push({
        from: income.entityKey,
        to: surplus.entityKey,
        rule: 'surplus′ = income′ × (surplus/income)',
        incomeSyn,
        surplusSyn,
      });
    }
  }

  if (capacity) {
    let capacitySyn;
    if (surplus && surplusReal && capacityReal && surplusSyn) {
      capacitySyn = Math.max(1, Math.round(surplusSyn * (capacityReal / surplusReal)));
    } else if (income && incomeReal && capacityReal && incomeSyn) {
      capacitySyn = Math.max(1, Math.round(incomeSyn * (capacityReal / incomeReal)));
    } else {
      capacitySyn = parseMoney(map.get(capacity.entityKey))
        || Math.max(1, Math.round((capacityReal || 500000) * 0.91));
    }
    map.set(capacity.entityKey, formatMoneyLike(capacity.realValue, capacitySyn));
    if (surplus) {
      links.push({
        from: surplus.entityKey,
        to: capacity.entityKey,
        rule: 'capacity′ = surplus′ × (capacity/surplus)',
        surplusSyn,
        capacitySyn,
      });
    } else if (income) {
      links.push({
        from: income.entityKey,
        to: capacity.entityKey,
        rule: 'capacity′ = income′ × (capacity/income)',
        incomeSyn,
        capacitySyn,
      });
    }
  }

  // Propagate same role keys to sibling entities of same role (keep ratio to primary real)
  for (const role of ['income', 'surplus', 'capacity']) {
    const primary = byRole[role][0];
    if (!primary) continue;
    const primarySyn = parseMoney(map.get(primary.entityKey));
    const primaryReal = parseMoney(primary.realValue);
    if (primarySyn == null || primaryReal == null) continue;
    for (const sibling of byRole[role].slice(1)) {
      if (sibling.userLocked) continue;
      const sibReal = parseMoney(sibling.realValue);
      if (sibReal == null) continue;
      const sibSyn = Math.max(1, Math.round(primarySyn * (sibReal / primaryReal)));
      map.set(sibling.entityKey, formatMoneyLike(sibling.realValue, sibSyn));
    }
  }

  return {
    map,
    applied: true,
    relationshipId: RELATIONSHIP_ID,
    links,
    gap: 'General constraint solver / additional relationship types not implemented.',
  };
}

/**
 * @param {{ strategyId: string, arithmeticConsistent: boolean, map: Map, entities: Array }} opts
 */
function enforceArithmeticConsistency(opts = {}) {
  const { strategyId, arithmeticConsistent, map, entities } = opts;

  if (!arithmeticConsistent) {
    return {
      map,
      applied: false,
      skippedReason: 'arithmetic constraint not requested',
      relationshipId: null,
      links: [],
      gap: null,
    };
  }

  // Blackout / generalized satisfy for free — no rewrite
  if (strategyId === 'blackout' || strategyId === 'generalized') {
    return {
      map,
      applied: false,
      skippedReason: `${strategyId} satisfies arithmetic consistency by construction`,
      relationshipId: RELATIONSHIP_ID,
      links: [],
      gap: null,
      satisfiedByConstruction: true,
    };
  }

  if (strategyId !== 'realistic') {
    return {
      map,
      applied: false,
      skippedReason: `arithmetic constraint only rewrites realistic strategy (got ${strategyId})`,
      relationshipId: RELATIONSHIP_ID,
      links: [],
      gap: 'No behaviour defined for this strategy under arithmetic constraint.',
    };
  }

  return applyIncomeSurplusCapacity(map, entities);
}

module.exports = {
  RELATIONSHIP_ID,
  classifyRole,
  parseMoney,
  formatMoneyLike,
  applyIncomeSurplusCapacity,
  enforceArithmeticConsistency,
};
