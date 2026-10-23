import React, { useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { taskPayload } from './noteAiActions.mjs';

/**
 * After a voice note is made: the to-dos found in what was said, each with a tick, so the ones that matter can go to Tasks in one tap.
 * Nothing is created until the person presses the button, and the note itself is never changed. `note` is the new note (for its project and
 * client); `onMade(n)` says how many tasks were made; `onClose` dismisses the panel.
 */
export default function VoiceTodosPanel({ todos, note, mobile, onMade, onClose }) {
  const getIcon = useIcon();
  const [items, setItems] = useState(() => todos.map((title) => ({ title, on: true })));
  const [making, setMaking] = useState(false);
  const [error, setError] = useState('');
  const chosen = items.filter((i) => i.on && i.title.trim());

  async function make() {
    setMaking(true);
    setError('');
    let made = 0;
    const left = [];
    for (const it of items) {
      if (!it.on || !it.title.trim()) { left.push(it); continue; }
      try {
        const res = await api.post('/api/tasks', taskPayload(it, note));
        if (!res.ok) throw new Error('create failed');
        made++;
      } catch { left.push(it); }
    }
    setMaking(false);
    if (made) onMade?.(made);
    if (left.some((i) => i.on && i.title.trim())) {
      setItems(left);
      setError(`${left.filter((i) => i.on).length} could not be created. Press the button to try those again.`);
      return;
    }
    onClose?.();
  }

  const btn = (primary) => ({ minHeight: mobile ? 48 : 36, background: primary ? 'var(--color-primary)' : 'var(--color-bg)', color: primary ? '#fff' : 'var(--color-text)', border: primary ? 'none' : '1px solid var(--color-border)' });
  return (
    <div className={`fixed inset-0 flex ${mobile ? 'items-end' : 'items-center'} justify-center z-50 ${mobile ? '' : 'p-4'}`} style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className={`${mobile ? 'rounded-t-2xl' : 'rounded-2xl'} p-5 max-w-md w-full shadow-xl space-y-3 max-h-full overflow-y-auto`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', paddingBottom: mobile ? 'max(20px, env(safe-area-inset-bottom))' : undefined }}
        role="dialog" aria-label="To-dos from your voice note"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{items.length === 1 ? 'A to-do' : `${items.length} to-dos`} in what you said</h3>
          <button type="button" aria-label="Close" onClick={onClose} className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', minWidth: mobile ? 40 : 24, minHeight: mobile ? 40 : 24 }}>{getIcon('x', { size: 18 })}</button>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Tick the ones to add to Tasks. They stay in the note either way.</p>
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={i} className="flex items-start gap-2">
              <input
                type="checkbox" checked={it.on} onChange={(e) => setItems((prev) => prev.map((p, j) => (j === i ? { ...p, on: e.target.checked } : p)))}
                aria-label={`Add "${it.title}" to Tasks`} style={{ width: 20, height: 20, marginTop: 6, accentColor: 'var(--color-primary)', flexShrink: 0 }}
              />
              <input
                value={it.title} onChange={(e) => setItems((prev) => prev.map((p, j) => (j === i ? { ...p, title: e.target.value } : p)))}
                aria-label="Task name" className="flex-1 min-w-0 rounded-lg px-2"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 44 : 32 }}
              />
            </li>
          ))}
        </ul>
        {error && <p className="text-xs" style={{ color: '#ef4444' }} role="alert">{error}</p>}
        <div className="flex gap-2">
          <Tooltip text={NOTE_TIPS.voiceTodosAdd}>
            <button type="button" disabled={making || !chosen.length} onClick={make} className="flex-1 px-3 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={btn(true)}>
              {making ? 'Adding…' : `Add ${chosen.length} to Tasks`}
            </button>
          </Tooltip>
          <button type="button" onClick={onClose} className="flex-1 px-3 rounded-lg text-sm hover:opacity-70 transition-opacity duration-200" style={btn(false)}>Not now</button>
        </div>
      </div>
    </div>
  );
}
