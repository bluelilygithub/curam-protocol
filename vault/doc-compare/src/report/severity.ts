import type { Severity } from './model';

/** Every severity decision lives here so the rules are easy to tune. */
export const SEVERITY = {
  removed: 'high',
  removedSection: 'high',
  removedTableRow: 'high',
  number: 'high',
  wordCountDrop: 'high',
  added: 'medium',
  addedSection: 'medium',
  wording: 'medium',
  structure: 'medium', // heading level, block type, list structure, table shape
  moved: 'medium',
  layout: 'medium',
  metadataWarning: 'medium', // big file-size change, count drops, suspicious dates
  typo: 'low',
  inlineFormat: 'low',
  metadataInfo: 'low',
  trivial: 'low',
} as const satisfies Record<string, Severity>;

export type SeverityRule = keyof typeof SEVERITY;

export const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
