import { useEffect, useRef, useState } from 'react';
import { saveBlob } from '@planner-core/export/csv';
import { formatDuration, photoFileName, PhotoJob, QUALITY_SAMPLES, SIZE_PRESETS, type JobSnapshot, type PhotoQuality } from '@planner-core/render3d/photo';
import { buildPhotoGeometry, type PhotoGeometryInput, type PhotoView } from './photoGeometry';
import type { CellarPathTracer } from './photoTracer';

/**
 * Render photo (public planner): a realistic picture of the visitor's design, drawn by their own computer. Desktop and tablet only (a phone is told so),
 * and honest about the wait: how long it takes is said before it starts, an estimate appears as soon as it has a speed to go on, and it can be paused or
 * stopped (a stopped picture can still be saved). A fair-use limit of a few pictures per visit keeps the page responsive. Nothing leaves the browser.
 */

/** How many pictures one visit may make. Soft: it only stops someone leaving a laptop rendering all day. */
export const RENDERS_PER_VISIT = 3;
export const RENDER_COUNT_KEY = 'cellar-lite:renders:v1';
export const PHOTO_SIZES = SIZE_PRESETS.filter((s) => s.id !== 'uhd');
/** The two qualities offered: the third (Best) takes far too long for a visitor to wait for. */
export const PHOTO_QUALITIES: Array<{ id: PhotoQuality; label: string; time: string }> = [
  { id: 'draft', label: 'Quick look', time: 'about 1 to 3 minutes' },
  { id: 'good', label: 'Good', time: 'about 5 to 15 minutes' },
];

export const rendersUsed = (storage: Pick<Storage, 'getItem'> = sessionStorage): number => {
  try { const n = Number(storage.getItem(RENDER_COUNT_KEY)); return Number.isInteger(n) && n > 0 ? Math.min(n, 99) : 0; } catch { return 0; }
};
const countRender = (): void => { try { sessionStorage.setItem(RENDER_COUNT_KEY, String(rendersUsed() + 1)); } catch { /* the limit just is not remembered */ } };

const IDLE: JobSnapshot = { state: 'idle', samples: 0, target: 1, progress: 0, samplesPerSecond: 0, etaSeconds: null, message: '', phase: '' };
const VIEWS: Array<{ id: PhotoView; label: string; tip: string }> = [
  { id: 'door', label: 'From the doorway', tip: 'As if you are standing just inside the door, looking in.' },
  { id: 'overview', label: 'From above', tip: 'Looking down into the cellar with the door wall cut away, like the 3D picture on the page.' },
];

