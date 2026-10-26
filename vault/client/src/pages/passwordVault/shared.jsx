import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import useToastStore from '../../store/toastStore';
import { estimateStrength, normaliseOptions, DEFAULT_OPTIONS } from '../../utils/passwordGen.mjs';

export const FIELD = 'px-3 py-2.5 rounded-xl border text-sm outline-none';
export const FIELD_STYLE = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
export const BTN = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity duration-200 disabled:opacity-40';
export const BTN_PRIMARY = { background: 'var(--color-primary)', color: '#fff' };
export const BTN_OUTLINE = { border: '1px solid var(--color-border)', color: 'var(--color-text)', background: 'transparent' };
export const CARD = 'rounded-2xl border p-6 space-y-4';
export const CARD_STYLE = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
// Status colours are deliberately outside the theme (see client/DESIGN.md).
export const STATUS = { good: '#16a34a', warn: '#f59e0b', bad: '#ef4444' };
export const CLEAR_AFTER_MS = 30000;

const GEN_KEY = 'vault:passwordGenOptions';
export function loadGenOptions() {
  try { return normaliseOptions(JSON.parse(localStorage.getItem(GEN_KEY) || '{}')); } catch { return { ...DEFAULT_OPTIONS }; }
}
export function saveGenOptions(o) {
  try { localStorage.setItem(GEN_KEY, JSON.stringify(o)); } catch { /* private window: just not remembered */ }
}

let clearTimer = null;
/** Put a secret on the clipboard, then clear it after 30 seconds if the clipboard still holds it (never wipes something else the person copied). */
export async function copySecret(text, what = 'Password') {
  const toast = useToastStore.getState().addToast;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast('Your browser would not let Vault copy that.', 'error');
    return false;
  }
  toast(`${what} copied. It is cleared from the clipboard in 30 seconds.`, 'success');
  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(async () => {
    try {
      if ((await navigator.clipboard.readText()) === text) await navigator.clipboard.writeText('');
    } catch { /* reading the clipboard was not allowed: leave it alone rather than blank something else */ }
  }, CLEAR_AFTER_MS);
  return true;
}

/** Copy something that is not secret (a username, a web address). */
export async function copyPlain(text, what) {
  try { await navigator.clipboard.writeText(text); useToastStore.getState().addToast(`${what} copied.`, 'success'); } catch { useToastStore.getState().addToast('Your browser would not let Vault copy that.', 'error'); }
}

export function StrengthMeter({ password, label = 'Strength' }) {
  if (!password) return null;
  const s = estimateStrength(password);
  const color = s.level <= 1 ? STATUS.bad : s.level === 2 ? STATUS.warn : STATUS.good;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-1.5 w-6 rounded-full" style={{ background: i <= s.level ? color : 'var(--color-border)' }} />)}
      </div>
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}: <strong style={{ color }}>{s.label}</strong> <span title="A rough guess from length and variety. It cannot know if a password was leaked or is easy to guess.">(rough guess)</span></span>
    </div>
  );
}

/** A password box with an eye to show it. Deliberately no microphone: a spoken password would be sent to a speech service. */
export function SecretInput({ value, onChange, label, placeholder, onEnter, autoFocus, autoComplete = 'off', id, className = '' }) {
  const getIcon = useIcon();
  const [shown, setShown] = useState(false);
  return (
    <div className={`relative ${className}`}>
      <input
        id={id} type={shown ? 'text' : 'password'} className={`${FIELD} w-full pr-10 font-mono`} style={FIELD_STYLE}
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label}
        autoComplete={autoComplete} autoCapitalize="none" autoCorrect="off" spellCheck={false} autoFocus={autoFocus}
        onKeyDown={(e) => { if (e.key === 'Enter') onEnter?.(); }}
      />
      <Tooltip text={shown ? 'Hide it again.' : 'Show what you typed.'}>
        <button
          type="button" onClick={() => setShown((v) => !v)} aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-60 hover:opacity-100 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}
        >{getIcon(shown ? 'eye-off' : 'eye', { size: 16 })}</button>
      </Tooltip>
    </div>
  );
}

export function Message({ kind = 'bad', children }) {
  if (!children) return null;
  return <p className="text-sm leading-relaxed" role={kind === 'bad' ? 'alert' : undefined} style={{ color: STATUS[kind] }}>{children}</p>;
}
