// Credits: who made the 3D models and under what licence, plus the main open-source software the planner is built with.
import { useEffect } from 'react';
import { MODEL_LICENCE, modelPageUrl, REAL_MODELS } from '../data/realModels';
import { useApp, useUi } from './AppContext';

const SOFTWARE: Array<{ name: string; licence: string; url: string; what: string }> = [
  { name: 'three.js', licence: 'MIT', url: 'https://threejs.org', what: '3D view' },
  { name: 'three-gpu-pathtracer', licence: 'MIT', url: 'https://github.com/gkjohnson/three-gpu-pathtracer', what: 'Render photo' },
  { name: 'React Three Fiber', licence: 'MIT', url: 'https://r3f.docs.pmnd.rs', what: '3D view host' },
  { name: 'Konva', licence: 'MIT', url: 'https://konvajs.org', what: 'plan drawing' },
  { name: 'pdf-lib', licence: 'MIT', url: 'https://pdf-lib.js.org', what: 'PDF plan and schedule' },
];

export function CreditsPanel() {
  const app = useApp();
  const open = useUi((s) => s.creditsOpen);
  const close = (): void => app.ui.getState().setCreditsOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); app.ui.getState().setCreditsOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, app]);
  if (!open) return null;
  const models = Object.values(REAL_MODELS).sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal credits-panel" role="dialog" aria-modal="true" aria-label="Credits">
        <div className="modal-head">
          <h2>Credits</h2>
          <button className="btn icon" onClick={close} aria-label="Close credits" title="Close (Esc)">×</button>
        </div>
        <div className="info-body">
          <h3 className="credits-h">3D models</h3>
          <p>The pieces marked “3D model” come from <a href="https://polyhaven.com" target="_blank" rel="noreferrer noopener">Poly Haven</a>, a community library of free assets. They are released under <a href={MODEL_LICENCE.url} target="_blank" rel="noreferrer noopener">{MODEL_LICENCE.name}</a>, which needs no credit; they are listed here with thanks to the artists. The textures were reduced in size for this app; nothing else was changed apart from fitting each model to the size you choose.</p>
          <ul className="credits-list">
            {models.map((m) => (
              <li key={m.folder}>
                <a href={modelPageUrl(m)} target="_blank" rel="noreferrer noopener">{m.title}</a> by {m.author}
              </li>
            ))}
          </ul>
          <h3 className="credits-h">Software</h3>
          <ul className="credits-list">
            {SOFTWARE.map((s) => (
              <li key={s.name}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.name}</a> ({s.licence}): {s.what}</li>
            ))}
          </ul>
        </div>
        <div className="modal-foot"><span className="spacer" /><button className="btn" onClick={close}>Close</button></div>
      </div>
    </div>
  );
}
