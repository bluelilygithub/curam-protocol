import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';

const when = (t: string): string => new Date(t).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

export function ProjectsPanel() {
  const app = useApp();
  const open = useUi((s) => s.projectsOpen);
  const current = useProject((s) => s.project?.id);
  const entries = useStore(app.library, (s) => s.entries);
  const note = useStore(app.library, (s) => s.note);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  if (!open) return null;

  const exportCurrent = async (): Promise<void> => {
    const f = await app.exportJson();
    if (!f) return;
    const url = URL.createObjectURL(new Blob([f.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Your gardens" onClick={(e) => { if (e.target === e.currentTarget) app.ui.getState().set({ projectsOpen: false }); }}>
      <div className="modal">
        <div className="modal-head">
          <h2>Your gardens</h2>
          <button type="button" className="icon-btn" title="Close" onClick={() => app.ui.getState().set({ projectsOpen: false })}><Icon name="close" size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="row">
            <button type="button" className="btn primary" onClick={() => app.ui.getState().set({ wizardOpen: true, projectsOpen: false })}><Icon name="plus" size={15} /> New garden</button>
            <button type="button" className="btn" onClick={() => file.current?.click()}><Icon name="upload" size={15} /> Import file</button>
            <button type="button" className="btn" disabled={!current} onClick={() => void exportCurrent()}><Icon name="download" size={15} /> Export this garden</button>
            <input ref={file} type="file" accept=".json,application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) app.importFile(await f.text()); e.target.value = ''; }} />
          </div>
          <ul className="plist">
            {entries.map((e) => (
              <li key={e.id} className={e.id === current ? 'cur' : ''}>
                <button type="button" className="plist-main" onClick={() => app.openProject(e.id)}>
                  <strong>{e.name}</strong>
                  <span>{e.location} · {e.plantCount} plant{e.plantCount === 1 ? '' : 's'} · saved {when(e.updatedAt)}</span>
                </button>
                <button type="button" className="icon-btn" title="Duplicate" onClick={() => app.duplicateProject(e.id)}><Icon name="copy" size={15} /></button>
                {confirmId === e.id
                  ? <span className="confirm">Delete? <button type="button" className="link" onClick={() => { app.deleteProject(e.id); setConfirmId(null); }}>Yes</button> / <button type="button" className="link" onClick={() => setConfirmId(null)}>No</button></span>
                  : <button type="button" className="icon-btn" title="Delete" onClick={() => setConfirmId(e.id)}><Icon name="trash" size={15} /></button>}
              </li>
            ))}
            {entries.length === 0 && <li className="empty">No saved gardens yet.</li>}
          </ul>
          <p className="note">{note || 'Gardens save automatically.'} Export a file to keep a copy or move it to another device.</p>
        </div>
      </div>
    </div>
  );
}
