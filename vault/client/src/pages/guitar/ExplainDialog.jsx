import React, { useState, useEffect } from 'react';
import api from '../../utils/apiClient';
import Dialog from '../../components/Dialog';

/**
 * "Explain this song": a short theory breakdown and things to practise. The server works from the song's chords; `analysis` is the
 * key, numerals and flagged chords the Player already shows. The wording is written by AI and checked so it names no chord the song
 * does not use, and it knows only the chart, not the recording.
 */
export default function ExplainDialog({ song, analysis, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await api.post('/api/guitar-coach/explain', { songId: song.id, analysis });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        if (!cancelled) setState({ data });
      } catch (e) { if (!cancelled) setState({ error: e.message }); }
    })();
    return () => { cancelled = true; };
  }, [song.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const h = 'text-xs font-semibold uppercase tracking-wide';
  return (
    <Dialog title={`Explain: ${song.title}`} size="lg" onClose={onClose}>
      <div className="p-5 flex flex-col gap-4">
        {state.loading && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Reading the chart…</p>}
        {state.error && <p className="text-sm" style={{ color: '#dc2626' }}>{state.error}</p>}
        {state.data && (
          <>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{state.data.summary}</p>
            <div>
              <p className={h} style={{ color: 'var(--color-muted)' }}>Why it works</p>
              <ul className="list-disc pl-5 mt-1 flex flex-col gap-1">
                {state.data.why.map((t, i) => <li key={i} className="text-sm" style={{ color: 'var(--color-text)' }}>{t}</li>)}
              </ul>
            </div>
            {state.data.techniques.length > 0 && (
              <div>
                <p className={h} style={{ color: 'var(--color-muted)' }}>Things to practise</p>
                <ul className="list-disc pl-5 mt-1 flex flex-col gap-1">
                  {state.data.techniques.map((t, i) => <li key={i} className="text-sm" style={{ color: 'var(--color-text)' }}>{t}</li>)}
                </ul>
              </div>
            )}
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Written by AI from this song's chart ({state.data.chords.join(', ')}). It has not heard the recording, so treat the suggestions as a starting point.
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
