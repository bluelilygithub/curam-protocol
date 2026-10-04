// Render photo panel (Spec Addition A2, M4.7): choose a view, lighting, size and quality, then watch a path-traced picture sharpen,
// and download it as a PNG. Never changes the project. Lazy-loaded with the 3D chunk.
import { useEffect, useMemo, useRef, useState } from 'react';
import { projectName } from '../engine/roomOps';
import type { SavedView } from '../engine/types';
import { useApp, useProject, useUi } from '../ui/AppContext';
import { presetCamera, type CameraState } from './cameraPresets';
import { autoStops } from './tour';
import {
  DEFAULT_SIZE_ID, formatDuration, INSIDE_FOV, LIGHTING, ORBIT_FOV, PHOTO_EXPECTATIONS, PHOTO_TIPS, photoFileName, PhotoJob, QUALITY_LABELS, QUALITY_SAMPLES, SIZE_PRESETS, SLOW_WARNING_SECONDS, sizeById,
  type JobSnapshot, type PhotoLighting, type PhotoQuality,
} from './photo';
import { checkPhotoSupport, PathTracerTracer } from './photoTracer';

const NO_VIEWS: SavedView[] = [];
const IDLE: JobSnapshot = { state: 'idle', samples: 0, target: 1, progress: 0, samplesPerSecond: 0, etaSeconds: null, message: '', phase: '' };

const viewToCamera = (v: SavedView): CameraState => ({ position: v.cameraPosition, target: v.target, projection: 'perspective', zoom: v.zoom ?? 1 });

