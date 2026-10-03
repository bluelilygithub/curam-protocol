import { useApp } from './AppContext';
import { Icons } from './icons';

/** B8: centred first-run prompt with the two ways to begin. */
export function EmptyState() {
  const app = useApp();
  return (
    <div className="empty" role="region" aria-label="Get started">
      <div className="empty-card">
        <p className="eyebrow">New plan</p>
        <h1>Start with a room</h1>
        <p className="lede">Begin with a ready-made rectangle, then add walls’ thickness, doors, windows and furniture.</p>
        <div className="empty-actions">
          <button className="btn primary big" onClick={() => app.startRectangle()}>
            {Icons.rect}<span>Start from a rectangle</span><small>4 × 5 m</small>
          </button>
          <button className="btn big" disabled title="Drawing a room corner by corner arrives in the next milestone">
            {Icons.pencil}<span>Draw a room</span><small>coming next</small>
          </button>
        </div>
        <p className="fine">Everything you change can be undone. Your project is saved in this browser as you go.</p>
      </div>
    </div>
  );
}
