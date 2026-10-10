import { staffPrice, type Catalogue } from '../app/catalogue';
import type { Analysis, AppProject } from '../app/model';

/**
 * The design at a glance, always on screen above the drawing: bottles, rack units, price and the number of errors and warnings, so nobody has to open a
 * panel to know where the design stands. The buttons on the right hide the side panels (the choice is remembered) or give the drawing the whole window.
 */
export function StatusStrip({ project, analysis, cat, layout }: {
  project: AppProject; analysis: Analysis; cat: Catalogue | null;
  layout: { leftHidden: boolean; rightHidden: boolean; focus: boolean; toggleLeft(): void; toggleRight(): void; toggleFocus(): void; showChecks(): void };
}) {
  const t = analysis.racks.total;
  const units = project.runs.reduce((n, r) => n + (Number.isFinite(r.units) && r.units > 0 ? Math.floor(r.units) : 0), 0);
  const errors = analysis.issues.filter((i) => i.severity === 'error').length;
  const warnings = analysis.issues.filter((i) => i.severity === 'warning').length;
  const price = staffPrice(project, cat, { errors });
  return (
    <div className="status-strip" data-testid="status-strip">
      <div className="status-items" role="status" aria-label="Design summary">
        <span title="Bottles all the racks hold. It says not set until every run has the values it needs." data-testid="strip-bottles"><b>{t.status === 'OK' ? t.capacity : 'not set'}</b> bottles</span>
        <span title="Rack units across all runs." data-testid="strip-units"><b>{units}</b> {units === 1 ? 'unit' : 'units'}</span>
        <span title={price.status === 'OK' ? 'The total from the Price panel (the customer range is shown there).' : price.reason} data-testid="strip-price">{price.status === 'OK' ? <b>{price.currency}{price.total.toLocaleString('en-AU')}</b> : <span className="muted">no price</span>}</span>
        <button type="button" className={`strip-checks${errors ? ' bad' : ''}`} title={errors ? 'There are errors in this design. Show the checks.' : 'Show the checks.'} onClick={layout.showChecks} data-testid="strip-checks">
          <b>{errors}</b> {errors === 1 ? 'error' : 'errors'}{warnings > 0 && <>, <b>{warnings}</b> {warnings === 1 ? 'warning' : 'warnings'}</>}
        </button>
      </div>
      <div className="status-views" role="group" aria-label="Panels">
        <button type="button" className="btn small" aria-pressed={layout.leftHidden || layout.focus} title={layout.leftHidden ? 'Show the controls panel.' : 'Hide the controls panel to give the drawing more room. Your choice is remembered.'} onClick={layout.toggleLeft} data-testid="toggle-left">{layout.leftHidden || layout.focus ? 'Show controls' : 'Hide controls'}</button>
        <button type="button" className="btn small" aria-pressed={layout.rightHidden || layout.focus} title={layout.rightHidden ? 'Show the checks panel.' : 'Hide the checks panel. The strip still shows the error count. Your choice is remembered.'} onClick={layout.toggleRight} data-testid="toggle-right">{layout.rightHidden || layout.focus ? 'Show checks' : 'Hide checks'}</button>
        <button type="button" className="btn small" aria-pressed={layout.focus} title={layout.focus ? 'Leave focus mode and bring the panels back (Esc).' : 'Focus mode: hide both panels so the drawing has the whole window.'} onClick={layout.toggleFocus} data-testid="toggle-focus">{layout.focus ? 'Leave focus' : 'Focus'}</button>
      </div>
    </div>
  );
}
