import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { Card, Chip, InfoTip, Notice, PrimaryButton, SecondaryButton, inputCls } from './ui';
import { TIPS } from './tips';

const KINDS = [
  { id: 'morning', label: 'Morning plan', text: 'Your sessions for the day, only on days that have one.', hasTime: true },
  { id: 'catchup', label: 'Evening catch-up', text: 'One gentle note if today\'s plan is still open: log it or move it.', hasTime: true },
  { id: 'rerate', label: 'Re-rate nudge', text: 'A soft note when a re-rate is due, and a firmer one later. Once each.', hasTime: false },
];

const todayPlus = (days) => {
  const d = new Date(Date.now() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Reminder emails (all off until you switch them on), the link to Tasks, and adding Today to your phone. */
export default function RemindersCard() {
  const addToast = useToastStore((s) => s.addToast);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/api/fitness/reminders').then((r) => r.json()).then((d) => { if (live) { setData(d); setDraft(d.settings); } }).catch(() => {});
    return () => { live = false; };
  }, []);

  if (!data || !draft) return null;
  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setKind = (id, patch) => setDraft((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const paused = draft.pausedUntil && draft.pausedUntil >= todayPlus(0);

  const save = async () => {
    setSaving(true);
    try {
      const r = await api.put('/api/fitness/reminders', draft);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save');
      setData(d); setDraft(d.settings);
      addToast('Reminders saved', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async (kind) => {
    setTesting(kind);
    try {
      const r = await api.post('/api/fitness/reminders/test', { kind });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not send');
      addToast(`A test email is on its way to ${d.sentTo}`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setTesting('');
    }
  };

  return (
    <div className="space-y-5" data-tour="fitness-reminders">
      <Card title="Reminders" icon="bell" hint="Optional emails to keep you on track. All off until you switch them on, never on a rest day, and never a telling-off.">
        <InfoTip tip={TIPS.reminders} trigger="text" />
        {!data.emailConfigured && <Notice>Email is not set up on this server yet, so reminders cannot be sent.</Notice>}
        <div className="space-y-3">
          {KINDS.map((k) => (
            <div key={k.id} className="flex flex-wrap items-center gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="flex-1 min-w-[200px]">
                <p className="text-sm font-medium m-0" style={{ color: 'var(--color-text)' }}>{k.label}</p>
                <p className="text-xs m-0 mt-0.5" style={{ color: 'var(--color-muted)' }}>{k.text}</p>
              </div>
              {k.hasTime && draft[k.id].on && (
                <input
                  type="time"
                  value={draft[k.id].time}
                  onChange={(e) => setKind(k.id, { time: e.target.value })}
                  aria-label={`${k.label} time`}
                  className={`${inputCls} !w-auto`}
                />
              )}
              <Chip active={draft[k.id].on} onClick={() => setKind(k.id, { on: !draft[k.id].on })}>{draft[k.id].on ? 'On' : 'Off'}</Chip>
              {draft[k.id].on && data.emailConfigured && (
                <SecondaryButton onClick={() => test(k.id)} disabled={testing !== ''}>{testing === k.id ? 'Sending…' : 'Send me a test'}</SecondaryButton>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Chip active={!!paused} onClick={() => set({ pausedUntil: paused ? null : todayPlus(7) })}>{paused ? `Paused until ${draft.pausedUntil}` : 'Pause for a week'}</Chip>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Times are in your time zone from Settings. After three weeks with nothing logged, reminders stop by themselves; logging again turns them back on.
          </span>
        </div>
      </Card>

      <Card title="Tasks and Goals" icon="list-checks" hint="Your upcoming sessions can appear in your Tasks, and this week's progress in your Goals, so your day sits in one place.">
        <div className="flex flex-wrap items-center gap-3">
          <Chip active={draft.showInTasks} onClick={() => set({ showInTasks: !draft.showInTasks })}>{draft.showInTasks ? 'Showing my sessions in Tasks' : 'Not showing my sessions in Tasks'}</Chip>
          <InfoTip tip={TIPS.fitnessTasks} />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Chip active={draft.goalLink} onClick={() => set({ goalLink: !draft.goalLink })}>{draft.goalLink ? 'Showing my week in Goals' : 'Not showing my week in Goals'}</Chip>
          <InfoTip tip={TIPS.fitnessGoal} />
        </div>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Only today and later, one task per session. Moving a session moves its task, and they stay open or closed together: done in one is done in the other. A session you did not get to quietly drops out, never as an overdue task. Log the exercises themselves in Fitness.
        </p>
      </Card>

      <div className="flex justify-end">
        <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save reminders'}</PrimaryButton>
      </div>

      <Card title="Add Today to your phone" icon="smartphone" hint="Open Fitness on your phone and add it to your home screen, so Today is one tap away.">
        <ul className="text-sm space-y-1.5 leading-relaxed list-disc pl-5" style={{ color: 'var(--color-text)' }}>
          <li><strong>iPhone (Safari):</strong> tap Share, then Add to Home Screen.</li>
          <li><strong>Android (Chrome):</strong> open the menu, then Install app or Add to Home screen.</li>
        </ul>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>It opens straight to your Fitness plan for today, full screen.</p>
      </Card>
    </div>
  );
}
