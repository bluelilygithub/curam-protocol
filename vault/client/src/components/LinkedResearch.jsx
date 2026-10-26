import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';

// The research (Topic Research) done for a client or a project, shown on that client's or project's own page, each item opening Topic Research.
// Quiet by design: nothing is drawn when the tool is off for the person or the request fails. Pass exactly one of clientId / projectId.

/** The linked topics (with their briefs and drafts), or null while loading or when the tool is not available to this person. */
export function useLinkedResearch({ clientId = null, projectId = null }) {
  const [topics, setTopics] = useState(null);
  useEffect(() => {
    let live = true;
    setTopics(null);
    (async () => {
      try {
        const q = clientId ? `clientId=${clientId}` : projectId ? `projectId=${projectId}` : '';
        if (!q) return;
        const r = await api.get(`/api/topic-research/linked?${q}`);
        if (!r.ok) return; // 403 when the tool is off for this person: draw nothing
        const d = await r.json();
        if (live && Array.isArray(d.topics)) setTopics(d.topics);
      } catch { /* the section is a courtesy */ }
    })();
    return () => { live = false; };
  }, [clientId, projectId]);
  return topics;
}

/** The topics, briefs and drafts as a plain list (no frame), for a page that wraps it in its own section. */
export function ResearchList({ topics, noun = 'client' }) {
  const navigate = useNavigate();
  const muted = { color: 'var(--color-muted)' };
  const link = { color: 'var(--color-primary)' };
  const go = (qs) => navigate(`/topic-research?${qs}`);
  const day = (d) => (d ? new Date(d).toLocaleDateString() : '');
  return (
    <div className="space-y-3 pt-3" data-guide="linked-research">
      {!topics.length && (
        <p className="text-sm" style={muted}>No research is linked here yet. In Topic Research, choose this {noun} when you search a topic, or open a topic and press Change.</p>
      )}
      {topics.map((t) => (
        <div key={t.id} className="space-y-1">
          <button type="button" onClick={() => go(t.lastRunId ? `topic=${t.id}&run=${t.lastRunId}` : `topic=${t.id}`)} className="text-sm font-medium text-left hover:opacity-70 transition-opacity break-words" style={{ color: 'var(--color-text)' }}>{t.keyword}</button>
          {(t.briefs.length > 0 || t.drafts.length > 0) && (
            <ul className="space-y-0.5 pl-3">
              {t.briefs.map((b) => (
                <li key={`b${b.id}`} className="text-xs break-words">
                  <button type="button" onClick={() => go(`brief=${b.id}`)} className="underline hover:opacity-70 transition-opacity text-left" style={link}>Brief: {b.label}</button>
                  <span style={muted}> · {day(b.createdAt)}</span>
                </li>
              ))}
              {t.drafts.map((d) => (
                <li key={`d${d.id}`} className="text-xs break-words">
                  <button type="button" onClick={() => go(`draft=${d.id}`)} className="underline hover:opacity-70 transition-opacity text-left" style={link}>Draft: {d.label}</button>
                  <span style={muted}> · {day(d.createdAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

/** The framed card (used on the Project page). */
export default function LinkedResearch({ clientId = null, projectId = null, showEmpty = true }) {
  const navigate = useNavigate();
  const topics = useLinkedResearch({ clientId, projectId });
  if (topics === null) return null;
  if (!topics.length && !showEmpty) return null;
  return (
    <section className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Research</h3>
        <button type="button" onClick={() => navigate('/topic-research')} className="text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }}>Open Topic Research</button>
      </div>
      <ResearchList topics={topics} noun={clientId ? 'client' : 'project'} />
    </section>
  );
}
