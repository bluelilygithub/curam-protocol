import { useEffect, useMemo, useState } from 'react';
import { CLIMATE_LABEL, FROST_LABEL } from '../domain/climate';
import { VoiceInput } from '@planner-core/speech/VoiceInput';
import { MONTHS, mid } from '../plants/growth';
import { COLOUR_FAMILIES, NO_FILTERS, filterPlants, type PlantFilters } from '../plants/filters';
import { PLANTS, botanicalLabel, plantLabel } from '../plants/plants';
import { UNSUITABLE_TEXT, sunLevelForHours, unsuitableReasons } from '../plants/suitability';
import { weedFilterNote, weedStatus, weedStatusText } from '../plants/weeds';
import { DRAFT_LABEL } from '../checks/draft';
import { averageHoursIn, computeSunHours } from '../sun/sunHours';
import { sampleShape } from '../domain/shapes';
import { MONTH_NAMES } from '../plants/growth';
import { FEATURES, PLANT_TYPES, type Feature, type PlantRecord, type Sun, type Water } from '../plants/types';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';
import { PlantPhotos } from './PlantPhotos';
import { labelOf } from './fields';

const FAV_KEY = 'garden-planner:favourites:v1';
function readFavs(): string[] {
  try { const v = JSON.parse(localStorage.getItem(FAV_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
function writeFavs(f: string[]): void { try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch { /* private mode: favourites last for this visit only */ } }

export function useFavourites(): [string[], (id: string) => void] {
  const [favs, setFavs] = useState<string[]>(readFavs);
  const toggle = (id: string): void => setFavs((cur) => { const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]; writeFavs(next); return next; });
  return [favs, toggle];
}

export function PlantLibrary() {
  const app = useApp();
  const open = useUi((s) => s.libraryOpen);
  const suitsOnly = useUi((s) => s.suitsOnly);
  const placing = useUi((s) => s.placingPlantId);
  const climate = useProject((s) => s.project?.climateZone);
  const frost = useProject((s) => s.project?.frost);
  const state = useProject((s) => s.project?.location.state);
  const pets = useProject((s) => s.project?.pets ?? false);
  const [f, setF] = useState<PlantFilters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [favsOnly, setFavsOnly] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [favs, toggleFav] = useFavourites();
  const matchBed = useUi((s) => s.matchBedSun);
  const selection = useUi((s) => s.selection);
  const stage = useUi((s) => s.stage);
  const month = useUi((s) => s.month);
  const thresholds = useUi((s) => s.sunThresholds);
  const project = useProject((s) => s.project);
  const selectedBed = selection?.kind === 'bed' ? project?.beds.find((b) => b.id === selection.id) : undefined;
  // light level of the selected bed in the chosen month (full sun / part shade / shade), for the "match this bed" filter
  const bedLevel = useMemo(() => {
    if (!project || !selectedBed) return null;
    const g = computeSunHours(project, { stage, month });
    const h = g ? averageHoursIn(g, sampleShape(selectedBed.shape)) : null;
    return h === null ? null : { hours: h, level: sunLevelForHours(h, thresholds) };
  }, [project, selectedBed, stage, month, thresholds]);

  const site = useMemo(() => (climate && frost && state ? { zone: climate, frost, state } : null), [climate, frost, state]);
  const results = useMemo(() => {
    let r = filterPlants(PLANTS, f, suitsOnly ? site : null);
    if (favsOnly) r = r.filter((p) => favs.includes(p.id));
    if (matchBed && bedLevel) r = r.filter((p) => p.sun.includes(bedLevel.level));
    return r;
  }, [f, suitsOnly, site, favsOnly, favs, matchBed, bedLevel]);
  // Plants the filter leaves out are NOT silently dropped: they are listed below with the reason (the data behind the reason is a draft)
  const hidden = useMemo(() => {
    if (!suitsOnly || !site) return [];
    const shown = new Set(results.map((p) => p.id));
    return filterPlants(PLANTS, f, null).filter((p) => !shown.has(p.id) && unsuitableReasons(p, site).length > 0);
  }, [f, suitsOnly, site, results]);
  const hiddenCount = hidden.length;

  useEffect(() => { if (placing) setOpenId(placing); }, [placing]);
  if (!open) return null;
  const set = <K extends keyof PlantFilters>(k: K, v: PlantFilters[K]): void => setF((cur) => ({ ...cur, [k]: v }));
  const active = JSON.stringify({ ...f, text: '' }) !== JSON.stringify(NO_FILTERS);

  return (
    <aside className="panel panel-left" aria-label="Plant library" data-tour="gp-library">
      <div className="panel-head">
        <h2>Plants</h2>
        <button type="button" className="icon-btn" title="Scan a plant tag: photograph the tag from the nursery to find the plant" data-testid="open-tag-scan" onClick={() => app.ui.getState().set({ tagScanOpen: true })}><Icon name="camera" size={16} /></button>
        <button type="button" className="icon-btn" title="Hide the plant library" onClick={() => app.ui.getState().set({ libraryOpen: false })}><Icon name="close" size={16} /></button>
      </div>

      <SiteBadge />

      <div className="lib-search">
        <Icon name="search" size={16} />
        <VoiceInput value={f.text} onChange={(v) => set('text', v)} placeholder="Search by common or botanical name" aria-label="Search plants" />
      </div>

      <div className="lib-bar">
        <label className="switch" title="Hide plants that will not suit your climate and frost, and weeds in your state">
          <input type="checkbox" checked={suitsOnly} onChange={(e) => app.ui.getState().set({ suitsOnly: e.target.checked })} />
          <span>Suits my garden</span>
        </label>
        <button type="button" className={`chip${favsOnly ? ' on' : ''}`} title="Show only your favourites" aria-pressed={favsOnly} onClick={() => setFavsOnly(!favsOnly)}><Icon name="star" size={13} /> Favourites</button>
        {bedLevel && (
          <label className="switch" title="Only plants that suit the sun in the bed you have selected, in the month shown">
            <input type="checkbox" checked={matchBed} onChange={(e) => app.ui.getState().set({ matchBedSun: e.target.checked })} />
            <span>Match this bed's sun ({bedLevel.hours.toFixed(1)} h in {MONTH_NAMES[month - 1]}, {bedLevel.level.replace('_', ' ')})</span>
          </label>
        )}
        <button type="button" className={`chip${showFilters || active ? ' on' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}>Filters{active ? ' •' : ''}</button>
      </div>

      {showFilters && (
        <div className="filters">
          <label>Type<select value={f.type} onChange={(e) => set('type', e.target.value as PlantFilters['type'])}><option value="any">Any</option>{PLANT_TYPES.map((t) => <option key={t} value={t}>{labelOf(t)}</option>)}</select></label>
          <label>Origin<select value={f.origin} onChange={(e) => set('origin', e.target.value as PlantFilters['origin'])}><option value="any">Any</option><option value="native">Australian native</option><option value="exotic">Exotic</option></select></label>
          <label>Sun<select value={f.sun} onChange={(e) => set('sun', e.target.value as Sun | 'any')}><option value="any">Any</option><option value="full_sun">Full sun</option><option value="part_shade">Part shade</option><option value="shade">Shade</option></select></label>
          <label>Water<select value={f.water} onChange={(e) => set('water', e.target.value as Water | 'any')}><option value="any">Any</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
          <label>Flowers in<select value={f.flowerMonth} onChange={(e) => set('flowerMonth', Number(e.target.value))}><option value={0}>Any month</option>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label>Flower colour<select value={f.colour} onChange={(e) => set('colour', e.target.value as PlantFilters['colour'])}><option value="any">Any</option>{COLOUR_FAMILIES.map((c) => <option key={c} value={c}>{labelOf(c)}</option>)}</select></label>
          <label>Max height (m)<VoiceInput kind="number" value={f.maxHeight ? String(f.maxHeight) : ''} parse={(s) => { const n = Number(s); return Number.isFinite(n) ? n : null; }} onChange={(v) => set('maxHeight', Math.max(0, Number(v) || 0))} min={0} step={0.5} placeholder="Any" aria-label="Maximum height" /></label>
          <label>Max spread (m)<VoiceInput kind="number" value={f.maxSpread ? String(f.maxSpread) : ''} parse={(s) => { const n = Number(s); return Number.isFinite(n) ? n : null; }} onChange={(v) => set('maxSpread', Math.max(0, Number(v) || 0))} min={0} step={0.5} placeholder="Any" aria-label="Maximum spread" /></label>
          <div className="feat">
            {FEATURES.map((x: Feature) => (
              <button key={x} type="button" className={`chip${f.features.includes(x) ? ' on' : ''}`} aria-pressed={f.features.includes(x)} onClick={() => set('features', f.features.includes(x) ? f.features.filter((y) => y !== x) : [...f.features, x])}>{labelOf(x)}</button>
            ))}
          </div>
          <button type="button" className="btn" onClick={() => setF({ ...NO_FILTERS, text: f.text })}>Clear filters</button>
        </div>
      )}

      {suitsOnly && <p className="weednote" data-testid="library-weed-note">{weedFilterNote()}</p>}

      <p className="lib-count" role="status">
        {results.length} plant{results.length === 1 ? '' : 's'}{hiddenCount > 0 ? ` · ${hiddenCount} set aside (not suited to this garden, listed below with the reason)` : ''}
      </p>

      <ul className="plant-list">
        {results.map((p) => (
          <li key={p.id}>
            <PlantRow p={p} open={openId === p.id} fav={favs.includes(p.id)} pets={pets} armed={placing === p.id}
              onToggle={() => setOpenId(openId === p.id ? null : p.id)} onFav={() => toggleFav(p.id)} />
          </li>
        ))}
        {results.length === 0 && <li className="empty">No plants match. Try clearing a filter{suitsOnly ? ' or turning off “Suits my garden”' : ''}.</li>}
      </ul>
      {hidden.length > 0 && (
        <details className="hidden-plants" data-testid="hidden-plants">
          <summary>Not suited to this garden ({hidden.length})</summary>
          <p className="note">These are set aside, not deleted. The reasons rest on plant data that is {DRAFT_LABEL}: check before ruling one out.</p>
          <ul>
            {hidden.map((p) => (
              <li key={p.id}>
                <strong>{plantLabel(p)}</strong> <em>{botanicalLabel(p)}</em>
                {unsuitableReasons(p, site!).map((r) => <span key={r} className="why">{UNSUITABLE_TEXT[r](p, site!)} ({DRAFT_LABEL})</span>)}
                <button type="button" className="link" onClick={() => app.ui.getState().set({ suitsOnly: false })}>Show it in the list</button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}

/** Where the garden is and what the library is filtering for: the address (or suburb), climate zone, frost and state. Click to change them. */
function SiteBadge() {
  const app = useApp();
  const address = useProject((s) => s.project?.location.address);
  const label = useProject((s) => s.project?.location.label);
  const zone = useProject((s) => s.project?.climateZone);
  const frost = useProject((s) => s.project?.frost);
  const state = useProject((s) => s.project?.location.state);
  if (!label || !zone || !frost) return null;
  return (
    <button type="button" className="site-badge" data-testid="site-badge" title="Where the garden is. The library is filtered for this climate, frost level and state. Click to change them."
      onClick={() => app.ui.getState().set({ inspectorOpen: true, selection: null, rightTab: 'details' })}>
      <Icon name="map" size={15} />
      <span><strong>{address ?? label}</strong><small>{CLIMATE_LABEL[zone]} · frost: {FROST_LABEL[frost].toLowerCase()} · {state}</small></span>
    </button>
  );
}

export const PLANT_DRAG_TYPE = 'application/x-garden-plant';

function PlantRow({ p, open, fav, pets, armed, onToggle, onFav }: { p: PlantRecord; open: boolean; fav: boolean; pets: boolean; armed: boolean; onToggle(): void; onFav(): void }) {
  return (
    <div className={`plant-row${open ? ' open' : ''}${armed ? ' armed' : ''}`}>
      <button type="button" className="plant-head" aria-expanded={open} onClick={onToggle} draggable title="Drag onto the plan to plant it"
        onDragStart={(e) => { e.dataTransfer.setData(PLANT_DRAG_TYPE, p.id); e.dataTransfer.setData('text/plain', plantLabel(p)); e.dataTransfer.effectAllowed = 'copy'; }}>
        <PlantSwatch p={p} />
        <span className="plant-names"><strong>{plantLabel(p)}</strong><em>{botanicalLabel(p)}</em></span>
        {pets && p.cautions.includes('toxic_pets') && <span className="badge warn" title="Toxic to pets">Pets</span>}
        {p.native && <span className="badge" title="Australian native">Native</span>}
      </button>
      {open && <PlantCard p={p} fav={fav} onFav={onFav} />}
    </div>
  );
}

/** Stand-in picture until real photos arrive (image pipeline): the plant's own foliage and flower colours in a form glyph. */
export function PlantSwatch({ p, size = 38 }: { p: PlantRecord; size?: number }) {
  const flower = p.flowerColours[0];
  return (
    <svg className="swatch" width={size} height={size} viewBox="0 0 40 40" role="img" aria-label={`${plantLabel(p)} colours`}>
      <rect width="40" height="40" rx="8" fill="#eef0e6" />
      {p.form === 'palm' ? <g><rect x="18.5" y="16" width="3" height="18" fill="#6b4a2e" />{[0, 1, 2, 3, 4].map((i) => <ellipse key={i} cx="20" cy="14" rx="11" ry="3" transform={`rotate(${i * 36 - 72} 20 14)`} fill={p.foliageColour} />)}</g>
        : p.form === 'clumping_grass' ? <g>{[-10, -5, 0, 5, 10].map((d) => <path key={d} d={`M20 34 Q${20 + d} 20 ${20 + d * 1.5} 8`} stroke={p.foliageColour} strokeWidth="3" fill="none" strokeLinecap="round" />)}</g>
        : p.form === 'groundcover_mat' ? <ellipse cx="20" cy="28" rx="15" ry="6" fill={p.foliageColour} />
        : p.form === 'climber' ? <path d="M12 34 C 8 24 28 22 22 12 S 30 6 28 4" stroke={p.foliageColour} strokeWidth="3.5" fill="none" strokeLinecap="round" />
        : <g>{p.type === 'tree' && <rect x="18.5" y="22" width="3" height="12" fill="#6b4a2e" />}<ellipse cx="20" cy={p.type === 'tree' ? 16 : 24} rx={p.form === 'columnar' ? 7 : 13} ry={p.form === 'columnar' ? 14 : p.type === 'tree' ? 11 : 10} fill={p.foliageColour} /></g>}
      {flower && <g fill={flower}><circle cx="14" cy="14" r="2.6" /><circle cx="26" cy="19" r="2.6" /><circle cx="20" cy="9" r="2.2" /></g>}
    </svg>
  );
}

export function FlowerCalendar({ p }: { p: PlantRecord }) {
  return (
    <div className="cal" aria-label={p.flowerMonths.length ? `Flowers in ${p.flowerMonths.map((m) => MONTHS[m - 1]).join(', ')}` : 'Grown for its foliage'}>
      {MONTHS.map((m, i) => <span key={m} className={p.flowerMonths.includes(i + 1) ? 'on' : ''} style={p.flowerMonths.includes(i + 1) && p.flowerColours[0] ? { background: p.flowerColours[0] } : undefined} title={m}>{m[0]}</span>)}
    </div>
  );
}

export function PlantCard({ p, fav, onFav }: { p: PlantRecord; fav: boolean; onFav(): void }) {
  const app = useApp();
  const climate = useProject((s) => s.project?.climateZone);
  const frost = useProject((s) => s.project?.frost);
  const state = useProject((s) => s.project?.location.state);
  const site = climate && frost && state ? { zone: climate, frost, state } : null;
  const reasons = site ? unsuitableReasons(p, site) : [];
  return (
    <div className="plant-card">
      <PlantPhotos p={p} />
      {reasons.length > 0 && (
        <ul className="warnlist">{reasons.map((r) => <li key={r}>{UNSUITABLE_TEXT[r](p, site!)}</li>)}</ul>
      )}
      <dl className="facts">
        <div><dt>Mature size</dt><dd>{p.height[0]}–{p.height[1]} m high, {p.spread[0]}–{p.spread[1]} m wide</dd></div>
        <div><dt>Takes</dt><dd>about {p.yearsToMature} year{p.yearsToMature === 1 ? '' : 's'} to mature · {p.growth} growing</dd></div>
        <div><dt>Sun</dt><dd>{p.sun.map(labelOf).join(', ')}</dd></div>
        <div><dt>Water</dt><dd>{labelOf(p.water)}{p.droughtTolerant ? ' · drought tolerant' : ''}</dd></div>
        <div><dt>Frost</dt><dd>{p.frost === 'none' ? 'Frost tender' : `Up to ${p.frost} frost`}</dd></div>
        <div><dt>Climates</dt><dd>{p.zones.map((z) => labelOf(z)).join(', ')}</dd></div>
        <div><dt>Soil</dt><dd>{p.soils.map(labelOf).join(', ')}{p.tolerantOfPoorDrainage ? ' · copes with poor drainage' : ''}</dd></div>
        {state && <div><dt>Weed status</dt><dd data-testid="card-weed">{weedStatusText(p, state)}{weedStatus(p, state) === 'unknown' ? '. Not the same as safe.' : ''}</dd></div>}
        <div><dt>Origin</dt><dd>{p.native ? `Australian native${p.origin.length ? ` (${p.origin.join(', ')})` : ''}` : 'Exotic'}</dd></div>
        <div><dt>Foliage</dt><dd>{labelOf(p.foliage)}</dd></div>
      </dl>
      <div className="facts-row"><span className="dt">Flowers</span><FlowerCalendar p={p} /></div>
      {p.features.length > 0 && <p className="tags">{p.features.map((x) => <span key={x} className="tag">{labelOf(x)}</span>)}</p>}
      {p.cautions.length > 0 && <p className="tags">{p.cautions.map((x) => <span key={x} className="tag warn">{labelOf(x)}</span>)}</p>}
      <p className="src" title={p.source.note}>Data: {p.source.dataset} (draft, unverified)</p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => app.ui.getState().placePlant(p.id)}><Icon name="plus" size={15} /> Add to plan</button>
        <button type="button" className={`btn${fav ? ' on' : ''}`} aria-pressed={fav} onClick={onFav}><Icon name="star" size={15} /> {fav ? 'Favourite' : 'Add to favourites'}</button>
      </div>
      <p className="note">One plant is placed per click. Select a bed and use “Fill bed” in the panel on the right to plant it at the recommended spacing ({(Math.max(0.15, mid(p.spread) * 0.85)).toFixed(2)} m).</p>
    </div>
  );
}
