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
            <p><strong>Furnish it.</strong> Click a piece in the Library, then click the plan to place it. Drag to move, press R to rotate. The planner tells you when something overlaps, blocks a door swing or leaves too little clearance, and “Fix position” moves it to the nearest valid spot. The Library also has plants, a lamp, a mirror and rugs; furniture can stand on a rug. Pictures, paintings and mirrors (Wall art) hang flat on a wall at a set height; change the height in the Inspector (Elevation). Select a picture, or the Your photo frame piece, and use <strong>Use my photo</strong> in the Inspector to put one of your own photos in it; the photo is shrunk and kept inside the project, and shows in the Realistic 3D look and in Render photo. Ceiling lights and table lamps light the room (see Lights below); a table lamp, like a small plant, settles on a table. Ceiling lights hang from the ceiling and light the room in the Realistic look. A small plant settles on a side table or sideboard when you drop it there, and travels with it if you move the table.</p>
            <p><strong>Snapping.</strong> While you drag, pieces snap to walls, corners and each other. The Snap list in the toolbar switches between Smart, Grid only (edges land on grid lines measured from the room’s first corner) and Off, and Grid sets the spacing. Hold Alt to skip snapping for one move. The grid lines show on the floor inside the room, from the room’s first corner (zoom in to see the finer lines). Hover any piece in the plan to see its name and size.</p>
            <p><strong>Lost the room?</strong> If you drag or zoom the plan until the room is out of view, a <strong>Show room</strong> button appears; the Home key and the fit button in the toolbar do the same.</p>
            <p><strong>Everything is undoable.</strong> Undo and Redo cover every change. Undo history is not saved with the project.</p>
            <p><strong>2D and 3D.</strong> 2D is the plan you edit; 3D shows the same design. Save viewpoints in 3D to come back to them or to use as the stops of a fly-through.</p>
            <p><strong>Colour palettes.</strong> Pick a palette for a room (in the Inspector with nothing selected, or the Palette list in 3D) to colour the walls, floor, trim, sofas and rugs together. It shows in the 3D view; a finish you choose for a piece is kept.</p>
            <p><strong>The 3D bar.</strong> One bar at the bottom of the 3D view: the camera (Perspective, Orthographic, Isometric, Top, Fit room), the look (Standard, Clay, Realistic), Play tour for a fly-through, and Render photo. The <strong>View</strong> menu holds Quality (Low is the fast setting for laptops), Walk, Full screen and Saved views. At the bottom of the Inspector are three boxes, collapsed until you open them: <strong>Colour palette</strong>, <strong>Lights</strong> (switch ceiling lights and lamps on or off, and drag the power of all lights; select a light to drag its own power; they show in the Realistic look and in Render photo) and <strong>Sound</strong> (soothing rain, ocean waves, forest breeze or calm music, made in your browser).</p>
            <p><strong>Render photo.</strong> A real, path-traced picture of your design (never an AI-made image, so it can’t invent or change anything). Pick the current view, an eye-level “Inside the room” view, or a saved view. The first few seconds are spent preparing, then it starts grainy and sharpens; choose Draft to check and Good for a client. It can take minutes, depending on your computer.</p>
            <p><strong>3D models.</strong> Pieces marked “3D model” in the Library are real, photographed-and-textured models. They show as the real thing in the Realistic look and in Render photo, and as plain shapes in the other looks. They are free to use (CC0); <button className="link" onClick={() => app.ui.getState().setCreditsOpen(true)}>see the credits</button>.</p>
            <p><strong>Schedule and PDF.</strong> The <strong>Schedule</strong> button in the toolbar lists what is in the room (or every room): kinds grouped with quantity, size, vendor, SKU, finish code, unit cost and a cost total. <strong>Download CSV</strong> gives a spreadsheet file; <strong>Download PDF</strong> gives a to-scale plan of each room (walls, doors with their swing, numbered pieces, dimensions, a scale bar) followed by the schedule. Fill in vendor, SKU, finish code, cost and notes for a piece in the Inspector (Metadata).</p>
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
