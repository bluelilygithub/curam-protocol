import { useMemo, useState } from 'react';
import { setFence, findItem, STRUCTURE_LABEL, recommendedSpacing } from '../domain/edit';
import { CLIMATE_LABEL, FROST_LABEL } from '../domain/climate';
import { shapeArea, polylineLength } from '../domain/shapes';
import {
  AU_STATES, CLIMATE_ZONES, FENCE_HEIGHT, FENCE_TYPES, FROST_LEVELS,
  type Bed, type Boundary, type EdgingType, type FenceType, type GardenProject, type GrassType, type House, type Lawn, type MulchType, type PathItem,
  type PathMaterial, type PlantInstance, type ServiceKind, type ServiceLine, SERVICE_KINDS, type Soil, type Structure, type Zone, type ZoneKind,
} from '../domain/types';
import { MONTH_NAMES, mid, plantSizeAt } from '../plants/growth';
import { averageHoursIn, computeSunHours } from '../sun/sunHours';
import { sampleShape } from '../domain/shapes';
import { sunLevelForHours } from '../plants/suitability';
import { filterPlants, NO_FILTERS } from '../plants/filters';
import { PLANTS, botanicalLabel, plantById, plantLabel } from '../plants/plants';
import { unsuitableReasons, UNSUITABLE_TEXT } from '../plants/suitability';
import type { Selection } from '../state/uiStore';
import { useApp, useProject, useUi } from './AppContext';
import { Accordion, CheckField, NumField, SelectField, Section, TextField, labelOf, optionsOf } from './fields';
import { Icon } from './icons';
import { MapSection } from './MapSection';
import { AddressLookup } from './AddressLookup';
import { PRECISION_TEXT } from '../state/geocode';
import { ChecksPanel } from './ChecksPanel';
import { useStore } from 'zustand';
import { countBySeverity } from '../state/checksStore';

export function Inspector() {
  const app = useApp();
  const open = useUi((s) => s.inspectorOpen);
  const sel = useUi((s) => s.selection);
  const project = useProject((s) => s.project);
  const tab = useUi((s) => s.rightTab);
  const issues = useStore(app.checks, (s) => s.issues);
  if (!open || !project) return null;
  const item = sel ? findItem(project, sel) : null;
  const c = countBySeverity(issues);
  const worst = c.error ? 'error' : c.warning ? 'warning' : 'ok';
  return (
    <aside className="panel panel-right" aria-label="Details" data-tour="gp-inspector">
      <div className="panel-head">
        <div className="tabs" role="tablist" aria-label="Panel">
          <button type="button" role="tab" aria-selected={tab === 'details'} className="tab" onClick={() => app.ui.getState().set({ rightTab: 'details' })}>{sel && item ? titleOf(sel) : 'Garden'}</button>
          <button type="button" role="tab" aria-selected={tab === 'checks'} className="tab" data-testid="checks-tab" title="Problems found in the plan, with the reason for each" onClick={() => app.ui.getState().set({ rightTab: 'checks' })}>Checks <span className={`badge-count sev-${worst}`} data-testid="checks-count">{c.error + c.warning}</span></button>
        </div>
        <button type="button" className="icon-btn" title="Hide this panel" onClick={() => app.ui.getState().set({ inspectorOpen: false })}><Icon name="close" size={16} /></button>
      </div>
      <div className="panel-body">
        {tab === 'checks' ? <ChecksPanel /> : sel && item ? <ItemPanel key={`${sel.kind}:${sel.id}`} sel={sel} item={item} project={project} /> : <ProjectPanel project={project} />}
      </div>
    </aside>
  );
}

const titleOf = (s: Selection): string => ({ boundary: 'Plot boundary', house: 'House', zone: 'Zone', bed: 'Bed', path: 'Path', service: 'Service line', lawn: 'Lawn', structure: 'Structure', plant: 'Plant' } as const)[s.kind];

