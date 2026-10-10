// The zoom in / zoom out / reset buttons in the corner of a picture (the same three on the 3D view, the plan and the wall view).
export function ZoomControls({ testid, onIn, onOut, onReset, canReset }: { testid: string; onIn(): void; onOut(): void; onReset(): void; canReset: boolean }) {
  return (
    <span className="zoomctl" role="group" aria-label="Zoom">
      <button type="button" className="zoomctl-btn" onClick={onIn} title="Zoom in." aria-label="Zoom in" data-testid={`${testid}-zoom-in`}>+</button>
      <button type="button" className="zoomctl-btn" onClick={onOut} title="Zoom out." aria-label="Zoom out" data-testid={`${testid}-zoom-out`}>−</button>
      <button type="button" className={`zoomctl-btn${canReset ? ' lit' : ''}`} onClick={onReset} title="Back to the starting view." aria-label="Reset the view" data-testid={`${testid}-reset`}>⟲</button>
    </span>
  );
}
