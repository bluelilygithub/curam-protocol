export type Category = 'removed' | 'added' | 'moved' | 'wording' | 'typo' | 'number' | 'formatting' | 'layout' | 'metadata';
export type Severity = 'high' | 'medium' | 'low';

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

export interface ComparisonResult {
  changes: Change[];
  trivialCount: number;
  metadata: MetaRow[];
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
};
