import { useState } from 'react';
import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import { analyseApp, fillBlankRackWithGuesses, sortIssues, type AppProject, type EstimateField } from '../app/model';
import type { AppStore } from '../app/store';
import type { HeaderComponent, WallKind, WallSide } from '../enclosure';
import { BOTTLE_PROFILES, type BottleProfileId } from '../engine';
import { fillWall } from '../placement';
import { effectiveBottlesPerRow, missingFields, type RackOrientation, type RackSpec } from '../rack';
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
      <Section title="Enclosure" testid="enclosure-panel" tour="cp-enclosure" note={<p className="note">Sizes to the outer faces of the walls. Values from the sample drawings are unverified.</p>}>
        <NumField label="Width (north / south walls)" value={e.outerWidthMm} min={500} hint="The length of the north and south walls, measured on their outer faces." onCommit={(v) => set({ outerWidthMm: v as number })} testid="outer-width" />
        <NumField label="Depth (east / west walls)" value={e.outerDepthMm} min={500} hint="The length of the east and west walls, measured on their outer faces." onCommit={(v) => set({ outerDepthMm: v as number })} testid="outer-depth" />
        <NumField label="Height" value={e.heightMm} min={1000} hint="Floor to the top of the ceiling panel. The header sits above this." onCommit={(v) => set({ heightMm: v as number })} testid="outer-height" />
        <NumField label="Ceiling build-up" value={e.ceilingBuildUpMm} hint="How much of the height the ceiling takes, so it is taken off the inside height. Unconfirmed: the sample says 'reinforced ceiling panel' with no thickness." onCommit={(v) => set({ ceilingBuildUpMm: v as number })} testid="ceiling-buildup" />
        <NumField label="Floor build-up" value={e.floorBuildUpMm} hint="How much a floor build-up takes off the inside height. Unconfirmed: no sample drawing shows one." onCommit={(v) => set({ floorBuildUpMm: v as number })} testid="floor-buildup" />
        <NumField label="Header height" value={e.headerHeightMm} hint="The box above the enclosure that carries the conditioner and vents. It does not reduce the inside height." onCommit={(v) => set({ headerHeightMm: v as number })} testid="header-height" />
      </Section>
      <Section title="Walls" testid="walls-panel">
        {WALLS.map(([side, name]) => (
          <div className="pair" key={side}>
            <SelectField label={`${name} wall`} value={e.walls[side].kind} options={KINDS} hint={`What the ${name.toLowerCase()} wall is made of. It sets how the wall is drawn and whether it counts as glass.`} onChange={(v) => setWall(side, { kind: v as WallKind })} testid={`wall-kind-${side}`} />
            <NumField label="Build-up" value={e.walls[side].buildUpMm} hint={`How thick the ${name.toLowerCase()} wall is, from its outer face inwards. It is taken off the inside size.`} onCommit={(v) => setWall(side, { buildUpMm: v as number })} testid={`wall-build-${side}`} />
          </div>
        ))}
      </Section>
      <Section title="Door" testid="door-panel" tour="cp-door">
        <SelectField label="On wall" value={e.door.wall} options={WALLS} hint="Which wall the door is in." onChange={(v) => setDoor({ wall: v as WallSide })} testid="door-wall" />
        <SelectField label="Door type" value={e.door.leaves === 2 ? 'DOUBLE' : 'SINGLE'} options={[['SINGLE', 'Single door (one leaf)'], ['DOUBLE', 'Double door (two leaves)']]} hint="A single door has one leaf. A double door has two equal leaves that meet in the middle, each hinged at an outer edge: wider to carry things through, but it needs more wall." onChange={(v) => setDoor(v === 'DOUBLE' ? { leaves: 2, widthMm: Math.max(e.door.widthMm, 1500) } : { leaves: 1, widthMm: Math.min(e.door.widthMm, 970) })} testid="door-leaves" />
        <NumField label={e.door.leaves === 2 ? 'Opening width (both leaves)' : 'Width'} value={e.door.widthMm} min={300} hint={e.door.leaves === 2 ? 'The whole opening. Each leaf is half of it, and half of it is the radius each open leaf sweeps.' : "The door's width. It is also the radius of the arc the open leaf sweeps."} onCommit={(v) => setDoor({ widthMm: v as number })} testid="door-width" />
        <NumField label="Height" value={e.door.heightMm} min={1000} hint="The door's height. It cannot be taller than the inside." onCommit={(v) => setDoor({ heightMm: v as number })} testid="door-height" />
        <SelectField label="Swings" value={e.door.swing} options={[['OUT', 'Out'], ['IN', 'In']]} hint="Out swings away from the enclosure. In takes floor inside, which racks must stay clear of." onChange={(v) => setDoor({ swing: v as 'OUT' | 'IN' })} testid="door-swing" />
        {e.door.leaves !== 2 && <SelectField label="Hinge (seen from outside)" value={e.door.hinge} options={[['LEFT', 'Left'], ['RIGHT', 'Right']]} hint="Which side the hinge is on when you stand outside facing the door." onChange={(v) => setDoor({ hinge: v as 'LEFT' | 'RIGHT' })} testid="door-hinge" />}
        <NumField label="Offset from wall start" nullable value={e.door.offsetMm ?? null} hint="Distance from the start of the wall (the west or north end) to the door's near edge. Blank centres the door." onCommit={(v) => setDoor({ offsetMm: v === null ? undefined : v })} testid="door-offset" />
        <CheckField label="Glazed" checked={e.door.glazed} hint="A glazed door counts towards the glass share of the walls (advisory only)." onChange={(v) => setDoor({ glazed: v })} testid="door-glazed" />
      </Section>
      <Section title="Header: conditioner and vents" testid="header-panel" tour="cp-header">
        {e.header.map((c) => (
          <div className="part" key={c.id} data-testid={`part-${c.id}`}>
            <strong>{c.kind === 'VENT' ? 'Vent' : 'Conditioner'} <small>{c.id}</small></strong>
            <NumField label="x" value={c.xMm} hint="Distance from the left end of the header to the left edge of this part." onCommit={(v) => setPart(c.id, { xMm: v as number })} />
            <NumField label="y" value={c.yMm} hint="Height of this part's bottom edge above the bottom of the header." onCommit={(v) => setPart(c.id, { yMm: v as number })} />
            <NumField label="w" value={c.widthMm} min={1} hint="Width of this part." onCommit={(v) => setPart(c.id, { widthMm: v as number })} />
            <NumField label="h" value={c.heightMm} min={1} hint="Height of this part." onCommit={(v) => setPart(c.id, { heightMm: v as number })} />
            <button type="button" className="btn small" title="Remove this part from the header." onClick={() => edit((q) => ({ ...q, enclosure: { ...q.enclosure, header: q.enclosure.header.filter((x) => x.id !== c.id) } }))}>Remove</button>
          </div>
        ))}
        <div className="row">
          <button type="button" className="btn small" title="Add a vent to the header, then set where it goes." onClick={() => addPart('VENT')} data-testid="add-vent">Add vent</button>
          <button type="button" className="btn small" title="Add a ceiling conditioner to the header, then set where it goes." onClick={() => addPart('CONDITIONER')} data-testid="add-conditioner">Add conditioner</button>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------- racking

