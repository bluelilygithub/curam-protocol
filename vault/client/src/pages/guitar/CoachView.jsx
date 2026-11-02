import React, { useState, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { GT, FOCUS_TIPS } from './guitarTips.mjs';

const MINUTES = [15, 20, 30, 45, 60];
const FOCUS = [
  ['learning', 'New songs'],
  ['loops', 'Speed and rhythm'],
  ['transitions', 'Chord changes'],
  ['rusty', 'Rusty songs'],
  ['polishing', 'Polishing'],
];
const KIND = { learning: 'Learn', loops: 'Work up a loop', rusty: 'Revive', polishing: 'Polish', transitions: 'Chord change drill' };

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

function Source({ source }) {
  return (
    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
      {source === 'ai'
        ? 'Written by AI from numbers worked out in Vault. The numbers are checked against your own practice.'
        : 'A plain summary written by Vault from your own practice.'}
    </p>
  );
}

/** Coach tab: the weekly review and the practice session builder. The numbers and the plan are worked out in code; AI only writes the wording. */
export default function CoachView({ songs, onOpenSong, onStartDrill, onLog }) {
  const addToast = useToastStore(s => s.addToast);
  const [review, setReview] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [minutes, setMinutes] = useState(30);
  const [focus, setFocus] = useState([]);
  const [note, setNote] = useState('');
  const [plan, setPlan] = useState(null);
  const [building, setBuilding] = useState(false);

  const writeReview = useCallback(async () => {
    if (reviewing) return;
    setReviewing(true);
    try {
      const res = await api.get('/api/guitar-coach/week');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setReview(data);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setReviewing(false); }
  }, [reviewing, addToast]);

  const build = async () => {
    if (building) return;
    setBuilding(true);
    try {
      const res = await api.post('/api/guitar-coach/session', { minutes, focus, note: note.trim() || null });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPlan(data);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setBuilding(false); }
  };

  const toggle = (k) => setFocus(f => (f.includes(k) ? f.filter(x => x !== k) : [...f, k]));
  const songOf = (id) => songs.find(s => s.id === id);
  const f = review?.facts;

  return (
    <div className="flex flex-col gap-6">
      {/* Weekly review */}
      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} data-tour="guitar-coach">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>This week</h2>
        {!review && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            A short review of your last seven days: time played, loops you sped up, chord changes that are stalling and songs going rusty.
          </p>
        )}
        <Tooltip text={GT.coachReview}>
          <button onClick={writeReview} disabled={reviewing}
            className="self-start px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40 hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
            {reviewing ? 'Writing…' : review ? 'Write it again' : 'Write my review'}
          </button>
        </Tooltip>
        {review && (
          <>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{review.review}</p>
            <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
              <span>{f.sessions} {f.sessions === 1 ? 'session' : 'sessions'}</span>
              <span>· {f.minutes} min logged</span>
              {f.loops.filter(l => l.improved).map(l => (
                <span key={`${l.title}-${l.loopName}`}>· {l.title} {l.loopName}: {l.fromBpm != null ? `${l.fromBpm} to ${l.toBpm} bpm` : `${l.fromPct}% to ${l.toPct}%`}</span>
              ))}
              {f.stalled.map(s => <span key={s.pair}>· {s.pair} stalling at {s.rate} a minute</span>)}
              {f.rusty.length > 0 && <span>· rusty: {f.rusty.join(', ')}</span>}
            </div>
            <Source source={review.source} />
          </>
        )}
      </section>

      {/* Session builder */}
      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Build a session</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Time I have</span>
          {MINUTES.map(m => (
            <Tooltip text={GT.coachMinutes} key={m}>
              <button type="button" role="radio" aria-checked={minutes === m} onClick={() => setMinutes(m)}
                className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                style={minutes === m ? { ...btnPrimary, borderColor: 'var(--color-primary)' } : btnLine}>{m} min</button>
            </Tooltip>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Focus on</span>
          {FOCUS.map(([k, label]) => (
            <Tooltip text={FOCUS_TIPS[k]} key={k}>
              <button type="button" aria-pressed={focus.includes(k)} onClick={() => toggle(k)}
                className="text-xs px-2.5 py-1 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                style={focus.includes(k) ? { ...btnPrimary, borderColor: 'var(--color-primary)' } : btnLine}>{label}</button>
            </Tooltip>
          ))}
        </div>
        <Tooltip text={GT.coachNote}>
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={120} aria-label="Anything else to focus on"
            placeholder="Or say it in your own words, e.g. rhythm"
            className="text-sm px-3 py-2 rounded-lg border"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
        </Tooltip>
        <Tooltip text={GT.coachBuild}>
          <button onClick={build} disabled={building}
            className="self-start px-4 py-2 text-sm rounded-lg font-medium disabled:opacity-40 hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
            {building ? 'Building…' : 'Build my session'}
          </button>
        </Tooltip>

        {plan && (
          <div className="flex flex-col gap-2 pt-2">
            {plan.intro && <p className="text-sm" style={{ color: 'var(--color-text)' }}>{plan.intro}</p>}
            {plan.blocks.length === 0 ? null : plan.blocks.map((b, i) => {
              const song = b.songId ? songOf(b.songId) : null;
              return (
                <div key={`${b.kind}-${i}`} className="rounded-lg border p-3 flex items-center gap-3 flex-wrap" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <span className="text-sm font-mono w-14 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{b.minutes} min</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>{KIND[b.kind]}</p>
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{b.title}{b.loopName ? ` · ${b.loopName}` : ''}</p>
                    {b.tip && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{b.tip}</p>}
                  </div>
                  {b.kind === 'transitions' ? (
                    <Tooltip text={GT.startDrill}>
                      <button onClick={() => onStartDrill({ a: b.a, b: b.b })} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>Start drill</button>
                    </Tooltip>
                  ) : (
                    <>
                      {song && (
                        <Tooltip text={GT.openSong}>
                          <button onClick={() => onOpenSong(song)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Open</button>
                        </Tooltip>
                      )}
                      <Tooltip text={GT.played}>
                        <button onClick={() => onLog({ song: { id: b.songId, title: b.title }, loop: b.loopId ? { id: b.loopId, name: b.loopName } : null })}
                          className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>I played this</button>
                      </Tooltip>
                    </>
                  )}
                </div>
              );
            })}
            {plan.short && (
              <p className="text-xs" style={{ color: '#b45309' }}>
                {plan.blocks.length === 0
                  ? 'There is nothing to practise yet. Add a song in the Library and set its status.'
                  : `Your library only has enough for ${plan.planned} of the ${plan.minutes} minutes. Add songs, loops or chord changes for a longer session.`}
              </p>
            )}
            <Source source={plan.source} />
          </div>
        )}
      </section>
    </div>
  );
}