// ------------------------------------------------------------------ whole-garden settings
/** The garden's address: what it is, how exactly the point is known, and a way to change it (which moves the map too). */
function AddressSection({ project }: { project: GardenProject }) {
  const app = useApp();
  const [changing, setChanging] = useState(false);
  const l = project.location;
  return (
    <div className="addr-section" data-testid="address-section">
      <p className="addr-now"><span className="field-label">Address</span><strong data-testid="address-now">{l.address ?? 'Not set: only the suburb is known'}</strong></p>
      <p className="note addr-precision" data-testid="address-precision">{PRECISION_TEXT[l.precision ?? 'place']}. {l.lat.toFixed(5)}, {l.lng.toFixed(5)}</p>
      {changing
        ? <AddressLookup initial={l.address ?? ''} label="Find address" onPick={(h) => { app.setLocation({ label: h.label, lat: h.lat, lng: h.lng, state: h.state ?? l.state, ...(h.postcode ? { postcode: h.postcode } : {}), ...(h.address ? { address: h.address } : {}), precision: h.precision }); setChanging(false); }} />
        : <button type="button" className="btn" data-testid="address-change" onClick={() => setChanging(true)}><Icon name="search" size={15} /> {l.address ? 'Change address' : 'Enter an address'}</button>}
      {changing && <button type="button" className="btn" onClick={() => setChanging(false)}>Cancel</button>}
    </div>
  );
}

function ProjectPanel({ project }: { project: GardenProject }) {
  const app = useApp();
  const m = (patch: Parameters<typeof app.updateMeta>[0]): void => app.updateMeta(patch);
  const plotArea = useMemo(() => (project.boundary ? shapeArea({ points: project.boundary.vertices.map((v) => v.position), smooth: false }) : 0), [project.boundary]);
  const bedArea = useMemo(() => project.beds.reduce((s, b) => s + shapeArea(b.shape), 0), [project.beds]);
  const lawnArea = useMemo(() => project.lawns.reduce((s, b) => s + shapeArea(b.shape), 0), [project.lawns]);
  return (
    <Accordion initial="where">
      <TextField label="Garden name" value={project.name} onCommit={(v) => app.renameProject(v)} />
      <p className="summary">
        {plotArea > 0 && <span>Plot {plotArea.toFixed(0)} m²</span>}
        {bedArea > 0 && <span>Beds {bedArea.toFixed(0)} m²</span>}
        {lawnArea > 0 && <span>Lawn {lawnArea.toFixed(0)} m²</span>}
        <span>{project.plants.length} plant{project.plants.length === 1 ? '' : 's'}</span>
      </p>
      <Section id="where" title="Where and what the weather is like">
      <AddressSection project={project} />
      <TextField label="Place name" value={project.location.label} onCommit={(v) => m({ location: { ...project.location, label: v } })} hint="The short name used on plans and file names, such as the suburb." />
      <SelectField label="State" value={project.location.state} options={AU_STATES.map((s) => [s, s] as const)} onChange={(v) => m({ location: { ...project.location, state: v } })} hint="Used for the weed check." />
      <SelectField label="Climate zone" value={project.climateZone} options={CLIMATE_ZONES.map((z) => [z, CLIMATE_LABEL[z]] as const)} onChange={(v) => m({ climateZone: v })} />
      <SelectField label="Frost" value={project.frost} options={FROST_LEVELS.map((f) => [f, FROST_LABEL[f]] as const)} onChange={(v) => m({ frost: v })} />
      <SelectField label="Soil" value={project.soil ?? ('' as Soil)} options={[['' as Soil, 'Not set'], ...optionsOf<Soil>(['sandy', 'loam', 'clay'])]} onChange={(v) => m({ soil: v || undefined })} />
      <SelectField label="Drainage" value={project.drainage ?? 'good'} options={[['good', 'Good'], ['poor', 'Poor']]} onChange={(v) => m({ drainage: v })} />
      <CheckField label="We have pets" checked={project.pets} onChange={(v) => m({ pets: v })} hint="Warns about plants that are toxic to pets." />
      <NumField label="North points" unit="degrees" value={project.northDeg} min={0} max={359} step={1} decimals={0} onCommit={(v) => m({ northDeg: v })} hint="0 = the top of the plan is north. You can also drag the north arrow on the plan." />
      <MapSection project={project} />
      </Section>
      {project.underlay && (
        <>
          <Section id="tracing" title="Tracing picture">
          <NumField label="Opacity" unit="%" value={Math.round(project.underlay.opacity * 100)} min={10} max={100} step={5} decimals={0} onCommit={(v) => app.setUnderlay({ ...project.underlay!, opacity: v / 100 })} />
          <button type="button" className="btn" onClick={() => app.setUnderlay(null)}><Icon name="trash" size={15} /> Remove picture</button>
          </Section>
        </>
      )}
      <p className="note">Click anything on the plan to edit it. Click empty space to come back here.</p>
    </Accordion>
  );
}

