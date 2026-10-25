import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { costText, formatDate, mergeHistory, statusLabel } from './format.mjs';

// Status colours are deliberately outside the theme (see client/DESIGN.md).
const LEVEL = { good: '#16a34a', warn: '#f59e0b', bad: '#ef4444', info: 'var(--color-muted)' };
const FILTERS = [['all', 'All'], ['runs', 'Searches'], ['briefs', 'Briefs']];

// Every past search and brief, newest first. A search opens in the Results view (marked as an earlier search); a brief opens on the Brief page.
export default function HistoryPanel({ onOpenRun, onOpenBrief }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [data, setData] = useState(null); // { runs, briefs }
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.get(`/api/topic-research/history?type=${type}&q=${encodeURIComponent(q.trim())}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Could not load the history.');
        if (live) { setData(d); setError(''); }
      } catch (e) { if (live) { setError(e.message || 'Could not reach the server.'); setData((cur) => cur || { runs: [], briefs: [] }); } }
    }, q ? 250 : 0); // wait for a pause in typing
    return () => { live = false; clearTimeout(t); };
  }, [q, type]);

  const text = { color: 'var(--color-text)' };
  const muted = { color: 'var(--color-muted)' };
  const rows = data ? mergeHistory(data.runs, data.briefs) : [];

  return (
    <div className="space-y-4" data-guide="history">
      <div className="rounded-2xl border p-6 space-y-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-base font-semibold" style={text}>History</h2>
        <VoiceInput value={q} onChange={setQ} label="Search your history" placeholder="Search by topic or by a brief's angle" maxLength={120} />
        <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
          {FILTERS.map(([id, label]) => (
            <button
              key={id} type="button" aria-pressed={type === id} onClick={() => setType(id)}
              title={id === 'all' ? 'Show searches and briefs together' : `Show only ${label.toLowerCase()}`}
              className="px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity"
              style={type === id ? { background: 'var(--color-primary)', color: '#fff' } : { border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
            >{label}</button>
          ))}
        </div>
        {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}
      </div>

      {data === null && <p className="text-sm" style={muted}>Loading…</p>}
      {data && rows.length === 0 && (
        <p className="text-sm leading-relaxed" style={muted}>{q.trim() ? 'Nothing matches that.' : 'Nothing here yet. Searches and briefs you make will be listed here.'}</p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => {
          const st = r.kind === 'run' ? statusLabel(r.status) : null;
          return (
            <li key={`${r.kind}-${r.id}`}>
              <button
                type="button" onClick={() => (r.kind === 'run' ? onOpenRun(r.topicId, r.id) : onOpenBrief(r.id))}
                className="w-full text-left rounded-xl border p-4 hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
              >
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-semibold px-1.5 py-0.5 rounded" style={{ background: r.kind === 'run' ? 'var(--color-surface)' : 'var(--color-primary)', color: r.kind === 'run' ? 'var(--color-muted)' : '#fff', border: '1px solid var(--color-border)' }}>
                    {r.kind === 'run' ? 'Search' : 'Brief'}
                  </span>
                  <span className="text-sm font-medium break-words min-w-0" style={text}>{r.keyword}</span>
                  <span className="text-xs" style={muted}>{formatDate(r.when)}</span>
                </span>
                <span className="block text-xs mt-1" style={muted}>
                  {r.kind === 'run'
                    ? <>{r.articleCount} article{r.articleCount === 1 ? '' : 's'} · <span style={{ color: LEVEL[st.level] }}>{st.text}</span>{r.costUsd > 0 && <> · {costText(r.costUsd)}</>}</>
                    : <>{r.chosenAngle ? `Angle: ${r.chosenAngle} · ` : ''}{r.factCount} fact{r.factCount === 1 ? '' : 's'}{r.overlapCount > 0 && <> · {r.overlapCount} overlap warning{r.overlapCount === 1 ? '' : 's'}</>}{r.costUsd > 0 && <> · {costText(r.costUsd)}</>}</>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
