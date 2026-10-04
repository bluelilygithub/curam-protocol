import { useEffect, useMemo } from 'react';
import { validateRoom, primaryViolation } from '../engine/validation';
import { describeViolation, nameOf } from '../interaction/statusMessages';
import { useApp, useBus, useProject, useUi } from './AppContext';
import { Icons } from './icons';

/** Status bar (Spec §6): context · snap state · constraint message. Never modal. The message is clickable → violation popover (B5). */
export function StatusBar() {
  const app = useApp();
  const project = useProject((s) => s.project);
  const selection = useUi((s) => s.selection);
  const status = useUi((s) => s.status);
  const popoverOpen = useUi((s) => s.popoverOpen);
  const grid = useUi((s) => s.grid);
  const live = useBus((s) => s.message);
  const room = project?.rooms[0];

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => app.ui.getState().setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status, app]);

  const validation = useMemo(() => (project && room ? validateRoom(room, project.furnitureDefinitions) : null), [project, room]);
  const selectedIds = new Set(selection.filter((s) => s.kind !== 'wall').map((s) => s.id));
  const relevant = validation
    ? validation.violations.filter((v) => selectedIds.size === 0 || v.involvedObjectIds.some((i) => selectedIds.has(i)) || (v.involvedFixtureIds ?? []).some((i) => selectedIds.has(i)))
    : [];
  const primary = relevant.length && validation ? primaryViolation({ valid: validation.valid, violations: relevant }) : undefined;

  let context = 'Nothing selected';
  if (project && room && selection.length === 1) {
    const s = selection[0];
    if (s.kind === 'furniture') {
      const f = room.furniture.find((x) => x.id === s.id);
      if (f) context = `${nameOf(project, f.id)} · x ${f.position.x.toFixed(3)}  y ${f.position.y.toFixed(3)} · ${((f.rotation * 180) / Math.PI).toFixed(1)}°`;
    } else if (s.kind === 'fixture') {
      const f = room.fixtures.find((x) => x.id === s.id);
      if (f) context = `${nameOf(project, f.id)} · ${f.offsetAlongWall.toFixed(3)} m along wall`;
    } else if (s.kind === 'vertex') {
      const i = room.vertices.findIndex((x) => x.id === s.id);
      const v = room.vertices[i];
      if (v) context = `Corner ${i + 1} · x ${v.position.x.toFixed(3)}  y ${v.position.y.toFixed(3)}`;
    } else {
      context = `Wall ${room.walls.findIndex((w) => w.id === s.id) + 1}`;
    }
  } else if (selection.length > 1) {
    context = `${selection.length} selected`;
  }

  // Priority: the live drag message, then a transient notice from an action (it expires after 5 s), then the standing problem.
  const message = live
    ? { text: live.text, severity: live.severity }
    : status
      ? { text: status.text, severity: status.severity === 'info' ? 'info' as const : 'hard' as const }
      : primary && project
        ? { text: describeViolation(project, primary), severity: primary.severity }
        : null;
  const clickable = !live && !status && relevant.length > 0;

  return (
    <footer className="statusbar" role="status">
      <span className="ctx" title="Current selection">{context}</span>
      <span className="snap" title="Snapping: wall corners, walls, furniture edges and centres, alignment, grid">Snap on · grid {grid * 100} cm</span>
      <span className="spacer" />
      {message ? (
        <button
          className={`msg ${message.severity}`} disabled={!clickable} aria-expanded={popoverOpen}
          onClick={() => app.ui.getState().setPopover(!popoverOpen)}
          title={clickable ? 'Show everything that needs attention' : undefined}
        >
          {message.severity !== 'info' && Icons.warn}
          <span>{message.text}</span>
          {clickable && relevant.length > 1 && <span className="count">+{relevant.length - 1}</span>}
        </button>
      ) : (
        <span className="msg ok">{validation && validation.violations.length === 0 && room?.furniture.length ? 'Everything fits' : ''}</span>
      )}

      {popoverOpen && project && relevant.length > 0 && (
        <div className="popover" role="dialog" aria-label="Problems">
          <div className="popover-head">
            <strong>{relevant.length} {relevant.length === 1 ? 'thing needs' : 'things need'} attention</strong>
            <button className="btn icon" onClick={() => app.ui.getState().setPopover(false)} aria-label="Close">×</button>
          </div>
          <ul className="violations">
            {relevant.map((v, i) => (
              <li key={i} className={v.severity}>
                <span className="dot" />
                <span>{describeViolation(project, v)}</span>
                {v.involvedObjectIds.map((id) => (
                  <button key={id} className="link" onClick={() => app.ui.getState().select([{ kind: 'furniture', id }])}>{nameOf(project, id)}</button>
                ))}
                {(v.involvedFixtureIds ?? []).map((id) => (
                  <button key={id} className="link" onClick={() => app.ui.getState().select([{ kind: 'fixture', id }])}>{nameOf(project, id)}</button>
                ))}
              </li>
            ))}
          </ul>
          {selection.length === 1 && selection[0].kind === 'furniture' && relevant.some((v) => v.severity === 'hard') && (
            <button className="btn primary" title="Move this piece to the nearest spot where it fits" onClick={() => { app.fixPosition(selection[0].id); app.ui.getState().setPopover(false); }}>Fix position</button>
          )}
        </div>
      )}
    </footer>
  );
}
