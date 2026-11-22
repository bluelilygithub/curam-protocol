import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { formatTime } from './youtubeFormat.mjs';

// The video's own chapters (from its description, or YouTube's automatic ones via yt-dlp), each a time that jumps the player there.
// Not the AI chapters in Insights: these are the creator's (or YouTube's), cost nothing and need no captions.

export default function ChaptersPanel({ video, onSeek }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    let alive = true;
    setState({ loading: true });
    api.get(`/api/youtube/chapters/${video.id}`).then((r) => r.json())
      .then((d) => { if (alive) setState({ loading: false, ...d }); })
      .catch(() => { if (alive) setState({ loading: false, chapters: [], error: 'Could not read the chapters just now.' }); });
    return () => { alive = false; };
  }, [video.id]);

  const box = { margin: '0 1rem 1rem', padding: '0.75rem', border: '1px solid var(--color-border)', borderRadius: '0.75rem', background: 'var(--color-bg)' };
  const note = { margin: 0, fontSize: '0.8rem', color: 'var(--color-muted)', lineHeight: 1.5 };

  if (state.loading) return <div style={box}><p style={note}>Looking for chapters…</p></div>;
  const list = state.chapters || [];
  if (!list.length) return <div style={box}><p style={note}>{state.error || 'This video has no chapters. Insights & Ask can write AI chapters from its captions.'}</p></div>;

  return (
    <div style={box} data-guide="chapters">
      <p style={{ ...note, marginBottom: '0.5rem' }}>{list.length} chapters{state.source === 'youtube' ? ' (from YouTube, may be automatic)' : ' (from the video\'s description)'}. Click one to jump there.</p>
      <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {list.map((c) => (
          <li key={c.start}>
            <button onClick={() => onSeek(c.start)} style={{ fontFamily: 'inherit', display: 'flex', gap: '0.6rem', width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', padding: '0.3rem 0.4rem', borderRadius: '0.4rem', fontSize: '0.85rem', color: 'var(--color-text)' }}
              className="transition-colors duration-200 hover:bg-[var(--color-surface)]">
              <span style={{ color: 'var(--color-primary)', fontVariantNumeric: 'tabular-nums', minWidth: '3.5rem', fontWeight: 600 }}>{formatTime(c.start)}</span>
              <span>{c.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
