import { useApp, useLibrary } from './AppContext';

/** Shown only when saving needs the owner: a conflict (changed in another window) or a save that failed. */
export function LibraryBanner() {
  const app = useApp();
  const status = useLibrary((s) => s.status);
  const error = useLibrary((s) => s.error);
  if (status !== 'conflict' && status !== 'error') return null;
  return (
    <div className={`save-banner ${status}`} role="alert">
      <span>{error ?? 'The project could not be saved.'}</span>
      {status === 'conflict' ? (
        <>
          <button className="btn" onClick={() => void app.projects.reloadTheirs()}>Reload the saved version</button>
          <button className="btn primary" onClick={() => void app.projects.overwriteMine()}>Keep mine and overwrite</button>
        </>
      ) : (
        <button className="btn" onClick={() => void app.saveProject()}>Try again</button>
      )}
    </div>
  );
}
