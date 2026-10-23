import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import { AI_ACTIONS, todayLocal, taskPayload } from './noteAiActions.mjs';

/**
 * The result of one AI action on the open note (summary, to-dos, tidy-up, title). The AI only proposes: nothing changes until the
 * person presses one of the buttons here. A phone gets a bottom sheet, a bigger screen a centred card.
 *   ensureSaved()          saves the note first, so the AI reads what is on screen
 *   onApplyText(mode, t)   mode 'top' | 'replace' | 'bottom'
 *   onApplyTitle(t)
 *   onApplyTags(tags)      the chosen new tags (the page adds them to the note's tags)
 *   onTasksMade(n)         after tasks were created from the to-do list
 */
export default function NoteAiPanel({ action, note, mobile, ensureSaved, onApplyText, onApplyTitle, onApplyTags, onTasksMade, onClose }) {
  const getIcon = useIcon();
  const meta = AI_ACTIONS.find((a) => a.id === action);
  const [state, setState] = useState('working'); // working | ready | error
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [items, setItems] = useState([]); // to-dos: { title, due, who, on, made }
  const [off, setOff] = useState([]); // suggested tags the person unticked
  const [making, setMaking] = useState(false);
  const [copied, setCopied] = useState(false);
  const run = useRef(0);

  const start = useCallback(async () => {
    const mine = ++run.current;
    setState('working'); setError(''); setResult(null);
    try {
      await ensureSaved();
      const res = await api.post(`/api/notes/${note.id}/ai`, { action, today: todayLocal() });
      const data = await res.json().catch(() => ({}));
      if (mine !== run.current) return;
      if (!res.ok) { setError(data.error || 'The AI could not do that just now. Try again.'); setState('error'); return; }
      setResult(data);
      if (action === 'title') setTitleDraft(data.title || '');
      if (action === 'todos') setItems((data.items || []).map((i) => ({ ...i, on: true, made: false })));
      setState('ready');
    } catch {
      if (mine !== run.current) return;
      setError('The AI could not be reached. Try again.');
      setState('error');
    }
  }, [action, note.id, ensureSaved]);

  useEffect(() => { start(); return () => { run.current++; }; }, [start]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const text = result?.text ?? result?.body ?? '';
  const chosen = items.filter((i) => i.on && !i.made && i.title.trim());
  // suggested tags the note does not have yet, minus any the person unticked
  const tagChoices = (result?.tags || []).filter((t) => !(note.tags || []).includes(t));
  const tagPicks = tagChoices.filter((t) => !off.includes(t));
  const madeCount = items.filter((i) => i.made).length;

  async function makeTasks() {
    setMaking(true);
    let made = 0;
    let failed = 0;
    for (const it of chosen) {
      try {
        const res = await api.post('/api/tasks', taskPayload(it, note));
        if (!res.ok) throw new Error('create failed');
        made++;
        setItems((prev) => prev.map((p) => (p === it ? { ...p, made: true } : p)));
      } catch { failed++; }
    }
    setMaking(false);
    if (made) onTasksMade(made);
    if (failed) setError(`${failed} task${failed === 1 ? '' : 's'} could not be created. Press the button to try those again.`);
  }

  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard: the text is selectable */ }
  }

  const btn = (primary) => ({
    minHeight: mobile ? 48 : 36,
    background: primary ? 'var(--color-primary)' : 'var(--color-bg)',
    color: primary ? '#fff' : 'var(--color-text)',
    border: primary ? 'none' : '1px solid var(--color-border)',
  });
  const btnClass = 'text-sm font-medium px-4 rounded-lg hover:opacity-80 transition-opacity duration-200 disabled:opacity-40';
  const input = { background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 44 : 32 };

  return (
    <div className={`fixed inset-0 z-50 flex ${mobile ? 'items-end' : 'items-center'} justify-center`} style={{ background: 'rgba(0,0,0,0.4)' }} onClick={onClose}>
      <div
        className={`w-full max-w-lg flex flex-col shadow-xl ${mobile ? 'rounded-t-2xl' : 'rounded-2xl m-4'}`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: '85dvh', paddingBottom: mobile ? 'max(16px, env(safe-area-inset-bottom))' : undefined }}
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label={meta.label} aria-busy={state === 'working'}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-2 flex-shrink-0">
          <h3 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <span style={{ color: 'var(--color-primary)' }}>{getIcon(meta.icon, { size: 18 })}</span>{meta.label}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close" className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', minWidth: 40, minHeight: 40 }}>{getIcon('x', { size: 18 })}</button>
        </div>

        <div className="px-4 pb-3 overflow-y-auto flex-1 min-h-0">
          {state === 'working' && (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--color-muted)' }}>{meta.working}</p>
          )}
          {state === 'error' && (
            <div className="py-3 text-sm" style={{ color: '#ef4444' }} role="alert">{error}</div>
          )}

          {state === 'ready' && action === 'title' && (
            <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>Suggested title (you can change it)
              <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} maxLength={80} className="w-full rounded-lg px-3 mt-1 outline-none" style={input} />
            </label>
          )}

          {state === 'ready' && (action === 'summary' || action === 'tidy') && (
            <>
              {action === 'tidy' && <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Check it before you use it. Your note is not changed until you choose.</p>}
              <div className="text-sm rounded-lg p-3 whitespace-pre-wrap select-text" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', maxHeight: '45dvh', overflowY: 'auto' }}>{text}</div>
            </>
          )}

          {state === 'ready' && action === 'todos' && (
            items.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--color-muted)' }}>No to-dos found in this note.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((it, i) => (
                  <li key={i} className="rounded-lg p-2.5" style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', opacity: it.made ? 0.6 : 1 }}>
                    <div className="flex items-start gap-2.5">
                      <input
                        type="checkbox" checked={it.on || it.made} disabled={it.made} aria-label={`Make a task: ${it.title}`}
                        onChange={(e) => setItems((prev) => prev.map((p, j) => (j === i ? { ...p, on: e.target.checked } : p)))}
                        style={{ width: 20, height: 20, marginTop: 6, accentColor: 'var(--color-primary)', flexShrink: 0 }}
                      />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <input
                          value={it.title} disabled={it.made} aria-label="Task title"
                          onChange={(e) => setItems((prev) => prev.map((p, j) => (j === i ? { ...p, title: e.target.value } : p)))}
                          className="w-full rounded px-2 outline-none" style={input}
                        />
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-muted)' }}>Due
                            <input
                              type="date" value={it.due || ''} disabled={it.made}
                              onChange={(e) => setItems((prev) => prev.map((p, j) => (j === i ? { ...p, due: e.target.value || null } : p)))}
                              className="rounded px-2 outline-none" style={{ ...input, minHeight: mobile ? 40 : 28 }}
                            />
                          </label>
                          {it.who && <span className="text-xs rounded px-1.5 py-0.5" style={{ border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}>For {it.who}</span>}
                          {it.made && <span className="text-xs" style={{ color: '#22c55e' }}>✓ Task created</span>}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
          {state === 'ready' && action === 'tags' && (
            tagChoices.length === 0 ? (
              <p className="text-sm py-4 text-center" style={{ color: 'var(--color-muted)' }}>This note already has the tags that fit.</p>
            ) : (
              <>
                <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Untick any you do not want. Tags you already use are reused where they fit.</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Suggested tags">
                  {tagChoices.map((t) => {
                    const on = !off.includes(t);
                    return (
                      <button
                        key={t} type="button" aria-pressed={on}
                        onClick={() => setOff((prev) => (on ? [...prev, t] : prev.filter((x) => x !== t)))}
                        className="text-sm px-3 rounded-full transition-opacity duration-200 hover:opacity-80"
                        style={{ minHeight: mobile ? 40 : 30, background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-text)', border: `1px solid ${on ? 'var(--color-primary)' : 'var(--color-border)'}` }}
                      >{on ? '✓ ' : ''}{t}</button>
                    );
                  })}
                </div>
              </>
            )
          )}
          {state === 'ready' && error && <p className="text-xs mt-2" style={{ color: '#ef4444' }} role="alert">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-2 flex-shrink-0">
          {state === 'error' && (
            <>
              <button type="button" onClick={onClose} className={btnClass} style={btn(false)}>Close</button>
              <button type="button" onClick={start} className={btnClass} style={btn(true)}>Try again</button>
            </>
          )}
          {state === 'ready' && action === 'summary' && (
            <>
              <button type="button" onClick={copy} className={btnClass} style={btn(false)}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" onClick={() => { onApplyText('top', `Summary:\n${text}`); onClose(); }} className={btnClass} style={btn(true)}>Add to top of note</button>
            </>
          )}
          {state === 'ready' && action === 'tidy' && (
            <>
              <button type="button" onClick={copy} className={btnClass} style={btn(false)}>{copied ? 'Copied' : 'Copy'}</button>
              <button type="button" onClick={() => { onApplyText('bottom', text); onClose(); }} className={btnClass} style={btn(false)}>Add below note</button>
              <button type="button" onClick={() => { onApplyText('replace', text); onClose(); }} className={btnClass} style={btn(true)}>Replace note text</button>
            </>
          )}
          {state === 'ready' && action === 'title' && (
            <>
              <button type="button" onClick={onClose} className={btnClass} style={btn(false)}>Cancel</button>
              <button type="button" disabled={!titleDraft.trim()} onClick={() => { onApplyTitle(titleDraft.trim()); onClose(); }} className={btnClass} style={btn(true)}>Use this title</button>
            </>
          )}
          {state === 'ready' && action === 'tags' && (
            <>
              <button type="button" onClick={onClose} className={btnClass} style={btn(false)}>Cancel</button>
              {tagChoices.length > 0 && (
                <button type="button" disabled={tagPicks.length === 0} onClick={() => { onApplyTags(tagPicks); onClose(); }} className={btnClass} style={btn(true)}>
                  Add {tagPicks.length} tag{tagPicks.length === 1 ? '' : 's'}
                </button>
              )}
            </>
          )}
          {state === 'ready' && action === 'todos' && (
            <>
              <button type="button" onClick={onClose} className={btnClass} style={btn(false)}>{madeCount ? 'Done' : 'Cancel'}</button>
              {items.length > 0 && (
                <button type="button" disabled={making || chosen.length === 0} onClick={makeTasks} className={btnClass} style={btn(true)}>
                  {making ? 'Creating…' : `Create ${chosen.length} task${chosen.length === 1 ? '' : 's'}`}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
