/**
 * Icons used inside the program's cards and tiles, in one place so the same thing always has the same picture.
 * Names are the semantic names registered in IconProvider.
 */

export const DOMAIN_ICON = {
  strength: 'dumbbell',
  cardio: 'heart-pulse',
  balance: 'scale',
  flexibility: 'person-standing',
};

export const DOMAIN_NAME = {
  strength: 'Strength',
  cardio: 'Aerobic',
  balance: 'Balance',
  flexibility: 'Mobility',
};

// strength movements share the dumbbell; the others each have their own
export const PATTERN_ICON = {
  squat: 'dumbbell', hinge: 'dumbbell', lunge: 'dumbbell', push: 'dumbbell', pull: 'dumbbell', core: 'dumbbell', carry: 'dumbbell',
  cardio: 'heart-pulse',
  balance: 'scale',
  mobility: 'person-standing',
};

export const BLOCK_ICON = { warmup: 'flame', main: 'target', cooldown: 'snowflake' };

/** The main icon for a session: strength first, then cardio, balance, mobility. */
export function sessionIcon(session) {
  const domains = (session.components || []).map((c) => c.domain);
  for (const d of ['strength', 'cardio', 'balance', 'flexibility']) if (domains.includes(d)) return DOMAIN_ICON[d];
  return 'target';
}
