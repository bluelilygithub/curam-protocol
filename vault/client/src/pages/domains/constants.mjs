// What the Domain page offers to choose from. These lists mirror the server's (server/services/domainNaming/brief.js and domainSets.js);
// constants.test.mjs fails if the two drift apart.

export const ENDINGS = ['com', 'com.au', 'org', 'io', 'ai', 'co', 'app'];

export const PLATFORMS = [
  ['instagram', 'Instagram'], ['twitter', 'X (Twitter)'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'],
  ['youtube', 'YouTube'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['threads', 'Threads'],
];

// [id, label, what it means]
export const STYLES = [
  ['descriptive', 'Descriptive', 'says what you do'],
  ['compound', 'Compound', 'two words joined'],
  ['invented', 'Invented word', 'a made-up word'],
  ['metaphor', 'Metaphor', 'borrowed from nature, places or ideas'],
  ['personal', 'Founder or personal name', 'a person, family or place name'],
];

// [key, low end, high end]. 1 to 5, 3 is neutral.
export const TONES = [
  ['playfulSerious', 'playful', 'serious'],
  ['modernClassic', 'modern', 'classic'],
  ['localGlobal', 'local', 'global'],
  ['premiumApproachable', 'premium', 'approachable'],
];

export const BLANK_BRIEF = {
  what: '', who: '', own: '', notes: '',
  tone: { playfulSerious: 3, modernClassic: 3, localGlobal: 3, premiumApproachable: 3 },
  styles: [], include: [], avoid: [],
  required: { tlds: [], platforms: [] },
};

/** "a, b; c" into ['a', 'b', 'c'] (lower case, no repeats, at most `max`). */
export function splitWords(text, max = 8) {
  return [...new Set(String(text || '').split(/[,\n;]+/).map((w) => w.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, max);
}
