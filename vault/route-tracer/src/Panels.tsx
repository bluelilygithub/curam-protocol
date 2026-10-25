import { ToolList } from './ToolList';
import { ChevronLeft, Star } from 'lucide-react';
import type maplibregl from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, type Track, type TrackSummary } from './api';
import { displayLines, finish, fromLines } from './drawing';
import { bboxOf, formatDistance, sameLines, totalKm, type BBox } from './geo';
import { DirectionsList } from './Directions';
import { setSaved, type SavedLine } from './mapLayers';
import { ElevationChart } from './ElevationChart';
import { ExportPdf } from './ExportPdf';
import { SendToWatch } from './SendToWatch';
import { buildCuePdf } from './cuePdf';
import { usePlan } from './Plan';
import { findStart, loopChoices } from './suggest';
import { fitToLimit } from './gpx';
import { fitPadding } from './layout';
import { Field, Mic } from './Mic';
import { tidySpoken } from './voice';
import { COLORS, useStore } from './store';

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const errText = (e: unknown): string => (e instanceof Error ? e.message : 'That did not work.');
const TRACKS_CHANGED = 'route-tracer:tracks-changed';

/** After a delete: say so, say it is kept for 30 days, and offer Undo (puts it back from Vault's recycle bin). */
function offerUndo(text: string, binIds: string[]): void {
  const { toast } = useStore.getState();
  if (!binIds.length) { toast('ok', text); return; }
  toast('ok', `${text} Kept 30 days in the recycle bin.`, 10000, {
    label: 'Undo',
    onClick: () => {
      void (async () => {
        try {
          for (const id of binIds) await api.restore(id);
          toast('ok', 'Restored');
        } catch { toast('error', 'That could not be restored. Look in Vault Settings → Recycle bin.'); }
        window.dispatchEvent(new Event(TRACKS_CHANGED));
      })();
    },
  });
}

