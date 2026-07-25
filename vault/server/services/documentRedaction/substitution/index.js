'use strict';

/**
 * Substitution entrypoint — pluggable strategies + optional arithmetic constraint.
 *
 * Real apply input is a `target` object (consumer + requirement), not a bare style string.
 * Human UI will construct target from a dropdown later; agents may supply target directly.
 */

const { resolveSubstitutionPlan, UI_STYLE_TO_TARGET, REQUIREMENTS, DEFAULT_TARGET } = require('./target');
const blackout = require('./strategies/blackout');
const realistic = require('./strategies/realistic');
const generalized = require('./strategies/generalized');
const { enforceArithmeticConsistency, RELATIONSHIP_ID } = require('./arithmeticConsistency');

const STRATEGIES = {
  [blackout.id]: blackout,
  [realistic.id]: realistic,
  [generalized.id]: generalized,
};

function listStrategies() {
  return Object.values(STRATEGIES).map((s) => ({
    id: s.id,
    satisfies: s.satisfies,
  }));
}

/**
 * @param {object} opts
 * @param {string} [opts.modelId]
 * @param {Array} opts.entities
 * @param {{ consumer: string, requirement: string }} [opts.target]
 * @param {string} [opts.strategyOverride] — force strategy id regardless of requirement default
 * @returns {Promise<{ map: Map, errors: string[], modelId: string, plan: object, strategyMeta: object, arithmetic: object }>}
 */
async function generateSubstitutions(opts = {}) {
  const { modelId, entities = [], target, strategyOverride } = opts;
  const plan = resolveSubstitutionPlan({ target, strategyOverride });
  const strategy = STRATEGIES[plan.strategyId] || STRATEGIES.realistic;

  const result = await strategy.generate({ modelId, entities, target: plan.target });
  const map = result.map instanceof Map ? result.map : new Map(Object.entries(result.map || {}));
  const errors = result.errors || [];

  const arithmetic = enforceArithmeticConsistency({
    strategyId: strategy.id,
    arithmeticConsistent: plan.arithmeticConsistent,
    map,
    entities,
  });

  return {
    map: arithmetic.map || map,
    errors,
    modelId,
    plan: {
      target: plan.target,
      strategyId: strategy.id,
      arithmeticConsistent: plan.arithmeticConsistent,
    },
    strategyMeta: result.meta || { strategyId: strategy.id },
    arithmetic: {
      relationshipId: arithmetic.relationshipId || RELATIONSHIP_ID,
      applied: Boolean(arithmetic.applied),
      skippedReason: arithmetic.skippedReason || null,
      satisfiedByConstruction: Boolean(arithmetic.satisfiedByConstruction),
      links: arithmetic.links || [],
      gap: arithmetic.gap || null,
    },
  };
}

module.exports = {
  generateSubstitutions,
  listStrategies,
  STRATEGIES,
  UI_STYLE_TO_TARGET,
  REQUIREMENTS,
  DEFAULT_TARGET,
  resolveSubstitutionPlan,
  RELATIONSHIP_ID,
};
