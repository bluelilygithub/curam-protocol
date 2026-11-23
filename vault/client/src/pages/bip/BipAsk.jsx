import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

/**
 * "Ask about this profile": type or say a question, get an answer from the saved profile only (POST /api/bip/profiles/:id/ask), then
 * Save it (POST …/qa) or Discard it. Saved questions and answers are listed newest first, each with Delete (DELETE …/qa/:qaId).
 * Must sit inside a VoiceInputProvider (BipPage provides one).
 */

const STARTERS = [
  'Who runs this business, and how do we know?',
  'How long has it been operating?',
  'Where is it based? Do the sources agree?',
  'What do other websites say about it?',
];

const dateOf = (v) => (v ? new Date(v).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

async function json(res, fallback) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || fallback);
  return data;
}

function Answer({ item, muted }) {
  return (
    <>
      <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--color-text)' }}>{item.answer}</p>
      {item.unverifiedFigures?.length > 0 && (
        <p className="text-xs" style={{ color: '#f59e0b' }}>Not found in the profile data, so check before relying on it: {item.unverifiedFigures.join(', ')}.</p>
      )}
      <p className="text-xs" style={muted}>Answered by AI{item.model ? ` (${item.model})` : ''} from this profile only{item.createdAt ? ` · ${dateOf(item.createdAt)}` : ''}.</p>
    </>
  );
}

export default function BipAsk({ profile }) {
  const getIcon = useIcon();
  const addToast = useToastStore((s) => s.addToast);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState('');
  const [pending, setPending] = useState(null); // the latest answer, not yet saved
  const [saved, setSaved] = useState(null); // null = loading

  const base = `/api/bip/profiles/${profile.id}`;
  const load = useCallback(() => {
    api.get(`${base}/qa`).then((r) => json(r, 'Saved questions could not be loaded.')).then((d) => setSaved(d.qa || [])).catch(() => setSaved([]));
  }, [base]);
  useEffect(() => { setPending(null); setQuestion(''); load(); }, [load]);

  const ask = async (text = question) => {
    const q = String(text || '').trim();
    if (q.length < 3) { addToast('Type or say a question first.', 'error'); return; }
    setBusy('ask');
    setQuestion(q);
    try { setPending(await json(await api.post(`${base}/ask`, { question: q }), 'The question could not be answered.')); }
    catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(''); }
  };

  const save = async () => {
    if (!pending) return;
    setBusy('save');
    try {
      const d = await json(await api.post(`${base}/qa`, pending), 'The answer could not be saved.');
      setSaved((list) => [d.qa, ...(list || [])]);
      setPending(null);
      setQuestion('');
      addToast('Question and answer saved.', 'success');
    } catch (err) { addToast(err.message, 'error'); }
    finally { setBusy(''); }
  };

  const remove = async (item) => {
    if (!window.confirm(`Delete this saved question?\n\n"${item.question}"`)) return;
    try {
      await json(await api.delete(`${base}/qa/${item.id}`), 'The question could not be deleted.');
      setSaved((list) => (list || []).filter((x) => x.id !== item.id));
    } catch (err) { addToast(err.message, 'error'); }
  };

  const button = 'inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium hover:opacity-70 transition-opacity disabled:opacity-40';
  const panel = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
  const muted = { color: 'var(--color-muted)' };
  const done = profile.status === 'done';

  return (
    <div className="space-y-4" data-tour="bip-ask">
      <section className="rounded-2xl border p-5 space-y-3" style={panel}>
        <Tooltip text="Type, or press the microphone and speak. Answers use only this profile's saved data and name their sources.">
          <div>
            <VoiceInput type="textarea" append rows={3} value={question} onChange={setQuestion} label="Your question about this business"
              placeholder="e.g. Who runs this business, and how do we know?" />
          </div>
        </Tooltip>
        <div className="flex flex-wrap items-center gap-2">
          <Tooltip text="Answer from this profile's saved data. Nothing new is looked up and nothing is saved until you press Save.">
            <button type="button" className={button} disabled={!!busy || !done} onClick={() => ask()} style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {getIcon('send', { size: 14 })} {busy === 'ask' ? 'Thinking…' : 'Ask'}
            </button>
          </Tooltip>
          {!done && <span className="text-xs" style={muted}>Available once the profile has finished.</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <Tooltip key={s} text="Ask this question.">
              <button type="button" disabled={!!busy || !done} onClick={() => ask(s)} className="text-xs px-2.5 py-1 rounded-full border hover:opacity-70 disabled:opacity-40"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>{s}</button>
            </Tooltip>
          ))}
        </div>
      </section>

      {pending && (
        <section className="rounded-2xl border p-5 space-y-2" style={{ ...panel, borderColor: 'var(--color-primary)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{pending.question}</p>
          <Answer item={pending} muted={muted} />
          <div className="flex flex-wrap gap-2 pt-1">
            <Tooltip text="Keep this question and answer with the profile.">
              <button type="button" className={button} disabled={!!busy} onClick={save} style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {getIcon('save', { size: 14 })} {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
            </Tooltip>
            <Tooltip text="Close this answer without saving it.">
              <button type="button" className={button} disabled={!!busy} onClick={() => setPending(null)} style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>Discard</button>
            </Tooltip>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Saved questions{saved?.length ? ` (${saved.length})` : ''}</h3>
        {saved === null && <p className="text-xs" style={muted}>Loading…</p>}
        {saved?.length === 0 && <p className="text-xs" style={muted}>None saved yet. Ask a question and press Save to keep it here.</p>}
        {saved?.map((item) => (
          <div key={item.id} className="rounded-xl border p-4 space-y-2" style={panel}>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{item.question}</p>
              <Tooltip text="Delete this saved question and answer.">
                <button type="button" aria-label="Delete this saved question" onClick={() => remove(item)} className="shrink-0 p-1 rounded-lg hover:opacity-70" style={{ color: '#ef4444' }}>
                  {getIcon('trash', { size: 14 })}
                </button>
              </Tooltip>
            </div>
            <Answer item={item} muted={muted} />
          </div>
        ))}
      </section>
    </div>
  );
}
