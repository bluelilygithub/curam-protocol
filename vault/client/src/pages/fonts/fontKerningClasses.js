/**
 * Class-based kerning groups for the "Visual Balance & Rhythm" control.
 * Each group is a curated set of classically-loose letter pairs sharing a
 * cause (diagonal/round vs. straight strokes) — adjusting the balance
 * slider tightens or loosens every pair in the enabled groups at once,
 * scaled by the group's own multiplier. This is a live-preview overlay on
 * top of whatever kerning the font itself already has (from GPOS/kern via
 * opentype.js) — it never edits the font.
 */
export const KERNING_PAIR_GROUPS = [
  {
    id: 'diagonal-caps',
    label: 'Diagonal & round caps (A, V, W, Y)',
    description: 'Open diagonal strokes next to round/straight ones — classic loose spots.',
    pairs: ['AV', 'AW', 'AY', 'VA', 'WA', 'YA', 'AT', 'TA'],
    multiplier: 1,
  },
  {
    id: 'cap-round-lower',
    label: 'Caps before round lowercase (T, F, P before o/e/a)',
    description: 'A crossbar or bowl overhanging a following round lowercase letter.',
    pairs: ['To', 'Te', 'Ta', 'Tr', 'Tu', 'Ti', 'Tc', 'Ty', 'Fo', 'Fa', 'Po', 'Pa'],
    multiplier: 0.8,
  },
  {
    id: 'round-pairs',
    label: 'Round-to-round lowercase (o, e, c, a)',
    description: 'Two round bowls sitting next to each other read slightly loose by default.',
    pairs: ['oo', 'oe', 'eo', 'oc', 'co', 'oa', 'ao'],
    multiplier: 0.6,
  },
  {
    id: 'punctuation',
    label: 'Quotes & punctuation (", \', comma, period against caps)',
    description: 'Hanging punctuation and quote marks next to capitals.',
    pairs: ['A"', "A'", 'V,', 'V.', 'W,', 'W.', 'Y,', 'Y.'],
    multiplier: 1,
  },
];

const BASE_KERN_PX_AT_1000UPM = 24; // tuned so balance=100 reads as a clear, not extreme, tightening

/** Every pair string covered by at least one enabled group, deduped. */
export function affectedPairsForGroups(enabledGroupIds) {
  const set = new Set();
  for (const group of KERNING_PAIR_GROUPS) {
    if (!enabledGroupIds.includes(group.id)) continue;
    for (const pair of group.pairs) set.add(pair);
  }
  return set;
}

/**
 * Class-based kerning adjustment for a specific left+right character pair,
 * in font units (scaled for the font's own unitsPerEm), from the enabled
 * groups + balance slider. Returns 0 if the pair isn't covered by any
 * enabled group. Positive `balance` loosens, negative tightens.
 */
export function classKerningAdjustment(leftChar, rightChar, enabledGroupIds, balance, unitsPerEm) {
  const pair = leftChar + rightChar;
  let multiplier = 0;
  for (const group of KERNING_PAIR_GROUPS) {
    if (enabledGroupIds.includes(group.id) && group.pairs.includes(pair)) {
      multiplier = Math.max(multiplier, group.multiplier);
    }
  }
  if (multiplier === 0) return 0;
  const basePxPerUpm = BASE_KERN_PX_AT_1000UPM / 1000;
  return (balance / 100) * basePxPerUpm * unitsPerEm * multiplier;
}

/** A handful of classic problem pairs offered as starting rows in the Advanced Pairs panel. */
export const SUGGESTED_ADVANCED_PAIRS = ['AV', 'Wa', 'To', 'Yo', 'LT', 'PA', 'Tr', 'Ve'];
