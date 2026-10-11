import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Track, type TrackSummary } from './api';
import { displayLines, finish, fromLines } from './drawing';
import { bboxOf, formatDistance, totalKm, type BBox } from './geo';
import { setSaved, type SavedLine } from './mapLayers';
import { COLORS, useStore } from './store';

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const errText = (e: unknown): string => (e instanceof Error ? e.message : 'That did not work.');

/** Fit the map to a track, leaving room for the side panel (desktop) or bottom sheet (phone). */
export function fitTo(map: maplibregl.Map, bbox: BBox): void {
  const phone = window.matchMedia('(max-width: 767px)').matches;
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
    padding: phone ? { top: 80, left: 40, right: 40, bottom: Math.round(window.innerHeight * 0.45) + 40 } : { top: 80, left: 40, bottom: 40, right: 380 + 40 },
    maxZoom: 17,
    duration: 600,
  });
}

/** Which tracks are drawn on the map: the open one, or all of them. Nothing while drawing (the drawing is the focus). */
export function useSavedLayer(map: maplibregl.Map | null): void {
  const { selected, showAll, tracks, drawing, extendingId } = useStore();
  const cache = useRef(new Map<string, Track>());
  const [, bump] = useState(0);

  useEffect(() => {
    if (!showAll) return undefined;
    let dead = false;
    const need = tracks.filter((t) => !cache.current.has(t.id)).slice(0, 100);
    (async () => {
      for (let i = 0; i < need.length && !dead; i += 4) {
        await Promise.all(need.slice(i, i + 4).map((t) => api.get(t.id).then((full) => { cache.current.set(full.id, full); }).catch(() => undefined)));
        if (!dead) bump((n) => n + 1);
      }
    })();
    return () => { dead = true; };
  }, [showAll, tracks]);

  useEffect(() => {
    if (!map) return;
    let list: SavedLine[] = [];
    if (!drawing || !extendingId) {
      if (showAll && !drawing) list = [...cache.current.values()].filter((t) => tracks.some((x) => x.id === t.id)).map((t) => ({ id: t.id, name: t.name, color: t.color, lines: t.geometry.coordinates }));
      if (selected && !drawing && !list.some((l) => l.id === selected.id)) list.push({ id: selected.id, name: selected.name, color: selected.color, lines: selected.geometry.coordinates });
      if (selected && !showAll && !drawing) list = list.filter((l) => l.id === selected.id);
    }
    if (map.isStyleLoaded() || map.getSource('saved')) setSaved(map, list);
    else map.once('style.load', () => setSaved(map, list));
  });
}

export function SaveDialog({ onSaved }: { onSaved: (t: Track) => void }) {
  const { draw, mode, units, extendingId, drawColor, setDrawColor, setSaving, toast } = useStore();
  const lines = useMemo(() => finish(draw), [draw]);
  const existing = useStore((s) => (s.extendingId ? s.selected : null));
  const imported = useStore((s) => s.imported);
  const [name, setName] = useState(existing?.name ?? imported?.name ?? `Track – ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`);
  const [notes, setNotes] = useState(existing?.notes ?? imported?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const km = totalKm(lines);
  const points = lines.reduce((n, l) => n + l.length, 0);

  useEffect(() => { first.current?.focus(); first.current?.select(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSaving(false); }; // back to drawing, nothing lost
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSaving]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const geometry = { type: 'MultiLineString' as const, coordinates: lines };
      const track = extendingId
        ? await api.update(extendingId, { name: name.trim(), notes: notes.trim() || null, color: drawColor, geometry })
        : await api.create({ name: name.trim(), notes: notes.trim() || null, color: drawColor, geometry, drawMode: imported ? 'import' : mode === 'click' ? 'click' : 'freehand' });
      toast('ok', 'Saved');
      onSaved(track);
    } catch (err) { toast('error', errText(err)); setBusy(false); }
  }

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" role="dialog" aria-modal="true" aria-label="Save track" onSubmit={submit}>
        <h2>{extendingId ? 'Save changes' : 'Save track'}</h2>
        <label>Name<input ref={first} value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} /></label>
        <label>Notes (optional)<textarea value={notes} maxLength={2000} rows={3} onChange={(e) => setNotes(e.target.value)} /></label>
        <Swatches value={drawColor} onChange={setDrawColor} />
        <p className="stats">{formatDistance(km, units)} · {points} points</p>
        <div className="row">
          <button type="button" onClick={() => setSaving(false)}>Keep drawing</button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  );
}

function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <fieldset className="swatches">
      <legend>Colour</legend>
      {COLORS.map((c) => (
        <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={value.toUpperCase() === c} onClick={() => onChange(c)} />
      ))}
    </fieldset>
  );
}

