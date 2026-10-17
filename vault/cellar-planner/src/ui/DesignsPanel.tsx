import { useStore } from 'zustand';
import type { Designs } from '../app/designs';

const SAVE = { loading: 'Opening…', saved: 'Saved ✓', saving: 'Saving…', unsaved: 'Unsaved changes…', error: 'Not saved', conflict: 'Save paused' } as const;

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