// ------------------------------------------------------------------ one selected item
function ItemPanel({ sel, item, project }: { sel: Selection; item: unknown; project: GardenProject }) {
  const app = useApp();
  const upd = (next: unknown, label: string): void => app.updateSelected(sel, next, label);
  const actions = (
    <div className="row">
      {sel.kind !== 'boundary' && sel.kind !== 'house' && <button type="button" className="btn" title="Duplicate (Ctrl+D)" onClick={() => app.duplicateSelected()}><Icon name="copy" size={15} /> Duplicate</button>}
      <button type="button" className="btn danger" title="Delete (Del)" onClick={() => app.deleteSelected()}><Icon name="trash" size={15} /> Delete</button>
    </div>
  );
  switch (sel.kind) {
    case 'boundary': return <><BoundaryPanel b={item as Boundary} project={project} upd={upd} />{actions}</>;
    case 'house': return <><HousePanel h={item as House} upd={upd} />{actions}</>;
    case 'zone': { const z = item as Zone; return <><TextField label="Name" value={z.name} onCommit={(v) => upd({ ...z, name: v || z.name }, 'Rename zone')} /><SelectField label="Kind" value={z.kind} options={optionsOf<ZoneKind>(['front', 'back', 'side', 'courtyard', 'other'])} onChange={(v) => upd({ ...z, kind: v }, 'Change zone')} /><Area shape={z.shape} />{actions}</>; }
    case 'bed': return <><BedPanel b={item as Bed} project={project} upd={upd} />{actions}</>;
    case 'lawn': { const l = item as Lawn; return <><TextField label="Name" value={l.name} onCommit={(v) => upd({ ...l, name: v || l.name }, 'Rename lawn')} /><SelectField label="Grass" value={l.grass} options={optionsOf<GrassType>(['buffalo', 'kikuyu', 'couch', 'zoysia', 'fescue', 'synthetic'])} onChange={(v) => upd({ ...l, grass: v }, 'Change grass')} /><CheckField label="Curved edges" checked={l.shape.smooth} onChange={(v) => upd({ ...l, shape: { ...l.shape, smooth: v } }, 'Change edges')} /><Area shape={l.shape} />{actions}</>; }
    case 'path': { const pa = item as PathItem; return <><TextField label="Name" value={pa.name} onCommit={(v) => upd({ ...pa, name: v || pa.name }, 'Rename path')} /><SelectField label="Material" value={pa.material} options={optionsOf<PathMaterial>(['gravel', 'pavers', 'concrete', 'timber', 'stepping_stones', 'brick'])} onChange={(v) => upd({ ...pa, material: v }, 'Change path material')} /><NumField label="Width" unit="m" value={pa.width} min={0.3} max={5} step={0.1} onCommit={(v) => upd({ ...pa, width: v }, 'Change path width')} hint="Paths need at least 0.9 m to walk comfortably, 1.2 m for a mower or wheelbarrow." /><p className="summary"><span>{polylineLength(pa.points).toFixed(1)} m long</span></p>{actions}</>; }
    case 'service': return <><ServicePanel s={item as ServiceLine} upd={upd} />{actions}</>;
    case 'structure': return <><StructurePanel s={item as Structure} upd={upd} />{actions}</>;
    case 'plant': return <><PlantPanel inst={item as PlantInstance} project={project} upd={upd} />{actions}</>;
  }
}

