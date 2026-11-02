import React, { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import { chordQuestion, numeralQuestion, qualityQuestion, bassQuestion, progressionQuestion, scoreRound, missedCounts, ROUND_LENGTH } from './earQuestions.mjs';
import { playChordSound, playRootNote, audioContextFrom } from './chordSound.js';

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const MODES = [
  ['quality', 'Major or minor?', 'earQuality'],
  ['chords', 'Name the chord', 'earChords'],
  ['bass', 'Find the bass note', 'earBass'],
  ['numerals', 'Name the numeral', 'earNumerals'],
  ['progression', 'Name the progression', 'earProgression'],
];
const MODE_TEXT = {
  quality: 'You hear one chord from your songs and say whether it is major or minor. The only difference is one note, the 3rd, and a minor chord sounds sadder.',
  chords: 'You hear one chord and choose its name. Chords you miss come up more often.',
  bass: 'You hear a chord and choose its lowest note, the root. You can ask to hear that note on its own.',
  numerals: 'You hear the key chord, then another chord from one of your songs, and choose its Roman numeral (I, IV, V, vi and so on).',
  progression: 'You hear the key chord, then a well-known run of chords, and choose which progression it was.',
};
const PROMPT = {
  quality: 'Is this chord major or minor?',
  chords: 'Which chord is this?',
  bass: 'Which note is lowest in this chord?',
  numerals: 'You hear the key chord, then another. Which numeral is the second chord?',
  progression: 'You hear the key chord, then a progression. Which one is it?',
};

function Stats({ summary }) {
  if (!summary) return null;
  const rows = MODES.map(([id, label]) => ({ id, label, ...summary.byMode[id] })).filter(r => r.rounds > 0);
  if (!rows.length) return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No rounds yet. Your scores and the chords you miss most will show here.</p>;
  const trend = { up: ' and improving', down: ' and slipping', steady: ' and steady' };
  return (
    <div className="flex flex-col gap-1">
      {rows.map(r => (
        <p key={r.id} className="text-xs" style={{ color: 'var(--color-text)' }}>
          {r.label}: <strong>{r.accuracy}%</strong> over {r.rounds} {r.rounds === 1 ? 'round' : 'rounds'}{trend[r.trend] || ''}.
        </p>
      ))}
      {summary.topMisses.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Missed most: {summary.topMisses.map(m => `${m.name} (${m.count})`).join(', ')}.
        </p>
      )}
    </div>
  );
}

/**
 * Ear training with the chords and keys of the person's own songs. The sound is the browser's own synth, not the recording: chords
 * detected from audio are guesses, and chords from a chord sheet have no time in the recording, so a recording could not be trusted as the answer key.
 */
