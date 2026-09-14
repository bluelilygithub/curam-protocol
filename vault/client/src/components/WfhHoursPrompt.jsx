import { useState, useEffect } from 'react';
import api from '../utils/apiClient';
import Tooltip from './Tooltip';

// Global daily popup prompting for yesterday's (and any recent unfilled) work-from-home hours —
// a SEPARATE, purely diary/substantiation record from the periodic dollar-deduction "Save Hours"
// flow on the Home Office card (fin_home_office_daily_log has zero journal/accounting impact).
// Mounted once in Layout.jsx, gated behind canUseFeature('finance'), same pattern as
// ProcessingModal/TaskReminderModal being rendered once globally. See docs/finance.md.
//
// Weekends are never queued server-side (GET /home-office-daily-log/gaps only ever returns
// weekdays) and the whole feature no-ops (empty gaps array) unless `fixed_rate` is the locked
// home-office method for the relevant financial year — both enforced server-side, not here.
//
// Shown at most once per calendar day per browser (localStorage flag keyed by today's date) so
// it doesn't reappear on every page navigation within the same day, but checks again next day.
const SHOWN_FLAG_KEY = 'vault:wfhPromptShownDate';

function formatFriendly(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

export default function WfhHoursPrompt({ enabled }) {
  const [queue, setQueue] = useState([]); // array of date strings, oldest first
  const [hoursInput, setHoursInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    let alreadyShownToday = false;
    try { alreadyShownToday = localStorage.getItem(SHOWN_FLAG_KEY) === todayKey; } catch { /* ignore */ }
    if (alreadyShownToday) return;

    api.get('/api/finance/home-office-daily-log/gaps')
      .then(r => r.json())
      .then(gaps => {
        if (Array.isArray(gaps) && gaps.length) {
          setQueue(gaps);
          try { localStorage.setItem(SHOWN_FLAG_KEY, todayKey); } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, [enabled]);

  if (!enabled || dismissed || !queue.length) return null;

  const currentDate = queue[0];

  const save = async (hoursValue) => {
    const hoursNum = parseFloat(hoursValue);
    if (!Number.isFinite(hoursNum) || hoursNum < 0) {
      setError('Enter a number of hours 0 or greater');
      return;
    }
    setSaving(true); setError('');
    try {
      const res = await api.post('/api/finance/home-office-daily-log', {
        date: currentDate,
        hours: hoursNum,
        source: 'popup',
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to save');
      setHoursInput('');
      setQueue(q => q.slice(1));
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.4)' }}
    >
      <div
        className="rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="font-semibold text-base" style={{ color: 'var(--color-text)' }}>
            Work-from-home hours
          </h3>
          <Tooltip text="Close this — nothing already saved is lost, and you'll be re-prompted next time for whatever's still unfilled within the last 14 days.">
            <button
              onClick={() => setDismissed(true)}
              style={{ color: 'var(--color-muted)' }}
              className="hover:opacity-60 transition-opacity flex-shrink-0"
            >
              ✕
            </button>
          </Tooltip>
        </div>

        <p className="text-sm mb-1" style={{ color: 'var(--color-text)' }}>
          How many hours did you work from home on <span className="font-semibold">{formatFriendly(currentDate)}</span>?
        </p>
        <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
          This is a daily substantiation diary only — it doesn't post any deduction. Enter your periodic
          totals into the Home Office card's "Save Hours" as before to claim the actual expense.
          {queue.length > 1 ? ` ${queue.length} days need an answer.` : ''}
        </p>

        <div className="flex items-center gap-2 mb-3">
          <Tooltip text="Hours worked from home on this date — decimals allowed, e.g. 7.5">
            <input
              type="number"
              min="0"
              step="0.25"
              value={hoursInput}
              onChange={e => setHoursInput(e.target.value)}
              placeholder="0"
              className="text-sm px-3 py-2 rounded-lg border flex-1"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
            />
          </Tooltip>
          <Tooltip text="Save these hours and move to the next unfilled day, if any">
            <button
              onClick={() => save(hoursInput)}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
              style={{ background: 'var(--color-primary)' }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </Tooltip>
        </div>

        {error && <p className="text-xs mb-3" style={{ color: '#ef4444' }}>{error}</p>}

        <Tooltip text="Quickly log this date as 0 hours — a valid, explicit answer meaning you didn't work from home that day">
          <button
            onClick={() => save('0')}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
          >
            Didn't work from home that day (0 hours)
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
