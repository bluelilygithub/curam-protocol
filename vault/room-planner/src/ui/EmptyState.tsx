import { useApp, useUi } from './AppContext';
import { Icons } from './icons';

/** B8: centred first-run prompt with the two ways to begin. While drawing a room it shrinks to a three-step hint. */
export function EmptyState() {
  const app = useApp();
  const tool = useUi((s) => s.tool);

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
          <button className="btn primary big" onClick={() => app.startRectangle()}>
            {Icons.rect}<span>Start from a rectangle</span><small>4 × 5 m, change it later</small>
          </button>
          <button className="btn big" onClick={() => app.startDrawing()} title="Click each corner of the room">
            {Icons.pencil}<span>Draw a room</span><small>any shape</small>
          </button>
        </div>
        <p className="fine">Everything you change can be undone. Your project is saved in this browser as you go.</p>
      </div>
    </div>
  );
}
