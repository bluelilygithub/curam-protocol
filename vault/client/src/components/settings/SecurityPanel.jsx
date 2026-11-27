import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../Tooltip';
import Skeleton from '../Skeleton';
import EmptyState from '../EmptyState';
import ToolInfoModal, { useToolInfoModal } from '../ToolInfoModal';
import { relativeTime } from '../../utils/relativeTime';
import { BackupCodes, CodeInput } from '../../pages/login/AdminSecondStep';

/**
 * Settings -> Security (docs/two-step-login.md, Milestone 4): authenticator status and backup codes (admins), remembered devices,
 * and signing out other sessions. Nothing here ever signs out the session you are using.
 */

const HOW_IT_WORKS = [
  ['Two-step login', 'After your password, Vault asks for a second step. Members get a 6-digit code by email, only on a device Vault does not remember. Admins always use an authenticator app on their phone.'],
  ['Remembered devices', 'Ticking "Remember this device" at sign-in skips the second step on that browser: 30 days for members, 7 for admins. Forget a device you no longer use, or one you signed in on by mistake. Its next sign-in will ask for a code again.'],
  ['Backup codes (admins)', 'Ten single-use codes for when your phone is lost. Regenerating them needs a current authenticator code, and the old ones stop working at once.'],
  ['Sign out other sessions', 'Ends every other place you are signed in, such as another browser or a phone. This page stays signed in.'],
  ['Locked out?', 'Another admin can reset your two-step login from Dashboard. A new password also forgets every remembered device.'],
];

const box = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
const btn = 'px-3 py-1.5 rounded-lg text-xs border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const btnStyle = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const dateText = (d) => new Date(d).toLocaleDateString();

