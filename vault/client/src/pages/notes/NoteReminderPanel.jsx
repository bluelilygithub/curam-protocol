import React, { useEffect, useState } from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { reminderState, formatReminder, quickOptions, toLocalInput, fromLocalInput } from './noteReminders.mjs';

/**
 * Set, snooze, clear or finish a note's reminder. A phone gets a bottom sheet, a bigger screen a centred card (like the other Notes dialogs).
 *   note        { remind_at, remind_email, reminder_done_at }
 *   onSet(iso, email)  save a time; returns '' when it worked or an error message to show
 *   onClear()          remove the reminder
 *   onDone()           mark it done
 */
export default function NoteReminderPanel({ note, mobile, onSet, onClear, onDone, onClose }) {
  const getIcon = useIcon();
  const state = reminderState(note);
  const [email, setEmail] = useState(state === 'none' || state === 'done' ? true : !!note.remind_email);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const options = quickOptions();
  const [custom, setCustom] = useState(() => toLocalInput((options.find((o) => o.id === 'tomorrow') || options[0]).at));

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function choose(when) {
    setBusy(true); setError('');
    try {
      const msg = await onSet(when.toISOString(), email);
      if (msg) setError(msg); else onClose();
    } finally { setBusy(false); }
  }

  function chooseCustom() {
    const when = fromLocalInput(custom);
    if (!when) { setError('Pick a date and time.'); return; }
    if (when.getTime() < Date.now()) { setError('Pick a time in the future.'); return; }
    choose(when);
  }

  const btn = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', minHeight: mobile ? 48 : 36 };
  const primary = { background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 48 : 36 };
  const heading = state === 'due' ? 'Snooze until' : state === 'upcoming' ? 'Change the time' : 'Remind me';

  return (
    <div className={`fixed inset-0 z-50 flex ${mobile ? 'items-end' : 'items-center'} justify-center`} style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className={`w-full max-w-sm flex flex-col shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: mobile ? 'max(16px, env(safe-area-inset-bottom))' : undefined }}
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Reminder"
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-primary)' }}>{getIcon('clock', { size: 18 })}</span>Reminder
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>
        </div>

        <div className="px-4 pb-3 overflow-y-auto flex-1 min-h-0 space-y-3">
          {state === 'due' && (
            <div className="rounded-lg p-3 text-sm" style={{ background: 'var(--color-bg)', border: '1px solid #f59e0b', color: 'var(--color-text)' }}>
              <p className="font-medium" style={{ color: '#f59e0b' }}>This reminder is due: {formatReminder(note.remind_at)}</p>
              <Tooltip text={NOTE_TIPS.reminderDone}>
                <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onDone(); setBusy(false); onClose(); }} className="mt-2 text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={primary}>Mark done</button>
              </Tooltip>
            </div>
          )}
          {state === 'upcoming' && <p className="text-sm" style={{ color: 'var(--color-text)' }}>Set for <strong>{formatReminder(note.remind_at)}</strong>{note.remind_email ? ', and an email will be sent.' : '.'}</p>}
          {state === 'done' && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>The last reminder was marked done. Set a new one below.</p>}

          <label className="flex items-center gap-2.5 text-sm cursor-pointer" style={{ color: 'var(--color-text)', minHeight: mobile ? 44 : undefined }}>
            <input type="checkbox" checked={email} onChange={(e) => setEmail(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--color-primary)' }} />
            Also email me when it is due
          </label>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>{heading}</p>
            <div className="grid grid-cols-2 gap-2">
              {options.map((o) => (
                <Tooltip key={o.id} text={state === 'due' ? NOTE_TIPS.reminderSnooze : NOTE_TIPS.reminderButton}>
                  <button type="button" disabled={busy} onClick={() => choose(o.at)} className="text-sm rounded-lg px-2 hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={btn}>{o.label}</button>
                </Tooltip>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Or pick a date and time</label>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local" value={custom} onChange={(e) => { setCustom(e.target.value); setError(''); }} aria-label="Reminder date and time"
                className="flex-1 min-w-0 rounded-lg px-2 outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 48 : 36 }}
              />
              <button type="button" disabled={busy} onClick={chooseCustom} className="text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={primary}>Set</button>
            </div>
          </div>

          {error && <p className="text-xs" style={{ color: '#ef4444' }} role="alert">{error}</p>}
        </div>

        {(state === 'upcoming' || state === 'due' || state === 'done') && (
          <div className="px-4 pt-2 flex-shrink-0">
            <button type="button" disabled={busy} onClick={async () => { setBusy(true); await onClear(); setBusy(false); onClose(); }} className="text-sm hover:opacity-70 transition-opacity duration-200 disabled:opacity-40" style={{ color: '#ef4444', minHeight: mobile ? 44 : 32 }}>Remove the reminder</button>
          </div>
        )}
      </div>
    </div>
  );
}
