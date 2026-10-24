import React, { useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { NOTE_TIPS } from './noteTips.mjs';
import { diffLines, diffStats, collapse } from './noteDiff.mjs';
import { STYLE_CHOICES, readPrefs } from './voiceNoteUtils.mjs';

/**
 * "Write this voice note up another way": the recording is not needed again, because the words that were said are kept at the bottom of the note.
 * The person picks a style, sees exactly what would change (red lines go, green lines come in), and only then applies it. Nothing is saved by this
 * panel: `onApply({ title, body, useTitle })` does that through the page's AI-change path, so Undo AI change and Earlier versions both bring the old text back.
 */
export default function VoiceRewritePanel({ noteId, currentTitle, currentBody, mobile, onApply, onClose }) {
  const getIcon = useIcon();
  const [style, setStyle] = useState(() => readPrefs(typeof localStorage !== 'undefined' ? localStorage : null).style);
  const [result, setResult] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const defaultTitle = /^Voice note, /.test(currentTitle || '');
  const [useTitle, setUseTitle] = useState(defaultTitle);

  async function preview() {
    setWorking(true);
    setError('');
    setResult(null);
    try {
      const res = await api.post(`/api/notes/${noteId}/rewrite`, { style });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'The write-up could not be made. Try again.');
      setResult(data);
    } catch (err) {
      setError(err.message || 'The write-up could not be made. Try again.');
    } finally {
      setWorking(false);
    }
  }

  const ops = useMemo(() => (result ? diffLines(currentBody, result.body) : []), [result, currentBody]);
  const stats = useMemo(() => diffStats(ops), [ops]);
  const shown = useMemo(() => collapse(ops, 1), [ops]);
  const unchanged = result && !stats.added && !stats.removed;
  const btn = { minHeight: mobile ? 44 : 32 };

  return (
    <div className={`fixed inset-0 flex ${mobile ? 'items-end' : 'items-center'} justify-center z-50 ${mobile ? '' : 'p-4'}`} style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div
        className={`${mobile ? 'rounded-t-2xl' : 'rounded-2xl'} w-full ${mobile ? '' : 'max-w-2xl'} shadow-xl flex flex-col`}
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: mobile ? '92dvh' : '80vh', paddingBottom: mobile ? 'env(safe-area-inset-bottom)' : undefined }}
        role="dialog" aria-label="Write this voice note up another way"
      >
        <div className="flex items-start justify-between gap-3 p-4 pb-2 flex-shrink-0">
          <div>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Write it up another way</h3>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Uses the words that were said, kept at the bottom of this note. You see what would change before anything does.</p>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="hover:opacity-60 transition-opacity duration-200" style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', minWidth: mobile ? 40 : 24, minHeight: mobile ? 40 : 24 }}>{getIcon('x', { size: 18 })}</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-2 space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex-1 min-w-0 text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
              Write it up as
              <Tooltip text={NOTE_TIPS.voiceRewriteStyle}>
                <select value={style} onChange={(e) => { setStyle(e.target.value); setResult(null); }} className="w-full rounded-lg px-2 text-sm" style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)', fontSize: 16, minHeight: mobile ? 48 : 36 }}>
                  {STYLE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Tooltip>
            </label>
            <button type="button" disabled={working} onClick={preview} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-50" style={{ ...btn, background: 'var(--color-primary)', color: '#fff', minHeight: mobile ? 48 : 36 }}>{working ? 'Writing it up…' : result ? 'Try again' : 'Show me'}</button>
          </div>
          {error && <p className="text-xs" style={{ color: '#ef4444' }} role="alert">{error}</p>}

          {result && (
            <>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {unchanged ? 'This would not change the note.' : `This would bring in ${stats.added} line${stats.added === 1 ? '' : 's'} and remove ${stats.removed}.`}
              </p>
              <div className="overflow-y-auto rounded-lg p-2" style={{ maxHeight: mobile ? 240 : 300, background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-text)', fontFamily: 'ui-monospace, monospace', fontSize: 12, lineHeight: 1.5 }} aria-label="What would change">
                {shown.map((o, i) => (o.type === 'gap'
                  ? <p key={i} style={{ color: 'var(--color-muted)', margin: '2px 0' }}>… {o.count} unchanged line{o.count === 1 ? '' : 's'}</p>
                  : (
                    <p key={i} className="whitespace-pre-wrap break-words" style={{ margin: 0, padding: '0 4px', background: o.type === 'add' ? 'rgba(34,197,94,0.15)' : o.type === 'del' ? 'rgba(239,68,68,0.15)' : 'transparent', textDecoration: o.type === 'del' ? 'line-through' : 'none' }}>
                      <span aria-hidden="true" style={{ color: 'var(--color-muted)' }}>{o.type === 'add' ? '+ ' : o.type === 'del' ? '- ' : '  '}</span>{o.text || ' '}
                    </p>
                  )))}
              </div>
              {result.title && result.title !== currentTitle && (
                <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}>
                  <input type="checkbox" checked={useTitle} onChange={(e) => setUseTitle(e.target.checked)} style={{ width: 18, height: 18, accentColor: 'var(--color-primary)' }} />
                  Use the new title too: {result.title}
                </label>
              )}
              <div className="flex gap-2">
                <Tooltip text={NOTE_TIPS.voiceRewriteApply}>
                  <button type="button" disabled={unchanged && !(useTitle && result.title !== currentTitle)} onClick={() => onApply({ title: result.title, body: result.body, useTitle })} className="px-4 rounded-lg text-sm font-medium hover:opacity-80 transition-opacity duration-200 disabled:opacity-40" style={{ ...btn, background: 'var(--color-primary)', color: '#fff' }}>Use this version</button>
                </Tooltip>
                <button type="button" onClick={onClose} className="px-4 rounded-lg text-sm hover:opacity-70 transition-opacity duration-200" style={{ ...btn, border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
