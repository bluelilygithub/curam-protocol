import { useMemo, useState } from 'react';
import { VERDICT_TEXT } from '../review/verdict';
import { checkSize, searchChecks, type SavedCheck } from '../review/savedChecks';

const fmtSize = (n: number) => (n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Saved checks: find, open again, rename or delete a past comparison. Kept in this browser only. */
export function SavedChecksView({ checks, currentId, persistent, onOpen, onRename, onDelete, onNew }: {
  checks: SavedCheck[];
  currentId?: string;
  persistent: boolean;
  onOpen: (c: SavedCheck) => void;
  onRename: (c: SavedCheck, label: string) => void;
  onDelete: (c: SavedCheck) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const [draft, setDraft] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string>();
  const shown = useMemo(() => searchChecks(checks, q), [checks, q]);
  const total = checks.reduce((s, c) => s + checkSize(c), 0);

  const saveRename = (c: SavedCheck) => { const v = draft.trim(); if (v && v !== c.label) onRename(c, v); setRenaming(undefined); };

  return (
    <section className="saved" aria-label="Saved checks">
      <div className="saved-bar">
        <input type="search" placeholder="Search saved checks…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search saved checks" data-guide="saved-search"
          title="Search by label or file name. Every word you type must match." />
        <span className="muted small">{checks.length} saved · {fmtSize(total)} in this browser</span>
        <button className="btn primary" onClick={onNew} title="Start a new comparison in Compare documents.">New check</button>
      </div>
      {!persistent && <p className="muted small">This browser is not keeping data for this page, so saved checks last until you leave it.</p>}
      <p className="muted small">Saved checks, their files and your decisions are kept in this browser only. Clearing this browser's site data removes them.</p>

      {checks.length === 0 ? (
        <div className="empty-view"><h2>No saved checks yet</h2><p className="muted">Every comparison you run is saved here with its label, so you can come back to it. Give it a label in Compare documents.</p><button className="btn primary" onClick={onNew}>Start a check</button></div>
      ) : shown.length === 0 ? (
        <div className="empty-view"><h2>No saved checks match "{q}"</h2><p className="muted">Search looks at labels and file names.</p><button className="btn" onClick={() => setQ('')}>Clear search</button></div>
      ) : (
        <ul className="saved-list" data-guide="saved-list">
          {shown.map((c) => (
            <li key={c.id} className={c.id === currentId ? 'current' : ''}>
              <div className="saved-main">
                {renaming === c.id ? (
                  <input className="rename" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New label"
                    onKeyDown={(e) => { if (e.key === 'Enter') saveRename(c); if (e.key === 'Escape') setRenaming(undefined); }} onBlur={() => saveRename(c)} />
                ) : (
                  <button className="saved-label link-plain" onClick={() => onOpen(c)} title="Open this check: the comparison runs again and your decisions come back.">{c.label}</button>
                )}
                <span className="muted small">{c.original.name} → {c.edited.name}</span>
                <span className="muted small">Saved {fmtDate(c.createdAt)}{c.updatedAt !== c.createdAt ? ` · last opened ${fmtDate(c.updatedAt)}` : ''} · {fmtSize(checkSize(c))}</span>
              </div>
              <div className="saved-status">
                {c.verdict && <span className={`badge verdict-badge-${c.verdict}`}>{VERDICT_TEXT[c.verdict].icon} {VERDICT_TEXT[c.verdict].title}</span>}
                {c.counts && c.counts.total > 0 && <span className="muted small">{c.counts.decided} of {c.counts.total} decided</span>}
                {c.id === currentId && <span className="badge">Open now</span>}
              </div>
              <div className="row saved-actions">
                <button className="btn" onClick={() => onOpen(c)} title="Open this check: the comparison runs again and your decisions come back.">Open</button>
                <button className="btn ghost" onClick={() => { setRenaming(c.id); setDraft(c.label); }} title="Change this check's label.">Rename</button>
                {confirmDelete === c.id ? (
                  <span className="inline confirm">Delete? <button className="btn danger" onClick={() => { onDelete(c); setConfirmDelete(undefined); }} title="Delete this check, its two saved files and its decisions from this browser. This cannot be undone.">Yes</button><button className="btn ghost" onClick={() => setConfirmDelete(undefined)}>No</button></span>
                ) : (
                  <button className="btn ghost" onClick={() => setConfirmDelete(c.id)} title="Delete this saved check, its files and its decisions from this browser.">Delete</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
