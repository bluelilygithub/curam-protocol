import { useEffect, useState } from 'react';
import { readPicture } from '../state/images';
import { OSM_ATTRIBUTION, OSM_COPYRIGHT_URL, PlaceLookupError, type PlaceHit } from '../state/geocode';
import { CLIMATE_LABEL, FROST_LABEL, KNOWN_PLACES, stateFromPostcode, suggestClimate, suggestFrost } from '../domain/climate';
import { AU_STATES, CLIMATE_ZONES, FROST_LEVELS, type ClimateZone, type Drainage, type Frost, type Location, type Soil } from '../domain/types';
import { useApp, useUi } from './AppContext';
import { CheckField, Field, NumField, SelectField, TextField, optionsOf } from './fields';
import { Icon } from './icons';
import { MapPreview } from './MapSection';

const STEPS = ['Where', 'Climate', 'North', 'Your plot'] as const;

export function Wizard() {
  const app = useApp();
  const open = useUi((s) => s.wizardOpen);
  const [step, setStep] = useState(0);
  const [name, setName] = useState('My garden');
  const [loc, setLoc] = useState<Location>(KNOWN_PLACES[0]);
  const [postcode, setPostcode] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [looking, setLooking] = useState(false);
  /** The place came from an OpenStreetMap lookup: keep the attribution showing. */
  const [fromOsm, setFromOsm] = useState(false);
  const [lookupMsg, setLookupMsg] = useState('');
  const [zone, setZone] = useState<ClimateZone>(suggestClimate(KNOWN_PLACES[0].lat, KNOWN_PLACES[0].lng, KNOWN_PLACES[0].state));
  const [frost, setFrost] = useState<Frost>(suggestFrost(zone, KNOWN_PLACES[0].state));
  const [pets, setPets] = useState(false);
  const [soil, setSoil] = useState<Soil | ''>('');
  const [drainage, setDrainage] = useState<Drainage>('good');
  const [north, setNorth] = useState(0);
  const [plot, setPlot] = useState<'draw' | 'rect' | 'picture'>('draw');
  const [w, setW] = useState(15);
  const [d, setD] = useState(30);
  const [pic, setPic] = useState<{ blob: Blob; name: string; widthPx: number; heightPx: number; preview: string } | null>(null);
  useEffect(() => () => { if (pic) URL.revokeObjectURL(pic.preview); }, [pic]);
  const [err, setErr] = useState('');

  if (!open) return null;

  const place = (l: Location): void => {
    setLoc(l);
    const z = suggestClimate(l.lat, l.lng, l.state);
    setZone(z);
    setFrost(suggestFrost(z, l.state));
  };

  /** One search per press of Look up: never while typing (Nominatim forbids search-as-you-type), never for a box that is empty. */
  const lookup = async (): Promise<void> => {
    if (looking) return;
    setLooking(true); setLookupMsg(''); setHits([]);
    try {
      const text = postcode.trim();
      const r = await app.places.search(/^\d{4}$/.test(text) ? `${text}, Australia` : text);
      setHits(r.results);
      if (!r.results.length) setLookupMsg('Nothing found. Try another suburb, or pick a place from the list or type the latitude and longitude.');
    } catch (e) { setLookupMsg(e instanceof PlaceLookupError ? e.message : 'Could not look that up. Pick a place from the list instead.'); }
    setLooking(false);
  };

  const pickPicture = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setErr('');
    try {
      const p = await readPicture(file);
      setPic({ blob: p.blob, name: file.name, widthPx: p.width, heightPx: p.height, preview: URL.createObjectURL(p.blob) });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Could not read that picture.'); }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    await app.newProject({
      meta: { name: name.trim() || 'My garden', location: loc, climateZone: zone, frost, pets, soil: soil || undefined, drainage, northDeg: north },
      plot: plot === 'rect' ? { kind: 'rect', width: w, depth: d } : null,
      picture: plot === 'picture' && pic ? { blob: pic.blob, name: pic.name, widthPx: pic.widthPx, heightPx: pic.heightPx } : null,
    });
    if (plot === 'picture' && pic) { app.ui.getState().set({ tool: 'scale' }); app.notify('Now set the scale: click two points on the picture a known distance apart.'); }
    else if (plot === 'draw') { app.ui.getState().set({ tool: 'boundary' }); }
    setBusy(false);
    setStep(0);
  };

  const suggested = suggestClimate(loc.lat, loc.lng, loc.state);
  const canClose = !!app.project.getState().project;

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="New garden">
      <div className="modal wizard">
        <div className="modal-head">
          <h2>New garden</h2>
          {canClose && <button type="button" className="icon-btn" title="Cancel" onClick={() => app.ui.getState().set({ wizardOpen: false })}><Icon name="close" size={16} /></button>}
        </div>
        <ol className="steps" aria-label="Steps">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>{s}</li>)}</ol>

        <div className="modal-body">
          {step === 0 && (
            <>
              <TextField label="Garden name" value={name} onCommit={setName} />
              <label className="field">
                <span className="field-label">Pick a place</span>
                <select className="vi-input" value={KNOWN_PLACES.find((p) => p.label === loc.label)?.label ?? ''} onChange={(e) => { const p = KNOWN_PLACES.find((x) => x.label === e.target.value); if (p) { place(p); setPostcode(p.postcode ?? ''); setFromOsm(false); } }} aria-label="Pick a place">
                  <option value="">Somewhere else (use the boxes below)</option>
                  {KNOWN_PLACES.map((p) => <option key={p.label} value={p.label}>{p.label}</option>)}
                </select>
              </label>
              <div className="grid2">
                <TextField label="Suburb or postcode" value={postcode} onCommit={(v) => { setPostcode(v); if (/^\d{4}$/.test(v)) { const s = stateFromPostcode(v); if (s) place({ ...loc, state: s, postcode: v }); } }} placeholder="e.g. Paddington or 4064" />
                <button type="button" className="btn lookup" disabled={looking} onClick={() => void lookup()}><Icon name="search" size={15} /> {looking ? 'Looking…' : 'Look up'}</button>
              </div>
              {lookupMsg && <p className="note" role="status">{lookupMsg}</p>}
              {hits.length > 0 && (
                <ul className="hits">
                  {hits.map((h) => <li key={`${h.lat},${h.lng}`}><button type="button" className="btn" onClick={() => { const st = h.state ?? loc.state; place({ label: h.label, lat: h.lat, lng: h.lng, state: st, postcode: postcode || undefined }); setHits([]); setFromOsm(true); }}>{h.label}{h.state ? ` (${h.state})` : ''}</button></li>)}
                </ul>
              )}
              {(hits.length > 0 || fromOsm) && (
                <p className="note osm" data-testid="osm-attribution">Place details: <a href={OSM_COPYRIGHT_URL} target="_blank" rel="noreferrer noopener">{OSM_ATTRIBUTION}</a></p>
              )}
              <div className="grid2">
                <SelectField label="State" value={loc.state} options={AU_STATES.map((s) => [s, s] as const)} onChange={(s) => place({ ...loc, state: s })} />
                <TextField label="Place name" value={loc.label} onCommit={(v) => setLoc({ ...loc, label: v })} />
              </div>
              <div className="grid2">
                <NumField label="Latitude" value={loc.lat} min={-44} max={-9} step={0.01} decimals={3} onCommit={(v) => place({ ...loc, lat: v })} hint="Negative: Australia is in the southern hemisphere." />
                <NumField label="Longitude" value={loc.lng} min={112} max={155} step={0.01} decimals={3} onCommit={(v) => place({ ...loc, lng: v })} />
              </div>
              <MapPreview lat={loc.lat} lng={loc.lng} />
              <p className="note">Your location sets the sun path and suggests a climate zone. It is stored only in your garden file.</p>
            </>
          )}

          {step === 1 && (
            <>
              <p className="note">We suggest <strong>{CLIMATE_LABEL[suggested]}</strong> for {loc.label}. Change it if you know better, for example a frosty hollow or a sheltered courtyard.</p>
              <SelectField label="Climate zone" value={zone} options={CLIMATE_ZONES.map((z) => [z, CLIMATE_LABEL[z]] as const)} onChange={(z) => { setZone(z); setFrost(suggestFrost(z, loc.state)); }} />
              <SelectField<Frost> label="Frost" value={frost} options={FROST_LEVELS.map((f) => [f, FROST_LABEL[f]] as const)} onChange={setFrost} hint="Plants that cannot take this much frost are hidden from the library." />
              <div className="grid2">
                <SelectField<Soil | ''> label="Soil (optional)" value={soil} options={[['' as Soil | '', 'Not sure'], ...optionsOf<Soil>(['sandy', 'loam', 'clay'])]} onChange={setSoil} />
                <SelectField<Drainage> label="Drainage" value={drainage} options={[['good', 'Good'], ['poor', 'Poor']]} onChange={setDrainage} />
              </div>
              <CheckField label="We have pets" checked={pets} onChange={setPets} hint="Flags plants that are toxic to dogs and cats." />
            </>
          )}

          {step === 2 && (
            <>
              <p className="note">In Australia the sun is in the <strong>north</strong>, so a north-facing garden is the sunny one. Say which way north points on your plan. Drag the arrow, or type it.</p>
              <NorthDial value={north} onChange={setNorth} />
              <NumField label="North points" unit="degrees" value={north} min={0} max={359} step={1} decimals={0} onCommit={setNorth} hint="0 = north is straight up the page. 90 = north is to the right." />
              <p className="note">Not sure? Leave it at 0. You can change it any time, and drag the north arrow on the plan.</p>
            </>
          )}

          {step === 3 && (
            <>
              <div className="choices" role="radiogroup" aria-label="How to start your plot">
                {([['draw', 'Draw it myself', 'Click the corners of your plot on the plan.'], ['rect', 'Start with a rectangle', 'Type the width and depth; reshape it later.'], ['picture', 'Trace a picture', 'Use a site plan, aerial photo or sketch under the plan.']] as const).map(([k, t, sub]) => (
                  <button key={k} type="button" role="radio" aria-checked={plot === k} className={`choice${plot === k ? ' on' : ''}`} onClick={() => setPlot(k)}><strong>{t}</strong><span>{sub}</span></button>
                ))}
              </div>
              {plot === 'rect' && (
                <div className="grid2">
                  <NumField label="Width" unit="m" value={w} min={2} max={500} step={0.5} onCommit={setW} />
                  <NumField label="Depth" unit="m" value={d} min={2} max={500} step={0.5} onCommit={setD} />
                </div>
              )}
              {plot === 'picture' && (
                <>
                  <Field label="Picture file">
                    <input type="file" accept="image/*" onChange={(e) => void pickPicture(e.target.files?.[0])} aria-label="Choose a picture to trace" />
                  </Field>
                  {err && <p className="note err" role="alert">{err}</p>}
                  {pic && <img className="pic-preview" src={pic.preview} alt="Your tracing picture" />}
                  <p className="note">Next you will mark a known length on the picture (a fence line or the house wall) so it is to scale.</p>
                </>
              )}
            </>
          )}
        </div>

        <div className="modal-foot">
          {step > 0 && <button type="button" className="btn" onClick={() => setStep(step - 1)}>Back</button>}
          <span className="grow" />
          {step < STEPS.length - 1
            ? <button type="button" className="btn primary" onClick={() => setStep(step + 1)}>Next</button>
            : <button type="button" className="btn primary" disabled={busy || (plot === 'picture' && !pic)} onClick={() => void finish()}>{busy ? 'Creating…' : 'Create garden'}</button>}
        </div>
      </div>
    </div>
  );
}

/** Drag or tap the dial to point north. */
function NorthDial({ value, onChange }: { value: number; onChange(v: number): void }) {
  const set = (e: React.PointerEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    onChange(Math.round(((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360));
  };
  return (
    <svg className="dial" viewBox="-60 -60 120 120" width="150" height="150" role="slider" aria-label="North direction" aria-valuemin={0} aria-valuemax={359} aria-valuenow={value}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); set(e); }} onPointerMove={(e) => { if (e.buttons) set(e); }}>
      <circle r="52" fill="#fff" stroke="#c9c9bf" strokeWidth="2" />
      <text x="0" y="-38" textAnchor="middle" fontSize="9" fill="#888">top of plan</text>
      <g transform={`rotate(${value})`}><path d="M0 -44 L10 14 L0 6 L-10 14 Z" fill="#1A1A1A" /><text x="0" y="-48" textAnchor="middle" fontSize="12" fontWeight="700" fill="#CC785C" transform="translate(0,-4)">N</text></g>
    </svg>
  );
}
