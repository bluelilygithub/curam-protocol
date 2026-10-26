import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { briefTabLabel } from './format.mjs';

// The briefs written for one search, as tabs: flip between the first outline and a later angle without going back to the results.
// Hidden when there is only one. Refreshes when a brief is made, deleted or restored.
export default function BriefTabs({ runId, currentId, onOpen }) {
  const [briefs, setBriefs] = useState([]);
  const load = useCallback(async () => {
    if (!runId) return;
    try {
      const r = await api.get(`/api/topic-research/runs/${runId}/briefs`);
      const d = await r.json();
      if (r.ok && Array.isArray(d.briefs)) setBriefs(d.briefs);
    } catch { /* the tabs simply stay as they were */ }
  }, [runId]);
  useEffect(() => {
    load();
    window.addEventListener('topic-research:briefs-changed', load);
    return () => window.removeEventListener('topic-research:briefs-changed', load);
  }, [load, currentId]);

  if (briefs.length < 2) return null;
  const ordered = [...briefs].sort((a, b) => a.id - b.id); // oldest first: the first outline stays first
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Briefs written for this search" data-guide="brieftabs">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Briefs for this search:</span>
      {ordered.map((b) => {
        const current = b.id === currentId;
        return (
          <button
            key={b.id} type="button" aria-pressed={current} onClick={() => { if (!current) onOpen(b.id); }}
            title={`Made ${new Date(b.createdAt).toLocaleString()}`}
            className="px-2.5 py-1 rounded-full text-xs font-medium hover:opacity-70 transition-opacity"
            style={current ? { background: 'var(--color-primary)', color: '#fff' } : { border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          >{briefTabLabel(b)}</button>
        );
      })}
    </div>
  );
}
