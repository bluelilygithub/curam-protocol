import { useState } from 'react';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { analyseApp, sortIssues, type AppProject } from '../app/model';
import type { AppStore } from '../app/store';
import type { HeaderComponent, WallKind, WallSide } from '../enclosure';
import { BOTTLE_PROFILES, type BottleProfileId } from '../engine';
import { fillWall } from '../placement';
import { missingFields, type RackOrientation, type RackSpec } from '../rack';
import { CheckField, NumField, Section, SelectField } from './fields';

export const StoreContext = createContext<AppStore | null>(null);
const useAppStore = (): AppStore => { const s = useContext(StoreContext); if (!s) throw new Error('no store'); return s; };
export const useProject = (): AppProject => useStore(useAppStore(), (s) => s.project);
export const useEdit = (): AppStore['getState'] extends () => infer S ? (S extends { edit: infer E } ? E : never) : never => useAppStore().getState().edit;

const WALLS: Array<[WallSide, string]> = [['NORTH', 'North'], ['EAST', 'East'], ['SOUTH', 'South'], ['WEST', 'West']];
const KINDS: Array<[WallKind, string]> = [['PANEL', 'Insulated panel'], ['GLASS', 'Framed glass'], ['STUD', 'Stud wall']];

// ---------------------------------------------------------------- enclosure

