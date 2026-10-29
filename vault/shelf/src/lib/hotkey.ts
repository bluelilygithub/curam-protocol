// The hotkey recorder: turns a key press into text like "Ctrl+Shift+Space", and says which combinations are not allowed.

export interface KeyLike { key: string; code?: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);
const NAMED: Record<string, string> = {
  ' ': 'Space', Spacebar: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc', Enter: 'Enter',
  Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};

/** Combinations that already mean something everywhere (or that Windows will not hand to an app), so the shelf will not take them. */
export const RESERVED = ['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+A', 'Ctrl+S', 'Ctrl+W', 'Ctrl+Q', 'Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete', 'Ctrl+Shift+Esc', 'Win+L', 'Win+D', 'Win+E', 'Win+R', 'Win+V', 'Win+Space'];
export const DEFAULT_HOTKEY = 'Ctrl+Shift+Space';

function keyName(e: KeyLike): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const code = e.code ?? '';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (NAMED[e.key]) return NAMED[e.key] as string;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(e.key)) return e.key;
  if (e.key.length === 1 && /[a-z0-9]/i.test(e.key)) return e.key.toUpperCase();
  return null; // punctuation and the like differ between keyboards: not offered
}

/** "Ctrl+Shift+Space" for a key press, or null while only modifiers are held / the key is not usable. */
export function hotkeyFromEvent(e: KeyLike): string | null {
  const key = keyName(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Win');
  parts.push(key);
  return parts.join('+');
}

export type HotkeyProblem = 'no-modifier' | 'reserved' | 'bad';

/** null when the combination can be used, otherwise why not. A bare letter would fire while typing, so a modifier is required. */
export function hotkeyProblem(h: string): HotkeyProblem | null {
  const parts = h.split('+');
  const key = parts[parts.length - 1] ?? '';
  const mods = parts.slice(0, -1);
  if (!key || !mods.every((m) => ['Ctrl', 'Alt', 'Shift', 'Win'].includes(m)) || new Set(mods).size !== mods.length) return 'bad';
  if (mods.length === 0) return /^F([1-9]|1[0-9]|2[0-4])$/.test(key) ? null : 'no-modifier';
  if (mods.length === 1 && mods[0] === 'Shift') return 'no-modifier'; // Shift+letter is just typing
  if (RESERVED.some((r) => r.toLowerCase() === h.toLowerCase())) return 'reserved';
  return null;
}

export const HOTKEY_PROBLEM_TEXT: Record<HotkeyProblem, string> = {
  'no-modifier': 'Hold Ctrl, Alt or Win as well, or the shortcut would fire while you type.',
  reserved: 'Windows or most apps already use that one. Try another.',
  bad: 'That combination is not valid.',
};
