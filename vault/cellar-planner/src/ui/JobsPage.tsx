import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { UiStore } from '../app/uiStore';
import type { Designs } from '../app/designs';
import type { DesignEntry } from '../app/designLibrary';

const when = (t: string): string => new Date(t).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
type Sort = 'recent' | 'name';

/** Filter by a typed phrase (every word must appear in the name) and sort. Pure, so it is tested without a screen. */
export function visibleJobs(entries: DesignEntry[], query: string, sort: Sort): DesignEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = entries.filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
  return [...hit].sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'en-AU', { sensitivity: 'base' }) : (a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * The Jobs page: every saved job, with search and sort, and an Open button that fills the planner with it. It is a page of its own (the planner
 * keeps running behind it, nothing is lost), not a pop-up. Jobs save by themselves; Download file / Upload file still move one in and out as a file.
 * (Internally a job is a "design": the same saved record, the same Vault table.)
 */
export function JobsPage({ ui, designs, onImportFile }: { ui: UiStore; designs: Designs; onImportFile: (f: File) => void }) {
  const open = useStore(ui, (s) => s.designsOpen);
  const entries = useStore(designs.library, (s) => s.entries);
  const current = useStore(designs.library, (s) => s.currentId);
  const status = useStore(designs.library, (s) => s.status);
  const note = useStore(designs.library, (s) => s.note);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useMemo(() => visibleJobs(entries, query, sort), [entries, query, sort]);
  const currentEntry = entries.find((e) => e.id === current);
  const close = (): void => ui.getState().set({ designsOpen: false });

  useEffect(() => {
    if (!open) return undefined;
    setConfirmId(null);
    window.setTimeout(() => heading.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape' && currentEntry && !(e.target instanceof HTMLInputElement && e.target.value)) ui.getState().set({ designsOpen: false }); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, ui, currentEntry]);
  if (!open) return null;

  const openJob = async (e: DesignEntry): Promise<void> => {
    setBusy(e.id);
    try {
      await designs.controller.open(e.id);
      ui.getState().set({ designsOpen: false, notice: `Opened "${e.name}".` });
    } finally { setBusy(null); }
  };

  return (
    <section className="jobs-page" aria-labelledby="jobs-title" data-testid="jobs-page">
      <div className="jobs-inner">
        <div className="jobs-head">
          <h2 id="jobs-title" ref={heading} tabIndex={-1}>Jobs</h2>
          <span className="jobs-count" data-testid="jobs-count">{entries.length} saved{query.trim() ? `, ${shown.length} match${shown.length === 1 ? 'es' : ''}` : ''}</span>
          <span className="grow" />
          {currentEntry && <button type="button" className="btn" title="Go back to the job you had open. Nothing changes." onClick={close} data-testid="jobs-continue">Back to “{currentEntry.name}”</button>}
        </div>
        <div className="jobs-tools">
          <input type="search" className="jobs-search" placeholder="Search jobs by name" aria-label="Search jobs by name" title="Type part of a job's name to narrow the list." value={query} onChange={(e) => setQuery(e.target.value)} data-testid="jobs-search" />
          <label className="jobs-sort">Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} title="Most recently saved first, or alphabetical." data-testid="jobs-sort">
              <option value="recent">Recently saved</option>
              <option value="name">Name A to Z</option>
            </select>
          </label>
          <span className="grow" />
          <button type="button" className="btn primary" title="Start a new job from the blank sample enclosure (racks left blank). The job you have open stays saved." onClick={() => { void designs.controller.newProject('New job').then(close); }} data-testid="design-new">New job</button>
          <button type="button" className="btn" title="Add a .cellar.json file as a new saved job and open it. The job you have open stays as it is." onClick={() => file.current?.click()} data-testid="design-import">Upload file</button>
          <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Upload a job file" title="Upload a job file" onChange={(e) => { const f = e.target.files?.[0]; if (f) { onImportFile(f); close(); } e.target.value = ''; }} />
        </div>
        {status === 'loading' && entries.length === 0 && <p className="jobs-empty" role="status">Loading your jobs…</p>}
        <ul className="jobs-list" data-testid="design-list" aria-label="Saved jobs">
          {shown.map((e) => (
            <li key={e.id} className={`job${e.id === current ? ' cur' : ''}`} data-testid="design-item">
              <button type="button" className="plist-main" title="Open this job in the planner: all its settings fill in." aria-current={e.id === current ? 'true' : undefined} onClick={() => void openJob(e)}>
                <strong>{e.name}{e.id === current && <span className="job-tag">open now</span>}</strong>
                <span>{e.runCount} rack run{e.runCount === 1 ? '' : 's'}, {e.rackUnits} unit{e.rackUnits === 1 ? '' : 's'}{e.estimated ? ', best-guess values' : ''} · saved {when(e.updatedAt)}</span>
              </button>
              <button type="button" className="btn primary" disabled={busy !== null} title="Open this job in the planner: all its settings fill in." onClick={() => void openJob(e)} data-testid="job-open">{e.id === current ? 'Continue' : 'Open'}</button>
              <button type="button" className="btn" title="Make a copy of this job." onClick={() => void designs.controller.duplicate(e.id)} data-testid="design-copy">Copy</button>
              {confirmId === e.id
                ? <span className="confirm">Delete? <button type="button" className="link" title="Yes, delete this job." onClick={() => { void designs.controller.remove(e.id); setConfirmId(null); }} data-testid="design-delete-yes">Yes</button> / <button type="button" className="link" title="No, keep it." onClick={() => setConfirmId(null)}>No</button></span>
                : <button type="button" className="btn" title="Delete this job. It cannot be undone." onClick={() => setConfirmId(e.id)} data-testid="design-delete">Delete</button>}
            </li>
          ))}
          {entries.length > 0 && shown.length === 0 && <li className="jobs-empty">No job matches “{query.trim()}”.</li>}
          {entries.length === 0 && status !== 'loading' && <li className="jobs-empty">No saved jobs yet. Press New job to start one.</li>}
        </ul>
        <p className="note">{note || 'Jobs save automatically.'} Use Download file in the title bar to keep a copy on your computer or send one to someone.</p>
      </div>
    </section>
  );
}
