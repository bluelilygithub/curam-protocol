import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { estimateStrength } from '../../utils/passwordGen.mjs';
import { BTN, BTN_PRIMARY, CARD, CARD_STYLE, STATUS, SecretInput, StrengthMeter, Message } from './shared';

export const MIN_MASTER_LENGTH = 12;

/** What is wrong with a new master password, or '' when it is fine. */
export function masterProblem(pw, confirm) {
  if (pw.length < MIN_MASTER_LENGTH) return `Use at least ${MIN_MASTER_LENGTH} characters. A few ordinary words in a row work well and are easy to remember.`;
  if (estimateStrength(pw).level < 2) return 'That is too easy to guess. Try a longer phrase of several unrelated words.';
  if (pw !== confirm) return 'The two boxes do not match.';
  return '';
}

/** Create the master password (first visit). */
export function SetupForm({ vault }) {
  const getIcon = useIcon();
  const [pw, setPw] = useState('');
  const [again, setAgain] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = masterProblem(pw, again);

  const create = async () => {
    if (problem || !understood || busy) return;
    setBusy(true); setError('');
    try { await vault.setUp(pw); setPw(''); setAgain(''); } catch (e) { setError(e.message || 'Could not set up the vault.'); } finally { setBusy(false); }
  };

  return (
    <div className={CARD} style={CARD_STYLE} data-guide="master">
      <div className="flex items-center gap-2">
        {getIcon('lock', { size: 18 })}
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Make your master password</h2>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        One password opens everything in here. It is used on this device to lock each login before it is saved, and it is never sent to Vault.
      </p>
      <div className="space-y-3 max-w-md">
        <SecretInput value={pw} onChange={setPw} label="New master password" placeholder="New master password" autoComplete="new-password" autoFocus />
        <StrengthMeter password={pw} />
        <SecretInput value={again} onChange={setAgain} label="Type the master password again" placeholder="Type it again" autoComplete="new-password" onEnter={create} />
      </div>
      <div className="rounded-xl border p-3 text-sm leading-relaxed" style={{ borderColor: STATUS.warn, background: 'var(--color-bg)', color: 'var(--color-text)' }}>
        <strong>Vault cannot recover this password.</strong> If you forget it, your saved logins are gone for good and the only choice is to start again with an empty vault. Keep a copy somewhere safe that is not this computer.
      </div>
      <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} className="mt-1" />
        I understand that a forgotten master password cannot be recovered.
      </label>
      {pw && again && <Message>{problem}</Message>}
      <Message>{error}</Message>
      <Tooltip text="Lock the vault with this password. It takes about a second while your device makes the key.">
        <button type="button" onClick={create} disabled={busy || !!problem || !understood} className={BTN} style={BTN_PRIMARY}>
          {getIcon('lock', { size: 14 })}{busy ? 'Making your key…' : 'Create my vault'}
        </button>
      </Tooltip>
    </div>
  );
}

/** Type the master password to open the vault. */
export function UnlockForm({ vault, onForgot }) {
  const getIcon = useIcon();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const open = async () => {
    if (!pw || busy) return;
    setBusy(true); setError('');
    try {
      const ok = await vault.unlock(pw);
      if (ok) setPw(''); else setError('That is not your master password. Check it and try again.');
    } catch (e) { setError(e.message || 'Could not unlock.'); } finally { setBusy(false); }
  };

  return (
    <div className={CARD} style={CARD_STYLE} data-guide="master">
      <div className="flex items-center gap-2">
        {getIcon('lock', { size: 18 })}
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Your vault is locked</h2>
      </div>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>Type your master password to open it. It is checked on this device and never sent to Vault.</p>
      <div className="max-w-md space-y-3">
        <SecretInput value={pw} onChange={setPw} label="Master password" placeholder="Master password" onEnter={open} autoFocus />
        <Message>{error}</Message>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Open the vault. It takes about a second while your device checks the password.">
            <button type="button" onClick={open} disabled={busy || !pw} className={BTN} style={BTN_PRIMARY}>
              {getIcon('lock-open', { size: 14 })}{busy ? 'Checking…' : 'Unlock'}
            </button>
          </Tooltip>
          {onForgot && (
            <button type="button" onClick={onForgot} className="text-xs underline hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
              Forgot it?
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Whatever the vault needs before it can be used: loading, a problem, set up, or unlock. Renders nothing once it is open. */
export default function UnlockGate({ vault, onForgot }) {
  if (vault.loadError && !vault.status) {
    return <div className={CARD} style={CARD_STYLE}><Message>{vault.loadError}</Message><button type="button" className={BTN} style={BTN_PRIMARY} onClick={vault.reload}>Try again</button></div>;
  }
  if (!vault.status) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading your vault…</p>;
  if (!vault.status.setUp) return <SetupForm vault={vault} />;
  if (!vault.unlocked) return <UnlockForm vault={vault} onForgot={onForgot} />;
  return null;
}