export default function SecurityPanel() {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const info = useToolInfoModal('vault_security_info_seen');
  const [state, setState] = useState('loading'); // loading | ready | off | error
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirmForget, setConfirmForget] = useState(null); // device id, or 'all'
  const [regen, setRegen] = useState(null); // null | { code, error } while asking | { codes } once made

  const load = useCallback(async () => {
    try {
      const res = await api.get('/api/auth/security');
      if (res.status === 403) { setState('off'); return; }
      if (!res.ok) throw new Error();
      setData(await res.json());
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(call, okText) {
    setBusy(true);
    try {
      const res = await call();
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { addToast(body.error || 'That did not work. Try again.', 'error'); return; }
      addToast(okText(body), 'success');
      await load();
    } catch {
      addToast('That did not work. Try again.', 'error');
    } finally {
      setBusy(false);
      setConfirmForget(null);
    }
  }

  async function regenerate(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.post('/api/auth/backup-codes/regenerate', { code: regen.code });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setRegen({ code: '', error: body.error || 'That did not work. Try again.' }); return; }
      setRegen({ codes: body.backupCodes });
    } catch {
      setRegen({ code: '', error: 'That did not work. Try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <Skeleton lines={4} label="Loading security settings" />;
  if (state === 'off') return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Security settings are not available for a read-only login.</p>;
  if (state === 'error') {
    return (
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Could not load your security settings. <button type="button" className="underline hover:opacity-70 transition-opacity duration-200" onClick={load}>Try again</button>
      </p>
    );
  }

  const inlineConfirm = (id, label, onYes) => (confirmForget === id ? (
    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
      {label}
      <button type="button" disabled={busy} onClick={onYes} className="px-2 py-1 rounded-md text-white disabled:opacity-50 hover:opacity-70 transition-opacity duration-200" style={{ background: '#ef4444' }}>Yes</button>
      <button type="button" onClick={() => setConfirmForget(null)} className={btn} style={btnStyle}>No</button>
    </span>
  ) : null);

  return (
    <div className="space-y-5 max-w-3xl" data-tour="security-section">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          How you sign in, the browsers Vault remembers for you, and the other places you are signed in.
        </p>
        <Tooltip text="How two-step login, remembered devices and backup codes work">
          <button type="button" onClick={info.open} aria-label="How this works" className="p-1 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
            {getIcon('info', { size: 16 })}
          </button>
        </Tooltip>
      </div>

      {data.isAdmin && (
        <section className="rounded-2xl border p-5 space-y-3" style={box}>
          <div className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('shield-check', { size: 16 })}
            <h3 className="text-sm font-semibold">Authenticator app</h3>
          </div>
          {data.authenticatorSince ? (
            <>
              <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                Set up {dateText(data.authenticatorSince)}. <span style={{ color: data.backupCodesLeft <= 3 ? '#f59e0b' : 'var(--color-muted)' }}>
                  {data.backupCodesLeft} of 10 backup codes left.</span>
              </p>
              {regen?.codes ? (
                <BackupCodes codes={regen.codes} continueLabel="Done" continueTip="Close the codes; they cannot be shown again"
                  onContinue={() => { setRegen(null); load(); }} />
              ) : regen ? (
                <form onSubmit={regenerate} className="space-y-2 max-w-xs">
                  <label htmlFor="regen-code" className="block text-xs" style={{ color: 'var(--color-muted)' }}>Current code from your authenticator app</label>
                  <CodeInput id="regen-code" value={regen.code} onChange={(code) => setRegen({ code, error: '' })}
                    hint="The 6-digit code your authenticator app shows for Curam Vault right now" />
                  {regen.error && <p className="text-xs" role="alert" style={{ color: '#ef4444' }}>{regen.error}</p>}
                  <div className="flex gap-2">
                    <Tooltip text="Make 10 new codes. Your old codes stop working.">
                      <button type="submit" disabled={busy || regen.code.length !== 6} className={btn} style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)', borderColor: 'var(--color-primary)' }}>
                        Make new codes
                      </button>
                    </Tooltip>
                    <Tooltip text="Keep your current backup codes">
                      <button type="button" onClick={() => setRegen(null)} className={btn} style={btnStyle}>Cancel</button>
                    </Tooltip>
                  </div>
                </form>
              ) : (
                <Tooltip text="Make 10 new backup codes (needs a current authenticator code). The old ones stop working.">
                  <button type="button" onClick={() => setRegen({ code: '', error: '' })} className={`${btn} flex items-center gap-1.5`} style={btnStyle}>
                    {getIcon('refresh-cw', { size: 13 })}Regenerate backup codes
                  </button>
                </Tooltip>
              )}
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Not set up yet. You will be asked to set it up at your next sign-in.</p>
          )}
        </section>
      )}

      <section className="rounded-2xl border p-5 space-y-3" style={box}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('monitor', { size: 16 })}
            <h3 className="text-sm font-semibold">Remembered devices</h3>
          </div>
          {data.devices.length > 0 && (confirmForget === 'all' ? (
            inlineConfirm('all', 'Forget every device?', () => act(() => api.post('/api/auth/devices/forget-all', {}), (b) => `${b.removed} device${b.removed === 1 ? '' : 's'} forgotten. You stay signed in here.`))
          ) : (
            <Tooltip text="Every browser will ask for a code at its next sign-in. You stay signed in here.">
              <button type="button" disabled={busy} onClick={() => setConfirmForget('all')} className={btn} style={btnStyle}>Forget all devices</button>
            </Tooltip>
          ))}
        </div>
        {data.devices.length === 0 ? (
          <EmptyState icon="monitor" title="No remembered devices" body={'Tick "Remember this device" when you sign in to skip the code on that browser.'} />
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
            {data.devices.map((d) => (
              <li key={d.id} className="py-2.5 flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: 'var(--color-border)' }}>
                <div className="min-w-0">
                  <div className="text-sm" style={{ color: 'var(--color-text)' }}>
                    {d.label || 'A browser'}{d.current && <span className="ml-2 text-xs" style={{ color: 'var(--color-primary)' }}>This browser</span>}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Last used {d.lastUsedAt ? relativeTime(d.lastUsedAt) : 'never'} · expires {dateText(d.expiresAt)}
                  </div>
                </div>
                {confirmForget === d.id ? (
                  inlineConfirm(d.id, 'Forget?', () => act(() => api.delete(`/api/auth/devices/${d.id}`), () => `${d.label || 'Device'} forgotten.`))
                ) : (
                  <Tooltip text="This browser will ask for a code at its next sign-in. It does not sign it out.">
                    <button type="button" disabled={busy} onClick={() => setConfirmForget(d.id)} className={btn} style={btnStyle}>Forget</button>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border p-5 flex items-center justify-between gap-3 flex-wrap" style={box}>
        <div>
          <div className="flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('log-out', { size: 16 })}
            <h3 className="text-sm font-semibold">Other sessions</h3>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
            {data.otherSessions === 0 ? 'You are signed in only here.' : `Signed in ${data.otherSessions} other time${data.otherSessions === 1 ? '' : 's'} (other browsers or devices).`}
          </p>
        </div>
        <Tooltip text="End every session except this one. This page stays signed in.">
          <button type="button" disabled={busy || data.otherSessions === 0}
            onClick={() => act(() => api.post('/api/auth/sessions/sign-out-others', {}), (b) => `Signed out ${b.removed} other session${b.removed === 1 ? '' : 's'}.`)}
            className={btn} style={btnStyle}>
            Sign out other sessions
          </button>
        </Tooltip>
      </section>

      {info.show && (
        <ToolInfoModal title="How sign-in security works" onClose={info.close}>
          {HOW_IT_WORKS.map(([title, body]) => (
            <div key={title}>
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{body}</p>
            </div>
          ))}
        </ToolInfoModal>
      )}
    </div>
  );
}
