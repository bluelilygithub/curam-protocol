'use strict';

/** Pending candidates at or above this score block apply unless overridden. */
const DEFAULT_PENDING_SCORE_THRESHOLD = 0.5;

function isApproved(c) {
  return c.decision === 'approved' || c.decision === 'edited';
}

function isPending(c) {
  return !c.decision || c.decision === 'pending';
}

function isFrontierSource(c) {
  return c.source === 'frontier_suggested' || c.sourceLabel === 'frontier';
}

/**
 * Scope candidates by apply pass so local re-apply isn't blocked by pending
 * frontier suggestions, and frontier apply only considers frontier rows.
 * @param {'local'|'frontier'} applyPass
 */
function candidatesForPass(candidates, applyPass) {
  const list = candidates || [];
  if (applyPass === 'frontier') return list.filter(isFrontierSource);
  return list.filter((c) => !isFrontierSource(c));
}

/**
 * Gate: require confirmApply + at least one approved + no high-score pending.
 * @param {'local'|'frontier'} [opts.applyPass='local']
 */
function assertReadyToApply(candidates, {
  confirmApply,
  pendingScoreThreshold = DEFAULT_PENDING_SCORE_THRESHOLD,
  applyPass = 'local',
} = {}) {
  if (!confirmApply) {
    const err = new Error(
      'confirmApply must be true. Review decisions first, then re-submit with confirmApply: true.',
    );
    err.status = 400;
    err.code = 'CONFIRM_REQUIRED';
    throw err;
  }

  const pass = applyPass === 'frontier' ? 'frontier' : 'local';
  const list = candidatesForPass(candidates, pass);
  const approved = list.filter(isApproved);
  const rejected = list.filter((c) => c.decision === 'rejected');
  const pending = list.filter(isPending);
  const threshold = Number(pendingScoreThreshold);
  const pendingBlocking = pending.filter((c) => Number(c.score || 0) >= threshold);
  const pendingLow = pending.filter((c) => Number(c.score || 0) < threshold);

  if (!approved.length) {
    const err = new Error(
      pass === 'frontier'
        ? 'No approved (or edited) frontier suggestions to apply.'
        : 'No approved (or edited) candidates to apply.',
    );
    err.status = 400;
    err.code = 'NO_APPROVED';
    throw err;
  }

  if (pendingBlocking.length) {
    const err = new Error(
      `${pendingBlocking.length} pending ${pass === 'frontier' ? 'frontier ' : ''}candidate(s) have score ≥ ${threshold}. `
      + 'Approve, reject, or lower their score before applying (or pass a higher pendingScoreThreshold).',
    );
    err.status = 409;
    err.code = 'PENDING_BLOCKING';
    err.blocking = pendingBlocking.map((c) => ({
      id: c.id,
      entityText: c.entityText,
      categoryLabel: c.categoryLabel,
      score: c.score,
      source: c.source,
    }));
    throw err;
  }

  return {
    approved,
    rejected,
    pendingLow,
    pendingScoreThreshold: threshold,
    applyPass: pass,
  };
}

module.exports = {
  assertReadyToApply,
  DEFAULT_PENDING_SCORE_THRESHOLD,
  isApproved,
  isPending,
  isFrontierSource,
  candidatesForPass,
};
