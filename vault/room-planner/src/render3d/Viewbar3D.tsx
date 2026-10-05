import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { SavedView } from '../engine/types';
import { useApp, useProject, useUi } from '../ui/AppContext';

const NO_VIEWS: SavedView[] = [];

/**
 * The 3D controls, as ONE slim bar docked at the bottom of the view (not floating over the room). Always on the bar: camera (projection,
 * Isometric / Top / Fit), the look (Standard / Clay / Realistic), the fly-through, Render photo. Everything else lives in the View menu:
 * quality, walk, full screen and saved views. Lights, sound and the colour palette are collapsed boxes in the Inspector. Tour settings appear only while a tour is playing.
 */
export function Viewbar3D() {
  const app = useApp();
  const projection = useStore(app.camera, (s) => s.camera?.projection ?? 'perspective');
  const views = useProject((s) => s.project?.savedViews ?? NO_VIEWS);
  const cinematic = useUi((s) => s.cinematic);
  const quality = useUi((s) => s.quality);
  const look = useUi((s) => s.look);
  const playing = useUi((s) => s.tourPlaying);
  const loop = useUi((s) => s.tourLoop);
  const immersive = useUi((s) => s.immersive);
  const walking = useUi((s) => s.walking);
  const progress = useUi((s) => s.tourProgress);
  const project = useProject((s) => s.project);
  const summary = useMemo(() => app.tourSummary(), [app, project]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  // the View menu closes on a click elsewhere or Esc (Esc is swallowed so it does not also leave 3D)
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent): void => { if (menu.current && !menu.current.contains(e.target as Node)) setMenuOpen(false); };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && !editing) { e.stopPropagation(); e.preventDefault(); setMenuOpen(false); } };
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true); };
  }, [menuOpen, editing]);

  const finish = (id: string): void => {
    app.renameView(id, draft);
    setEditing(null);
  };

  /** Standard = the ordinary 3D view; Clay and Realistic are the two Cinematic looks. */
  const chooseLook = (which: 'standard' | 'clay' | 'realistic'): void => {
    if (which === 'standard') { app.setCinematic(false); return; }
    app.setLook(which);
    if (!cinematic) app.setCinematic(true);
  };
  const lookNow = !cinematic ? 'standard' : look;
  /** Play from anywhere: the fly-through is a Cinematic feature, so playing switches Cinematic on. */
  const togglePlay = (): void => {
    if (!cinematic && !playing) app.setCinematic(true);
    app.toggleTour();
  };

  // Walking: only the way out and how to move are shown.
  if (walking && !immersive) {
    return (
      <div className="dock3d" role="toolbar" aria-label="Walk mode">
        <div className="seg" role="group" aria-label="Walk">
          <button className="btn active" aria-pressed onClick={() => app.stopWalk()} title="Stop walking (Esc)"><span className="label">Stop walking</span></button>
          <span className="tour-note" role="status">WASD or arrows to move · drag to look · Shift to run · Esc to stop</span>
        </div>
      </div>
    );
  }

  // Presentation view: the interface is hidden; only play/pause, where we are, and the way out remain.
  if (immersive) {
    return (
      <div className="immersive-bar" role="toolbar" aria-label="Presentation controls">
        <button className="btn" title="Play or pause the fly-through (Space)" onClick={() => app.toggleTour()} aria-pressed={playing}><span className="label">{playing ? 'Pause tour' : 'Play tour'}</span></button>
        {progress && summary && <span className="tour-note" role="status">Stop {progress.stop + 1} of {progress.total}</span>}
        <button className="btn" onClick={() => app.exitImmersive()} title="Esc"><span className="label">Exit full screen</span></button>
      </div>
    );
  }

  return (
    <div className="dock3d" role="toolbar" aria-label="3D view">
      <div className="seg" role="group" aria-label="Camera">
        <button className={`btn ${projection === 'perspective' ? 'active' : ''}`} aria-pressed={projection === 'perspective'} aria-label="Perspective" onClick={() => app.setProjection('perspective')} title="Perspective camera">
          <span className="label" aria-hidden="true">Persp.</span>
        </button>
        <button className={`btn ${projection === 'orthographic' ? 'active' : ''}`} aria-pressed={projection === 'orthographic'} aria-label="Orthographic" onClick={() => app.setProjection('orthographic')} title="Orthographic camera (no perspective distortion)">
          <span className="label" aria-hidden="true">Ortho</span>
        </button>
        <span className="sep" aria-hidden="true" />
        <button className="btn" aria-label="Isometric" onClick={() => app.cameraPreset('iso')} title="Isometric view"><span className="label" aria-hidden="true">Iso</span></button>
        <button className="btn" onClick={() => app.cameraPreset('top')} title="Top-down view"><span className="label">Top</span></button>
        <button className="btn" aria-label="Fit room" onClick={() => app.cameraPreset('fit')} title="Frame the whole room"><span className="label" aria-hidden="true">Fit</span></button>
      </div>

      <div className="seg" role="group" aria-label="Look" data-tour="rp-cinematic">
        <button className={`btn ${lookNow === 'standard' ? 'active' : ''}`} aria-pressed={lookNow === 'standard'} onClick={() => chooseLook('standard')} title="Standard: the everyday 3D view, with colours by type and any problems tinted">
          <span className="label">Standard</span>
        </button>
        <button className={`btn ${lookNow === 'clay' ? 'active' : ''}`} aria-pressed={lookNow === 'clay'} onClick={() => chooseLook('clay')} title="Clay: a white architectural model with soft shadows">
          <span className="label">Clay</span>
        </button>
        <button className={`btn ${lookNow === 'realistic' ? 'active' : ''}`} aria-pressed={lookNow === 'realistic'} onClick={() => chooseLook('realistic')} title="Realistic: wood, fabric, lights and daylight">
          <span className="label">Realistic</span>
        </button>
      </div>

      <div className="seg" role="group" aria-label="Fly-through">
        <button className={`btn ${playing ? 'active' : ''}`} aria-pressed={playing} onClick={togglePlay} title="Fly through your room along your saved views (Space). Switches Cinematic on if it is off.">
          <span className="label">{playing ? 'Pause tour' : 'Play tour'}</span>
        </button>
        {playing && (
          <>
            <button className={`btn ${loop ? 'active' : ''}`} aria-pressed={loop} onClick={() => app.ui.getState().setTourLoop(!loop)} title="Repeat the tour">
              <span className="label">Loop</span>
            </button>
            <button className="btn" onClick={() => app.enterImmersive()} title="Full screen, interface hidden">
              <span className="label">Full screen</span>
            </button>
            {summary && (
              <span className="tour-note" role="status" title="The tour visits your saved views; with fewer than two it adds an overview, the entrance and corner views">
                {progress ? `Stop ${progress.stop + 1} of ${progress.total} · ` : ''}{summary.stops} stops · {summary.source}
              </span>
            )}
          </>
        )}
      </div>

      <div className="seg" role="group" aria-label="Photo" data-tour="rp-photo">
        <button className="btn primary" onClick={() => app.ui.getState().setPhotoOpen(true)} title="Make a photographic picture of this room to download (takes a minute or more)">
          <span className="label">Render photo</span>
        </button>
      </div>

      <div className="seg view-menu" role="group" aria-label="More view options" ref={menu}>
        <button className={`btn ${menuOpen ? 'active' : ''}`} aria-expanded={menuOpen} aria-haspopup="true" onClick={() => setMenuOpen((v) => !v)} title="More: quality, walk, full screen and saved views (lights, sound and the colour palette are in the Inspector)">
          <span className="label">View ▾</span>
        </button>
        {menuOpen && (
          <div className="dock-menu" role="group" aria-label="View options">
            <section>
              <h4>Quality</h4>
              <div className="row">
                <button className={`btn ${quality === 'low' ? 'active' : ''}`} aria-pressed={quality === 'low'} onClick={() => app.setQuality('low')} title="Low quality: fastest, for laptops (used in Clay and Realistic)">
                  <span className="label">Low</span>
                </button>
                <button className={`btn ${quality === 'high' ? 'active' : ''}`} aria-pressed={quality === 'high'} onClick={() => app.setQuality('high')} title="High quality: softer shadows and ambient shading, needs a stronger graphics card">
                  <span className="label">High</span>
                </button>
              </div>
            </section>
            <section>
              <h4>Move around</h4>
              <div className="row">
                <button className="btn" onClick={() => { setMenuOpen(false); app.toggleWalk(); }} title="Walk through the room at eye height; you cannot walk through walls or furniture">
                  <span className="label">Walk</span>
                </button>
                <button className="btn" onClick={() => { setMenuOpen(false); if (!cinematic) app.setCinematic(true); app.enterImmersive(); }} title="Full screen, interface hidden (Cinematic)">
                  <span className="label">Full screen</span>
                </button>
              </div>
            </section>
            <section className="views">
              <h4>Saved views</h4>
              <div className="row">
                <button className="btn" onClick={() => app.saveView()} title="Save the current camera as a named view. Saved views are the stops of the fly-through and choices in Render photo.">
                  <span className="label">Save view</span>
                </button>
              </div>
              {views.map((v) => (
                <span key={v.id} className="view-chip" data-testid={`view-${v.id}`}>
                  {editing === v.id ? (
                    <input
                      autoFocus value={draft} maxLength={60} aria-label="View name"
                      onChange={(e) => setDraft(e.target.value)} onBlur={() => finish(v.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') finish(v.id); if (e.key === 'Escape') setEditing(null); e.stopPropagation(); }}
                    />
                  ) : (
                    <>
                      <button className="btn" onClick={() => app.restoreView(v.id)} title={`Go to ${v.name}`} aria-label={`Go to ${v.name}`}><span className="label">{v.name}</span></button>
                      <button className="btn icon" onClick={() => { setDraft(v.name); setEditing(v.id); }} title="Rename" aria-label={`Rename ${v.name}`}>✎</button>
                      <button className="btn icon" onClick={() => app.deleteView(v.id)} title="Delete this view" aria-label={`Delete ${v.name}`}>×</button>
                    </>
                  )}
                </span>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
