import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { aabbOf } from '../engine/geometry';
import { cleanName } from '../engine/roomOps';
import { polygonArea } from '../engine/polygons';
import { validateRoom } from '../engine/validation';
import { describeViolation, nameOf } from '../interaction/statusMessages';
import type { ValidationViolation, Project } from '../engine/types';
import { useApp, useProject, useUi } from './AppContext';
import { Icons } from './icons';
import {
  previewFixtureEdit, previewFurnitureEdit, previewVertexPosition, previewWallLength, previewWallThickness, readFixtureField, readFurnitureField,
  type FieldPreview, type FieldValue, type FixtureField, type FurnitureField,
} from './inspectorLogic';

const fmt = (n: number): string => String(Number(n.toFixed(3)));

interface FieldProps {
  label: string;
  unit?: string;
  committed: string;
  mixed?: boolean;
  unavailable?: boolean;
  preview(draft: string): FieldPreview;
  onCommit(p: FieldPreview): void;
  kind?: 'number' | 'text' | 'area';
  placeholder?: string;
}

/**
 * One inspector field (A5): live domain validation on change (red outline + message for a hard violation, amber for soft);
 * on blur or Enter an invalid value reverts, a valid one is quantized and committed as one command. The message is also shown
 * as text under the field, because nothing important may depend on hover.
 */
function Field({ label, unit, committed, mixed, unavailable, preview, onCommit, kind = 'number', placeholder }: FieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [p, setP] = useState<FieldPreview | null>(null);
  const shown = draft ?? (mixed ? '' : committed);
  const cls = p && (p.state === 'hard' || p.state === 'invalid') ? 'field-hard' : p?.state === 'soft' ? 'field-soft' : '';

  const settle = (commit: boolean): void => {
    if (draft !== null && commit && draft !== committed) {
      const result = preview(draft);
      if ((result.state === 'ok' || result.state === 'soft') && result.command) onCommit(result);
    }
    setDraft(null);
    setP(null);
  };
  const common = {
    value: shown,
    disabled: unavailable,
    placeholder: mixed ? 'Mixed' : unavailable ? 'n/a' : placeholder,
    'aria-invalid': cls === 'field-hard' || undefined,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setP(preview(e.target.value)); },
    onBlur: () => settle(true),
    onKeyDown: (e: React.KeyboardEvent) => {
      e.stopPropagation(); // typing never reaches the canvas shortcuts
      if (e.key === 'Enter' && kind !== 'area') { settle(true); (e.target as HTMLElement).blur(); }
      if (e.key === 'Escape') { settle(false); (e.target as HTMLElement).blur(); }
    },
  };
  return (
    <label className={`field ${cls} ${unavailable ? 'disabled' : ''}`}>
      <span className="field-label">{label}</span>
      <span className="field-control">
        {kind === 'area' ? <textarea rows={2} {...common} /> : <input inputMode={kind === 'number' ? 'decimal' : 'text'} spellCheck={false} {...common} />}
        {unit && <span className="unit">{unit}</span>}
      </span>
      {p?.message && <span className={`field-msg ${p.state === 'soft' ? 'soft' : 'hard'}`} role="alert">{p.message}</span>}
    </label>
  );
}

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="section" open={open}>
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

function ViolationList({ items, project }: { items: ValidationViolation[]; project: Project }) {
  const app = useApp();
  if (items.length === 0) return <p className="ok-line">No problems with this placement.</p>;
  return (
    <ul className="violations">
      {items.map((v, i) => (
        <li key={i} className={v.severity}>
          <span className="dot" aria-label={v.severity === 'hard' ? 'Must fix' : 'Warning'} />
          <span>{describeViolation(project, v)}</span>
          {v.involvedObjectIds.slice(0, 2).map((id) => (
            <button key={id} className="link" onClick={() => app.ui.getState().select([{ kind: 'furniture', id }])}>{nameOf(project, id)}</button>
          ))}
        </li>
      ))}
    </ul>
  );
}