export function PhotoPanel() {
  const app = useApp();
  const open = useUi((s) => s.photoOpen);
  const views = useProject((s) => s.project?.savedViews ?? NO_VIEWS);
  const [source, setSource] = useState('current');
  const [lighting, setLighting] = useState<PhotoLighting>('daylight');
  const [sizeId, setSizeId] = useState(DEFAULT_SIZE_ID);
  const [quality, setQuality] = useState<PhotoQuality>('draft');
  const [caption, setCaption] = useState(true);
  const [snap, setSnap] = useState<JobSnapshot>(IDLE);
  const [problem, setProblem] = useState<string | null>(null);
  const job = useRef<PhotoJob | null>(null);
  const tracer = useRef<PathTracerTracer | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const size = sizeById(sizeId);
  const unsupported = useMemo(() => (open ? checkPhotoSupport(size.width, size.height) : null), [open, size.width, size.height]);
  const running = snap.state === 'building' || snap.state === 'rendering' || snap.state === 'paused';

  const teardown = (): void => {
    cancelAnimationFrame(raf.current);
    job.current?.dispose();
    job.current = null;
    tracer.current = null;
    if (holder.current) holder.current.replaceChildren();
  };

  // closing the panel (or leaving the page) releases the renderer
  useEffect(() => { if (!open) { teardown(); setSnap(IDLE); setProblem(null); } }, [open]);
  useEffect(() => teardown, []);

  const close = (): void => { teardown(); app.ui.getState().setPhotoOpen(false); };

  // Esc stops a render in progress first, then closes the panel
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); e.preventDefault();
      const j = job.current;
      if (j && !j.finished) j.stop('Stopped');
      else close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // eye-level views from inside the room (the same stops the fly-through uses): the entrance and the far corners
  const room0 = useProject((s) => s.project?.rooms[0]);
  const insideStops = useMemo(() => (room0 ? autoStops(room0, false).filter((s) => s.inside) : []), [room0]);
  const insideCamera = (id: string): CameraState | null => {
    const n = Number(id.replace('inside:', ''));
    const s = Number.isInteger(n) ? insideStops[n] : undefined;
    return s ? { position: s.position, target: s.target, projection: 'perspective', zoom: 1 } : null;
  };
  const cameraFor = (): CameraState | null => {
    if (source.startsWith('inside:')) return insideCamera(source);
    if (source !== 'current') { const v = views.find((x) => x.id === source); if (v) return viewToCamera(v); }
    const cur = app.camera.getState().camera;
    if (cur) return cur;
    const room = app.project.getState().project?.rooms[0];
    return room ? presetCamera(room, 'iso', null) : null;
  };

  const start = (): void => {
    const cam = cameraFor();
    if (!cam || unsupported) return;
    teardown();
    setProblem(null);
    const t = new PathTracerTracer({ project: app.project, camera: cam, width: size.width, height: size.height, lighting, fov: source.startsWith('inside:') ? INSIDE_FOV : ORBIT_FOV });
    tracer.current = t;
    holder.current?.replaceChildren(t.previewCanvas);
    const j = new PhotoJob(t, QUALITY_SAMPLES[quality]);
    job.current = j;
    j.subscribe(setSnap);
    // the design is never edited while rendering; if it changes anyway, the picture no longer matches it
    const projectAtStart = app.project.getState().project;
    const unsub = app.project.subscribe((s) => { if (s.project !== projectAtStart) j.stop('The design changed, so the render was stopped.'); });
    const loop = (now: number): void => {
      if (job.current !== j) { unsub(); return; }
      j.tick(now);
      if (j.finished) { unsub(); return; }
      raf.current = requestAnimationFrame(loop);
    };
    void j.start().then(() => { if (job.current === j && !j.finished) raf.current = requestAnimationFrame(loop); else unsub(); });
  };

  const pauseResume = (): void => {
    const j = job.current;
    if (!j) return;
    if (j.state === 'paused') { j.resume(); raf.current = requestAnimationFrame(function again(now) { if (job.current !== j) return; j.tick(now); if (!j.finished) raf.current = requestAnimationFrame(again); }); }
    else j.pause();
  };

  const download = async (): Promise<void> => {
    const t = tracer.current;
    if (!t) return;
    try {
      const p = app.project.getState().project;
      const room = p?.rooms[0]?.name ?? '';
      const proj = p ? projectName(p) : 'Room';
      const date = new Date();
      const blob = await t.toBlob(caption ? { project: proj, room, date } : undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = photoFileName(proj, room, date); a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not make the picture file.');
    }
  };

  if (!open) return null;
  const finished = snap.state === 'done' || snap.state === 'stopped';
  const hasPicture = snap.samples > 0 && snap.state !== 'failed';
  const slow = snap.state === 'rendering' && snap.etaSeconds !== null && snap.etaSeconds > SLOW_WARNING_SECONDS;

  return (
    <div className="modal-backdrop photo-backdrop">
      <div className="modal photo-panel" role="dialog" aria-modal="true" aria-label="Render photo">
        <div className="modal-head">
          <h2>Render photo</h2>
          <button className="btn icon" onClick={close} aria-label="Close render photo" title="Close (Esc)">×</button>
        </div>
        <p className="photo-caption" data-testid="photo-expectations">{PHOTO_EXPECTATIONS}</p>
        {unsupported && <p className="storage-note" role="alert">{unsupported}</p>}
        <div className="photo-body">
          <div className="photo-stage">
            <div ref={holder} className="photo-canvas" data-testid="photo-canvas" />
            {snap.state === 'idle' && <p className="photo-hint">Pick a view, lighting and size, then press Render. The picture starts grainy and sharpens while it works.</p>}
            {(snap.state === 'building' || (snap.state === 'rendering' && snap.samples === 0)) && (
              <div className="photo-busy" role="status" aria-live="polite">
                <span className="busy-bar" aria-hidden="true"><i /></span>
                <span>{snap.phase || 'Getting ready…'}</span>
                <span className="busy-note">This is the slow part before the first picture appears. It is working, even if the screen looks still.</span>
              </div>
            )}
          </div>
          <div className="photo-controls">
            <label title="Which camera position to photograph from: the 3D view as it is now, or one of your saved views">View
              <select value={source} onChange={(e) => setSource(e.target.value)} disabled={running} aria-label="View">
                <option value="current">Current 3D view</option>
                {insideStops.map((s, i) => <option key={`in-${i}`} value={`inside:${i}`}>Inside the room: {s.label === 'Entrance' ? 'from the entrance' : `corner view ${insideStops.slice(0, i + 1).filter((x) => x.label !== 'Entrance').length}`}</option>)}
                {views.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
            <label title="Daylight is bright with a clear sun; Overcast is soft and even; Evening is low and warm">Lighting
              <select value={lighting} onChange={(e) => setLighting(e.target.value as PhotoLighting)} disabled={running} aria-label="Lighting">
                {Object.values(LIGHTING).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <label title="Larger pictures take longer. 640 × 360 is a quick look; 1920 × 1080 suits most screens; 4K is for print">Size
              <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} disabled={running} aria-label="Size">
                {SIZE_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </label>
            <label title="More passes give a smoother picture and take longer. Draft to check, Good for a client, Best for the finished piece">Quality
              <select value={quality} onChange={(e) => setQuality(e.target.value as PhotoQuality)} disabled={running} aria-label="Quality">
                {(Object.keys(QUALITY_LABELS) as PhotoQuality[]).map((q) => <option key={q} value={q}>{QUALITY_LABELS[q]} ({QUALITY_SAMPLES[q]} passes)</option>)}
              </select>
            </label>
            <label className="check" title="Adds a thin strip under the picture with the project name, room and date"><input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} /> Add a caption (project, room, date)</label>

            {snap.state === 'idle' && (
              <ul className="photo-tips" aria-label="Tips for a better picture">
                {PHOTO_TIPS.map((t) => <li key={t}>{t}</li>)}
              </ul>
            )}
            {(finished || (running && snap.samples > 0)) && (
              <div className="photo-progress" role="status" aria-live="polite">
                <div className="bar"><div className="fill" style={{ width: `${Math.round(snap.progress * 100)}%` }} /></div>
                <span>
                  {snap.state === 'done' ? 'Done' : snap.state === 'stopped' ? snap.message || 'Stopped' : snap.state === 'paused' ? 'Paused' : snap.state === 'building' ? 'Building the scene…' : `${Math.round(snap.progress * 100)}% · about ${formatDuration(snap.etaSeconds)} left`}
                </span>
              </div>
            )}
            {slow && <p className="storage-note" role="status">This will take a while on this computer. Draft quality or a smaller size is quicker.</p>}
            {snap.state === 'failed' && <p className="storage-note" role="alert">The render failed: {snap.message.replace(/[.\s]+$/, '')}. The Realistic 3D view still works.</p>}
            {problem && <p className="storage-note" role="alert">{problem}</p>}

            <div className="photo-actions">
              {!running && <button className="btn primary" title="Start making the picture. Your design is not changed." onClick={start} disabled={!!unsupported}>{finished || snap.state === 'failed' ? 'Render again' : 'Render'}</button>}
              {(snap.state === 'rendering' || snap.state === 'paused') && <button className="btn" title="Pause or resume the render; the picture so far is kept" onClick={pauseResume}>{snap.state === 'paused' ? 'Resume' : 'Pause'}</button>}
              {running && <button className="btn" title="Stop here and keep the picture so far (Esc)" onClick={() => job.current?.stop('Stopped')}>Stop</button>}
              <button className="btn primary" title="Save the picture as a PNG file" onClick={() => void download()} disabled={!hasPicture}>Download PNG</button>
              <button className="btn" title="Close this panel and return to the 3D view" onClick={close}>Back to 3D</button>
            </div>
            <p className="storage-note">Your design is not changed. Esc stops a render, then closes this panel. Size {size.width} × {size.height}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PhotoPanel;
