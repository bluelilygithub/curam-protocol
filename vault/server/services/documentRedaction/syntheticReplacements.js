'use strict';

/**
 * Back-compat facade — apply path should prefer generateSubstitutions({ target }).
 * Keeps heuristicFallback export for older callers/tests.
 */

const {
  generateSubstitutions,
  listStrategies,
  UI_STYLE_TO_TARGET,
  REQUIREMENTS,
  DEFAULT_TARGET,
} = require('./substitution');
const realistic = require('./substitution/strategies/realistic');

/**
 * @deprecated Prefer generateSubstitutions({ modelId, entities, target })
 * Defaults to realistic / human-review when no target is supplied.
 */
async function generateSyntheticReplacements({ modelId, entities, target, strategyOverride, skipLlm } = {}) {
  const result = await generateSubstitutions({
    modelId,
    entities,
    target: target || DEFAULT_TARGET,
    strategyOverride,
    skipLlm,
  });
  return {
    map: result.map,
    errors: result.errors,
    modelId: result.modelId,
    plan: result.plan,
    strategyMeta: result.strategyMeta,
    arithmetic: result.arithmetic,
  };
}

module.exports = {
  generateSyntheticReplacements,
  generateSubstitutions,
  heuristicFallback: realistic.heuristicFallback,
  listStrategies,
  UI_STYLE_TO_TARGET,
  REQUIREMENTS,
  DEFAULT_TARGET,
};
