'use strict';

/**
 * Apply-step target — chain-ready interface.
 *
 * Human UI (future) and agent callers both construct this object.
 * Agent-to-agent orchestration is NOT built yet; this shape is the contract.
 *
 * @typedef {{ consumer: string, requirement: string }} SubstitutionTarget
 */

/** Known requirements strategies can declare (not a closed enum for consumers). */
const REQUIREMENTS = {
  MUST_REMAIN_READABLE: 'must-remain-readable',
  MUST_BE_UNAMBIGUOUSLY_WITHHELD: 'must-be-unambiguously-withheld',
  MUST_PRESERVE_AGGREGATE_PROPERTIES: 'must-preserve-aggregate-properties',
  MUST_REMAIN_ARITHMETICALLY_CONSISTENT: 'must-remain-arithmetically-consistent',
};

/**
 * Human dropdown labels → target objects (UI is one caller; not the only caller).
 * Not wired into DocumentRedactionPage yet — exported for the future dropdown.
 */
const UI_STYLE_TO_TARGET = {
  Realistic: {
    consumer: 'human-review',
    requirement: REQUIREMENTS.MUST_REMAIN_READABLE,
  },
  Blackout: {
    consumer: 'legal-disclosure',
    requirement: REQUIREMENTS.MUST_BE_UNAMBIGUOUSLY_WITHHELD,
  },
  Generalized: {
    consumer: 'public-summary',
    requirement: REQUIREMENTS.MUST_PRESERVE_AGGREGATE_PROPERTIES,
  },
  'Realistic + arithmetic': {
    consumer: 'frontier-logic-check',
    requirement: REQUIREMENTS.MUST_REMAIN_ARITHMETICALLY_CONSISTENT,
  },
};

const DEFAULT_TARGET = {
  consumer: 'human-review',
  requirement: REQUIREMENTS.MUST_REMAIN_READABLE,
};

/**
 * Default strategy id for a requirement (override via strategyOverride).
 * Arithmetic consistency is NOT a strategy — it maps to realistic + orthogonal constraint.
 */
const REQUIREMENT_DEFAULT_STRATEGY = {
  [REQUIREMENTS.MUST_REMAIN_READABLE]: 'realistic',
  [REQUIREMENTS.MUST_BE_UNAMBIGUOUSLY_WITHHELD]: 'blackout',
  [REQUIREMENTS.MUST_PRESERVE_AGGREGATE_PROPERTIES]: 'generalized',
  [REQUIREMENTS.MUST_REMAIN_ARITHMETICALLY_CONSISTENT]: 'realistic',
};

function normalizeTarget(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_TARGET };
  }
  const consumer = String(raw.consumer || '').trim() || DEFAULT_TARGET.consumer;
  const requirement = String(raw.requirement || '').trim() || DEFAULT_TARGET.requirement;
  return { consumer, requirement };
}

/**
 * Resolve which strategy plugin runs + whether arithmetic constraint is active.
 * @returns {{ target, strategyId, arithmeticConsistent: boolean }}
 */
function resolveSubstitutionPlan({ target, strategyOverride } = {}) {
  const normalized = normalizeTarget(target);
  const override = strategyOverride ? String(strategyOverride).trim().toLowerCase() : '';
  const strategyId = override
    || REQUIREMENT_DEFAULT_STRATEGY[normalized.requirement]
    || 'realistic';

  const arithmeticConsistent = normalized.requirement === REQUIREMENTS.MUST_REMAIN_ARITHMETICALLY_CONSISTENT
    || Boolean(target?.arithmeticConsistent);

  return {
    target: normalized,
    strategyId,
    arithmeticConsistent,
  };
}

module.exports = {
  REQUIREMENTS,
  UI_STYLE_TO_TARGET,
  DEFAULT_TARGET,
  REQUIREMENT_DEFAULT_STRATEGY,
  normalizeTarget,
  resolveSubstitutionPlan,
};
