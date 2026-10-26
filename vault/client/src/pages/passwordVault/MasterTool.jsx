import React, { useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import useProcessingStore from '../../store/processingStore';
import useToastStore from '../../store/toastStore';
import usePasswordVaultStore, { AUTO_LOCK_CHOICES, getAutoLockMinutes, setAutoLockMinutes } from '../../store/passwordVaultStore';
import UnlockGate, { SetupForm, UnlockForm, masterProblem } from './UnlockGate';
import { BTN, BTN_OUTLINE, BTN_PRIMARY, CARD, CARD_STYLE, FIELD, FIELD_STYLE, Message, STATUS, SecretInput, StrengthMeter } from './shared';

const RESET_PHRASE = 'DELETE EVERYTHING';

function ChangeMaster({ vault }) {
  const getIcon = useIcon();
  const { startProcessing, stopProcessing } = useProcessingStore();
  const toast = useToastStore((s) => s.addToast);
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const problem = masterProblem(newPw, again);

  const change = async () => {
    if (!oldPw || problem || busy) return;
    setBusy(true); setError('');
    startProcessing('Locking your passwords with the new master password…', `Re-encrypting ${vault.rows.length} login${vault.rows.length === 1 ? '' : 's'} on this device. Please don't close this page.`);
    try {
      const ok = await vault.changeMaster(oldPw, newPw);
      if (!ok) { setError('The current master password is not right.'); return; }
      setOldPw(''); setNewPw(''); setAgain('');
      toast('Master password changed ✓', 'success');
    } catch (e) {
      setError(e.code === 'LIST_CHANGED' || e.code === 'KEY_CHANGED' ? `${e.message}` : (e.message || 'Could not change the master password. Nothing was changed.'));
    } finally { stopProcessing(); setBusy(false); }
  };

  return (
    <div className={CARD} style={CARD_STYLE} data-guide="change-master">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Change master password</h2>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
        Every saved login is unlocked and locked again with the new password, on this device. If anything goes wrong, nothing is changed. Logins already in the Recycle bin cannot be put back afterwards.
      </p>
      <div className="max-w-md space-y-3">
        <SecretInput value={oldPw} onChange={setOldPw} label="Current master password" placeholder="Current master password" />
        <SecretInput value={newPw} onChange={setNewPw} label="New master password" placeholder="New master password" autoComplete="new-password" />
        <StrengthMeter password={newPw} />
        <SecretInput value={again} onChange={setAgain} label="Type the new master password again" placeholder="Type the new one again" autoComplete="new-password" onEnter={change} />
        {newPw && again && <Message>{problem}</Message>}
        <Message>{error}</Message>
        <button type="button" onClick={change} disabled={busy || !oldPw || !!problem} className={BTN} style={BTN_PRIMARY}>{getIcon('key-round', { size: 14 })}Change master password</button>
      </div>
    </div>
  );
}

function EraseVault({ vault, startOpen }) {
  const getIcon = useIcon();
  const toast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(startOpen);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const erase = async () => {
    if (phrase !== RESET_PHRASE || busy) return;
    setBusy(true); setError('');
    try { await vault.eraseAll(); setPhrase(''); setOpen(false); toast('The vault was erased. You can make a new master password.', 'success'); } catch (e) { setError(e.message || 'Could not erase the vault.'); } finally { setBusy(false); }
  };

  return (
    <div className={CARD} style={{ ...CARD_STYLE, borderColor: open ? STATUS.bad : 'var(--color-border)' }} data-guide="reset-vault" id="vault-erase">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-left text-base font-semibold hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-text)' }}>
        {open ? '▼' : '▶'} Forgot your master password?
      </button>
      {open && (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
            Vault cannot get your passwords back: it never had the key, and neither does anyone else. The only way forward is to <strong>erase every saved login for good</strong> and start again with a new master password.
          </p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>This cannot be undone and does not use the Recycle bin. Type <strong>{RESET_PHRASE}</strong> to confirm.</p>
          <input className={`${FIELD} w-full max-w-md`} style={FIELD_STYLE} value={phrase} onChange={(e) => setPhrase(e.target.value)} aria-label={`Type ${RESET_PHRASE} to confirm`} placeholder={RESET_PHRASE} autoComplete="off" spellCheck={false} />
          <Message>{error}</Message>
          <button type="button" onClick={erase} disabled={busy || phrase !== RESET_PHRASE} className={BTN} style={{ background: STATUS.bad, color: '#fff' }}>{getIcon('trash', { size: 14 })}{busy ? 'Erasing…' : 'Erase and start again'}</button>
        </div>
      )}
    </div>
  );
}

export default function MasterTool({ vault, openErase }) {
  const getIcon = useIcon();
  const lock = usePasswordVaultStore((s) => s.lock);
  const [minutes, setMinutes] = useState(getAutoLockMinutes);

  if (!vault.status) return <UnlockGate vault={vault} />;
  if (!vault.status.setUp) return <SetupForm vault={vault} />;

  return (
    <div className="space-y-4">
      {vault.unlocked ? (
        <div className={CARD} style={CARD_STYLE}>
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 text-base font-semibold" style={{ color: STATUS.good }}>{getIcon('lock-open', { size: 18 })}Unlocked</span>
            <Tooltip text="Lock the vault now. The key is forgotten, so your master password is needed again to read anything.">
              <button type="button" onClick={lock} className={BTN} style={BTN_PRIMARY} data-guide="lock-now">{getIcon('lock', { size: 14 })}Lock now</button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <UnlockForm vault={vault} />
      )}

      <div className={CARD} style={CARD_STYLE} data-guide="auto-lock">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Auto-lock</h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>The vault locks itself after this long with no clicking, typing or scrolling, wherever you are in Vault. It also locks when you reload the page or sign out. This choice is remembered on this browser only.</p>
        <Tooltip text="How long the vault stays open when you are not using it.">
          <select className={FIELD} style={FIELD_STYLE} value={minutes} aria-label="Lock after" onChange={(e) => { const n = Number(e.target.value); setMinutes(n); setAutoLockMinutes(n); }}>
            {AUTO_LOCK_CHOICES.map((n) => <option key={n} value={n}>Lock after {n} minute{n === 1 ? '' : 's'}</option>)}
          </select>
        </Tooltip>
      </div>

      {vault.unlocked && <ChangeMaster vault={vault} />}
      <EraseVault vault={vault} startOpen={!!openErase} />
    </div>
  );
}