function Area({ shape }: { shape: Bed['shape'] }) {
  return <p className="summary"><span>{shapeArea(shape).toFixed(1)} m²</span><span>{shape.points.length} corners</span></p>;
}

function BoundaryPanel({ b, project, upd }: { b: Boundary; project: GardenProject; upd(n: unknown, l: string): void }) {
  const edge = useUi((s) => s.boundaryEdge);
  const n = b.vertices.length;
  const seg = edge !== null ? b.segments[edge] : undefined;
  const area = shapeArea({ points: b.vertices.map((v) => v.position), smooth: false });
  void project;
  return (
    <Accordion key={seg ? 'edge' : 'all'} initial={seg ? 'edge' : 'all'}>
      <p className="summary"><span>{n} corners</span><span>{area.toFixed(0)} m²</span></p>
      {seg && edge !== null ? (
        <>
          <Section id="edge" title={`Edge ${edge + 1}`}>
          <SelectField label="Fence" value={seg.fence} options={optionsOf<FenceType>(FENCE_TYPES)} onChange={(v) => upd(setFence(b, edge, v), 'Change fence')} />
          <NumField label="Height" unit="m" value={seg.height} min={0} max={4} step={0.1} onCommit={(v) => upd({ ...b, segments: b.segments.map((s, i) => (i === edge ? { ...s, height: v } : s)) }, 'Change fence height')} />
        </Section>
        </>
      ) : <p className="note">Click one edge of the boundary to set its fence.</p>}
      <Section id="all" title="All edges">
      <SelectField label="Fence" value={(seg?.fence ?? b.segments[0]?.fence ?? 'timber_paling') as FenceType} options={optionsOf<FenceType>(FENCE_TYPES)} onChange={(v) => upd(setFence(b, 'all', v), 'Change all fences')} hint={`Standard heights: ${FENCE_TYPES.filter((f) => f !== 'open').map((f) => `${labelOf(f)} ${FENCE_HEIGHT[f]} m`).join(', ')}.`} />
      </Section>
    </Accordion>
  );
}

function HousePanel({ h, upd }: { h: House; upd(n: unknown, l: string): void }) {
  const [edge, setEdge] = useState(1);
  const n = h.vertices.length;
  const addFixture = (type: 'door' | 'window'): void => {
    const e = Math.min(Math.max(1, edge), n) - 1;
    const a = h.vertices[e].position, b = h.vertices[(e + 1) % n].position;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const width = type === 'door' ? 0.9 : 1.5;
    upd({ ...h, fixtures: [...h.fixtures, { id: `${type}-${h.fixtures.length + 1}-${Date.now().toString(36)}`, type, edge: e, offset: len / 2, width: Math.min(width, len * 0.8) }] }, `Add ${type}`);
  };
  return (
    <Accordion initial="doors">
      <NumField label="Height" unit="m" value={h.height} min={2} max={15} step={0.1} onCommit={(v) => upd({ ...h, height: v }, 'Change house height')} hint="Trees and shade checks use this." />
      <p className="summary"><span>{shapeArea({ points: h.vertices.map((v) => v.position), smooth: false }).toFixed(0)} m² footprint</span></p>
      <Section id="doors" title="Doors and windows">
      <p className="note">These give you viewpoints, like “from the back door”.</p>
      <NumField label="On wall number" value={edge} min={1} max={n} step={1} decimals={0} onCommit={setEdge} hint={`1 to ${n}. Wall 1 runs from the first corner you drew to the second.`} />
      <div className="row"><button type="button" className="btn" onClick={() => addFixture('door')}><Icon name="plus" size={14} /> Door</button><button type="button" className="btn" onClick={() => addFixture('window')}><Icon name="plus" size={14} /> Window</button></div>
      <ul className="fixtures">
        {h.fixtures.map((f) => (
          <li key={f.id}>
            <span>{labelOf(f.type)} on wall {f.edge + 1}</span>
            <button type="button" className="icon-btn" title={`Remove this ${f.type}`} onClick={() => upd({ ...h, fixtures: h.fixtures.filter((x) => x.id !== f.id) }, `Remove ${f.type}`)}><Icon name="close" size={14} /></button>
          </li>
        ))}
      </ul>
      </Section>
    </Accordion>
  );
}

