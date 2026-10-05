import { useStore } from 'zustand';
import { useApp, useProject, useUi } from './AppContext';

const SAVE = { loading: 'Opening…', saved: 'Saved ✓', saving: 'Saving…', unsaved: 'Unsaved changes…', error: 'Not saved', conflict: 'Save paused' } as const;

export function StatusBar() {
  const app = useApp();
  const status = useUi((s) => s.status);
  const save = useStore(app.library, (s) => s.status);
  const where = useStore(app.library, (s) => s.kind);
  const error = useStore(app.library, (s) => s.error);
  const loc = useProject((s) => s.project?.location.label);
  const zone = useProject((s) => s.project?.climateZone);
  const bad = save === 'error' || save === 'conflict';
  const place = where === 'server' ? ' to Vault' : where === 'local' ? ' in this browser' : '';
  return (
    <>
      {save === 'conflict' && (
        <div className="conflict" role="alert">
          <span>{error}</span>
          <button type="button" className="btn" onClick={() => void app.resolveConflict('saved')}>Load the saved version</button>
          <button type="button" className="btn primary" onClick={() => void app.resolveConflict('mine')}>Keep mine</button>
        </div>
      )}
      <div className="statusbar" role="status" aria-live="polite">
        <span className={`st-msg${status ? ` st-${status.severity}` : ''}`}>{status?.text ?? ''}</span>
        {loc && <span>{loc} · {zone?.replace('_', ' ')}</span>}
        <span className={bad ? 'st-error' : ''} title={bad && error ? error : where === 'server' ? 'Saved to your Vault account' : 'Saved in this browser only'}>
          {SAVE[save]}{save === 'saved' ? place : ''}
        </span>
      </div>
    </>
  );
}
