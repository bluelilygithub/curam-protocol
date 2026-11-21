import type { Block } from '../readers/types';

// The categories added for the submission checks (addendum §2) are part of the union now; the checks that produce them arrive in later phases.
export type Category =
  | 'removed' | 'added' | 'moved' | 'wording' | 'typo' | 'number' | 'formatting' | 'layout' | 'metadata'
  | 'newClaim' | 'reference' | 'citation' | 'quote' | 'numbering' | 'wordLimit' | 'spelling' | 'terminology' | 'requiredHeading' | 'versionNumber' | 'drift';
export type Severity = 'high' | 'medium' | 'low';
/** The addendum's names for the severities: red = high, amber = medium, info = low. */
export type Tier = 'red' | 'amber' | 'info';

export interface Change {
  id: number;
  category: Category;
  severity: Severity;
  location: string;
  original?: string; // full text; the UI and report truncate to ~300 chars
  edited?: string;
  detail?: string;
  diffHtml?: string; // escaped text with <del>/<ins> only
  children?: Change[];
  trivial?: boolean; // differs only by a rule in Settings → trivial changes; hidden unless "show trivial" is on
  group?: 'section' | 'tableRow'; // removed/added as a whole section or table row
  page?: number; // layout changes: original page, opens the page viewer
  // ---- addendum §2 (all optional) ----
  tier?: Tier; // derived from severity
  summary?: string; // plain language: what happened
  whyItMatters?: string;
  action?: string; // what to do about it
  decision?: 'restore' | 'accept' | 'later'; // set by the person (Phase 2)
  decidedAt?: string; // ISO timestamp
  origin?: 'removed' | 'added' | 'changed';
  // ---- projects (addendum §7) ----
  anchor?: string; // where the change sits in the original: a block id, or "+<id before>:<fingerprint>" for added text; stable across rounds
  edit?: Edit; // how the change is applied to the original when it is accepted (the accepted state, §7.3)
  roundNote?: string; // "New in this round", "Not fixed: …", "Since round 2: …" (§7.4, §7.6)
}

/** One accepted change, as an edit to the original's blocks (ids are the original's; inserted blocks get ids from their anchor). */
export interface Edit {
  remove?: string[];
  insert?: { after: string | null; blocks: Block[] };
  replace?: { id: string; block: Block };
}

export interface MetaRow {
  label: string;
  original: string;
  edited: string;
  difference: string;
  flagged?: boolean;
}

export interface SimilarityResult {
  score: number; // 0-100
  headingScore: number; // 0-1 (NaN-free; 1 when the original has no headings)
  overlapScore: number;
  structureScore: number;
  reasons: string[];
}

/** Word counts (addendum §5.4): totals and per section, reference list left out when Settings says so. */
export interface WordCounts {
  original: number;
  edited: number;
  limit: number | null;
  referencesExcluded: boolean;
  sections: { title: string; original: number; edited: number }[];
}

export interface ComparisonResult {
  changes: Change[];
  trivialCount: number;
  metadata: MetaRow[];
  words?: WordCounts;
}

export const CATEGORY_LABEL: Record<Category, string> = {
  removed: 'Removed',
  added: 'Added',
  moved: 'Moved',
  wording: 'Wording',
  typo: 'Typo',
  number: 'Number/date',
  formatting: 'Formatting',
  layout: 'Layout',
  metadata: 'Metadata',
  newClaim: 'New claim',
  reference: 'Reference',
  citation: 'Citation',
  quote: 'Quote',
  numbering: 'Numbering',
  wordLimit: 'Word limit',
  spelling: 'Spelling',
  terminology: 'Terminology',
  requiredHeading: 'Required heading',
  versionNumber: 'Version number',
  drift: 'Drift',
};

/** Text glyph per category so colour is never the only signal. */
export const CATEGORY_ICON: Record<Category, string> = {
  removed: '−',
  added: '+',
  moved: '↕',
  wording: '✎',
  typo: 'Aa',
  number: '#',
  formatting: 'B',
  layout: '▦',
  metadata: 'i',
  newClaim: '!',
  reference: '[ ]',
  citation: '[n]',
  quote: '“”',
  numbering: '1.',
  wordLimit: 'W',
  spelling: 'ab',
  terminology: 'T',
  requiredHeading: 'H',
  versionNumber: 'v',
  drift: '↘',
};