export function PhotoModal({ open, onClose, input, name, onStart }: { open: boolean; onClose(): void; input: PhotoGeometryInput; name: string; onStart?: () => void }) {
  const [view, setView] = useState<PhotoView>('door');
  const [sizeId, setSizeId] = useState('hd');
  const [quality, setQuality] = useState<PhotoQuality>('draft');
  const [snap, setSnap] = useState<JobSnapshot>(IDLE);
  const [problem, setProblem] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [used, setUsed] = useState(rendersUsed());
  const job = useRef<PhotoJob | null>(null);
  const tracer = useRef<CellarPathTracer | null>(null);
  const holder = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const startBtn = useRef<HTMLButtonElement>(null);
  const before = useRef<Element | null>(null);

  const size = PHOTO_SIZES.find((s) => s.id === sizeId) ?? PHOTO_SIZES[1]!;
  const running = snap.state === 'building' || snap.state === 'rendering' || snap.state === 'paused';
  const finished = snap.state === 'done' || snap.state === 'stopped';
  const hasPicture = snap.samples > 0 && snap.state !== 'failed';
  const left = RENDERS_PER_VISIT - used;

  useEffect(() => {
    if (!open) return;
    let live = true;
    setUsed(rendersUsed());
    void import('./photoTracer').then((m) => { if (live) setUnsupported(m.checkPhotoSupport(size.width, size.height)); });
    return () => { live = false; };
  }, [open, size.width, size.height]);

  const teardown = (): void => {
    cancelAnimationFrame(raf.current);
    job.current?.dispose();
    job.current = null;
    tracer.current = null;
    holder.current?.replaceChildren();
  };
  useEffect(() => { if (!open) { teardown(); setSnap(IDLE); setProblem(null); } }, [open]);
  useEffect(() => teardown, []);
  const close = (): void => { teardown(); onClose(); };

  // focus goes into the dialog and comes back; Esc stops a render in progress first, then closes
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    window.setTimeout(() => startBtn.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); e.preventDefault();
      const j = job.current;
      if (j && !j.finished) j.stop('Stopped'); else close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); if (before.current instanceof HTMLElement) before.current.focus(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const loop = (j: PhotoJob) => (now: number): void => {
    if (job.current !== j) return;
    j.tick(now);
    if (!j.finished) raf.current = requestAnimationFrame(loop(j));
  };

  const start = async (): Promise<void> => {
    if (unsupported || left <= 0 || running) return;
    teardown();
    setProblem(null);
    try {
      const { CellarPathTracer: Tracer } = await import('./photoTracer');
      // the design is copied when the picture starts, so changing it while it renders cannot change the picture
      const geometry = buildPhotoGeometry(input);
      if (geometry.racks.length === 0) { setProblem('There are no racks to show yet. Add some bottles in step 2, then try again.'); return; }
      const t = new Tracer({ geometry, view, width: size.width, height: size.height });
      tracer.current = t;
      holder.current?.replaceChildren(t.previewCanvas);
      // a test may ask for FEWER passes (software graphics are far too slow to finish a real picture); it can never ask for more
      const asked = Number((window as unknown as { __cellarPhotoSamples?: number }).__cellarPhotoSamples);
      const j = new PhotoJob(t, Number.isInteger(asked) && asked >= 1 ? Math.min(asked, QUALITY_SAMPLES[quality]) : QUALITY_SAMPLES[quality]);
      job.current = j;
      j.subscribe(setSnap);
      countRender(); setUsed(rendersUsed());
      onStart?.();
      void j.start().then(() => { if (job.current === j && !j.finished) raf.current = requestAnimationFrame(loop(j)); });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'The picture could not be started.');
    }
  };

  const pauseResume = (): void => {
    const j = job.current;
    if (!j) return;
    if (j.state === 'paused') { j.resume(); raf.current = requestAnimationFrame(loop(j)); } else j.pause();
  };

  const download = async (): Promise<void> => {
    const t = tracer.current;
    if (!t) return;
    try {
      const date = new Date();
      const blob = await t.toBlob({ title: name || 'Wine cellar design', note: 'Preliminary design only', date });
      saveBlob(blob, photoFileName(name || 'wine-cellar', '', date));
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not make the picture file.');
    }
  };

  if (!open) return null;
  const slow = snap.state === 'rendering' && snap.etaSeconds !== null && snap.etaSeconds > 180;
  const q = PHOTO_QUALITIES.find((x) => x.id === quality)!;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Render photo" data-testid="lite-photo" onClick={(e) => { if (e.target === e.currentTarget && !running) close(); }}>
      <div className="modal wide help">
        <div className="modal-head"><h2>Render photo</h2><button type="button" className="icon-btn" aria-label="Close" title={running ? 'Stop the picture and close this window.' : 'Close this window.'} onClick={() => { const j = job.current; if (j && !j.finished) j.stop('Stopped'); close(); }} data-testid="lite-photo-close">✕</button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Render photo">
          <p>A realistic picture of your cellar, with lifelike light and shadow, drawn by your own computer. Nothing is sent anywhere. It is an illustration of your design, not a photograph of a finished cellar.</p>
          <p className="lite-photo-wait" data-testid="lite-photo-wait"><strong>This takes time.</strong> The picture starts grainy and sharpens. A quick look takes {PHOTO_QUALITIES[0]!.time} on a laptop and longer on a tablet; Good takes {PHOTO_QUALITIES[1]!.time}. Keep this page open and on screen while it works: it slows down or pauses if you switch to another tab. An estimate appears as soon as it has measured your computer&rsquo;s speed.</p>

          {!running && !finished && (
            <div className="lite-photo-options">
              <fieldset className="lite-photo-set">
                <legend>View</legend>
                {VIEWS.map((v) => <label key={v.id} title={v.tip}><input type="radio" name="photo-view" checked={view === v.id} onChange={() => setView(v.id)} /> {v.label}</label>)}
              </fieldset>
              <label className="lite-photo-field">Size
                <select value={sizeId} onChange={(e) => setSizeId(e.target.value)} title="Bigger pictures look better but take much longer." data-testid="lite-photo-size">
                  {PHOTO_SIZES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              <label className="lite-photo-field">Quality
                <select value={quality} onChange={(e) => setQuality(e.target.value as PhotoQuality)} title="Quick look is grainy but shows the idea. Good is smoother and takes several times longer." data-testid="lite-photo-quality">
                  {PHOTO_QUALITIES.map((x) => <option key={x.id} value={x.id}>{x.label} ({x.time})</option>)}
                </select>
              </label>
            </div>
          )}

          {unsupported && <p className="lite-note" role="alert" data-testid="lite-photo-unsupported">{unsupported}</p>}
          {problem && <p className="lite-note" role="alert" data-testid="lite-photo-problem">{problem}</p>}
          {!unsupported && left <= 0 && !running && <p className="lite-note" role="status" data-testid="lite-photo-limit">You have used your {RENDERS_PER_VISIT} pictures for this visit. This keeps the page quick for everyone. You can save the ones you have made.</p>}

          {(running || hasPicture) && (
            <div className="lite-photo-progress" aria-live="polite">
              <div className="lite-photo-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(snap.progress * 100)} aria-label="Picture progress"><span style={{ width: `${Math.round(snap.progress * 100)}%` }} /></div>
              <p data-testid="lite-photo-status">
                {snap.state === 'building' ? (snap.phase || 'Getting ready…')
                  : snap.state === 'done' ? 'Done.'
                  : snap.state === 'stopped' ? 'Stopped. The picture so far can still be saved.'
                  : snap.state === 'failed' ? `The picture could not be finished: ${snap.message}`
                  : snap.state === 'paused' ? 'Paused.'
                  : snap.samples === 0 ? (snap.phase || 'Working…') : `${Math.round(snap.progress * 100)}% sharpened, about ${formatDuration(snap.etaSeconds)} left`}
              </p>
              {slow && <p className="lite-note" role="status">This is slower than usual on your device. You can stop at any point and keep the picture so far, or choose Quick look next time.</p>}
            </div>
          )}
          <div ref={holder} className="lite-photo-canvas" data-testid="lite-photo-canvas" aria-label="The picture" />
        </div>
        <div className="modal-foot">
          <span className="grow lite-photo-left" data-testid="lite-photo-left">{left > 0 ? `${left} of ${RENDERS_PER_VISIT} pictures left this visit` : 'No pictures left this visit'}</span>
          {running && <button type="button" className="btn" onClick={pauseResume} disabled={snap.state === 'building'} title="Pause the picture to free up your computer, then carry on." data-testid="lite-photo-pause">{snap.state === 'paused' ? 'Carry on' : 'Pause'}</button>}
          {running && <button type="button" className="btn" onClick={() => job.current?.stop('Stopped')} title="Stop now. You keep the picture as it is so far." data-testid="lite-photo-stop">Stop</button>}
          {hasPicture && !running && <button type="button" className="btn" onClick={() => void download()} title="Save the picture to your computer as a PNG file, with a small caption underneath." data-testid="lite-photo-save">Save picture</button>}
          {!running && <button ref={startBtn} type="button" className="btn primary" disabled={!!unsupported || left <= 0} onClick={() => void start()} title={`Start the picture. ${q.label} takes ${q.time}.`} data-testid="lite-photo-start">{finished ? 'Make another' : 'Start the picture'}</button>}
        </div>
      </div>
    </div>
  );
}
