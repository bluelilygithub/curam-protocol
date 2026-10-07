import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { UiStore } from '../app/uiStore';
import type { Designs } from '../app/designs';
import { Icon } from './icons';

const SAVE = { loading: 'Opening…', saved: 'Saved ✓', saving: 'Saving…', unsaved: 'Unsaved changes…', error: 'Not saved', conflict: 'Save paused' } as const;
const when = (t: string): string => new Date(t).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });

/** The header's save state, and (when the design was changed in another window) the choice of which version to keep. */
export function SaveStatus({ designs }: { designs: Designs }) {
  const status = useStore(designs.library, (s) => s.status);
  const where = useStore(designs.library, (s) => s.kind);
  const error = useStore(designs.library, (s) => s.error);
  const bad = status === 'error' || status === 'conflict';
  const text = status === 'saved' ? (where === 'server' ? 'Saved to your Vault account ✓' : 'Saved on this device only ✓') : SAVE[status];
  return (
    <>
      <span className={`save-state${bad ? ' bad' : ''}`} role="status" aria-live="polite" data-testid="save-status" data-status={status} data-where={where ?? ''}
        title={bad && error ? error : where === 'server' ? 'Saved to your Vault account. You can open it from any device.' : 'Saved in this browser on this device only. Open the planner from Vault while signed in to save to your account.'}>
        {text}
      </span>
      <button type="button" className="btn" disabled={status === 'saving' || status === 'loading' || status === 'conflict'} title="Save this design now instead of waiting for the automatic save."
        onClick={() => void designs.controller.saveNow()} data-testid="save-now">Save now</button>
    </>
  );
}

/** The choice shown when the design was changed in another window: keep this screen's version or take the saved one. */
export function ConflictBar({ designs }: { designs: Designs }) {
  const status = useStore(designs.library, (s) => s.status);
  const error = useStore(designs.library, (s) => s.error);
  return (
    <>
      {status === 'conflict' && (
        <div className="conflict" role="alert" data-testid="conflict">
          <span>{error ?? 'This design was changed in another window or tab.'}</span>
          <button type="button" className="btn" title="Keep what is on this screen and save it over the other version." onClick={() => void designs.controller.overwriteMine()} data-testid="keep-mine">Keep mine</button>
          <button type="button" className="btn" title="Throw away what is on this screen and open the version that was saved." onClick={() => void designs.controller.reloadTheirs()} data-testid="use-saved">Use the saved one</button>
        </div>
      )}
    </>
  );
}

/** Your saved designs: open, new, duplicate, delete. Designs save by themselves; Download file / Upload file still move a design in and out as a file. */
export function DesignsPanel({ ui, designs, onImportFile }: { ui: UiStore; designs: Designs; onImportFile: (f: File) => void }) {
  const open = useStore(ui, (s) => s.designsOpen);
  const entries = useStore(designs.library, (s) => s.entries);
  const current = useStore(designs.library, (s) => s.currentId);
  const note = useStore(designs.library, (s) => s.note);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const before = useRef<Element | null>(null);
  const first = useRef<HTMLButtonElement>(null);
  const close = (): void => ui.getState().set({ designsOpen: false });
  useEffect(() => {
    if (!open) return undefined;
    before.current = document.activeElement;
    setConfirmId(null);
    window.setTimeout(() => first.current?.focus(), 0);
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') ui.getState().set({ designsOpen: false }); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); if (before.current instanceof HTMLElement) before.current.focus(); };
  }, [open, ui]);
  if (!open) return null;

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Your designs" data-testid="designs-modal" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal">
        <div className="modal-head"><h2>Your designs</h2><button type="button" className="icon-btn" title="Close." onClick={close} data-testid="designs-close"><Icon name="close" /></button></div>
        <div className="modal-body" tabIndex={0} role="region" aria-label="Saved designs">
          <div className="row">
            <button ref={first} type="button" className="btn primary" title="Start a new design from the blank sample enclosure (racks left blank). The design you have open stays saved." onClick={() => { void designs.controller.newProject('New design'); close(); }} data-testid="design-new">New design</button>
            <button type="button" className="btn" title="Add a .cellar.json file as a new saved design and open it. The design you have open stays as it is." onClick={() => file.current?.click()} data-testid="design-import">Upload file</button>
            <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Upload a design file" title="Upload a design file" onChange={(e) => { const f = e.target.files?.[0]; if (f) { onImportFile(f); close(); } e.target.value = ''; }} />
          </div>
          <ul className="plist" data-testid="design-list">
            {entries.map((e) => (
              <li key={e.id} className={e.id === current ? 'cur' : ''} data-testid="design-item">
                <button type="button" className="plist-main" title="Open this design." aria-current={e.id === current ? 'true' : undefined} onClick={() => { void designs.controller.open(e.id); close(); }}>
                  <strong>{e.name}</strong>
                  <span>{e.runCount} rack run{e.runCount === 1 ? '' : 's'}, {e.rackUnits} unit{e.rackUnits === 1 ? '' : 's'}{e.estimated ? ', best-guess values' : ''} · saved {when(e.updatedAt)}</span>
                </button>
                <button type="button" className="btn" title="Make a copy of this design." onClick={() => void designs.controller.duplicate(e.id)} data-testid="design-copy">Copy</button>
                {confirmId === e.id
                  ? <span className="confirm">Delete? <button type="button" className="link" title="Yes, delete this design." onClick={() => { void designs.controller.remove(e.id); setConfirmId(null); }} data-testid="design-delete-yes">Yes</button> / <button type="button" className="link" title="No, keep this design." onClick={() => setConfirmId(null)}>No</button></span>
                  : <button type="button" className="btn" title="Delete this design. It cannot be undone." onClick={() => setConfirmId(e.id)} data-testid="design-delete">Delete</button>}
              </li>
            ))}
            {entries.length === 0 && <li className="empty">No saved designs yet.</li>}
          </ul>
          <p className="note">{note || 'Designs save automatically.'} Use Download file in the header to keep a copy on your computer or send one to someone.</p>
        </div>
      </div>
    </div>
  );
}
