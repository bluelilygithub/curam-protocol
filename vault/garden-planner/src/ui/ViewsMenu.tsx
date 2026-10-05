import { useState } from 'react';
import { useApp, useProject } from './AppContext';
import { Icon } from './icons';
import { TextField } from './fields';

/** Saved views: remember where the 3D camera is (or where you are standing when walking), go back to it, rename it, delete it. Two or more become the stops of the fly-through. */
export function ViewsMenu() {
  const app = useApp();
  const views = useProject((s) => s.project?.savedViews) ?? EMPTY;
  const [open, setOpen] = useState(false);
  return (
    <div className="views-wrap">
      <button type="button" aria-expanded={open} title="Saved views: remember where the camera is, and come back to it" data-testid="views-toggle" onClick={() => setOpen((v) => !v)}>Views{views.length ? ` (${views.length})` : ''}</button>
      {open && (
        <div className="views-pop" role="dialog" aria-label="Saved views" data-testid="views-pop">
          <button type="button" className="btn primary" data-testid="views-save" onClick={() => { app.saveView(); }}><Icon name="plus" size={15} /> Save this view</button>
          {views.length === 0 && <p className="note">Move the camera where you want it, then press Save this view. Two or more saved views become the stops of the fly-through.</p>}
          <ul data-testid="views-list">
            {views.map((v) => (
              <li key={v.id} data-testid="views-item">
                <button type="button" className="btn" title="Go to this view" onClick={() => { app.goToView(v.id); setOpen(false); }}>Go</button>
                <TextField label="View name" value={v.name} onCommit={(name) => app.renameView(v.id, name)} />
                <button type="button" className="icon-btn" title="Delete this view" aria-label={`Delete ${v.name}`} onClick={() => app.deleteView(v.id)}><Icon name="trash" size={15} /></button>
              </li>
            ))}
          </ul>
          {views.length === 1 && <p className="note">One saved view: the fly-through starts there and then visits places chosen from the garden. Save a second view to fly between your own.</p>}
        </div>
      )}
    </div>
  );
}

const EMPTY: never[] = [];
