import { useState } from 'react';
import type { Project } from '../project/model';
import { VERDICT_TEXT } from '../review/verdict';

export const fmtSize = (n: number) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

export interface Quota { usage: number; quota: number }
export interface ImportConflict { incoming: Project; existing: Project }

/** Projects (addendum §7.9): every document being checked over several rounds, kept in this browser. */
export function ProjectsView({ projects, currentId, persistent, quota, warnMb, conflict, onOpen, onRename, onExport, onDelete, onImport, onResolveImport, onQuick }: {
  projects: Project[];
  currentId?: string;
  persistent: boolean;
  quota?: Quota;
  warnMb: number;
  conflict?: ImportConflict;
  onOpen: (p: Project) => void;
  onRename: (p: Project, name: string) => void;
  onExport: (p: Project) => void;
  onDelete: (p: Project) => void;
  onImport: (f: File) => void;
  onResolveImport: (choice: 'both' | 'replace' | 'cancel') => void;
  onQuick: () => void;
}) {
  const [renaming, setRenaming] = useState<string>();
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const sorted = [...projects].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const total = projects.reduce((s, p) => s + (p.sizeBytes ?? 0), 0);
  const nearlyFull = quota && quota.quota > 0 && quota.usage / quota.quota >= 0.8;
  const saveRename = (p: Project) => { const v = draft.trim(); if (v && v !== p.name) onRename(p, v); setRenaming(undefined); };

  return (
    <section className="saved" aria-label="Projects">
      <div className="saved-bar">
        <span className="muted small" data-guide="storage">{projects.length} project{projects.length === 1 ? '' : 's'} · {fmtSize(total)} in this browser{quota && quota.quota > 0 ? ` · browser storage ${Math.round((quota.usage / quota.quota) * 100)}% used` : ''}</span>
        <label className="btn" title="Open a project exported from DocCompare (.doccompare). It is read on this computer; nothing is uploaded.">Import project<input type="file" accept=".doccompare,application/zip" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} /></label>
        <button className="btn primary" onClick={onQuick} title="Start a new project, or compare two files once without one, in Compare documents.">New check</button>
      </div>
      {nearlyFull && <div className="gate gate-warn" role="alert">This browser's storage is {Math.round((quota!.usage / quota!.quota) * 100)}% full. Export projects you want to keep, then compact old rounds or delete projects you no longer need.</div>}
      {!persistent && <p className="muted small">This browser is not keeping data for this page, so projects last until you leave it. Export a project to keep it.</p>}
      <p className="muted small">Projects, their files and your decisions are kept in this browser only. Your browser can clear saved files: export a project to keep a copy.</p>
      {conflict && (
        <div className="gate gate-warn" role="alertdialog" aria-labelledby="imp-title">
          <h2 id="imp-title">You already have this project</h2>
          <p>"{conflict.existing.name}" ({conflict.existing.rounds.length} rounds, updated {fmtDate(conflict.existing.updatedAt)}) is the same project as the one you are importing ({conflict.incoming.rounds.length} rounds).</p>
          <div className="row">
            <button className="btn primary" onClick={() => onResolveImport('both')} title="Import it as a separate copy, named (imported).">Keep both</button>
            <button className="btn danger" onClick={() => onResolveImport('replace')} title="Replace the project in this browser with the imported one. The one here is lost unless you exported it.">Replace</button>
            <button className="btn ghost" onClick={() => onResolveImport('cancel')}>Cancel</button>
          </div>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="empty-view">
          <h2>No projects yet</h2>
          <p className="muted">A project keeps a clean copy of your original and checks every later draft against it, round after round. Start one in Compare documents: leave "Save as a project" ticked.</p>
          <button className="btn primary" onClick={onQuick}>Start a project</button>
        </div>
      ) : (
        <ul className="saved-list" data-guide="projects-list">
          {sorted.map((p) => {
            const last = p.rounds[p.rounds.length - 1];
            const big = (p.sizeBytes ?? 0) > warnMb * 1048576;
            return (
              <li key={p.id} className={p.id === currentId ? 'current' : ''}>
                <div className="saved-main">
                  {renaming === p.id ? (
                    <input className="rename" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New project name"
                      onKeyDown={(e) => { if (e.key === 'Enter') saveRename(p); if (e.key === 'Escape') setRenaming(undefined); }} onBlur={() => saveRename(p)} />
                  ) : (
                    <button className="saved-label link-plain" onClick={() => onOpen(p)} title="Open this project: its latest round and your decisions.">{p.name}</button>
                  )}
                  <span className="muted small">Original: {p.original.name} · {p.rounds.length} round{p.rounds.length === 1 ? '' : 's'}{p.originalHistory.length ? ` · original replaced ${p.originalHistory.length}×` : ''}</span>
                  <span className="muted small">Updated {fmtDate(p.updatedAt)} · {fmtSize(p.sizeBytes ?? 0)}{big ? ` (over ${warnMb} MB: compact old rounds in Timeline)` : ''}{p.exportedAt ? ` · exported ${fmtDate(p.exportedAt)}` : ' · never exported'}</span>
                </div>
                <div className="saved-status">
                  {last && <span className={`badge verdict-badge-${last.verdict}`}>{VERDICT_TEXT[last.verdict].icon} {VERDICT_TEXT[last.verdict].title}</span>}
                  {p.id === currentId && <span className="badge">Open now</span>}
                </div>
                <div className="row saved-actions">
                  <button className="btn" onClick={() => onOpen(p)} title="Open this project: its latest round and your decisions.">Open</button>
                  <button className="btn ghost" onClick={() => { setRenaming(p.id); setDraft(p.name); }} title="Change this project's name.">Rename</button>
                  <button className="btn ghost" onClick={() => onExport(p)} title="Save the whole project (files, rounds and decisions) as one .doccompare file on this computer.">Export</button>
                  {confirmDelete === p.id ? (
                    <span className="inline confirm">Delete "{p.name}" and all {p.rounds.length} rounds? <button className="btn danger" onClick={() => { onDelete(p); setConfirmDelete(undefined); }} title="Delete this project, its files and decisions from this browser. This cannot be undone.">Yes</button><button className="btn ghost" onClick={() => setConfirmDelete(undefined)}>No</button></span>
                  ) : (
                    <button className="btn ghost" onClick={() => setConfirmDelete(p.id)} title="Delete this project, its files and its decisions from this browser.">Delete</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
