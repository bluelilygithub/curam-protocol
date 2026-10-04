import { useEffect, useRef, useState } from 'react';
import type { LibraryEntry } from '../state/library';
import { useApp, useLibrary, useUi } from './AppContext';

/**
 * The Projects panel: every saved project with create / open / rename / duplicate / delete, plus import and export of a file.
 * Deletions are confirmed inline ("Delete? Yes / No"), never with a browser dialog.
 */
export function ProjectsPanel() {
  const app = useApp();
  const open = useUi((s) => s.projectsOpen);
  const entries = useLibrary((s) => s.entries);
  const currentId = useLibrary((s) => s.currentId);
  const note = useLibrary((s) => s.note);
  const ready = useLibrary((s) => s.ready);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const close = (): void => { app.ui.getState().setProjectsOpen(false); setRenaming(null); setDeleting(null); };

  useEffect(() => { if (open) void app.projects.refresh(); }, [open, app]);
  // Esc closes the panel wherever the focus is (a deleted button leaves it on the page), before the editor sees the key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); app.ui.getState().setProjectsOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, app]);
  if (!open) return null;

  const run = async (fn: () => Promise<unknown>): Promise<void> => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const create = (): void => { void run(async () => { await app.newProject(name); setName(''); close(); }); };
  const finishRename = (e: LibraryEntry): void => { const n = draft; setRenaming(null); if (n.trim() && n.trim() !== e.name) void run(() => app.renameProject(e.id, n)); };
  const download = (): void => {
    const out = app.exportJson();
    if (!out) return;
    const url = URL.createObjectURL(new Blob([out.text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = out.name; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
      <div className="modal projects-panel" role="dialog" aria-modal="true" aria-label="Projects">
        <div className="modal-head">
          <h2>Projects</h2>
          <button className="btn icon" onClick={close} aria-label="Close projects" title="Close">×</button>
        </div>
        <p className="storage-note" role="status">{note || 'Loading your projects…'}</p>

        <form className="new-project" onSubmit={(e) => { e.preventDefault(); create(); }}>
          <input
            aria-label="New project name" placeholder="New project name" value={name} maxLength={120} autoFocus
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" type="submit" title="Start an empty project with the name you typed" disabled={busy || !ready}>New project</button>
        </form>

        <ul className="project-list" aria-label="Your projects">
          {entries.length === 0 && <li className="empty-line">{ready ? 'No projects yet.' : 'Loading…'}</li>}
          {entries.map((e) => (
            <li key={e.id} className={`project-row ${e.id === currentId ? 'current' : ''}`} data-testid={`project-${e.id}`}>
              <div className="project-main">
                {renaming === e.id ? (
                  <input
                    aria-label={`New name for ${e.name}`} value={draft} maxLength={120} autoFocus onChange={(ev) => setDraft(ev.target.value)}
                    onBlur={() => finishRename(e)}
                    onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') finishRename(e); if (ev.key === 'Escape') setRenaming(null); }}
                  />
                ) : (
                  <button className="project-name" onClick={() => { if (e.id !== currentId) void run(async () => { await app.openProject(e.id); close(); }); else close(); }} title={e.id === currentId ? 'Open now' : `Open ${e.name}`} aria-label={`Open ${e.name}`}>
                    <span className="label">{e.name}</span>
                  </button>
                )}
                <small>{e.id === currentId ? 'Open now · ' : ''}{e.roomCount} {e.roomCount === 1 ? 'room' : 'rooms'} · {new Date(e.updatedAt).toLocaleString()}</small>
              </div>
              {deleting === e.id ? (
                <span className="inline-confirm" role="group" aria-label={`Delete ${e.name}?`}>
                  Delete?
                  <button className="btn danger" onClick={() => { setDeleting(null); void run(() => app.deleteProject(e.id)); }}>Yes</button>
                  <button className="btn" onClick={() => setDeleting(null)}>No</button>
                </span>
              ) : (
                <span className="project-actions">
                  <button className="btn" onClick={() => { setRenaming(e.id); setDraft(e.name); }} aria-label={`Rename ${e.name}`} title="Change this project’s name">Rename</button>
                  <button className="btn" disabled={busy} onClick={() => void run(() => app.duplicateProject(e.id))} aria-label={`Duplicate ${e.name}`} title="Make a copy of this project with all its rooms">Duplicate</button>
                  <button className="btn danger" onClick={() => setDeleting(e.id)} aria-label={`Delete ${e.name}`} title="Delete this project for good. You are asked to confirm.">Delete</button>
                </span>
              )}
            </li>
          ))}
        </ul>

        <div className="modal-foot">
          <button className="btn" onClick={() => file.current?.click()} title="Add a project from a .json file">Import file…</button>
          <button className="btn" onClick={download} disabled={!app.project.getState().document} title="Download the open project, every room, as a .json file">Export open project</button>
          <input
            ref={file} type="file" accept="application/json,.json" hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) { const text = await f.text(); await run(async () => { if (await app.importFile(text)) close(); }); }
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
}
