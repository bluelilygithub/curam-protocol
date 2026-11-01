import React, { useEffect, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import AiTranscriptDialog from './AiTranscriptDialog';
import { formatTime, coverageNote, ASK_STARTERS, noteHref } from './youtubeFormat.mjs';

// Sits under the player in the watch window: AI notes on the video (summary, key points, chapters, to-dos, quotes) with timestamps that jump the
// player, a "Save to Notes" button, and a place to ask the video questions. Everything comes from the video's captions; nothing is read from
// the picture or sound. Notes are written once and kept (Refresh writes them again).

const pill = (on) => ({
  fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', padding: '0.35rem 0.75rem', borderRadius: '0.5rem',
  border: '1px solid var(--color-border)', background: on ? 'var(--color-primary)' : 'var(--color-bg)', color: on ? '#fff' : 'var(--color-muted)',
});
const small = { fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.75rem', padding: '0.35rem 0.75rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const heading = { margin: '0.9rem 0 0.35rem', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--color-muted)' };
const body = { margin: 0, fontSize: '0.82rem', lineHeight: 1.55, color: 'var(--color-text)' };
const select = { padding: '0.3rem 0.5rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.75rem', fontFamily: 'inherit', maxWidth: 180 };

function At({ sec, onSeek }) {
  if (sec === null || sec === undefined) return null;
  return (
    <Tooltip text={`Jump the video to ${formatTime(sec)}.`}>
      <button
        type="button"
        onClick={() => onSeek(sec)}
        style={{ fontFamily: 'inherit', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.4rem 0 0', textDecoration: 'underline' }}
      >
        {formatTime(sec)}
      </button>
    </Tooltip>
  );
}

export default function VideoStudyPanel({ video, onSeek, onClose }) {
  const addToast = useToastStore((s) => s.addToast);
  const [tab, setTab] = useState('insights');

  // ---- insights
  const [loading, setLoading] = useState(true);
  const [writing, setWriting] = useState(false);
  const [data, setData] = useState(null); // { insights, truncated, coveredSec, createdAt }
  const [error, setError] = useState('');
  const [canGenerate, setCanGenerate] = useState(false); // the video has no readable captions: offer the AI transcript
  const [showAi, setShowAi] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api.get(`/api/youtube/insights/${video.id}`).then((r) => r.json()).then((d) => { if (live) setData(d && d.insights ? d : null); })
      .catch(() => {}).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [video.id]);

  async function writeNotes(refresh = false) {
    setWriting(true);
    setError('');
    try {
      const res = await api.post('/api/youtube/insights', { videoId: video.id, refresh });
      const d = await res.json();
      setCanGenerate(!res.ok && !!d.canGenerate);
      if (!res.ok) throw new Error(d.error || 'Could not write notes for this video.');
      setData(d);
    } catch (e) {
      setError(e.message || 'Could not write notes for this video.');
    } finally {
      setWriting(false);
    }
  }

  // ---- save to Notes
  const [showSave, setShowSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projects, setProjects] = useState([]);
  const [clients, setClients] = useState([]);
  const [projectId, setProjectId] = useState('');
  const [clientId, setClientId] = useState('');
  const loadedLists = useRef(false);

  function openSave() {
    setShowSave((v) => !v);
    if (loadedLists.current) return;
    loadedLists.current = true;
    api.get('/api/projects').then((r) => r.json()).then((d) => setProjects(Array.isArray(d) ? d : [])).catch(() => {});
    api.get('/api/clients?status=active').then((r) => r.json()).then((d) => setClients(Array.isArray(d) ? d : [])).catch(() => {});
  }

  async function saveToNotes() {
    setSaving(true);
    try {
      const draftRes = await api.post('/api/youtube/note-draft', { videoId: video.id, channel: video.channel || '' });
      const draft = await draftRes.json();
      if (!draftRes.ok) throw new Error(draft.error || 'Could not prepare the note.');
      const noteRes = await api.post('/api/notes', {
        title: draft.title, body: draft.body,
        project_id: projectId ? Number(projectId) : null,
        client_id: clientId ? Number(clientId) : null,
      });
      const note = await noteRes.json();
      if (!noteRes.ok) throw new Error(note.error || 'The note could not be saved.');
      addToast('Saved to Notes.', 'success', undefined, { label: 'Open note', href: noteHref(note.id) });
      setShowSave(false);
      if (!data) writeNotes(false).catch(() => {}); // the draft step wrote them: show them here too
    } catch (e) {
      addToast(e.message || 'The note could not be saved.', 'error');
    } finally {
      setSaving(false);
    }
  }

  // ---- ask
  const [turns, setTurns] = useState([]); // { question, answer, citations, partial }
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState('');

  async function ask(q) {
    const text = String(q ?? question).trim();
    if (!text || asking) return;
    setAsking(true);
    setAskError('');
    try {
      const res = await api.post('/api/youtube/ask', {
        videoId: video.id, question: text,
        history: turns.slice(-4).map((t) => ({ question: t.question, answer: t.answer })),
      });
      const d = await res.json();
      setCanGenerate(!res.ok && !!d.canGenerate);
      if (!res.ok) throw new Error(d.error || 'Could not answer that just now.');
      setTurns((t) => [...t, { question: text, answer: d.answer, citations: d.citations || [], partial: !!d.partial }]);
      setQuestion('');
    } catch (e) {
      setAskError(e.message || 'Could not answer that just now.');
    } finally {
      setAsking(false);
    }
  }

  const ins = data && data.insights;
  const note = data ? coverageNote(data.truncated, data.coveredSec) : '';

  return (
    <div style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
      <div style={{ padding: '0.6rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border)' }} role="tablist" aria-label="Video study tools">
        <Tooltip text="AI notes on this video: summary, key points, chapters, things to do and quotes, with times you can click.">
          <button role="tab" aria-selected={tab === 'insights'} onClick={() => setTab('insights')} style={pill(tab === 'insights')}>Insights</button>
        </Tooltip>
        <Tooltip text="Ask a question and get an answer taken from what is said in the video, with the moments it comes from.">
          <button role="tab" aria-selected={tab === 'ask'} onClick={() => setTab('ask')} style={pill(tab === 'ask')}>Ask this video</button>
        </Tooltip>
        <span style={{ flex: 1 }} />
        {ins && (
          <>
            <Tooltip text="Save these notes as a note in Notes, with the video link and clickable times. You can file it under a project or client.">
              <button onClick={openSave} aria-expanded={showSave} style={small}>Save to Notes</button>
            </Tooltip>
            <Tooltip text="Write the notes again from the captions. Replaces the saved ones.">
              <button onClick={() => writeNotes(true)} disabled={writing} style={{ ...small, color: 'var(--color-muted)' }}>{writing ? 'Writing…' : 'Refresh'}</button>
            </Tooltip>
          </>
        )}
        <Tooltip text="Hide this panel. The notes stay saved.">
          <button onClick={onClose} aria-label="Hide study panel" style={{ ...small, color: 'var(--color-muted)' }}>Hide</button>
        </Tooltip>
      </div>

      {showSave && ins && (
        <div style={{ padding: '0.6rem 1rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
          <Tooltip text="Optional: keep the note with one of your projects.">
            <select aria-label="File under a project" value={projectId} onChange={(e) => setProjectId(e.target.value)} style={select}>
              <option value="">No project</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Tooltip>
          <Tooltip text="Optional: link the note to a client in the CRM.">
            <select aria-label="Link to a client" value={clientId} onChange={(e) => setClientId(e.target.value)} style={select}>
              <option value="">No client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Tooltip>
          <button onClick={saveToNotes} disabled={saving} style={{ ...pill(true), opacity: saving ? 0.6 : 1 }}>{saving ? 'Saving…' : 'Save note'}</button>
        </div>
      )}

      <div style={{ padding: '0.75rem 1rem 1rem', maxHeight: '36vh', overflowY: 'auto' }} aria-live="polite">
        {tab === 'insights' && (
          <>
            {loading && <p style={{ ...body, color: 'var(--color-muted)' }}>Looking for saved notes…</p>}
            {!loading && !ins && (
              <div>
                <p style={body}>Write notes for this video: a summary, the key points, chapters, things to do and quotes. They are written by AI from the video's captions, so a video with no captions cannot be done. This takes a few seconds and is kept for next time.</p>
                <button onClick={() => writeNotes(false)} disabled={writing} style={{ ...pill(true), marginTop: '0.6rem', opacity: writing ? 0.6 : 1 }}>{writing ? 'Reading the captions…' : 'Write notes for this video'}</button>
              </div>
            )}
            {error && <p style={{ ...body, color: '#b91c1c', marginTop: '0.5rem' }}>{error}</p>}
            {canGenerate && <Tooltip text="Have Google's Gemini AI listen to this video and write a transcript. It shows the cost and waiting time first and does nothing until you agree.">
              <button onClick={() => setShowAi(true)} style={{ fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', padding: '0.45rem 0.9rem', borderRadius: '0.5rem', border: '1px solid var(--color-primary)', background: 'var(--color-bg)', color: 'var(--color-primary)', marginTop: '0.5rem' }}>
                Generate a transcript with AI…
              </button>
              </Tooltip>}
            {ins && (
              <div>
                {note && <p style={{ ...body, color: 'var(--color-muted)', fontStyle: 'italic' }}>{note}</p>}
                {ins.overview && <p style={body}>{ins.overview}</p>}
                {ins.keyPoints.length > 0 && (<><p style={heading}>Key points</p><ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{ins.keyPoints.map((k, i) => <li key={i} style={body}><At sec={k.at} onSeek={onSeek} />{k.text}</li>)}</ul></>)}
                {ins.chapters.length > 0 && (<><p style={heading}>Chapters</p><ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{ins.chapters.map((c, i) => <li key={i} style={body}><At sec={c.at} onSeek={onSeek} />{c.title}</li>)}</ul></>)}
                {ins.actionItems.length > 0 && (<><p style={heading}>Things to do</p><ul style={{ margin: 0, paddingLeft: '1.1rem' }}>{ins.actionItems.map((a, i) => <li key={i} style={body}>{a}</li>)}</ul></>)}
                {ins.quotes.length > 0 && (<><p style={heading}>Quotes</p>{ins.quotes.map((q, i) => <p key={i} style={{ ...body, margin: '0 0 0.4rem', paddingLeft: '0.6rem', borderLeft: '2px solid var(--color-border)' }}><At sec={q.at} onSeek={onSeek} />“{q.text}”</p>)}</>)}
                <p style={{ ...body, color: 'var(--color-muted)', fontSize: '0.72rem', marginTop: '0.9rem' }}>Written by AI from the video's captions. Check anything that matters against the video.</p>
              </div>
            )}
          </>
        )}

        {tab === 'ask' && (
          <div>
            {turns.length === 0 && (
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
                {ASK_STARTERS.map((s) => <button key={s} onClick={() => ask(s)} disabled={asking} style={{ ...small, fontWeight: 500 }}>{s}</button>)}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} style={{ marginBottom: '0.8rem' }}>
                <p style={{ ...body, fontWeight: 700 }}>{t.question}</p>
                <p style={body}>{t.answer}</p>
                {t.partial && <p style={{ ...body, color: 'var(--color-muted)', fontSize: '0.72rem' }}>This is a long video, so only the parts most likely to matter were read.</p>}
                {t.citations.map((c, j) => (
                  <p key={j} style={{ ...body, margin: '0.2rem 0 0', paddingLeft: '0.6rem', borderLeft: '2px solid var(--color-border)', color: 'var(--color-muted)' }}><At sec={c.at} onSeek={onSeek} />“{c.quote}”</p>
                ))}
              </div>
            ))}
            {askError && <p style={{ ...body, color: '#b91c1c' }}>{askError}</p>}
            {canGenerate && <Tooltip text="Have Google's Gemini AI listen to this video and write a transcript. It shows the cost and waiting time first and does nothing until you agree.">
              <button onClick={() => setShowAi(true)} style={{ fontFamily: 'inherit', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem', padding: '0.45rem 0.9rem', borderRadius: '0.5rem', border: '1px solid var(--color-primary)', background: 'var(--color-bg)', color: 'var(--color-primary)', marginTop: '0.5rem' }}>
                Generate a transcript with AI…
              </button>
              </Tooltip>}
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
                placeholder="Ask about what is said in this video…"
                aria-label="Ask a question about this video"
                maxLength={500}
                style={{ flex: 1, padding: '0.5rem 0.7rem', borderRadius: '0.5rem', border: '1px solid var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)', fontSize: '0.85rem', fontFamily: 'inherit' }}
              />
              <Tooltip text="Send the question. The answer comes only from the captions.">
                <button onClick={() => ask()} disabled={asking || !question.trim()} style={{ ...pill(true), opacity: asking || !question.trim() ? 0.6 : 1 }}>{asking ? 'Reading…' : 'Ask'}</button>
              </Tooltip>
            </div>
            <p style={{ ...body, color: 'var(--color-muted)', fontSize: '0.72rem', marginTop: '0.5rem' }}>Answers come from the video's captions only. If the video does not say, it says so.</p>
          </div>
        )}
      </div>
      {showAi && (
        <AiTranscriptDialog
          video={video}
          onClose={() => setShowAi(false)}
          onDone={() => { setCanGenerate(false); setError(''); setAskError(''); if (!data) writeNotes(false); }}
        />
      )}
    </div>
  );
}