export function TracksPanel({ map }: { map: maplibregl.Map | null }) {
  const { panel, setPanel, tracks, setTracks, selected, select, showAll, setShowAll, units, toast } = useStore();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const load = useCallback(async (query: string, after: string | null) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const r = await api.list({ q: query, cursor: after });
      if (id !== reqId.current) return;
      setTracks(after ? [...useStore.getState().tracks, ...r.tracks] : r.tracks);
      setCursor(r.nextCursor);
      setLoaded(true);
    } catch (e) { toast('error', errText(e)); } finally { if (id === reqId.current) setLoading(false); }
  }, [setTracks, toast]);

  useEffect(() => {
    if (panel === 'closed') return undefined;
    const t = setTimeout(() => { void load(q, null); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [panel === 'closed', q, load]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading) return undefined;
    const io = new IntersectionObserver((es) => { if (es[0]?.isIntersecting) void load(q, cursor); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, q, load, panel]);

  async function open(t: TrackSummary) {
    try {
      const full = await api.get(t.id);
      select(full);
      if (map) fitTo(map, full.bbox);
    } catch (e) { toast('error', errText(e)); }
  }

  const togglePicked = (id: string) => { setConfirming(false); setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const allPicked = tracks.length > 0 && picked.size === tracks.length;
  async function deletePicked() {
    if (!picked.size || deleting) return;
    setDeleting(true);
    try {
      const ids = [...picked];
      const r = await api.removeMany(ids);
      const gone = new Set(ids);
      setTracks(useStore.getState().tracks.filter((t) => !gone.has(t.id)));
      if (useStore.getState().selected && gone.has(useStore.getState().selected!.id)) useStore.getState().select(null);
      setPicked(new Set());
      toast('ok', r.deleted === 1 ? 'Deleted 1 track' : `Deleted ${r.deleted} tracks`);
    } catch (e) { toast('error', errText(e)); } finally { setDeleting(false); setConfirming(false); }
  }

  if (panel === 'closed') return null;
  if (panel === 'detail' && selected) return <TrackDetail map={map} track={selected} onChanged={(t) => { select(t); void load(q, null); }} onGone={() => { select(null); setPanel('tracks'); void load(q, null); }} />;

  return (
    <aside className="panel" aria-label="Tracks">
      <div className="panel-head">
        <h2>Tracks</h2>
        <button type="button" onClick={() => setPanel('closed')} aria-label="Close tracks">✕</button>
      </div>
      <input type="search" aria-label="Search tracks" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
      <label className="check"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all on map</label>
      {tracks.length > 0 && (
        <div className="row">
          <button type="button" onClick={() => { setConfirming(false); setPicked(allPicked ? new Set() : new Set(tracks.map((t) => t.id))); }}>{allPicked ? 'Deselect all' : 'Select all'}</button>
          {confirming ? (
            <>
              <span>Delete {picked.size} {picked.size === 1 ? 'track' : 'tracks'}?</span>
              <button type="button" className="danger" disabled={deleting} onClick={() => void deletePicked()}>Yes</button>
              <button type="button" onClick={() => setConfirming(false)}>No</button>
            </>
          ) : (
            <button type="button" className="danger" disabled={!picked.size} onClick={() => setConfirming(true)}>Delete{picked.size ? ` (${picked.size})` : ''}</button>
          )}
        </div>
      )}
      <ul className="tracklist">
        {tracks.map((t) => (
          <li key={t.id} className={picked.has(t.id) ? 'picked' : ''}>
            <label className="pick"><input type="checkbox" aria-label={`Select ${t.name}`} checked={picked.has(t.id)} onChange={() => togglePicked(t.id)} /></label>
            <button type="button" onClick={() => void open(t)}>
              <span className="dot" style={{ background: t.color }} />
              <span className="tname">{t.name}</span>
              <span className="tmeta">{formatDistance(t.distanceM / 1000, units)} · {fmtDate(t.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
      {loaded && !tracks.length && <p className="hint">{q ? 'No tracks match.' : 'No saved tracks yet. Tap Draw to trace one.'}</p>}
      {loading && <p className="hint">Loading…</p>}
      <div ref={sentinel} style={{ height: 1 }} />
    </aside>
  );
}

function TrackDetail({ map, track, onChanged, onGone }: { map: maplibregl.Map | null; track: Track; onChanged: (t: Track) => void; onGone: () => void }) {
  const { units, setPanel, startDrawing, setExtendingId, setDrawColor, setMode, select, toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  const [notes, setNotes] = useState(track.notes ?? '');
  const [color, setColor] = useState(track.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setName(track.name); setNotes(track.notes ?? ''); setColor(track.color); setEditing(false); setConfirmDelete(false); }, [track.id, track.updatedAt, track.name, track.notes, track.color]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { onChanged(await api.update(track.id, { name: name.trim(), notes: notes.trim() || null, color })); toast('ok', 'Saved'); } catch (err) { toast('error', errText(err)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.remove(track.id); toast('ok', 'Deleted'); onGone(); } catch (err) { toast('error', errText(err)); setBusy(false); }
  }
  async function exportGpx() {
    try { await api.downloadGpx(track.id, track.name); } catch (err) { toast('error', errText(err)); }
  }
  /** Open the track in the drawing tools: Extend continues it, Edit points reshapes it. Saving writes back over the same track. */
  function reopen(mode: 'extend' | 'edit') {
    startDrawing(fromLines(track.geometry.coordinates));
    setExtendingId(track.id);
    setDrawColor(track.color);
    if (mode === 'edit') setMode('edit');
    else if (useStore.getState().mode === 'edit') setMode('freehand');
    // keep `selected` so the save dialog can prefill; the map layer hides it while extending
    const last = track.geometry.coordinates.at(-1)?.at(-1);
    if (map && last) map.easeTo({ center: last, duration: 400 });
  }

  return (
    <aside className="panel" aria-label="Track detail">
      <div className="panel-head">
        <button type="button" onClick={() => select(null)}>← Tracks</button>
        <button type="button" onClick={() => { select(null); setPanel('closed'); }} aria-label="Close">✕</button>
      </div>
      {editing ? (
        <form className="stack" onSubmit={save}>
          <label>Name<input value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} /></label>
          <label>Notes<textarea value={notes} rows={4} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /></label>
          <Swatches value={color} onChange={setColor} />
          <div className="row">
            <button type="button" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="primary" disabled={busy || !name.trim()}>Save</button>
          </div>
        </form>
      ) : (
        <>
          <h2 className="tdetail-name"><span className="dot" style={{ background: track.color }} /> {track.name}</h2>
          <p className="big">{formatDistance(track.distanceM / 1000, units)}</p>
          <p className="hint">{fmtDate(track.createdAt)} · {track.pointCount} points</p>
          {track.notes && <p className="notes">{track.notes}</p>}
          <div className="stack">
            <button type="button" onClick={() => setEditing(true)}>Rename / edit</button>
            <button type="button" onClick={() => reopen('edit')}>Edit points</button>
            <button type="button" onClick={() => reopen('extend')}>Extend</button>
            <button type="button" onClick={() => void exportGpx()}>Export GPX</button>
            {confirmDelete ? (
              <div className="row">
                <span>Delete this track?</span>
                <button type="button" className="danger" disabled={busy} onClick={() => void remove()}>Yes</button>
                <button type="button" onClick={() => setConfirmDelete(false)}>No</button>
              </div>
            ) : (
              <button type="button" className="danger" onClick={() => setConfirmDelete(true)}>Delete</button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/** Offered on load when a drawing was left unsaved (autosaved to localStorage every 2 s while drawing). */
const DRAFT_KEY = 'route-tracer:draft';
interface Draft { lines: [number, number][][]; mode: 'freehand' | 'click' | 'edit'; extendingId: string | null; color: string }

export function useAutosave(): void {
  const { drawing, draw, mode, extendingId, drawColor } = useStore();
  const latest = useRef({ draw, mode, extendingId, drawColor });
  latest.current = { draw, mode, extendingId, drawColor };
  useEffect(() => {
    if (!drawing) return undefined;
    const t = setInterval(() => {
      const l = latest.current;
      const lines = displayLines(l.draw).filter((x) => x.length > 0);
      try {
        if (lines.length) localStorage.setItem(DRAFT_KEY, JSON.stringify({ lines, mode: l.mode, extendingId: l.extendingId, color: l.drawColor } satisfies Draft));
      } catch { /* private window */ }
    }, 2000);
    return () => clearInterval(t);
  }, [drawing]);
}

export const clearDraft = (): void => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* none */ } };

export function RecoveryBanner() {
  const { drawing, startDrawing, setMode, setExtendingId, setDrawColor, select } = useStore();
  const [draft, setDraft] = useState<Draft | null>(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null;
      return d && Array.isArray(d.lines) && d.lines.length ? d : null;
    } catch { return null; }
  });
  if (!draft || drawing) return null;
  const km = totalKm(draft.lines);
  return (
    <div className="banner" role="alert">
      <span>Unsaved drawing found ({formatDistance(km, useStore.getState().units)}).</span>
      <button type="button" className="primary" onClick={() => {
        setMode(draft.mode);
        startDrawing(fromLines(draft.lines));
        setDrawColor(draft.color);
        setExtendingId(draft.extendingId);
        if (draft.extendingId) api.get(draft.extendingId).then(select).catch(() => setExtendingId(null)); // the track being extended; gone -> save as a new one
        const b = bboxOf(draft.lines);
        if (b) window.dispatchEvent(new CustomEvent('route-tracer:fit', { detail: b }));
        setDraft(null);
      }}>Restore</button>
      <button type="button" onClick={() => { clearDraft(); setDraft(null); }}>Discard</button>
    </div>
  );
}