export function EnclosurePanel() {
  const p = useProject();
  const edit = useEdit();
  const e = p.enclosure;
  const set = (patch: Partial<typeof e>): void => edit((q) => ({ ...q, enclosure: { ...q.enclosure, ...patch } }));
  const setWall = (side: WallSide, patch: Partial<typeof e.walls.NORTH>): void => edit((q) => ({ ...q, enclosure: { ...q.enclosure, walls: { ...q.enclosure.walls, [side]: { ...q.enclosure.walls[side], ...patch } } } }));
  const setDoor = (patch: Partial<typeof e.door>): void => edit((q) => ({ ...q, enclosure: { ...q.enclosure, door: { ...q.enclosure.door, ...patch } } }));
  const setPart = (id: string, patch: Partial<HeaderComponent>): void => edit((q) => ({ ...q, enclosure: { ...q.enclosure, header: q.enclosure.header.map((c) => (c.id === id ? { ...c, ...patch } : c)) } }));
  const addPart = (kind: 'VENT' | 'CONDITIONER'): void => edit((q) => {
    const n = q.enclosure.header.filter((c) => c.kind === kind).length + 1;
    const part: HeaderComponent = kind === 'VENT'
      ? { id: `vent-${n}-${q.enclosure.header.length + 1}`, kind, xMm: 200, yMm: 100, widthMm: 400, heightMm: 100 }
      : { id: `conditioner-${q.enclosure.header.length + 1}`, kind, xMm: Math.max(0, Math.round((q.enclosure.outerWidthMm - 900) / 2)), yMm: 0, widthMm: 900, heightMm: 300 };
    return { ...q, enclosure: { ...q.enclosure, header: [...q.enclosure.header, part] } };
  });
  return (
    <>
      <Section title="Enclosure" testid="enclosure-panel" note={<p className="note">Sizes to the outer faces of the walls. Values from the sample drawings are unverified.</p>}>
        <NumField label="Width (north / south walls)" value={e.outerWidthMm} min={500} onCommit={(v) => set({ outerWidthMm: v as number })} testid="outer-width" />
        <NumField label="Depth (east / west walls)" value={e.outerDepthMm} min={500} onCommit={(v) => set({ outerDepthMm: v as number })} testid="outer-depth" />
        <NumField label="Height" value={e.heightMm} min={1000} onCommit={(v) => set({ heightMm: v as number })} testid="outer-height" />
        <NumField label="Ceiling build-up" value={e.ceilingBuildUpMm} hint="Unconfirmed: the sample says 'reinforced ceiling panel' with no thickness." onCommit={(v) => set({ ceilingBuildUpMm: v as number })} testid="ceiling-buildup" />
        <NumField label="Floor build-up" value={e.floorBuildUpMm} hint="Unconfirmed: no drawing shows a floor build-up." onCommit={(v) => set({ floorBuildUpMm: v as number })} testid="floor-buildup" />
        <NumField label="Header height" value={e.headerHeightMm} onCommit={(v) => set({ headerHeightMm: v as number })} testid="header-height" />
      </Section>
      <Section title="Walls" testid="walls-panel">
        {WALLS.map(([side, name]) => (
          <div className="pair" key={side}>
            <SelectField label={`${name} wall`} value={e.walls[side].kind} options={KINDS} onChange={(v) => setWall(side, { kind: v as WallKind })} testid={`wall-kind-${side}`} />
            <NumField label="Build-up" value={e.walls[side].buildUpMm} onCommit={(v) => setWall(side, { buildUpMm: v as number })} testid={`wall-build-${side}`} />
          </div>
        ))}
      </Section>
      <Section title="Door" testid="door-panel">
        <SelectField label="On wall" value={e.door.wall} options={WALLS} onChange={(v) => setDoor({ wall: v as WallSide })} testid="door-wall" />
        <NumField label="Width" value={e.door.widthMm} min={300} onCommit={(v) => setDoor({ widthMm: v as number })} testid="door-width" />
        <NumField label="Height" value={e.door.heightMm} min={1000} onCommit={(v) => setDoor({ heightMm: v as number })} testid="door-height" />
        <SelectField label="Swings" value={e.door.swing} options={[['OUT', 'Out'], ['IN', 'In']]} onChange={(v) => setDoor({ swing: v as 'OUT' | 'IN' })} testid="door-swing" />
        <SelectField label="Hinge (seen from outside)" value={e.door.hinge} options={[['LEFT', 'Left'], ['RIGHT', 'Right']]} onChange={(v) => setDoor({ hinge: v as 'LEFT' | 'RIGHT' })} testid="door-hinge" />
        <NumField label="Offset from wall start" nullable value={e.door.offsetMm ?? null} hint="Blank = centred" onCommit={(v) => setDoor({ offsetMm: v === null ? undefined : v })} testid="door-offset" />
        <CheckField label="Glazed" checked={e.door.glazed} onChange={(v) => setDoor({ glazed: v })} testid="door-glazed" />
      </Section>
      <Section title="Header: conditioner and vents" testid="header-panel">
        {e.header.map((c) => (
          <div className="part" key={c.id} data-testid={`part-${c.id}`}>
            <strong>{c.kind === 'VENT' ? 'Vent' : 'Conditioner'} <small>{c.id}</small></strong>
            <NumField label="x" value={c.xMm} onCommit={(v) => setPart(c.id, { xMm: v as number })} />
            <NumField label="y" value={c.yMm} onCommit={(v) => setPart(c.id, { yMm: v as number })} />
            <NumField label="w" value={c.widthMm} min={1} onCommit={(v) => setPart(c.id, { widthMm: v as number })} />
            <NumField label="h" value={c.heightMm} min={1} onCommit={(v) => setPart(c.id, { heightMm: v as number })} />
            <button type="button" className="btn small" onClick={() => edit((q) => ({ ...q, enclosure: { ...q.enclosure, header: q.enclosure.header.filter((x) => x.id !== c.id) } }))}>Remove</button>
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn small" onClick={() => addPart('VENT')} data-testid="add-vent">Add vent</button>
          <button type="button" className="btn small" onClick={() => addPart('CONDITIONER')} data-testid="add-conditioner">Add conditioner</button>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- racking

const ORIENTATIONS: Array<[RackOrientation, string]> = [['NECK_OUT', 'Neck-out'], ['LABEL_FORWARD', 'Label-forward']];

export function RackPanel() {
  const p = useProject();
  const edit = useEdit();
  const s = p.rackSpec;
  const set = (patch: Partial<RackSpec>): void => edit((q) => ({ ...q, rackSpec: { ...q.rackSpec, ...patch } }));
  const missing = missingFields(s);
  return (
    <Section
      title="Rack specification" testid="rack-panel"
      note={missing.length
        ? <p className="banner" data-testid="rack-missing">Rack values are not set (missing: {missing.join(', ')}). Enter your supplier's or fabricator's values: until then bottles cannot be counted or quoted.</p>
        : <p className="note">All rack values entered. Rows = the number of rows if given, otherwise height divided by row pitch.</p>}
    >
      <SelectField label="Bottle" value={p.bottle} options={Object.values(BOTTLE_PROFILES).map((b): [BottleProfileId, string] => [b.id, b.label])} onChange={(v) => edit((q) => ({ ...q, bottle: v as BottleProfileId }))} testid="bottle" />
      <NumField label="Unit width" nullable value={s.unitWidthMm} min={1} onCommit={(v) => set({ unitWidthMm: v })} testid="rack-width" />
      <NumField label="Unit depth" nullable value={s.unitDepthMm} min={1} onCommit={(v) => set({ unitDepthMm: v })} testid="rack-depth" />
      <NumField label="Unit height" nullable value={s.unitHeightMm} min={1} onCommit={(v) => set({ unitHeightMm: v })} testid="rack-height" />
      <NumField label="Row pitch" nullable value={s.rowPitchMm} min={1} onCommit={(v) => set({ rowPitchMm: v })} testid="rack-pitch" />
      <NumField label="Rows per unit (optional)" nullable unit="" value={s.rowsPerUnit ?? null} min={1} hint="If the fabricator states the rows, enter them; then height and pitch are not needed." onCommit={(v) => set({ rowsPerUnit: v })} testid="rack-rows" />
      <NumField label="Bottles per row" nullable unit="" value={s.bottlesPerRow} min={1} onCommit={(v) => set({ bottlesPerRow: v })} testid="rack-per-row" />
      <SelectField label="Bottle orientation" value={s.orientation} blank="not set" options={ORIENTATIONS} onChange={(v) => set({ orientation: v })} testid="rack-orientation" />
      <NumField label="Posts per unit" nullable unit="" value={s.postsPerUnit} min={1} onCommit={(v) => set({ postsPerUnit: v })} testid="rack-posts" />
      <NumField label="Minimum walkway" nullable value={p.walkwayMm} min={1} hint="Blank: the walkway check does not run. A step-in cabinet and a walk-in room are designed to different minimums." onCommit={(v) => edit((q) => ({ ...q, walkwayMm: v }))} testid="walkway" />
    </Section>
  );
}

// ---------------------------------------------------------------- runs

export function RunsPanel() {
  const p = useProject();
  const edit = useEdit();
  const [wall, setWall] = useState<WallSide>('NORTH');
  const [msg, setMsg] = useState('');
  const patch = (id: string, change: Partial<AppProject['runs'][number]>): void => edit((q) => ({ ...q, runs: q.runs.map((r) => (r.id === id ? { ...r, ...change } : r)) }));
  const add = (): void => edit((q) => {
    let n = q.runs.length + 1;
    while (q.runs.some((r) => r.id === `run-${n}`)) n++;
    return { ...q, runs: [...q.runs, { id: `run-${n}`, wall, startMm: 0, units: 1 }] };
  });
  const fill = (side: WallSide): void => {
    const r = fillWall(p.enclosure, side, p.rackSpec, p.bottle, `${side.toLowerCase()}-fill`);
    if (r.status === 'NOT_SET') { setMsg(`Enter the ${r.missing.join(' and ')} first: a wall cannot be filled with units of unknown size.`); return; }
    setMsg(r.runs.length ? `Filled the ${side.toLowerCase()} wall with ${r.runs.reduce((n, x) => n + x.units, 0)} units.` : `No whole unit fits the ${side.toLowerCase()} wall.`);
    edit((q) => ({ ...q, runs: [...q.runs.filter((x) => x.wall !== side), ...r.runs.map(({ id, wall: w, startMm, units }) => ({ id, wall: w, startMm, units }))] }));
  };
  return (
    <Section title="Rack runs" testid="runs-panel">
      {p.runs.length === 0 && <p className="note">No racks placed yet.</p>}
      {p.runs.map((r) => (
        <div className="run" key={r.id} data-testid={`run-${r.id}`}>
          <strong>{r.id}</strong>
          <SelectField label="Wall" value={r.wall} options={WALLS} onChange={(v) => patch(r.id, { wall: v as WallSide })} />
          <NumField label="Start along wall" value={r.startMm} onCommit={(v) => patch(r.id, { startMm: v as number })} testid={`run-start-${r.id}`} />
          <NumField label="Units" unit="" value={r.units} onCommit={(v) => patch(r.id, { units: v as number })} testid={`run-units-${r.id}`} />
          <button type="button" className="btn small" onClick={() => edit((q) => ({ ...q, runs: q.runs.filter((x) => x.id !== r.id) }))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <SelectField label="New run on" value={wall} options={WALLS} onChange={(v) => setWall(v as WallSide)} testid="new-run-wall" />
        <button type="button" className="btn small" onClick={add} data-testid="add-run">Add run</button>
      </div>
      <div className="row">
        {WALLS.map(([side, name]) => <button type="button" key={side} className="btn small" onClick={() => fill(side)} data-testid={`fill-${side}`}>Fill {name.toLowerCase()}</button>)}
      </div>
      {msg && <p className="note" role="status" data-testid="fill-msg">{msg}</p>}
    </Section>
  );
}

// ---------------------------------------------------------------- checks

export function ChecksPanel() {
  const p = useProject();
  const a = analyseApp(p);
  const issues = sortIssues(a.issues);
  const total = a.racks.total;
  return (
    <div className="checks" data-testid="checks-panel">
      <section className="section">
        <h2>Bottles</h2>
        <p className={`total${total.status === 'NOT_SET' ? ' notset-total' : ''}`} data-testid="total">
          {total.status === 'OK' ? `${total.capacity} bottles` : `not set (${total.unsetRuns} run${total.unsetRuns === 1 ? '' : 's'} without rack values)`}
        </p>
        <p className="note">Inside {a.enclosure.internal.widthMm} x {a.enclosure.internal.depthMm} x {a.enclosure.internal.heightMm} mm. Glass {(a.enclosure.glassFraction * 100).toFixed(1)}% of the outer wall area.</p>
      </section>
      <section className="section">
        <h2>Checks <span className="count" data-testid="issue-count">{issues.filter((i) => i.severity === 'error').length} errors, {issues.filter((i) => i.severity === 'warning').length} warnings</span></h2>
        {issues.length === 0 && <p className="note">Nothing to report.</p>}
        <ul className="issues">
          {issues.map((i, n) => (
            <li key={`${i.code}-${i.where ?? ''}-${n}`} className={`issue ${i.severity}`} data-testid={`issue-${i.code}`}>
              <span className="sev">{i.severity}</span>
              <span>{i.message}{i.fix && <small> {i.fix}</small>}{i.where && <small> ({i.where})</small>}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="section advisory" data-testid="advisories">
        <h2>Advisory guidance <small>information only</small></h2>
        <ul className="issues">
          {a.advisories.map((x) => <li key={x.code} className="issue info" data-testid={`advisory-${x.code}`}>{x.text}</li>)}
        </ul>
      </section>
    </div>
  );
}