const ORIENTATIONS: Array<[RackOrientation, string]> = [['NECK_OUT', 'Neck-out'], ['LABEL_FORWARD', 'Label-forward']];

const FIELD_NAMES: Record<EstimateField, string> = { unitWidthMm: 'unit width', unitDepthMm: 'unit depth', unitHeightMm: 'unit height', rowPitchMm: 'row pitch', orientation: 'bottle orientation', postsPerUnit: 'posts per unit' };

export function RackPanel() {
  const p = useProject();
  const edit = useEdit();
  const s = p.rackSpec;
  /** Change rack values. Each edited field stops being "estimated": the person has put their own number there. */
  const set = (patch: Partial<RackSpec>): void => edit((q) => ({ ...q, rackSpec: { ...q.rackSpec, ...patch }, ...(q.estimated?.length ? { estimated: q.estimated.filter((k) => !(k in patch)) } : {}) }));
  const missing = missingFields(s, p.bottle);
  const perRow = effectiveBottlesPerRow(s, p.bottle);
  const calculated = s.orientation !== 'LABEL_FORWARD' && s.bottlesPerRow === null && perRow?.source === 'calculated';
  const est = (k: EstimateField): boolean => p.estimated?.includes(k) ?? false;
  const stillEstimated = (p.estimated ?? []).map((k) => FIELD_NAMES[k]);
  return (
    <Section
      title="Rack specification" testid="rack-panel" tour="cp-rack"
      note={stillEstimated.length
        ? <p className="banner estimate" role="note" data-testid="rack-estimated"><b>Best guesses for testing, not supplier values</b> (still estimated: {stillEstimated.join(', ')}). Type your supplier's or fabricator's number over each one; its "estimated" marker goes as you do. Do not quote from these.</p>
        : missing.length
          ? (
            <div className="banner" role="note" data-testid="rack-missing">
              <p>Rack values are not set (missing: {missing.join(', ')}). Enter your supplier's or fabricator's values: until then bottles cannot be counted or quoted.</p>
              <button type="button" className="btn small" title="Fill only the blank rack fields with best-guess values so there are bottles to count. Anything you have typed is kept. Each guess is marked estimated until you type over it, and Undo takes them all back." onClick={() => edit(fillBlankRackWithGuesses)} data-testid="fill-guesses">Fill the blanks with best guesses</button>
            </div>
          )
          : <p className="note">All rack values entered. Rows = the number of rows if given, otherwise height divided by row pitch.</p>}
    >
      <SelectField label="Bottle" value={p.bottle} options={Object.values(BOTTLE_PROFILES).map((b): [BottleProfileId, string] => [b.id, b.label])} hint="The bottle the racks are for. Its length sets how deep a unit must be (typical sizes, unverified)." onChange={(v) => edit((q) => ({ ...q, bottle: v as BottleProfileId }))} testid="bottle" />
      <NumField label="Unit width" nullable value={s.unitWidthMm} min={1} estimated={est('unitWidthMm')} hint="Width of one rack unit along the wall. Blank means not set: it is never counted as zero." onCommit={(v) => set({ unitWidthMm: v })} testid="rack-width" />
      <NumField label="Unit depth" nullable value={s.unitDepthMm} min={1} estimated={est('unitDepthMm')} hint="How far one rack unit stands out from the wall." onCommit={(v) => set({ unitDepthMm: v })} testid="rack-depth" />
      <NumField label="Unit height" nullable value={s.unitHeightMm} min={1} estimated={est('unitHeightMm')} hint="Height of one rack unit. It cannot be taller than the inside." onCommit={(v) => set({ unitHeightMm: v })} testid="rack-height" />
      <NumField label="Row pitch" nullable value={s.rowPitchMm} min={1} estimated={est('rowPitchMm')} hint="The vertical distance from one row of bottles to the next." onCommit={(v) => set({ rowPitchMm: v })} testid="rack-pitch" />
      <NumField label="Rows per unit (optional)" nullable unit="" value={s.rowsPerUnit ?? null} min={1} hint="If your fabricator states the number of rows, enter it. Then unit height and row pitch are not needed." onCommit={(v) => set({ rowsPerUnit: v })} testid="rack-rows" />
      {s.orientation === 'LABEL_FORWARD'
        ? <NumField label="Bottles per row (label-forward)" nullable unit="" value={s.bottlesPerRowLabelForward ?? null} min={1} hint="How many label-forward bottles one row holds. On a metal rack this may mean the bottle lies side-on and takes about its own length of width, so the neck-out figure does not carry over: it is never calculated. Ask your fabricator." onCommit={(v) => set({ bottlesPerRowLabelForward: v })} testid="rack-per-row-lf" />
        : <NumField label="Bottles per row" nullable unit="" value={s.bottlesPerRow} min={1} calculated={calculated} placeholder={calculated && perRow ? `calculated: ${perRow.value}` : undefined} hint={`How many bottles side by side in one row. Left blank, it is calculated: the unit width divided by the bottle's pitch (${calculated && perRow && s.unitWidthMm ? `${s.unitWidthMm} \u00f7 ${Math.round(s.unitWidthMm / perRow.value)}, rounded down` : 'needs the unit width and a bottle'}), an estimate until your fabricator gives the real pin spacing. Type a number to override it.`} onCommit={(v) => set({ bottlesPerRow: v })} testid="rack-per-row" />}
      <SelectField label="Bottle orientation" value={s.orientation} blank="not set" options={ORIENTATIONS} estimated={est('orientation')} hint="Neck-out needs the bottle's length plus 15 mm of depth. Label-forward needs the inclined footprint (a joinery assumption until your fabricator confirms how their rods hold the bottle) and has its own bottles-per-row, never calculated." onChange={(v) => set({ orientation: v })} testid="rack-orientation" />
      <NumField label="Posts per unit" nullable unit="" value={s.postsPerUnit} min={1} estimated={est('postsPerUnit')} hint="Posts in one unit, for the parts list. It does not change the bottle count." onCommit={(v) => set({ postsPerUnit: v })} testid="rack-posts" />
      <NumField label="Minimum walkway" nullable value={p.walkwayMm} min={1} hint="The least clear width you design to between racks. Blank: it is not checked. A step-in cabinet and a walk-in room need different minimums, so there is no default. It is only ever a warning." onCommit={(v) => edit((q) => ({ ...q, walkwayMm: v }))} testid="walkway" />
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
    <Section title="Rack runs" testid="runs-panel" tour="cp-runs">
      {p.runs.length === 0 && <p className="note">No racks placed yet.</p>}
      {p.runs.map((r) => (
        <div className="run" key={r.id} data-testid={`run-${r.id}`}>
          <strong>{r.id}</strong>
          <SelectField label="Wall" value={r.wall} options={WALLS} hint="Which wall this run of racks stands against." onChange={(v) => patch(r.id, { wall: v as WallSide })} />
          <NumField label="Start along wall" value={r.startMm} hint="Where the first unit starts, measured along the inside of the wall from its start (the west or north end)." onCommit={(v) => patch(r.id, { startMm: v as number })} testid={`run-start-${r.id}`} />
          <NumField label="Units" unit="" value={r.units} hint="How many rack units are in this run." onCommit={(v) => patch(r.id, { units: v as number })} testid={`run-units-${r.id}`} />
          <button type="button" className="btn small" title="Remove this run." onClick={() => edit((q) => ({ ...q, runs: q.runs.filter((x) => x.id !== r.id) }))}>Remove</button>
        </div>
      ))}
      <div className="row">
        <SelectField label="New run on" value={wall} options={WALLS} hint="The wall the next run will be added to." onChange={(v) => setWall(v as WallSide)} testid="new-run-wall" />
        <button type="button" className="btn small" title="Add one rack unit on the chosen wall, then set where it starts and how many." onClick={add} data-testid="add-run">Add run</button>
      </div>
      <div className="row">
        {WALLS.map(([side, name]) => <button type="button" key={side} className="btn small" title={`Fill the ${name.toLowerCase()} wall with as many whole units as fit, leaving the door opening free. It replaces any runs already on that wall and needs the unit width first.`} onClick={() => fill(side)} data-testid={`fill-${side}`}>Fill {name.toLowerCase()}</button>)}
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
      <section className="section" data-tour="cp-total" title="The bottles all the runs hold. It says 'not set' until every run has its rack values.">
        <h2>Bottles</h2>
        <p className={`total${total.status === 'NOT_SET' ? ' notset-total' : ''}`} data-testid="total">
          {total.status === 'OK' ? `${total.capacity} bottles` : `not set (${total.unsetRuns} run${total.unsetRuns === 1 ? '' : 's'} without rack values)`}
        </p>
        {total.status === 'OK' && total.uncounted && <p className="note uncounted" data-testid="uncounted"><b>Not counted:</b> {total.uncounted.bottles} bottles in {total.uncounted.runs} run{total.uncounted.runs === 1 ? '' : 's'} with errors (see Checks). Only runs that can be built are in the total.</p>}
        {a.racks.runs.some((r) => r.capacity.status === 'OK' && r.capacity.bottlesPerRowSource === 'calculated') && <p className="note" data-testid="calculated-note">Bottles per row is calculated (unit width ÷ the bottle's pitch): an estimate until your fabricator gives the real figure.</p>}
        <p className="note">Inside {a.enclosure.internal.widthMm} x {a.enclosure.internal.depthMm} x {a.enclosure.internal.heightMm} mm. Glass {(a.enclosure.glassFraction * 100).toFixed(1)}% of the outer wall area.</p>
      </section>
      <section className="section" data-tour="cp-checks">
        <h2 title="Problems with the design. Errors mean something does not fit; warnings and information are for you to judge.">Checks <span className="count" data-testid="issue-count">{issues.filter((i) => i.severity === 'error').length} errors, {issues.filter((i) => i.severity === 'warning').length} warnings</span></h2>
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
      <section className="section advisory" data-testid="advisories" data-tour="cp-advisory">
        <h2 title="Guidance from a cellar-building guide. Information only: it never blocks a design and always needs engineer or HVAC sign-off.">Advisory guidance <small>information only</small></h2>
        <ul className="issues">
          {a.advisories.map((x) => <li key={x.code} className="issue info" data-testid={`advisory-${x.code}`}>{x.text}</li>)}
        </ul>
      </section>
    </div>
  );
}