function BedPanel({ b, project, upd }: { b: Bed; project: GardenProject; upd(n: unknown, l: string): void }) {
  const app = useApp();
  const placing = useUi((s) => s.placingPlantId);
  const site = { zone: project.climateZone, frost: project.frost, state: project.location.state };
  const choices = useMemo(() => filterPlants(PLANTS, NO_FILTERS, site), [site.zone, site.frost, site.state]); // eslint-disable-line react-hooks/exhaustive-deps
  const [plantId, setPlantId] = useState(placing && choices.some((p) => p.id === placing) ? placing : choices[0]?.id ?? '');
  const stage = useUi((s) => s.stage);
  const month = useUi((s) => s.month);
  const thresholds = useUi((s) => s.sunThresholds);
  // sun this bed gets in the chosen month and at the midwinter and midsummer extremes (June and December), at the current growth stage
  const sunLines = useMemo(() => {
    const poly = sampleShape(b.shape);
    const hours = (m: number): number | null => { const g = computeSunHours(project, { stage, month: m }); return g ? averageHoursIn(g, poly) : null; };
    const months = [...new Set([month, 6, 12])];
    return months.map((m) => ({ m, h: hours(m) }));
  }, [project, b.shape, stage, month]);
  const rec = plantById(plantId);
  return (
    <Accordion initial="sun">
      <TextField label="Name" value={b.name} onCommit={(v) => upd({ ...b, name: v || b.name }, 'Rename bed')} />
      <SelectField label="Edging" value={b.edging} options={optionsOf<EdgingType>(['none', 'timber', 'steel', 'brick', 'stone'])} onChange={(v) => upd({ ...b, edging: v }, 'Change edging')} />
      <SelectField label="Mulch" value={b.mulch} options={optionsOf<MulchType>(['none', 'bark', 'sugarcane', 'gravel', 'pebbles'])} onChange={(v) => upd({ ...b, mulch: v }, 'Change mulch')} />
      <CheckField label="Raised bed" checked={b.raised} onChange={(v) => upd({ ...b, raised: v }, 'Change bed')} />
      <CheckField label="Curved edges" checked={b.shape.smooth} onChange={(v) => upd({ ...b, shape: { ...b.shape, smooth: v } }, 'Change edges')} />
      <Area shape={b.shape} />
      <Section id="sun" title="Sun in this bed">
      <ul className="sunlines" data-testid="bed-sun">
        {sunLines.map(({ m, h }) => (
          <li key={m}>{MONTH_NAMES[m - 1]}: {h === null ? 'not mapped' : `${h.toFixed(1)} h, ${LEVEL_TEXT[sunLevelForHours(h, thresholds)]}`}</li>
        ))}
      </ul>
      <p className="note">Average over the bed, from the shadows of the house, fences, structures and plants at the current growth stage.</p>
      </Section>
      <Section id="fill" title="Fill this bed">
      <label className="field"><span className="field-label">Plant</span>
        <select className="vi-input" value={plantId} onChange={(e) => setPlantId(e.target.value)} aria-label="Plant to fill the bed with">
          {choices.map((p) => <option key={p.id} value={p.id}>{plantLabel(p)}</option>)}
        </select>
      </label>
      {rec && <p className="note">Spacing {recommendedSpacing(rec.id).toFixed(2)} m, a little under its {mid(rec.spread).toFixed(1)} m mature spread.</p>}
      <button type="button" className="btn primary" disabled={!rec} onClick={() => { const n = app.fillBed(b.id, plantId); if (n) app.notify(`Planted ${n} × ${rec ? plantLabel(rec) : 'plant'}.`); }}><Icon name="plant" size={15} /> Fill bed</button>
      </Section>
    </Accordion>
  );
}