export default function EarTraining() {
  const addToast = useToastStore(s => s.addToast);
  const [material, setMaterial] = useState(null);
  const [summary, setSummary] = useState(null);
  const [mode, setMode] = useState('chords');
  const [round, setRound] = useState(null);      // { question, answers, picked } while a round is running
  const [result, setResult] = useState(null);    // the finished round
  const ctxRef = useRef(null);

  const loadSummary = useCallback(() => {
    api.get('/api/guitar-play/ear/summary').then(r => r.json()).then(setSummary).catch(() => {});
  }, []);
  useEffect(() => {
    api.get('/api/guitar-play/ear/material').then(r => r.json()).then(setMaterial).catch(() => setMaterial({ chords: [], songs: [] }));
    loadSummary();
  }, [loadSummary]);

  const play = useCallback((chords, step = 1.3) => {
    try {
      const ctx = audioContextFrom(ctxRef);
      let t = 0;
      for (const c of chords) { playChordSound(ctx, c.root, c.quality, t); t += step; }
    } catch (_) { addToast('Sound is not available in this browser', 'error'); }
  }, [addToast]);

  const playBass = useCallback((root) => {
    try { playRootNote(audioContextFrom(ctxRef), root); } catch (_) { addToast('Sound is not available in this browser', 'error'); }
  }, [addToast]);

  const make = useCallback((answers) => {
    const missed = missedCounts(answers);
    if (mode === 'quality') return qualityQuestion({ chords: material.chords, missed });
    if (mode === 'bass') return bassQuestion({ chords: material.chords, missed });
    if (mode === 'progression') return progressionQuestion({ songs: material.songs, missed });
    return mode === 'chords' ? chordQuestion({ chords: material.chords, missed }) : numeralQuestion({ songs: material.songs, missed });
  }, [mode, material]);

  const start = () => {
    const question = make([]);
    if (!question) { addToast('You need a song with a few chords in its key for numerals', 'error'); return; }
    setResult(null);
    setRound({ question, answers: [], picked: null });
    setTimeout(() => play(question.play, question.step), 150);
  };

  const pick = (option) => {
    if (round.picked) return;
    setRound(r => ({ ...r, picked: option, answers: [...r.answers, { answer: r.question.answer, picked: option, key: r.question.key }] }));
  };

  const finish = async (answers) => {
    const score = scoreRound(answers);
    setRound(null);
    setResult(score);
    try {
      const res = await api.post('/api/guitar-play/ear/sessions', { mode, ...score });
      if (!res.ok) throw new Error((await res.json()).error);
      loadSummary();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const next = () => {
    if (round.answers.length >= ROUND_LENGTH) { finish(round.answers); return; }
    const question = make(round.answers);
    if (!question) { finish(round.answers); return; }
    setRound(r => ({ ...r, question, picked: null }));
    setTimeout(() => play(question.play, question.step), 150);
  };

  if (!material) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  const q = round?.question;
  const done = round?.answers.length || 0;
  const revealed = !!round?.picked;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
        Train your ear on the chords in your own songs. The sound is Vault's own synth, not the recording.
      </p>

      {!round && (
        <section className="rounded-xl border p-4 flex flex-col gap-3" style={card}>
          <div className="flex items-center gap-2 flex-wrap">
            {MODES.map(([id, label, tip]) => (
              <Tooltip text={GT[tip]} key={id}>
                <button type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)}
                  className="text-sm px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                  style={mode === id ? { ...btnPrimary, borderColor: 'var(--color-primary)' } : btnLine}>{label}</button>
              </Tooltip>
            ))}
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {MODE_TEXT[mode]}
          </p>
          <Tooltip text={GT.earStart}>
            <button onClick={start} className="self-start px-4 py-2 text-sm rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
              Start a round of {ROUND_LENGTH}
            </button>
          </Tooltip>
          {result && (
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              Last round: <strong>{result.correct} of {result.total}</strong>.
              {Object.keys(result.misses).length > 0 ? ` Missed: ${Object.entries(result.misses).map(([n, c]) => `${n}${c > 1 ? ` (${c})` : ''}`).join(', ')}.` : ' A clean sweep.'}
            </p>
          )}
          <Stats summary={summary} />
        </section>
      )}

      {round && q && (
        <section className="rounded-xl border p-4 flex flex-col gap-3" style={card} aria-live="polite">
          <div className="flex items-center justify-between text-xs" style={{ color: 'var(--color-muted)' }}>
            <span>Question {Math.min(done + (revealed ? 0 : 1), ROUND_LENGTH)} of {ROUND_LENGTH}</span>
            {q.mode === 'numerals' && <span>Key of {q.keyLabel} · from {q.songTitle}</span>}
            {q.mode === 'progression' && <span>Key of {q.keyLabel}</span>}
          </div>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            {PROMPT[q.mode]}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Tooltip text={GT.earReplay}>
              <button onClick={() => play(q.play, q.step)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>
                {q.mode === 'numerals' ? 'Play both again' : q.mode === 'progression' ? 'Play it again' : 'Play again'}
              </button>
            </Tooltip>
            {q.mode === 'bass' && (
              <Tooltip text={GT.earBassHint}>
                <button onClick={() => playBass(q.bass.root)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Hear the bass note</button>
              </Tooltip>
            )}
            {(q.mode === 'numerals' || q.mode === 'progression') && (
              <Tooltip text={GT.earTonic}>
                <button onClick={() => play([q.play[0]])} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Play the key chord</button>
              </Tooltip>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {q.options.map(o => {
              const isAnswer = revealed && o === q.answer;
              const isWrong = revealed && o === round.picked && o !== q.answer;
              return (
                <Tooltip text={GT.earAnswer} key={o}>
                  <button type="button" disabled={revealed} onClick={() => pick(o)}
                    className="text-lg font-semibold py-3 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                    style={{ ...btnLine, ...(isAnswer ? { borderColor: '#16a34a', background: 'rgba(22,163,74,0.12)' } : {}), ...(isWrong ? { borderColor: '#dc2626', background: 'rgba(220,38,38,0.1)' } : {}) }}>
                    {o}
                  </button>
                </Tooltip>
              );
            })}
          </div>
          {revealed && (
            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-sm font-medium" style={{ color: round.picked === q.answer ? '#16a34a' : '#dc2626' }}>
                {round.picked === q.answer ? 'Correct.' : `It was ${q.answer}.`}
              </p>
              <Tooltip text={GT.earNext}>
                <button onClick={next} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>
                  {done >= ROUND_LENGTH ? 'See my score' : 'Next'}
                </button>
              </Tooltip>
              {round.picked !== q.answer && (
                <Tooltip text={GT.earReplay}>
                  <button onClick={() => play(q.play, q.step)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Hear it again</button>
                </Tooltip>
              )}
              {q.mode === 'quality' && (
                <Tooltip text={GT.earHearBoth}>
                  <button onClick={() => play(q.compare, 1.6)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>Hear major, then minor</button>
                </Tooltip>
              )}
            </div>
          )}
          {revealed && q.mode === 'quality' && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              That was {q.chordName}. Major and minor share the same root and 5th; only the 3rd changes, and it is a half step lower in the minor.
            </p>
          )}
          {revealed && q.mode === 'progression' && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              That was {q.progressionName}: {q.chordNames.join(', ')} in the key of {q.keyLabel}.
            </p>
          )}
          {revealed && q.mode === 'bass' && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              The chord was {q.chordName}. A chord is named after its root, and the root is usually the lowest note.
            </p>
          )}
          <Tooltip text={GT.earStop}>
            <button onClick={() => setRound(null)} className="self-start text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200" style={{ ...btnLine, color: 'var(--color-muted)' }}>Stop round</button>
          </Tooltip>
        </section>
      )}
    </div>
  );
}
