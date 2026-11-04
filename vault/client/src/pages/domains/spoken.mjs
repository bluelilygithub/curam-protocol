// Turning what a speech engine hears into what a domain box needs. Pure: used as the `parse` of a VoiceInput, so it only ever touches
// spoken text, never what the person types.
//
// "acme wine dot com dot au" -> "acmewine.com.au"     "my brand dash name" -> "mybrand-name"     "Blue Lily." -> "bluelily"

const WORD_FIXES = [
  [/\s+(?:dot|period|full stop)\s+/gi, '.'],
  [/\s+(?:dash|hyphen|minus)\s+/gi, '-'],
  [/\s+underscore\s+/gi, '_'],
  [/\s+at\s+sign\s+/gi, '@'],
];

function joined(text) {
  let s = ` ${String(text == null ? '' : text).trim()} `;
  for (const [re, to] of WORD_FIXES) s = s.replace(re, to);
  return s.trim();
}

/** A domain, name or handle in one word: lower case, no spaces, no sentence full stop on the end. */
export function spokenName(text) {
  return joined(text)
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/^\.+|\.+$/g, '')
    .replace(/[^a-z0-9._-]/g, '');
}

/** A social handle: as a name, without dots. Platforms differ on dots, so they are left for the person to add. */
export function spokenHandle(text) {
  return spokenName(text).replace(/\./g, '');
}

/** A brand name to compare: spoken words become one word unless the person said a dot, which makes it a domain. */
export const spokenBrand = spokenName;
