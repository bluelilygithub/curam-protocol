import { useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { SavedView } from '../engine/types';
import { AMBIENT_OPTIONS, type AmbientKind } from '../audio/ambient';
import { PALETTES } from '../data/palettes';
import { useApp, useProject, useUi } from '../ui/AppContext';

const NO_VIEWS: SavedView[] = [];

/** Camera controls for the 3D view: projection, presets and saved viewpoints (D43, D44). */
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
  const palette = useProject((s) => s.project?.rooms[0]?.palette);
  const lightsOn = useUi((s) => s.lightsOn);
  const ambient = useUi((s) => s.ambient);
  const ambientVolume = useUi((s) => s.ambientVolume);
  const summary = useMemo(() => app.tourSummary(), [app, project]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const finish = (id: string): void => {
    app.renameView(id, draft);
    setEditing(null);
  };

  // Walking: only the way out and how to move are shown.
  if (walking && !immersive) {
    return (
      <div className="viewbar3d" role="toolbar" aria-label="Walk mode">
        <div className="group" role="group" aria-label="Walk">
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
    <div className="viewbar3d" role="toolbar" aria-label="3D camera">
      <div className="group" role="group" aria-label="Walk">
        <button className="btn" onClick={() => app.toggleWalk()} title="Walk through the room at eye height; you cannot walk through walls or furniture">
          <span className="label">Walk</span>
        </button>
      </div>
      <div className="group" role="group" aria-label="Cinematic" data-tour="rp-cinematic">
        <button className={`btn ${cinematic ? 'active' : ''}`} aria-pressed={cinematic} onClick={() => app.setCinematic(!cinematic)} title="Cinematic: clay look and a fly-through of your room">
          <span className="label">Cinematic</span>
        </button>
        {cinematic && (
          <>
            <button className={`btn ${look === 'clay' ? 'active' : ''}`} aria-pressed={look === 'clay'} onClick={() => app.setLook('clay')} title="Clay: a white architectural model">
              <span className="label">Clay</span>
            </button>
            <button className={`btn ${look === 'realistic' ? 'active' : ''}`} aria-pressed={look === 'realistic'} onClick={() => app.setLook('realistic')} title="Realistic: wood, fabric and daylight">
              <span className="label">Realistic</span>
            </button>
            <button className={`btn ${quality === 'low' ? 'active' : ''}`} aria-pressed={quality === 'low'} onClick={() => app.setQuality('low')} title="Low quality: fastest, for laptops">
              <span className="label">Low</span>
            </button>
            <button className={`btn ${quality === 'high' ? 'active' : ''}`} aria-pressed={quality === 'high'} onClick={() => app.setQuality('high')} title="High quality: softer shadows and ambient shading, needs a stronger graphics card">
              <span className="label">High</span>
            </button>
          </>
        )}
      </div>
      <div className="group" role="group" aria-label="Light and sound">
        <button className={`btn ${lightsOn ? 'active' : ''}`} aria-pressed={lightsOn} onClick={() => app.setLightsOn(!lightsOn)} title="Switch the ceiling lights and lamps on or off. They light the room in the Realistic look and in Render photo.">
          <span className="label">Lights</span>
        </button>
        <label className="palette-select" title="Soothing ambient sound while you look around in 3D: rain, ocean waves, a forest breeze or calm music. Made in your browser; nothing is downloaded.">
          <span className="label">Sound</span>
          <select aria-label="Ambient sound" value={ambient} onChange={(e) => app.setAmbient(e.target.value as AmbientKind)}>
            {AMBIENT_OPTIONS.map((o) => <option key={o.id} value={o.id} title={o.note}>{o.label}</option>)}
          </select>
        </label>
        {ambient !== 'off' && (
          <input
            type="range" className="volume" min={0} max={1} step={0.05} value={ambientVolume} aria-label="Sound volume" title="Sound volume"
            onChange={(e) => app.setAmbientVolume(Number(e.target.value))}
          />
        )}
      </div>
      <div className="group" role="group" aria-label="Colours">
        <label className="palette-select" title="Choose a colour palette for this room: walls, floor, trim, sofas and rugs together. Not shown in the Clay look.">
          <span className="label">Palette</span>
          <select aria-label="Colour palette" value={palette ?? ''} onChange={(e) => app.setPalette(e.target.value || null)}>
            <option value="">Standard</option>
            {PALETTES.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <div className="group" role="group" aria-label="Photo" data-tour="rp-photo">
        <button className="btn" onClick={() => app.ui.getState().setPhotoOpen(true)} title="Make a photographic picture of this room to download (takes a minute or more)">
          <span className="label">Render photo</span>
        </button>
      </div>
      {cinematic && (
        <div className="group" role="group" aria-label="Fly-through">
          <button className={`btn ${playing ? 'active' : ''}`} aria-pressed={playing} onClick={() => app.toggleTour()} title="Play or pause the fly-through (Space)">
            <span className="label">{playing ? 'Pause tour' : 'Play tour'}</span>
          </button>
          <button className={`btn ${loop ? 'active' : ''}`} aria-pressed={loop} onClick={() => app.ui.getState().setTourLoop(!loop)} title="Repeat the tour">
            <span className="label">Loop</span>
          </button>
          <button className="btn" onClick={() => app.enterImmersive()} title="Full screen, interface hidden">
            <span className="label">Full screen</span>
          </button>
          {summary && (
            <span className="tour-note" role="status" title="The tour visits your saved views; with fewer than two it adds an overview, the entrance and corner views">
              {progress && playing ? `Stop ${progress.stop + 1} of ${progress.total} · ` : ''}{summary.stops} stops · {summary.source}
            </span>
          )}
        </div>
      )}
      <div className="group" role="group" aria-label="Projection">
        <button className={`btn ${projection === 'perspective' ? 'active' : ''}`} aria-pressed={projection === 'perspective'} onClick={() => app.setProjection('perspective')} title="Perspective camera">
          <span className="label">Perspective</span>
        </button>
        <button className={`btn ${projection === 'orthographic' ? 'active' : ''}`} aria-pressed={projection === 'orthographic'} onClick={() => app.setProjection('orthographic')} title="Orthographic camera (no perspective distortion)">
          <span className="label">Orthographic</span>
        </button>
      </div>
      <div className="group" role="group" aria-label="Camera presets">
        <button className="btn" onClick={() => app.cameraPreset('iso')} title="Isometric view"><span className="label">Isometric</span></button>
        <button className="btn" onClick={() => app.cameraPreset('top')} title="Top-down view"><span className="label">Top</span></button>
        <button className="btn" onClick={() => app.cameraPreset('fit')} title="Frame the whole room"><span className="label">Fit room</span></button>
      </div>
      <div className="group views" role="group" aria-label="Saved views">
        <button className="btn" onClick={() => app.saveView()} title="Save the current camera as a named view"><span className="label">Save view</span></button>
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
      </div>
    </div>
  );
}
