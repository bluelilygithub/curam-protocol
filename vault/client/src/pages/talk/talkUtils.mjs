// Pure helpers for Talk it through (docs/talk.md): making a reply fit to be spoken, cutting it into pieces a speech engine will say, and the words on screen.
// Unit-tested: node client/src/pages/talk/talkUtils.test.mjs

/** What a voice should say for a chat reply: markdown symbols, code blocks and web addresses taken out so they are not read out letter by letter. */
export function toSpeakable(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')                       // a code block is not worth hearing
    .replace(/`([^`]*)`/g, '$1')                            // inline code: just the words
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')                  // images
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')            // [words](address) -> words
    .replace(/https?:\/\/\S+/g, 'a link')                   // a bare address
    .replace(/<[^>]+>/g, ' ')                               // html tags
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                     // headings
    .replace(/^\s*>\s?/gm, '')                              // quotes
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '') // list markers
    .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, ' ')             // table rules
    .replace(/\|/g, ', ')                                   // table cells
    .replace(/(\*\*|__|\*|_|~~)/g, '')                      // bold, italic, strike
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n+\s*/g, '. ')                            // a line break is a pause
    .replace(/\.\s*\./g, '.')
    .replace(/([.!?])\s*\.\s*/g, '$1 ')
    .trim();
}

/** The text in pieces of at most `max` characters, cut at sentence ends where possible: some engines stop speaking in the middle of a long passage. */
export function splitForSpeech(text, max = 180) {
  const sentences = String(text ?? '').match(/[^.!?]+[.!?]+["')\]]*\s*|[^.!?]+$/g) || [];
  const out = [];
  let cur = '';
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  for (const raw of sentences) {
    let s = raw;
    while (s.length > max) {                              // one very long sentence: cut at a comma or a space
      const at = Math.max(s.lastIndexOf(', ', max), s.lastIndexOf(' ', max));
      const cut = at > max * 0.4 ? at + 1 : max;
      if ((cur + s.slice(0, cut)).length > max) push();
      cur += s.slice(0, cut);
      push();
      s = s.slice(cut);
    }
    if ((cur + s).length > max) push();
    cur += s;
  }
  push();
  return out;
}

/** True on an iPhone or iPad (including an iPad that says it is a Mac): the browser there cannot listen while it speaks, so the loop waits for a tap. */
export function isIOS(nav) {
  const ua = String(nav?.userAgent || '');
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && Number(nav?.maxTouchPoints) > 1);
}

export const PREFS_KEY = 'vault:talk:prefs';

/** The remembered switches, checked. Listening again by itself starts off on an iPhone (it cannot do it), on elsewhere. */
export function readPrefs(storage, ios = false) {
  const base = { readAloud: true, autoListen: !ios, useNotes: false };
  try {
    const saved = JSON.parse(storage?.getItem(PREFS_KEY) || '{}');
    return {
      readAloud: typeof saved.readAloud === 'boolean' ? saved.readAloud : base.readAloud,
      autoListen: typeof saved.autoListen === 'boolean' ? saved.autoListen : base.autoListen,
      useNotes: typeof saved.useNotes === 'boolean' ? saved.useNotes : base.useNotes,
    };
  } catch { return base; }
}

export function savePrefs(storage, prefs) {
  try { storage?.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* not remembered in a private window */ }
}

/** The line under the big button. */
export function stateLabel(phase, { autoListen = true, supported = true } = {}) {
  if (!supported) return 'This browser cannot listen. Type below instead.';
  if (phase === 'listening') return 'Listening… pause when you are done';
  if (phase === 'thinking') return 'Thinking…';
  if (phase === 'speaking') return 'Speaking… tap to interrupt';
  return autoListen ? 'Tap to start talking' : 'Tap to talk';
}
