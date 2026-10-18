import { ChevronLeft } from 'lucide-react';
import { useMemo, useState } from 'react';
import { canSnap, cleared, displayLines, hasWork, snapCounts, snapRetry, undo } from './drawing';
import { ElevationChart } from './ElevationChart';
import { formatDistance, totalKm } from './geo';
import { clearDraft } from './Panels';
import { PROFILES } from './Plan';
import { useStore } from './store';

/** The drawing tools, as a sidebar view: the distance so far, how to draw, route shapes, elevation, and Undo / Clear / Finish / Cancel at the foot. */
export function DrawPanel({ onFinish }: { onFinish: () => void }) {
  const { draw, mode, setMode, apply, units, stopDrawing, selectedVertex, setSelectedVertex, deleteSelectedVertex, extendingId, setPanel, closeLoop, outAndBack, elevationOpen, setElevationOpen, drawColor, imported, followRoads, setFollowRoads, followProfile, setFollowProfile, routePlanning } = useStore();
  const lines = useMemo(() => displayLines(draw), [draw]);
  const km = useMemo(() => totalKm(lines), [lines]);
  const [confirmClear, setConfirmClear] = useState(false);
  const work = hasWork(draw);
  const c = snapCounts(draw);
  const canFollow = canSnap(draw);

  function cancel() {
    if (work && !window.confirm('Discard this drawing?')) return;
    clearDraft();
    stopDrawing();
    if (extendingId) setPanel('detail'); // back to the track that was being edited
  }
  return (
    <section className="side-view" aria-label="Drawing tools">
      <div className="side-head">
        <div className="side-back"><button type="button" className="back" onClick={cancel} title={work ? 'Go back to your tracks and the other choices. Asks first, because this drawing is not saved.' : 'Go back to your tracks and the other choices'} data-testid="draw-back"><ChevronLeft size={18} aria-hidden="true" /> {extendingId ? 'Track' : 'Back'}</button></div>
        <h2>{extendingId ? 'Edit route' : 'Draw a route'}</h2>
      </div>
      <div className="side-body">
        <div className="readout" aria-live="polite" data-testid="distance" title="Total distance of the route so far">{formatDistance(km, units)}</div>
        <div className="seg three" role="group" aria-label="Draw mode" data-tour="rt-modes">
          <button type="button" aria-pressed={mode === 'freehand'} onClick={() => setMode('freehand')} title="Freehand: press and drag to draw a line that follows your finger or mouse. Two fingers, or Space + drag, move the map.">Freehand</button>
          <button type="button" aria-pressed={mode === 'click'} onClick={() => setMode('click')} title="Click: each click or tap adds a point joined by a straight line. Best for following roads precisely. Drag a point to move it. Double-click to finish.">Click</button>
          <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')} disabled={!work} title="Edit points: drag a point to move it, drag a small dot to add a point, tap a point to pick it for deleting">Edit points</button>
        </div>
        <p className="hint">{mode === 'freehand' ? 'Drag to draw. Two fingers (or Space + drag) to move the map.' : mode === 'click' ? (followRoads ? 'Click to add points: each click finds the road or path from the last one. Drag a point to move it. Double-click to finish.' : 'Click to add points. Drag a point to move it. Double-click to finish.') : 'Drag a point to move it. Drag a small dot to add a point. Tap a point, then Delete selected point.'}</p>
        {mode === 'click' && (
          <div className="follow" data-tour="rt-follow">
            <button
              type="button" aria-pressed={followRoads} disabled={!followRoads && (!routePlanning || !canFollow)} onClick={() => setFollowRoads(!followRoads)}
              title={followRoads ? 'Follow roads is on: each click finds the road or path from the last click. Press to go back to straight lines between clicks.'
                : !routePlanning ? 'Follow roads needs route planning, which is not set up on this server yet (ORS_API_KEY)'
                  : !canFollow ? 'Follow roads starts from the first click. Clear this drawing, or start a new one, to use it.'
                    : 'Follow roads: each click finds the road or path from the last click, instead of a straight line'}
            >Follow roads</button>
            {followRoads && (
              <div className="seg four" role="group" aria-label="Follow roads for">
                {PROFILES.map(({ id, label, tip, Icon }) => (
                  <button key={id} type="button" aria-pressed={followProfile === id} aria-label={`Follow roads for ${label.toLowerCase()}`} onClick={() => setFollowProfile(id)} title={`${label}: ${tip}. Applies to the next clicks.`}><Icon size={18} aria-hidden="true" /></button>
                ))}
              </div>
            )}
          </div>
        )}
        {draw.snap && (c.waiting > 0 || c.failed > 0) && (
          <div className="snap-status" aria-live="polite" data-testid="snap-status">
            {c.waiting > 0 && <span>Finding the roads…</span>}
            {c.failed > 0 && (
              <>
                <span>{c.failed} {c.failed === 1 ? 'section' : 'sections'} could not follow a road, so {c.failed === 1 ? 'it is a straight line' : 'they are straight lines'}.</span>
                <button type="button" onClick={() => apply(snapRetry)} title="Ask for the roads again for the sections that are straight lines">Try again</button>
              </>
            )}
          </div>
        )}
        {mode === 'edit' && (
          <button type="button" className="danger" onClick={deleteSelectedVertex} disabled={!selectedVertex} title="Delete the point you tapped (or press Delete). A stroke always keeps at least two points.">Delete selected point</button>
        )}
        <div className="row" role="group" aria-label="Route shape" data-tour="rt-shape">
          <button type="button" onClick={closeLoop} disabled={!work} title="Add a straight line from the end of the route back to its start, making a loop">Return to start</button>
          <button type="button" onClick={outAndBack} disabled={!work} title="Retrace the route in reverse so you finish where you began. The distance doubles.">Out and back</button>
          <button type="button" onClick={() => setElevationOpen(!elevationOpen)} aria-pressed={elevationOpen} disabled={!work} title="Show the elevation profile and total climb for this route, from terrain data" data-tour="rt-elev">Elevation</button>
        </div>
        {elevationOpen && work && <ElevationChart lines={lines} color={drawColor} name={imported?.name ?? 'Drawing'} />}
      </div>
      <div className="side-foot" data-tour="rt-actions">
        <button type="button" className="primary wide" onClick={onFinish} disabled={!work || c.waiting > 0} title={c.waiting > 0 ? 'Waiting for the roads to be found, a moment' : 'Finish drawing and save it as a named track'}>Finish</button>
        <div className="row">
          <button type="button" onClick={() => { setSelectedVertex(null); apply(undo); }} disabled={!draw.history.length && !draw.active} title="Undo the last stroke, point, move or route shape (one step at a time)">Undo</button>
          {confirmClear ? (
            <>
              <span>Clear all?</span>
              <button type="button" onClick={() => { apply(cleared); setConfirmClear(false); }} title="Yes, remove everything drawn">Yes</button>
              <button type="button" onClick={() => setConfirmClear(false)} title="No, keep the drawing">No</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmClear(true)} disabled={!work} title="Remove everything you have drawn (asks first)">Clear</button>
          )}
          <button type="button" onClick={cancel} title="Stop drawing and discard it (asks first)">Cancel</button>
        </div>
      </div>
    </section>
  );
}
