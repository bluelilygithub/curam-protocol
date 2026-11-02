import React, { useState, useEffect, useCallback } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import Tooltip from '../../components/Tooltip';
import { GT } from './guitarTips.mjs';
import GlossaryList from './GlossaryList';

// Chords a beginner meets first; shown even when no song uses them yet, so there is always something to tick
const STARTER = ['G', 'C', 'D', 'Em', 'Am', 'A', 'E', 'Dm', 'F', 'Bm'];

const card = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const btnPrimary = { background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' };
const btnLine = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * "What can I play?": tick the chords you can play cleanly and the library shows the songs that use only those, which chord to learn next
 * (and how many songs it opens up), and the path to a song you want to play. Everything comes from your own songs.
 */
export default function LearnView({ onOpenSong, songs }) {
  const addToast = useToastStore(s => s.addToast);
  const [data, setData] = useState(null);
  const [want, setWant] = useState('');
  const [road, setRoad] = useState(null);

  const load = useCallback(() => {
    api.get('/api/guitar-play/my-chords').then(r => r.json()).then(setData).catch(() => setData({ known: [], libraryChords: [], songs: [], suggestions: [] }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveKnown = async (chords) => {
    setData(d => ({ ...d, known: chords }));
    try {
      const res = await api.put('/api/guitar-play/my-chords', { chords });
      if (!res.ok) throw new Error((await res.json()).error);
      load();
      if (want) loadRoad(want);
    } catch (e) { addToast(e.message, 'error'); load(); }
  };
  const toggle = (chord) => {
    const has = data.known.includes(chord);
    saveKnown(has ? data.known.filter(c => c !== chord) : [...data.known, chord]);
  };

  const loadRoad = useCallback((id) => {
    if (!id) { setRoad(null); return; }
    api.get(`/api/guitar-play/roadmap/${id}`).then(r => r.json()).then(setRoad).catch(() => setRoad(null));
  }, []);
  const pickSong = (id) => { setWant(id); loadRoad(id); };

  if (!data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  const all = [...new Set([...STARTER, ...data.libraryChords, ...data.known])];
  const order = (c) => (STARTER.includes(c) ? STARTER.indexOf(c) : 100);
  all.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  const playableNow = data.songs.filter(s => s.playable);
  const notYet = data.songs.filter(s => !s.playable);
  const songOf = (id) => songs.find(s => s.id === id);

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Chords I can play</h2>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Tick a chord when you can play it cleanly, every string ringing. Be honest: it only decides which songs are suggested.
        </p>
        <div className="flex flex-wrap gap-2">
          {all.map(c => {
            const on = data.known.includes(c);
            return (
              <Tooltip text={on ? `${c}: you can play this. Press to untick it.` : GT.learnChip} key={c}>
                <button type="button" aria-pressed={on} onClick={() => toggle(c)}
                  className="text-sm font-mono font-semibold px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200"
                  style={on ? { ...btnPrimary, borderColor: 'var(--color-primary)' } : btnLine}>{c}</button>
              </Tooltip>
            );
          })}
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          {data.known.length === 0 ? 'Nothing ticked yet.' : `${plural(data.known.length, 'chord', 'chords')} ticked.`}
        </p>
      </section>

      <section className="rounded-xl border p-4 flex flex-col gap-2" style={card}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Songs I can play now</h2>
        {data.songs.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Add songs with chords in the Library and they will be sorted here.</p>}
        {data.songs.length > 0 && playableNow.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            {data.known.length === 0 ? 'Tick the chords you know above and the songs you can already play appear here.' : 'No song uses only the chords you have ticked yet. See what to learn next below.'}
          </p>
        )}
        {playableNow.map(s => (
          <div key={s.id} className="flex items-center gap-3 rounded-lg border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{s.title}</p>
              <p className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{s.chords.join(' ')}</p>
            </div>
            {songOf(s.id) && (
              <Tooltip text={GT.openSong}>
                <button onClick={() => onOpenSong(songOf(s.id))} className="text-xs px-3 py-1.5 rounded-lg font-medium hover:opacity-70 transition-opacity duration-200" style={btnPrimary}>Open</button>
              </Tooltip>
            )}
          </div>
        ))}
        {data.songs.length > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{playableNow.length} of {plural(data.songs.length, 'song', 'songs')}.</p>}
      </section>

      {data.suggestions.length > 0 && (
        <section className="rounded-xl border p-4 flex flex-col gap-2" style={card}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Learn next</h2>
          {data.suggestions.slice(0, 5).map(s => (
            <div key={s.chord} className="flex items-center gap-3 rounded-lg border p-2 flex-wrap" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <span className="text-lg font-mono font-bold w-14" style={{ color: 'var(--color-primary)' }}>{s.chord}</span>
              <p className="flex-1 min-w-0 text-xs" style={{ color: 'var(--color-text)' }}>
                {s.unlockCount > 0
                  ? <>Learn <strong>{s.chord}</strong> and you can play {plural(s.unlockCount, 'more song', 'more songs')}: {s.unlocks.join(', ')}.</>
                  : <>{s.chord} is used in {plural(s.usedIn, 'song', 'songs')}{s.nearlyCount ? `, and brings ${plural(s.nearlyCount, 'song', 'songs')} one chord closer` : ''}.</>}
              </p>
              <Tooltip text={GT.learnHave}>
                <button onClick={() => toggle(s.chord)} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity duration-200" style={btnLine}>I can play it</button>
              </Tooltip>
            </div>
          ))}
        </section>
      )}

      <section className="rounded-xl border p-4 flex flex-col gap-3" style={card}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>I want to play…</h2>
        <Tooltip text={GT.learnPick}>
          <select value={want} onChange={e => pickSong(e.target.value)} aria-label="A song you want to play"
            className="text-sm px-3 py-2 rounded-lg border self-start max-w-full"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
            <option value="">Choose a song…</option>
            {data.songs.map(s => <option key={s.id} value={s.id}>{s.title}{s.playable ? ' (you can play it)' : ''}</option>)}
          </select>
        </Tooltip>
        {road && road.ready && <p className="text-sm" style={{ color: 'var(--color-text)' }}>You already know every chord in {road.title}. Go and play it.</p>}
        {road && !road.ready && (
          <ol className="flex flex-col gap-2">
            {road.steps.map((st, i) => (
              <li key={st.chord} className="flex items-start gap-3">
                <span className="text-xs w-5 text-right pt-1" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
                <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                  Learn <strong className="font-mono">{st.chord}</strong>
                  {st.unlockCount > 0 && <span style={{ color: 'var(--color-muted)' }}> and you can play {st.unlocks.join(', ')}{st.unlockCount > st.unlocks.length ? ` and ${st.unlockCount - st.unlocks.length} more` : ''}</span>}
                </p>
              </li>
            ))}
            <li className="flex items-start gap-3">
              <span className="text-xs w-5 text-right pt-1" style={{ color: 'var(--color-muted)' }}>{road.steps.length + 1}</span>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Then play <strong>{road.title}</strong>.</p>
            </li>
          </ol>
        )}
        {notYet.length === 0 && data.songs.length > 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>You can play every song in your library.</p>}
      </section>

      <GlossaryList />
    </div>
  );
}
