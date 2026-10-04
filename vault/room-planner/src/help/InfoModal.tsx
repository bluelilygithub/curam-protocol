// "How this works" for the Room Planner (same pattern as Vault's CrmInfoModal / FontTutorialModal): opens by itself once per browser,
// and any time from the (i) button beside the title. Esc or clicking outside closes it.
import { useEffect } from 'react';
import { useApp, useUi } from '../ui/AppContext';
import { Icons } from '../ui/icons';
import { INFO_SEEN_KEY, safeSet } from './helpKeys';

export function InfoModal() {
  const app = useApp();
  const open = useUi((s) => s.infoOpen);
  const close = (): void => { safeSet(INFO_SEEN_KEY, '1'); app.ui.getState().setInfoOpen(false); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal info-modal" role="dialog" aria-modal="true" aria-label="How the Room Planner works">
        <div className="modal-head">
          <h2 className="info-title">{Icons.info}<span>How This Works</span></h2>
          <button className="btn icon" onClick={close} aria-label="Close" title="Close (Esc)">×</button>
        </div>
        <div className="info-body">
          <p>Design one or more rooms to scale, check that everything fits, then walk through them or make a photo to show a client.</p>
          <div className="info-card">
            <p><strong>Draw the room.</strong> Start a room (or a rectangle), then set exact sizes by typing a wall length in the Inspector. Walls grow outward only, so the inside size never changes.</p>
            <p><strong>Furnish it.</strong> Click a piece in the Library, then click the plan to place it. Drag to move, press R to rotate. The planner tells you when something overlaps, blocks a door swing or leaves too little clearance, and “Fix position” moves it to the nearest valid spot.</p>
            <p><strong>Everything is undoable.</strong> Undo and Redo cover every change. Undo history is not saved with the project.</p>
            <p><strong>2D and 3D.</strong> 2D is the plan you edit; 3D shows the same design. Save viewpoints in 3D to come back to them or to use as the stops of a fly-through.</p>
            <p><strong>Cinematic.</strong> A clean white model or a Realistic look with wood, fabric and daylight, with a fly-through, a first-person walk and a full-screen presentation. Low quality is the fast setting for laptops.</p>
            <p><strong>Render photo.</strong> A real, path-traced picture of your design (never an AI-made image, so it can’t invent or change anything). It starts grainy and sharpens; choose Draft to check and Good for a client. It can take minutes, depending on your computer.</p>
            <p><strong>Projects.</strong> A project can hold several rooms. Projects save to your Vault account and autosave a moment after each change; import and export a file any time. If you are signed out they save in this browser.</p>
          </div>
          <p className="info-foot">The compass beside the title gives a guided tour. Hover any button or field for a short explanation.</p>
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={close}>Got it</button>
        </div>
      </div>
    </div>
  );
}