/** Rename the open room: type and press Enter (or leave the field). One undoable step. */
function RoomNameField({ id, name }: { id: string; name: string }) {
  const app = useApp();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]); // follows a rename made elsewhere (the room tab, undo)
  const finish = (): void => {
    const next = cleanName(draft, name);
    if (next === name) setDraft(name); // blank or unchanged: put the real name back
    else app.renameRoom(id, next);
  };
  return (
    <label className="field">
      <span className="field-label">Room name</span>
      <input
        value={draft} maxLength={80} aria-label="Room name"
        onChange={(e) => setDraft(e.target.value)} onBlur={finish}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setDraft(name); (e.target as HTMLInputElement).blur(); } }}
      />
    </label>
  );
}

export function Inspector() {
  const app = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const project = useProject((s) => s.project);
  const selection = useUi((s) => s.selection);
  const room = project?.rooms[0];

  const commit = (p: FieldPreview): void => {
    if (p.command) app.project.getState().commitResult({ rejected: false, command: p.command }, p.label);
  };
  const validation = useMemo(() => (project && room ? validateRoom(room, project.furnitureDefinitions) : null), [project, room]);

  if (!project || !room) {
    return <aside className="panel right" aria-label="Inspector"><div className="panel-head"><h2>Inspector</h2></div><div className="panel-body"><p className="hint">Nothing to inspect yet.</p></div></aside>;
  }

  const furnitureIds = selection.filter((s) => s.kind === 'furniture').map((s) => s.id);
  const single = selection.length === 1 ? selection[0] : null;
  let body: ReactNode;

  if (furnitureIds.length > 0 && furnitureIds.length === selection.length) {
    const ids = furnitureIds;
    const group = ids.length > 1;
    const num = (f: FurnitureField, label: string, unit?: string): ReactNode => {
      const r = readFurnitureField(project, ids, f);
      return (
        <Field
          key={f} label={label} unit={unit} mixed={r.mixed} unavailable={r.unavailable}
          committed={typeof r.value === 'number' ? fmt(r.value) : String(r.value ?? '')}
          preview={(d) => previewFurnitureEdit(project, ids, f, d)} onCommit={commit}
        />
      );
    };
    const txt = (f: FurnitureField, label: string, kind: 'text' | 'area' | 'number' = 'text'): ReactNode => {
      const r = readFurnitureField(project, ids, f);
      return (
        <Field
          key={f} label={label} kind={kind} mixed={r.mixed} committed={r.value === undefined ? '' : String(r.value)}
          preview={(d) => previewFurnitureEdit(project, ids, f, d)} onCommit={commit}
        />
      );
    };
    const locked = readFurnitureField(project, ids, 'locked');
    const finish = readFurnitureField(project, ids, 'finish');
    const violations = (validation?.violations ?? []).filter((v) => v.involvedObjectIds.some((id) => ids.includes(id)));
    const hard = violations.some((v) => v.severity === 'hard');
    body = (
      <>
        <div className="subject">
          <div>
            <h3 className="subject-name">{group ? `${ids.length} objects` : nameOf(project, ids[0])}</h3>
            <p className="subject-sub">{group ? 'Edits apply to every selected object' : `Furniture · ${room.name}`}</p>
          </div>
          <button
            className={`btn icon ${locked.value === true ? 'active' : ''}`} aria-pressed={locked.value === true}
            title={locked.value === true ? 'Unlock' : 'Lock in place'}
            onClick={() => commit(previewFurnitureEdit(project, ids, 'locked', locked.value !== true))}
          >
            {locked.value === true ? Icons.lock : Icons.unlock}
          </button>
        </div>
        <Section title="Transform">
          <div className="two">
            {num('x', 'X', 'm')}{num('y', 'Y', 'm')}
            {num('width', 'Width', 'm')}{num('length', 'Length', 'm')}
            {num('height', 'Height', 'm')}{num('elevation', 'Elevation', 'm')}
            {num('rotationDeg', 'Rotation', '°')}
          </div>
          {group && <p className="hint">Position is changed by moving the group.</p>}
        </Section>
        <Section title="Appearance">
          <label className="field">
            <span className="field-label">Finish</span>
            <span className="field-control">
              <select
                value={finish.mixed ? '__mixed__' : String(finish.value ?? '')}
                onChange={(e) => { if (e.target.value !== '__mixed__') commit(previewFurnitureEdit(project, ids, 'finish', e.target.value)); }}
              >
                {finish.mixed && <option value="__mixed__">Mixed</option>}
                <option value="">Default</option>
                {project.materials.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </span>
          </label>
        </Section>
        <Section title="Constraints">
          <ViolationList items={violations} project={project} />
          {hard && !group && <button className="btn primary" onClick={() => app.fixPosition(ids[0])}>Fix position</button>}
        </Section>
        <Section title="Metadata">
          {txt('meta.vendor', 'Vendor')}
          {txt('meta.sku', 'SKU')}
          {txt('meta.finishCode', 'Finish code')}
          {num('meta.unitCost', 'Unit cost')}
          {txt('meta.notes', 'Notes', 'area')}
        </Section>
        <div className="actions">
          <button className="btn" onClick={() => app.interaction.keyDown({ key: 'r', ctrl: false, shift: false, alt: false })}>{Icons.rotate}<span className="label">Rotate 45°</span></button>
          <button className="btn" onClick={() => app.interaction.duplicate(ids)}>{Icons.copy}<span className="label">Duplicate</span></button>
          <button className="btn danger" onClick={() => app.interaction.keyDown({ key: 'Delete', ctrl: false, shift: false, alt: false })}>{Icons.trash}<span className="label">Delete</span></button>
        </div>
      </>
    );
  } else if (single?.kind === 'fixture') {
    const fx = room.fixtures.find((f) => f.id === single.id);
    if (!fx) { body = null; } else {
      const row = (f: FixtureField, label: string, unit?: string): ReactNode => {
        const v = readFixtureField(fx, f);
        return (
          <Field
            key={f} label={label} unit={unit} committed={typeof v === 'number' ? fmt(v) : String(v ?? '')}
            preview={(d) => previewFixtureEdit(project, fx.id, f, d)} onCommit={commit}
          />
        );
      };
      const mine = (validation?.violations ?? []).filter((v) => (v.involvedFixtureIds ?? []).includes(fx.id));
      body = (
        <>
          <div className="subject">
            <div>
              <h3 className="subject-name">{fx.type === 'door' ? 'Door' : 'Window'}</h3>
              <p className="subject-sub">On wall {room.walls.findIndex((w) => w.id === fx.wallId) + 1} of {room.walls.length}</p>
            </div>
          </div>
          <Section title="Size and position">
            <div className="two">
              {row('width', 'Width', 'm')}{row('height', 'Height', 'm')}
              {row('elevation', 'Elevation', 'm')}{row('offsetAlongWall', 'Offset along wall', 'm')}
            </div>
            <p className="hint">Offset is measured from the wall’s start to the centre of the opening.</p>
          </Section>
          {fx.type === 'door' && (
            <Section title="Door">
              <label className="field">
                <span className="field-label">Hinge side</span>
                <span className="field-control">
                  <select value={fx.hingeSide ?? 'left'} onChange={(e) => commit(previewFixtureEdit(project, fx.id, 'hingeSide', e.target.value))}>
                    <option value="left">Left (seen from inside)</option>
                    <option value="right">Right (seen from inside)</option>
                  </select>
                </span>
              </label>
              {row('swingAngleDeg', 'Swing angle', '°')}
            </Section>
          )}
          <Section title="Constraints">
            <ViolationList items={mine} project={project} />
          </Section>
          <div className="actions">
            <button className="btn danger" onClick={() => app.interaction.keyDown({ key: 'Delete', ctrl: false, shift: false, alt: false })}>{Icons.trash}<span className="label">Delete</span></button>
          </div>
        </>
      );
    }
  } else if (single?.kind === 'wall') {
    const wall = room.walls.find((w) => w.id === single.id);
    const idx = room.walls.findIndex((w) => w.id === single.id);
    if (!wall) { body = null; } else {
      const a = room.vertices.find((v) => v.id === wall.startVertexId)!.position;
      const b = room.vertices.find((v) => v.id === wall.endVertexId)!.position;
      body = (
        <>
          <div className="subject">
            <div>
              <h3 className="subject-name">Wall {idx + 1}</h3>
              <p className="subject-sub">Inside length {Math.hypot(b.x - a.x, b.y - a.y).toFixed(3)} m</p>
            </div>
          </div>
          <Section title="Length">
            <Field label="Inside length" unit="m" committed={fmt(Math.hypot(b.x - a.x, b.y - a.y))} preview={(d) => previewWallLength(project, wall.id, d as FieldValue)} onCommit={commit} />
            <p className="hint">Typing a length moves this wall’s far corner along the wall. Use it to set the room’s size.</p>
          </Section>
          <Section title="Thickness">
            <Field label="Thickness" unit="m" committed={fmt(wall.thickness)} preview={(d) => previewWallThickness(project, wall.id, d as FieldValue)} onCommit={commit} />
            <p className="hint">Walls grow outward only. The room’s inside size never changes.</p>
          </Section>
        </>
      );
    }
  } else if (single?.kind === 'vertex') {
    const idx = room.vertices.findIndex((v) => v.id === single.id);
    const vertex = room.vertices[idx];
    if (!vertex) { body = null; } else {
      body = (
        <>
          <div className="subject">
            <div>
              <h3 className="subject-name">Corner {idx + 1}</h3>
              <p className="subject-sub">Room corner · {room.vertices.length} in total</p>
            </div>
          </div>
          <Section title="Position">
            <div className="two">
              <Field label="X" unit="m" committed={fmt(vertex.position.x)} preview={(d) => previewVertexPosition(project, vertex.id, 'x', d as FieldValue)} onCommit={commit} />
              <Field label="Y" unit="m" committed={fmt(vertex.position.y)} preview={(d) => previewVertexPosition(project, vertex.id, 'y', d as FieldValue)} onCommit={commit} />
            </div>
            <p className="hint">Drag the corner on the plan, or type exact values. Doors and windows are re-fitted to the new wall lengths; furniture never moves by itself.</p>
          </Section>
          <div className="actions">
            <button className="btn danger" disabled={room.vertices.length < 4} title={room.vertices.length < 4 ? 'A room needs at least three corners' : 'Remove this corner (Delete)'} onClick={() => app.interaction.keyDown({ key: 'Delete', ctrl: false, shift: false, alt: false })}>{Icons.trash}<span className="label">Delete corner</span></button>
          </div>
        </>
      );
    }
  } else if (selection.length > 1) {
    body = <p className="hint">Select furniture only to edit several things at once.</p>;
  } else {
    const area = polygonArea(room.vertices.map((v) => v.position));
    const box = aabbOf(room.vertices.map((v) => v.position));
    const size = { w: box.max.x - box.min.x, l: box.max.y - box.min.y };
    const issues = validation?.violations.length ?? 0;
    body = (
      <>
        <div className="subject"><div><h3 className="subject-name">{room.name}</h3><p className="subject-sub">Room</p></div></div>
        <RoomNameField key={room.id} id={room.id} name={room.name} />
        <Section title="Room">
          <dl className="facts">
            <dt>Size</dt><dd>{size.w.toFixed(2)} × {size.l.toFixed(2)} m</dd>
            <dt>Area</dt><dd>{area.toFixed(2)} m²</dd>
            <dt>Walls</dt><dd>{room.walls.length}</dd>
            <dt>Wall height</dt><dd>{fmt(room.wallHeight)} m</dd>
            <dt>Objects</dt><dd>{room.furniture.length} furniture · {room.fixtures.length} doors/windows</dd>
            <dt>Problems</dt><dd>{issues === 0 ? 'None' : `${issues} to look at`}</dd>
          </dl>
        </Section>
        <p className="hint">Click a wall, door, window or piece of furniture to edit it. Drag on empty floor to select several. Use the Walls tool (key 3) to move, add or remove corners.</p>
        <div className="actions">
          {confirmDelete ? (
            <span className="inline-confirm" role="group" aria-label="Delete this room?">
              Delete this room and everything in it? You can undo.
              <button className="btn danger" onClick={() => { setConfirmDelete(false); app.deleteRoom(); }}>Yes</button>
              <button className="btn" onClick={() => setConfirmDelete(false)}>No</button>
            </span>
          ) : (
            <button className="btn danger" onClick={() => setConfirmDelete(true)}>
              {Icons.trash}<span className="label">Delete room</span>
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <aside className="panel right" aria-label="Inspector">
      <div className="panel-head"><h2>Inspector</h2></div>
      <div className="panel-body" key={selection.map((s) => `${s.kind}:${s.id}`).join(',')}>{body}</div>
    </aside>
  );
}
