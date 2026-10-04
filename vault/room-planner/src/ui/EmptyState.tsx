import { useApp, useProject, useUi } from './AppContext';
import { Icons } from './icons';

/** B8: centred first-run prompt with the two ways to begin. While drawing a room it shrinks to a three-step hint. */
export function EmptyState() {
  const app = useApp();
  const tool = useUi((s) => s.tool);
  const roomsInProject = useProject((s) => s.document?.rooms.length ?? 0);

  // Adding a room to a project that already has some: just the drawing hint, with a way back.
  if (roomsInProject > 0) {
    return (
      <div className="draw-hint" role="status">
        <strong>Draw a new room</strong>
        <ol>
          <li>Click to place the first corner, then each next corner.</li>
          <li>Click the <em>first</em> corner again, or press <kbd>Enter</kbd>, to close the room.</li>
          <li><kbd>Backspace</kbd> removes the last corner · <kbd>Esc</kbd> twice gives up.</li>
        </ol>
        <button className="btn" title="Go back to your other rooms" onClick={() => app.cancelNewRoom()}>Cancel</button>
      </div>
    );
  }

  if (tool === 'wall_edit') {
    return (
      <div className="draw-hint" role="status">
        <strong>Draw a room</strong>
        <ol>
          <li>Click to place the first corner, then each next corner.</li>
          <li>Click the <em>first</em> corner again, or press <kbd>Enter</kbd>, to close the room.</li>
          <li><kbd>Backspace</kbd> removes the last corner · <kbd>Esc</kbd> cancels.</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="empty" role="region" aria-label="Get started">
      <div className="empty-card">
        <p className="eyebrow">New plan</p>
        <h1>Start with a room</h1>
        <p className="lede">Begin with a ready-made rectangle, or draw your own shape corner by corner. Then add wall thickness, doors, windows and furniture.</p>
        <div className="empty-actions">
          <button className="btn primary big" title="Place a 4 × 5 m rectangular room. You can change every wall length afterwards." onClick={() => app.startRectangle()}>
            {Icons.rect}<span>Start from a rectangle</span><small>4 × 5 m, change it later</small>
          </button>
          <button className="btn big" onClick={() => app.startDrawing()} title="Click each corner of the room">
            {Icons.pencil}<span>Draw a room</span><small>any shape</small>
          </button>
        </div>
        <p className="fine">Everything you change can be undone. Your project is saved as you go; open <strong>Projects</strong> in the toolbar to manage them.</p>
      </div>
    </div>
  );
}
