import { useEffect, useMemo, useRef, useState } from 'react';
import { saveBlob } from '@planner-core/export/csv';
import {
  DEFAULT_SIZE_ID, formatDuration, LIGHTING, ORBIT_FOV, photoFileName, PhotoJob, QUALITY_LABELS, QUALITY_SAMPLES, SIZE_PRESETS, SLOW_WARNING_SECONDS, sizeById,
  type JobSnapshot, type PhotoLighting, type PhotoQuality,
} from '@planner-core/render3d/photo';
import { MID_MONTH_DAY, solarPosition } from '../sun/solar';
import { placeFor } from '../sun/timezone';
import { MONTH_NAMES } from '../plants/growth';
import { LIGHTING_HELP, SUN_DOWN_MESSAGE } from '../render3d/photoLighting';
import type { GardenPathTracer, Pose } from '../render3d/photoTracer';
import { useApp, useProject, useUi } from './AppContext';

const IDLE: JobSnapshot = { state: 'idle', samples: 0, target: 1, progress: 0, samplesPerSecond: 0, etaSeconds: null, message: '', phase: '' };
type Source = 'current' | 'iso' | 'front' | 'top';

/** What the garden version of the panel promises: honest about what the picture is. */
export const GARDEN_EXPECTATIONS =
  'A computer-generated picture of your garden with realistic light and shadow, with the sun where the Month and Time sliders put it. Plants are simple shapes (a tree is a trunk and a ball of leaves), not botanical models, so judge the light, the layout and the shade rather than the leaves. ' +
  'It starts grainy and sharpens; Draft is quick, Good takes several minutes and Best much longer, and larger sizes take longer still. The first seconds are spent preparing, so a still screen at the start is normal.';

export const fmtHour = (h: number): string => {
  const total = Math.round(h * 60);
  const hh = Math.floor(total / 60) % 24, mm = total % 60;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
};

