import type { Severity, Tier } from './model';

/**
 * Every severity decision lives here so the rules are easy to tune. Tiers (addendum §3): red = high (must be decided before a document is
 * ready), amber = medium (review recommended), info = low (only under "Show all changes").
 */
export const SEVERITY = {
  // red
  removed: 'high', // a removed paragraph, list item, heading or image; also a paragraph that lost a large part of its words
  removedSection: 'high',
  removedTableRow: 'high',
  number: 'high', // any changed number, date, percentage or amount
  wordCountDrop: 'high', // whole document down more than 5%
  sectionWordDrop: 'high', // one section down more than 15% (when no removal there already explains it)
  // amber
  added: 'medium',
  addedSection: 'medium',
  wording: 'medium',
  structure: 'medium', // heading level, block type, list structure, table shape, page breaks
  moved: 'medium',
  // info
  layout: 'low', // PDF page pixel changes (was medium before the addendum)
  metadataWarning: 'low', // big file-size change, count changes, suspicious dates (was medium before the addendum)
  typo: 'low',
  inlineFormat: 'low',
  metadataInfo: 'low',
  trivial: 'low',
} as const satisfies Record<string, Severity>;

export type SeverityRule = keyof typeof SEVERITY;

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const TIER: Record<Severity, Tier> = { high: 'red', medium: 'amber', low: 'info' };

/** Section word-count drop that counts as red (addendum §3). */
export const SECTION_DROP_PCT = 15;
/** Sections shorter than this are left out of the per-section check: a 12-word section losing 3 words is not a finding. */
export const SECTION_MIN_WORDS = 40;