/** Fit the map to a track (the sidebar is beside the map on a computer; on a phone it is a sheet over the bottom, and room is left for it). */
export function fitTo(map: maplibregl.Map, bbox: BBox): void {
  map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: fitPadding(), maxZoom: 17, duration: 600 });
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
  const lines = useMemo(() => fitToLimit(finish(draw)).lines, [draw]); // a long road-following route can have more points than a track holds: thinned only if so
  const existing = useStore((s) => (s.extendingId ? s.selected : null));
  const imported = useStore((s) => s.imported);
  const planned = useStore((s) => s.planned);
  const plannedCues = useStore((s) => s.plannedCues);
  // directions are kept only while the line is still the one they were made for: moved points or new strokes would make them point at the wrong places
  const cues = plannedCues && sameLines(plannedCues.lines, lines) ? plannedCues.cues : null;
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
        ? await api.update(extendingId, { name: name.trim(), notes: notes.trim() || null, color: drawColor, geometry, cues })
        : await api.create({ name: name.trim(), notes: notes.trim() || null, color: drawColor, geometry, cues, drawMode: imported ? 'import' : planned ? 'route' : mode === 'click' || draw.snap ? 'click' : 'freehand' });
      toast('ok', 'Saved');
      onSaved(track);
    } catch (err) { toast('error', errText(err)); setBusy(false); }
  }

  return (
    <div className="modal-back" role="presentation">
      <form className="modal" role="dialog" aria-modal="true" aria-label="Save track" onSubmit={submit}>
        <h2>{extendingId ? 'Save changes' : 'Save track'}</h2>
        <Field label="Name">{(id) => <span className="vwrap"><input id={id} ref={first} title="A short name for this track, up to 120 characters" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} /><Mic onText={(t) => setName(t.slice(0, 120))} onDone={(t) => { setName(tidySpoken(t).slice(0, 120)); }} /></span>}</Field>
        <Field label="Notes (optional)">{(id) => <span className="vwrap vwrap-area"><textarea id={id} title="Anything worth remembering about this route: surface, parking, turnaround points" value={notes} maxLength={2000} rows={3} onChange={(e) => setNotes(e.target.value)} /><Mic area label="Speak a note, added to the end" onDone={(t) => { setNotes((n) => `${n.trim() ? `${n.trim()} ` : ''}${t.trim()}`.slice(0, 2000)); }} /></span>}</Field>
        <Swatches value={drawColor} onChange={setDrawColor} />
        <p className="stats">{formatDistance(km, units)} · {points} points{cues ? ` · ${cues.length} directions` : ''}</p>
        {planned && !cues && <p className="hint" data-testid="no-directions">{plannedCues ? 'Directions are not saved: the line no longer matches the planned route.' : 'This route came without directions, so none are saved.'}</p>}
        <div className="row">
          <button type="button" onClick={() => setSaving(false)} title="Go back to the drawing without saving (Escape does the same)">Keep drawing</button>
          <button type="submit" className="primary" disabled={busy || !name.trim()} title="Save this track to your Vault account">{busy ? 'Saving…' : 'Save'}</button>
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
        <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Colour ${c}`} title={`Colour the line ${c}`} aria-pressed={value.toUpperCase() === c} onClick={() => onChange(c)} />
      ))}
    </fieldset>
  );
}

/** Three ready-made loops on the home screen: one press sets up Plan route as a loop of that length from where you are (or your last start). */
function SuggestedLoops({ map }: { map: maplibregl.Map | null }) {
  const { routePlanning, drawing, units, toast } = useStore();
  const planning = usePlan((s) => s.active);
  const [busy, setBusy] = useState<number | null>(null);
  if (!routePlanning || drawing || planning) return null;
  async function go(km: number) {
    setBusy(km);
    try {
      const start = await findStart();
      if (!start) { toast('error', 'Allow your location, or open Plan a route and tap the map for a start, and the loops will start from there next time.', 6000); return; }
      const p = usePlan.getState();
      p.start();
      p.setKind('loop');
      p.setLengthKm(km);
      p.setFrom(start.pos);
      map?.flyTo({ center: start.pos, zoom: Math.max(map.getZoom(), 13.5), duration: 600 });
      if (start.source === 'remembered') toast('ok', 'Your location was not available, so the loops start from the last place you used. Drag the A pin to move it.', 5000);
    } finally { setBusy(null); }
  }
  return (
    <section className="suggest" aria-label="Suggested loops" data-testid="suggested-loops">
      <h3>Suggested loops</h3>
      <p className="hint">A round trip from where you are. Pick a length.</p>
      <div className="suggest-row">
        {loopChoices(units).map((c) => (
          <button key={c.label} type="button" disabled={busy !== null} aria-busy={busy === c.km} onClick={() => void go(c.km)}
            title={`Find loops of about ${c.label} that start and end where you are now (your browser asks for your location the first time). Falls back to the last place you started from.`}>{busy === c.km ? '…' : c.label}</button>
        ))}
      </div>
    </section>
  );
}

export function TracksPanel({ map }: { map: maplibregl.Map | null }) {
  const { panel, setPanel, tracks, setTracks, selected, select, showAll, setShowAll, units, toast } = useStore();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);
  const qRef = useRef(q);
  qRef.current = q;
  const favRef = useRef(favOnly);
  favRef.current = favOnly;

  const load = useCallback(async (query: string, after: string | null, favourite = favRef.current) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const r = await api.list({ q: query, cursor: after, favourite });
      if (id !== reqId.current) return;
      setTracks(after ? [...useStore.getState().tracks, ...r.tracks] : r.tracks);
      setCursor(r.nextCursor);
      setLoaded(true);
    } catch (e) { toast('error', errText(e)); } finally { if (id === reqId.current) setLoading(false); }
  }, [setTracks, toast]);

  useEffect(() => {
    const t = setTimeout(() => { void load(q, null); }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q, favOnly, load]);

  // a delete was undone (or something else changed the list): ask again
  useEffect(() => {
    const again = (): void => { void load(qRef.current, null, favRef.current); };
    window.addEventListener(TRACKS_CHANGED, again);
    return () => window.removeEventListener(TRACKS_CHANGED, again);
  }, [load]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !cursor || loading) return undefined;
    const io = new IntersectionObserver((es) => { if (es[0]?.isIntersecting) void load(q, cursor); }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [cursor, loading, q, load]);

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
      offerUndo(r.deleted === 1 ? 'Deleted 1 track.' : `Deleted ${r.deleted} tracks.`, r.binIds ?? []);
    } catch (e) { toast('error', errText(e)); } finally { setDeleting(false); setConfirming(false); }
  }

  if (panel === 'detail' && selected) return <TrackDetail map={map} track={selected} onChanged={(t) => { select(t); void load(q, null); }} onGone={() => { select(null); setPanel('tracks'); void load(q, null); }} />;

  return (
    <section className="side-view" role="complementary" aria-label="Tracks" data-tour="rt-panel">
      <div className="side-head">
        <ToolList map={map} />
        <h2>Your tracks</h2>
        <span className="vwrap"><input type="search" aria-label="Search tracks" title="Type part of a track name to filter the list" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} /><Mic label="Speak part of a track name" onText={setQ} onDone={(t) => { setQ(tidySpoken(t)); }} /></span>
      </div>
      <div className="side-body">
        <SuggestedLoops map={map} />
        <label className="check" title="List only the tracks you have starred as favourites"><input type="checkbox" title="List only your favourite tracks" checked={favOnly} onChange={(e) => setFavOnly(e.target.checked)} /> Favourites only</label>
        <label className="check" title="Draw every saved track on the map at once, not just the open one"><input type="checkbox" title="Draw every saved track on the map at once" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all on map</label>
        {tracks.length > 0 && (
          <div className="row">
            <button type="button" onClick={() => { setConfirming(false); setPicked(allPicked ? new Set() : new Set(tracks.map((t) => t.id))); }} title="Tick or untick every track in the list">{allPicked ? 'Deselect all' : 'Select all'}</button>
            {confirming ? (
              <>
                <span>Delete {picked.size} {picked.size === 1 ? 'track' : 'tracks'}?</span>
                <button type="button" className="danger" disabled={deleting} onClick={() => void deletePicked()} title="Yes, delete the ticked tracks. They are kept for 30 days in the recycle bin, so you can undo it.">Yes</button>
                <button type="button" onClick={() => setConfirming(false)} title="No, keep them">No</button>
              </>
            ) : (
              <button type="button" className="danger" disabled={!picked.size} onClick={() => setConfirming(true)} title="Delete the ticked tracks (asks first)">Delete{picked.size ? ` (${picked.size})` : ''}</button>
            )}
          </div>
        )}
        <ul className="tracklist">
          {tracks.map((t) => (
            <li key={t.id} className={picked.has(t.id) ? 'picked' : ''}>
              <label className="pick"><input type="checkbox" aria-label={`Select ${t.name}`} title="Tick to select this track for deleting" checked={picked.has(t.id)} onChange={() => togglePicked(t.id)} /></label>
              <button type="button" onClick={() => void open(t)} title="Open this track: show it on the map with its details">
                <span className="dot" style={{ background: t.color }} />
                <span className="tname">{t.favourite ? <Star size={13} aria-label="Favourite" className="fav-on" /> : null}{t.name}</span>
                <span className="tmeta">{formatDistance(t.distanceM / 1000, units)} · {fmtDate(t.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
        {loaded && !tracks.length && <p className="hint">{q || favOnly ? 'No tracks match.' : 'No saved tracks yet. Choose Draw a route to trace one, or Plan a route to find one.'}</p>}
        {loading && <p className="hint">Loading…</p>}
        <div ref={sentinel} style={{ height: 1 }} />
      </div>
    </section>
  );
}

function TrackDetail({ map, track, onChanged, onGone }: { map: maplibregl.Map | null; track: Track; onChanged: (t: Track) => void; onGone: () => void }) {
  const { units, startDrawing, setExtendingId, setDrawColor, setMode, select, toast } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(track.name);
  const [notes, setNotes] = useState(track.notes ?? '');
  const [color, setColor] = useState(track.color);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [watchOpen, setWatchOpen] = useState(false);
  const [cuePdfBusy, setCuePdfBusy] = useState(false);
  const [fav, setFav] = useState(track.favourite);

  useEffect(() => { setPdfOpen(false); setWatchOpen(false); setName(track.name); setNotes(track.notes ?? ''); setColor(track.color); setEditing(false); setConfirmDelete(false); setFav(track.favourite); }, [track.id, track.updatedAt, track.name, track.notes, track.color, track.favourite]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try { onChanged(await api.update(track.id, { name: name.trim(), notes: notes.trim() || null, color })); toast('ok', 'Saved'); } catch (err) { toast('error', errText(err)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { const r = await api.remove(track.id); offerUndo(`Deleted ${track.name}.`, r?.binId ? [r.binId] : []); onGone(); } catch (err) { toast('error', errText(err)); setBusy(false); }
  }
  /** The directions as a printable PDF, made in the browser and saved from a Blob link. */
  async function directionsPdf() {
    if (!track.cues?.length || cuePdfBusy) return;
    setCuePdfBusy(true);
    try {
      const bytes = await buildCuePdf({ title: track.name, notes: track.notes, dateLabel: fmtDate(track.createdAt), color: track.color, units, totalM: track.distanceM, cues: track.cues });
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${track.name.replace(/[^\w\- .]+/g, '_').trim().slice(0, 80) || 'track'} - directions.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (err) { toast('error', errText(err)); } finally { setCuePdfBusy(false); }
  }
  async function toggleFavourite() {
    const next = !fav;
    setFav(next);
    try { onChanged(await api.update(track.id, { favourite: next })); toast('ok', next ? 'Added to your favourites' : 'Removed from your favourites'); } catch (err) { setFav(!next); toast('error', errText(err)); }
  }
  /** Copy or Reverse: a NEW track (the original is not touched), opened straight away. */
  async function derive(kind: 'copy' | 'reverse') {
    setBusy(true);
    try {
      const made = await (kind === 'copy' ? api.copyTrack(track.id) : api.reverseTrack(track.id));
      window.dispatchEvent(new Event(TRACKS_CHANGED));
      useStore.getState().select(made);
      if (map) fitTo(map, made.bbox);
      toast('ok', kind === 'copy' ? `Copied as "${made.name}".` : `Reversed as "${made.name}". The original is unchanged.`);
    } catch (err) { toast('error', errText(err)); } finally { setBusy(false); }
  }
  async function exportGpx() {
    try { await api.downloadGpx(track.id, track.name); } catch (err) { toast('error', errText(err)); }
  }
  /** Open the track in the drawing tools: Extend continues it, Edit points reshapes it. Saving writes back over the same track. */
  function reopen(mode: 'extend' | 'edit') {
    startDrawing(fromLines(track.geometry.coordinates));
    useStore.getState().setPlannedCues(track.cues?.length ? { cues: track.cues, lines: track.geometry.coordinates } : null); // kept on save only if the line is left alone
    setExtendingId(track.id);
    setDrawColor(track.color);
    if (mode === 'edit') setMode('edit');
    else if (useStore.getState().mode === 'edit') setMode('freehand');
    // keep `selected` so the save dialog can prefill; the map layer hides it while extending
    const last = track.geometry.coordinates.at(-1)?.at(-1);
    if (map && mode === 'edit') fitTo(map, track.bbox); // all of it in view, so every point can be reached
    else if (map && last) map.easeTo({ center: last, duration: 400 });
  }

  return (
    <section className="side-view" role="complementary" aria-label="Track detail" data-tour="rt-panel">
      <div className="side-head">
        <button type="button" className="back" onClick={() => select(null)} title="Back to the list of tracks"><ChevronLeft size={18} aria-hidden="true" /> Tracks</button>
      </div>
      <div className="side-body">
        {editing ? (
          <form className="stack" onSubmit={save}>
            <Field label="Name">{(id) => <span className="vwrap"><input id={id} title="The track's name, up to 120 characters" value={name} maxLength={120} required onChange={(e) => setName(e.target.value)} /><Mic onText={(t) => setName(t.slice(0, 120))} onDone={(t) => { setName(tidySpoken(t).slice(0, 120)); }} /></span>}</Field>
            <Field label="Notes">{(id) => <span className="vwrap vwrap-area"><textarea id={id} title="Notes about this route" value={notes} rows={4} maxLength={2000} onChange={(e) => setNotes(e.target.value)} /><Mic area label="Speak a note, added to the end" onDone={(t) => { setNotes((n) => `${n.trim() ? `${n.trim()} ` : ''}${t.trim()}`.slice(0, 2000)); }} /></span>}</Field>
            <Swatches value={color} onChange={setColor} />
            <div className="row">
              <button type="button" onClick={() => setEditing(false)} title="Discard these changes">Cancel</button>
              <button type="submit" className="primary" disabled={busy || !name.trim()} title="Save the new name, notes and colour">Save</button>
            </div>
          </form>
        ) : (
          <>
            <h2 className="tdetail-name"><span className="dot" style={{ background: track.color }} /> {track.name}</h2>
            <p className="big">{formatDistance(track.distanceM / 1000, units)}</p>
            <p className="hint">{fmtDate(track.createdAt)} · {track.pointCount} points</p>
            {track.notes && <p className="notes">{track.notes}</p>}
            <ElevationChart lines={track.geometry.coordinates} color={track.color} name={track.name} />
            {track.cues?.length ? <DirectionsList cues={track.cues} map={map} units={units} title={track.name} /> : null}
            <div className="stack">
              <button type="button" onClick={() => void toggleFavourite()} aria-pressed={fav} title={fav ? 'This is one of your favourites. Press to remove the star.' : 'Star this track as a favourite, so you can list only your favourites'}>
                <Star size={14} aria-hidden="true" className={fav ? 'fav-on' : ''} /> {fav ? 'Favourite' : 'Add to favourites'}
              </button>
              <button type="button" onClick={() => setEditing(true)} title="Change this track's name, notes or colour">Rename / edit</button>
              <button type="button" disabled={busy} onClick={() => void derive('copy')} title="Make a copy of this track to change or extend without touching the original">Copy</button>
              <button type="button" disabled={busy} onClick={() => void derive('reverse')} title="Make a new track that goes the same way back, from the end to the start. The original stays as it is, and the directions are not copied (a left turn would become a right turn).">Reverse</button>
              <button type="button" onClick={() => reopen('edit')} title="Reshape the route: move points, add points or delete them">Edit points</button>
              <button type="button" onClick={() => reopen('extend')} title="Carry on drawing from the end of this route">Extend</button>
              <button type="button" onClick={() => void exportGpx()} title="Download this track as a GPX file for Strava, Garmin or gpx.studio">Export GPX</button>
              <button type="button" onClick={() => setWatchOpen((o) => !o)} aria-expanded={watchOpen} title="Get this route onto a Zepp watch such as the Amazfit Bip 6">Send to watch</button>
              {watchOpen && <SendToWatch track={track} />}
              <button type="button" onClick={() => setPdfOpen(true)} title="Make a printable A4 map of this route as a PDF, to download or email" data-tour="rt-pdf">Map as PDF</button>
              {track.cues?.length ? <button type="button" onClick={() => void directionsPdf()} disabled={cuePdfBusy} title="Download the turn-by-turn directions as a printable PDF list">{cuePdfBusy ? 'Making the PDF…' : 'Directions as PDF'}</button> : null}
              {confirmDelete ? (
                <div className="row">
                  <span>Delete this track?</span>
                  <button type="button" className="danger" disabled={busy} onClick={() => void remove()} title="Yes, delete this track. It is kept for 30 days in the recycle bin, so you can undo it.">Yes</button>
                  <button type="button" onClick={() => setConfirmDelete(false)} title="No, keep it">No</button>
                </div>
              ) : (
                <button type="button" className="danger" onClick={() => setConfirmDelete(true)} title="Delete this track (asks first)">Delete</button>
              )}
            </div>
          </>
        )}
      </div>
      {pdfOpen && <ExportPdf track={track} onClose={() => setPdfOpen(false)} />}
    </section>
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
      }} title="Reopen the drawing that was not saved">Restore</button>
      <button type="button" onClick={() => { clearDraft(); setDraft(null); }} title="Throw the unsaved drawing away">Discard</button>
    </div>
  );
}