const LEVEL_TEXT = { full_sun: 'full sun', part_shade: 'part shade', shade: 'shade' } as const;

function ServicePanel({ s, upd }: { s: ServiceLine; upd(n: unknown, l: string): void }) {
  const easement = s.kind === 'easement';
  return (
    <>
      <TextField label="Name" value={s.name} onCommit={(v) => upd({ ...s, name: v || s.name }, 'Rename service')} />
      <SelectField label="Kind" value={s.kind} options={optionsOf<ServiceKind>(SERVICE_KINDS)} onChange={(v) => upd({ ...s, kind: v, width: v === 'easement' ? Math.max(s.width, 2) : s.width }, 'Change service kind')} />
      {easement && <NumField label="Corridor width" unit="m" value={s.width} min={0.5} max={20} step={0.5} onCommit={(v) => upd({ ...s, width: v }, 'Change easement width')} hint="Trees and large plants are flagged inside it." />}
      <p className="summary"><span>{polylineLength(s.points).toFixed(1)} m long</span></p>
      <p className="note">The checks keep trees, and any plant flagged for invasive roots, clear of services and out of easements. Positions are only as good as what you drew: confirm real locations with Dial Before You Dig.</p>
    </>
  );
}

function StructurePanel({ s, upd }: { s: Structure; upd(n: unknown, l: string): void }) {
  const deg = Math.round(((s.rotation * 180) / Math.PI + 360) % 360);
  return (
    <>
      <TextField label="Name" value={s.name} onCommit={(v) => upd({ ...s, name: v || s.name }, 'Rename')} />
      <p className="note">{STRUCTURE_LABEL[s.kind]}</p>
      <NumField label="Width" unit="m" value={s.width} min={0.1} max={50} step={0.1} onCommit={(v) => upd({ ...s, width: v }, 'Resize')} />
      <NumField label="Length" unit="m" value={s.length} min={0.05} max={50} step={0.1} onCommit={(v) => upd({ ...s, length: v }, 'Resize')} />
      <NumField label="Height" unit="m" value={s.height} min={0} max={10} step={0.1} onCommit={(v) => upd({ ...s, height: v }, 'Resize')} />
      <NumField label="Turn" unit="degrees" value={deg} min={0} max={359} step={5} decimals={0} onCommit={(v) => upd({ ...s, rotation: (v * Math.PI) / 180 }, 'Rotate')} />
      {s.kind === 'gate' && <SelectField label="Swings" value={String(s.swing ?? 1) as '1' | '-1'} options={[['1', 'One way'], ['-1', 'The other way']]} onChange={(v) => upd({ ...s, swing: v === '1' ? 1 : -1 }, 'Change gate swing')} />}
    </>
  );
}

function PlantPanel({ inst, project, upd }: { inst: PlantInstance; project: GardenProject; upd(n: unknown, l: string): void }) {
  const stage = useUi((s) => s.stage);
  const rec = plantById(inst.plantId);
  if (!rec) return <p className="note">This plant is no longer in the library.</p>;
  const size = plantSizeAt(rec, stage);
  const reasons = unsuitableReasons(rec, { zone: project.climateZone, frost: project.frost, state: project.location.state });
  return (
    <>
      <p className="plant-title"><strong>{plantLabel(rec)}</strong><em>{botanicalLabel(rec)}</em></p>
      <p className="summary"><span>{size.height.toFixed(1)} m high</span><span>{size.spread.toFixed(1)} m wide</span></p>
      <p className="note">Size comes from the plant and the growth control at the bottom. Change the growth stage to see it grow.</p>
      {reasons.length > 0 && <ul className="warnlist">{reasons.map((r) => <li key={r}>{UNSUITABLE_TEXT[r](rec, { zone: project.climateZone, frost: project.frost, state: project.location.state })}</li>)}</ul>}
      <TextField label="Note" value={inst.note ?? ''} onCommit={(v) => upd({ ...inst, note: v || undefined }, 'Edit note')} placeholder="e.g. bought at Bunnings, planted in May" />
    </>
  );
}
