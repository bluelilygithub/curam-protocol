import { useState } from 'react';
import { useStore } from 'zustand';
import type { SavedView } from '../engine/types';
import { useApp, useProject } from '../ui/AppContext';

const NO_VIEWS: SavedView[] = [];

/** Camera controls for the 3D view: projection, presets and saved viewpoints (D43, D44). */
export function Viewbar3D() {
  const app = useApp();
  const projection = useStore(app.camera, (s) => s.camera?.projection ?? 'perspective');
  const views = useProject((s) => s.project?.savedViews ?? NO_VIEWS);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const finish = (id: string): void => {
    app.renameView(id, draft);
    setEditing(null);
  };

  return (
    <div className="viewbar3d" role="toolbar" aria-label="3D camera">
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
