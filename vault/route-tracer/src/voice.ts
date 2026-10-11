/** What speech recognition hears, made fit for a field. Pure, so it is tested without a microphone. */

/** What was said, tidied for a name or a sentence: no full stop at the end, no doubled spaces. */
export function tidySpoken(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '').trim();
}

/**
 * An email address as people say it: "michael at example dot com" -> michael@example.com. Also "dot", "underscore", "dash" or "hyphen" and
 * "plus", and numbers said as words are left to the recogniser (it usually writes digits). Anything it could not turn into an address is
 * still returned (the field checks it) with the spaces closed up.
 */
export function spokenEmail(text: string): string {
  let s = ` ${text.toLowerCase().replace(/[,;]+/g, ' ')} `;
  s = s.replace(/\s+at\s+(?:the\s+rate\s+)?/g, '@').replace(/\s+dot\s+/g, '.').replace(/\s+(?:underscore|under score)\s+/g, '_').replace(/\s+(?:dash|hyphen|minus)\s+/g, '-').replace(/\s+plus\s+/g, '+');
  s = s.replace(/\s+/g, '').replace(/\.+$/, '');
  const at = s.indexOf('@');
  return at < 0 ? s : `${s.slice(0, at + 1)}${s.slice(at + 1).replace(/@/g, '')}`; // only one @
}