/** Render photo: choose a view, lighting, size and quality, watch a path-traced picture sharpen, and download it as a PNG. Never changes the garden. */
export function PhotoModal() {
  const app = useApp();
  const open = useUi((s) => s.photoOpen);
  const month = useUi((s) => s.month);
  const hour = useUi((s) => s.hour);
  const project = useProject((s) => s.project);
  const [source, setSource] = useState<Source>('current');
  const [lighting, setLighting] = useState<PhotoLighting>('daylight');
  const [sizeId, setSizeId] = useState(DEFAULT_SIZE_ID);
  const [quality, setQuality] = useState<PhotoQuality>('draft');
  const [caption, setCaption] = useState(true);
  const [snap, setSnap] = useState<JobSnapshot>(IDLE);
  const [problem, setProblem] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const job = useRef<PhotoJob | null>(null);
  const tracer = useRef<GardenPathTracer | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const raf = useRef(0);

  const size = sizeById(sizeId);
  const running = snap.state === 'building' || snap.state === 'rendering' || snap.state === 'paused';

  // where the sun is for what the sliders say (the same maths as the 3D view)
  const sun = useMemo(() => (open && project ? solarPosition(placeFor(project.location, month), month, MID_MONTH_DAY, hour) : null), [open, project, month, hour]);
  const sunDown = !!sun && sun.altitude <= 0;

  useEffect(() => {
    if (!open) return;
    let live = true;
    void import('../render3d/photoTracer').then((m) => { if (live) setUnsupported(m.checkPhotoSupport(size.width, size.height)); });
    return () => { live = false; };
  }, [open, size.width, size.height]);

  const teardown = (): void => {
    cancelAnimationFrame(raf.current);
    job.current?.dispose();
    job.current = null;
    tracer.current = null;
    if (holder.current) holder.current.replaceChildren();
  };
  useEffect(() => { if (!open) { teardown(); setSnap(IDLE); setProblem(null); } }, [open]);
  useEffect(() => teardown, []);
  const close = (): void => { teardown(); app.ui.getState().set({ photoOpen: false }); };

  // Esc stops a render in progress first, then closes the panel
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); e.preventDefault();
      const j = job.current;
      if (j && !j.finished) j.stop('Stopped'); else close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const poseFor = (): Pose | null => {
    const v = app.view3d.current;
    if (!v) return null;
    return source === 'current' ? v.cameraState() : v.presetPose(source);
  };

  const start = async (): Promise<void> => {
    const pose = poseFor();
    if (!pose) { setProblem('Open the 3D view first, then choose Render photo.'); return; }
    if (unsupported || sunDown) return;
    teardown();
    setProblem(null);
    const { GardenPathTracer } = await import('../render3d/photoTracer');
    const t = new GardenPathTracer({ app, camera: pose, width: size.width, height: size.height, lighting, fov: pose.fov ?? ORBIT_FOV });
    tracer.current = t;
    holder.current?.replaceChildren(t.previewCanvas);
    const j = new PhotoJob(t, QUALITY_SAMPLES[quality]);
    job.current = j;
    j.subscribe(setSnap);
    // the garden is copied when the picture starts, so editing while it renders cannot change it: say so rather than stopping
    const loop = (now: number): void => {
      if (job.current !== j) return;
      j.tick(now);
      if (j.finished) return;
      raf.current = requestAnimationFrame(loop);
    };
    void j.start().then(() => { if (job.current === j && !j.finished) raf.current = requestAnimationFrame(loop); });
  };

  const pauseResume = (): void => {
    const j = job.current;
    if (!j) return;
    if (j.state === 'paused') { j.resume(); raf.current = requestAnimationFrame(function again(now) { if (job.current !== j) return; j.tick(now); if (!j.finished) raf.current = requestAnimationFrame(again); }); } else j.pause();
  };

  const download = async (): Promise<void> => {
    const t = tracer.current;
    const p = app.project.getState().project;
    if (!t || !p) return;
    try {
      const date = new Date();
      const credit = p.map?.on ? (await app.mapTiles.status()).attribution : undefined;
      const blob = await t.toBlob({ ...(caption ? { caption: { project: p.name, place: p.location.label, date } } : {}), credit });
      saveBlob(blob, photoFileName(p.name, p.location.label, date));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not make the picture file.');
    }
  };

  if (!open) return null;
  const finished = snap.state === 'done' || snap.state === 'stopped';
  const hasPicture = snap.samples > 0 && snap.state !== 'failed';
  const slow = snap.state === 'rendering' && snap.etaSeconds !== null && snap.etaSeconds > SLOW_WARNING_SECONDS;
  const sunLine = sun ? (sun.altitude > 0 ? `Sun ${Math.round(sun.altitude)}° up in ${MONTH_NAMES[month - 1]} at ${fmtHour(hour)}.` : SUN_DOWN_MESSAGE) : '';

  return (
    <div className="modal-back photo-backdrop" role="presentation">
      <div className="modal wide photo-panel" role="dialog" aria-modal="true" aria-label="Render photo">
        <div className="modal-head">
          <h2>Render photo</h2>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close render photo" title="Close (Esc)">×</button>
        </div>
        <p className="photo-caption" data-testid="photo-expectations">{GARDEN_EXPECTATIONS}</p>
        {unsupported && <p className="note warn" role="alert">{unsupported}</p>}
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
            <label title="Which camera position to photograph from: the 3D view as it is now, or one of the standard views">View
              <select value={source} onChange={(e) => setSource(e.target.value as Source)} disabled={running} aria-label="View">
                <option value="current">Current 3D view</option>
                <option value="iso">Corner (Iso)</option>
                <option value="front">From the front</option>
                <option value="top">From above</option>
              </select>
            </label>
            <label title={LIGHTING_HELP}>Lighting
              <select value={lighting} onChange={(e) => setLighting(e.target.value as PhotoLighting)} disabled={running} aria-label="Lighting">
                {Object.values(LIGHTING).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
            </label>
            <p className={`note${sunDown ? ' warn' : ''}`} data-testid="photo-sun" role="status">{sunLine}</p>
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
            <label className="check" title="Adds a thin strip under the picture with the garden name, place and date"><input type="checkbox" checked={caption} onChange={(e) => setCaption(e.target.checked)} disabled={running} /> Caption under the picture</label>
            {project?.map?.on && <p className="note" data-testid="photo-map-note">The satellite map is on, so it lies on the ground in the picture, with its credit printed in the corner.</p>}

            {(finished || (running && snap.samples > 0)) && (
              <div className="photo-progress" role="status" aria-live="polite">
                <div className="bar"><div className="fill" style={{ width: `${Math.round(snap.progress * 100)}%` }} /></div>
                <span>
                  {snap.state === 'done' ? 'Done' : snap.state === 'stopped' ? snap.message || 'Stopped' : snap.state === 'paused' ? 'Paused' : snap.state === 'building' ? 'Building the scene…' : `${Math.round(snap.progress * 100)}% · about ${formatDuration(snap.etaSeconds)} left`}
                </span>
              </div>
            )}
            {slow && <p className="note warn" role="status">This will take a while on this computer. Draft quality or a smaller size is quicker.</p>}
            {snap.state === 'failed' && <p className="note warn" role="alert" data-testid="photo-failed">The render failed: {snap.message.replace(/[.\s]+$/, '')}. The 3D view still works.</p>}
            {problem && <p className="note warn" role="alert">{problem}</p>}

            <div className="photo-actions">
              {!running && <button type="button" className="btn primary" title="Start making the picture. Your garden is not changed." onClick={() => void start()} disabled={!!unsupported || sunDown}>{finished || snap.state === 'failed' ? 'Render again' : 'Render'}</button>}
              {(snap.state === 'rendering' || snap.state === 'paused') && <button type="button" className="btn" title="Pause or resume the render; the picture so far is kept" onClick={pauseResume}>{snap.state === 'paused' ? 'Resume' : 'Pause'}</button>}
              {running && <button type="button" className="btn" title="Stop here and keep the picture so far (Esc)" onClick={() => job.current?.stop('Stopped')}>Stop</button>}
              <button type="button" className="btn primary" title="Save the picture as a PNG file" onClick={() => void download()} disabled={!hasPicture}>Download PNG</button>
              <button type="button" className="btn" title="Close this panel and return to the 3D view" onClick={close}>Back to 3D</button>
            </div>
            <p className="note">Your garden is not changed, and edits made while it renders do not affect the picture. Esc stops a render, then closes this panel. Size {size.width} × {size.height}.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
