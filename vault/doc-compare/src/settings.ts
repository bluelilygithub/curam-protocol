export interface TrivialRules {
  whitespace: boolean; // spaces, tabs, trailing spaces, line wraps
  quotes: boolean; // curly vs straight quotes, dashes vs hyphen, non-breaking spaces
  unicode: boolean; // NFC, zero-width characters, soft hyphens
  lineEndings: boolean;
}

export interface Settings {
  similarityThreshold: number; // Gate 2, 0-100
  fileSizeChangePct: number;
  wordCountDropPct: number;
  trivial: TrivialRules;
  showTrivial: boolean;
  layoutPixelRatio: number; // share of changed pixels that flags a page
  maxPagesForLayout: number; // above this, layout comparison waits for a click
}

export const DEFAULT_SETTINGS: Settings = {
  similarityThreshold: 60,
  fileSizeChangePct: 20,
  wordCountDropPct: 5,
  trivial: { whitespace: true, quotes: true, unicode: true, lineEndings: true },
  showTrivial: false,
  layoutPixelRatio: 0.005,
  maxPagesForLayout: 500,
};

const KEY = 'doc-compare:settings';

export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') return { ...DEFAULT_SETTINGS, ...saved, trivial: { ...DEFAULT_SETTINGS.trivial, ...saved.trivial } };
  } catch { /* private window or blocked storage: defaults */ }
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: Settings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* not persisted; still applies this session */ }
}
