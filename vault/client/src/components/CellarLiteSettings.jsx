import React, { cloneElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../utils/apiClient';
import Tooltip from './Tooltip';

// Settings -> Cellar Planner (admin). The owner's numbers, shared by the PUBLIC lite planner and the staff Cellar Planner: the rack types (sizes, bottle
// counts, price per unit, "confirmed by the supplier"), door widths, the price formula, a line of text and the starting rooms. Saved to Vault (workspace_settings); the public tool fetches them when it opens. Rules live on the server
// (server/config/cellarLiteConfig.js), which also sends back plain-language reasons when a value is refused. Docs: docs/cellar-planner.md.

const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const INPUT = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-all';
const CARD = 'rounded-2xl border p-6 space-y-4';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const ROUND_TO = [1, 10, 50, 100, 500, 1000];
const MAX_PRESETS = 6;
const MAX_RACK_TYPES = 8;
const ORIENTATION_OPTIONS = [['NECK_OUT', 'Neck-out'], ['LABEL_FORWARD', 'Label-forward']];
const RACK_NUM_KEYS = ['unitWidthMm', 'unitDepthMm', 'unitHeightMm', 'rowPitchMm', 'postsPerUnit', 'bottlesPerRow', 'bottlesPerRowLabelForward', 'rowsPerUnit', 'pricePerUnit'];
const typeToForm = (r) => ({ id: r.id, name: r.name, orientation: r.orientation, confirmed: !!r.confirmed, ...Object.fromEntries(RACK_NUM_KEYS.map((k) => [k, r[k] === null || r[k] === undefined ? '' : String(r[k])])) });
const typeToConfig = (r) => ({ id: r.id, name: r.name, orientation: r.orientation, confirmed: r.confirmed, ...Object.fromEntries(RACK_NUM_KEYS.map((k) => [k, r[k]])) });
const slugOf = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

const toForm = (c) => ({
  promise: c.promise ?? '',
  quoteNote: c.quoteNote ?? '',
  phone: c.phone ?? '',
  accent: c.accent ?? '#4a5a2a',
  rackTypes: (c.rackTypes || []).map(typeToForm), defaultRackType: c.defaultRackType,
  clK: String(c.cooling?.panelConductivity ?? 0.025), clGlass: String(c.cooling?.glassU ?? 1.4), clFloor: String(c.cooling?.floorU ?? 1), clGains: String(c.cooling?.internalGainsW ?? 100), clMargin: String(c.cooling?.marginPct ?? 20), clTarget: String(c.cooling?.targetC ?? 14), clAmbient: String(c.cooling?.ambientC ?? 35),
  qBusinessName: c.quote?.businessName ?? '', qDetails: c.quote?.details ?? '', qTerms: c.quote?.terms ?? '', qValidityDays: String(c.quote?.validityDays ?? 30), qGstNote: c.quote?.gstNote ?? '',
  singleMm: String(c.doors.singleMm), doubleMm: String(c.doors.doubleMm),
  show: !!c.pricing.show, currency: c.pricing.currency ?? '$',
  fixed: c.pricing.fixed ?? '', doorSingle: c.pricing.doorSingle ?? '', doorDouble: c.pricing.doorDouble ?? '',
  rangePct: String(c.pricing.rangePct), roundTo: String(c.pricing.roundTo), note: c.pricing.note ?? '',
  presets: (c.presets || []).map((p) => ({ id: p.id, name: p.name, widthMm: String(p.widthMm), depthMm: String(p.depthMm), heightMm: String(p.heightMm), doorStyle: p.doorStyle })),
});
const toConfig = (f) => ({
  version: 1,
  promise: f.promise,
  quoteNote: f.quoteNote,
  phone: f.phone,
  accent: f.accent,
  rackTypes: f.rackTypes.map(typeToConfig), defaultRackType: f.defaultRackType,
  cooling: { panelConductivity: f.clK, glassU: f.clGlass, floorU: f.clFloor, internalGainsW: f.clGains, marginPct: f.clMargin, targetC: f.clTarget, ambientC: f.clAmbient },
  quote: { businessName: f.qBusinessName, details: f.qDetails, terms: f.qTerms, validityDays: f.qValidityDays, gstNote: f.qGstNote },
  doors: { singleMm: f.singleMm, doubleMm: f.doubleMm },
  pricing: { show: f.show, currency: f.currency, fixed: f.fixed, doorSingle: f.doorSingle, doorDouble: f.doorDouble, rangePct: f.rangePct, roundTo: f.roundTo, note: f.note },
  presets: f.presets.map((p) => ({ id: p.id, name: p.name, widthMm: p.widthMm, depthMm: p.depthMm, heightMm: p.heightMm, doorStyle: p.doorStyle })),
});

// The label names the field; the hint is attached separately (aria-describedby) so a screen reader hears "Unit width" then the hint, not one long label.
function Field({ label, hint, tip, children }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium" style={{ color: 'var(--color-text)' }}>{label}</label>
      <Tooltip text={tip}>{cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) })}</Tooltip>
      {hint && <span id={`${id}-hint`} className="block text-xs" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
    </div>
  );
}

export default function CellarLiteSettings({ onDirtyChange }) {
  const [form, setForm] = useState(null);
  // what is stored right now, as text: the form differs from it exactly when there are unsaved changes
  const [stored, setStored] = useState('');
  const [defaults, setDefaults] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [warnings, setWarnings] = useState([]);
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [exampleUnits, setExampleUnits] = useState('12');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get('/api/admin/cellar-lite/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the settings.');
      setForm(toForm(data.config));
      setStored(JSON.stringify(toForm(data.config)));
      setDefaults(data.defaults);
      setWarnings(data.warnings || []);
    } catch (e) {
      setLoadError(e.message || 'Could not load the settings.');
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setSaved(false); setErrors([]); };
  const setPreset = (i, key, value) => { setForm((f) => ({ ...f, presets: f.presets.map((p, j) => (j === i ? { ...p, [key]: value } : p)) })); setSaved(false); setErrors([]); };
  const addPreset = () => { setForm((f) => ({ ...f, presets: [...f.presets, { id: '', name: '', widthMm: '2500', depthMm: '2000', heightMm: '2400', doorStyle: 'SINGLE' }] })); setSaved(false); };
  const setType = (i, key, value) => { setForm((f) => ({ ...f, rackTypes: f.rackTypes.map((r, j) => (j === i ? { ...r, [key]: value } : r)) })); setSaved(false); setErrors([]); };
  const addType = () => { setForm((f) => ({ ...f, rackTypes: [...f.rackTypes, typeToForm({ id: '', name: '', orientation: 'NECK_OUT', confirmed: false, unitWidthMm: 600, unitHeightMm: 2000 })] })); setSaved(false); };
  const removeType = (i) => { setForm((f) => { const next = f.rackTypes.filter((_, j) => j !== i); const gone = f.rackTypes[i]; return { ...f, rackTypes: next, defaultRackType: gone.id === f.defaultRackType ? (next[0]?.id ?? '') : f.defaultRackType }; }); setSaved(false); };
  const removePreset = (i) => { setForm((f) => ({ ...f, presets: f.presets.filter((_, j) => j !== i) })); setSaved(false); };

  // the same arithmetic the public tool does, so the owner can see what a visitor would be shown
  const example = useMemo(() => {
    if (!form || !form.show) return null;
    const n = (v) => (v === '' || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
    const units = Number(exampleUnits);
    const door = n(form.doorSingle);
    const perUnit = n((form.rackTypes.find((r) => r.id === form.defaultRackType) || form.rackTypes[0] || {}).pricePerUnit);
    if (!(units > 0) || (n(form.fixed) === null && perUnit === null && door === null)) return null;
    const mid = (n(form.fixed) ?? 0) + (perUnit ?? 0) * units + (door ?? 0);
    const step = Number(form.roundTo) || 100, spread = (Number(form.rangePct) || 0) / 100;
    const round = (x) => Math.round(x / step) * step;
    const lo = Math.max(0, round(mid * (1 - spread))), hi = Math.max(lo, round(mid * (1 + spread)));
    const fmt = (x) => `${form.currency}${x.toLocaleString('en-AU')}`;
    return lo === hi ? `about ${fmt(lo)}` : `${fmt(lo)} to ${fmt(hi)}`;
  }, [form, exampleUnits]);

  const dirty = form !== null && JSON.stringify(form) !== stored;
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  // closing or reloading the browser tab with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    setSaving(true); setErrors([]); setSaved(false);
    try {
      const res = await api.put('/api/admin/cellar-lite/config', { config: toConfig(form) });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors?.length ? data.errors : [data.error || 'Could not save.']); return; }
      setForm(toForm(data.config)); setStored(JSON.stringify(toForm(data.config))); setWarnings([]); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErrors([e.message || 'Could not save.']);
    } finally {
      setSaving(false);
    }
  }
  async function reset() {
    setConfirmReset(false); setErrors([]);
    try {
      const res = await api.delete('/api/admin/cellar-lite/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not reset.');
      setForm(toForm(data.config)); setStored(JSON.stringify(toForm(data.config))); setWarnings([]); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErrors([e.message || 'Could not reset.']);
    }
  }

  if (loadError) {
    return (
      <section className={CARD} style={CARD_STYLE}>
        <p className="text-sm" style={{ color: '#ef4444' }}>{loadError}</p>
        <Tooltip text="Ask Vault for the settings again."><button onClick={load} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Try again</button></Tooltip>
      </section>
    );
  }
  if (!form) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  const numInput = (key, props = {}) => (
    <input type="text" inputMode="decimal" value={form[key]} onChange={(e) => set(key, e.target.value)} className={INPUT} style={FIELD_STYLE} {...props} />
  );

  return (
    <div className="space-y-6" data-testid="cellar-lite-settings">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>Cellar Planner (public tool)</h2>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          These numbers control the public planner on your website. Changes show to visitors within a minute of saving. If this page can't be reached, the planner uses its built-in values, so it never goes blank.{' '}
          <Tooltip text="Opens the public planner as Vault hosts it, in a new tab. It reads the settings you have saved, so you can see the effect of a change."><a href="/cellar-lite/" target="_blank" rel="noreferrer" className="underline hover:opacity-70 transition-opacity">Preview the planner</a></Tooltip>
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border px-3 py-2 text-xs space-y-1" style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>
          <p className="font-medium">Some saved values were not valid and are showing their standard values instead. Save to fix them:</p>
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <section className={CARD} style={CARD_STYLE} data-testid="cellar-lite-racktypes">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Rack types</h3>
          {form.rackTypes.length < MAX_RACK_TYPES && (
            <Tooltip text="Add another kind of rack to the catalogue (up to eight)."><button onClick={addType} className="text-xs px-3 py-1 rounded-lg border font-medium hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }} data-testid="cellar-lite-add-racktype">+ Add a rack type</button></Tooltip>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          The catalogue of racks you sell. The <strong>default</strong> type is what the public planner builds its estimates from (width, height and price per unit). Staff pick a type per design in the Cellar Planner. Leave a box blank if you don't know the value: it shows as "not set" and is never counted as zero. Tick <strong>Confirmed by supplier</strong> only when the numbers are the supplier's real values; until then the staff planner marks them as estimated.
        </p>
        <div className="space-y-3">
          {form.rackTypes.map((r, i) => (
            <div key={i} className="rounded-xl border p-4 space-y-3" style={{ borderColor: r.id === form.defaultRackType ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }} data-testid="cellar-lite-racktype">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Name" tip="What this rack is called, for example Standard 600 or Wide display. Up to 40 characters."><input type="text" value={r.name} maxLength={40} onChange={(e) => setType(i, 'name', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Bottle orientation" tip="How the bottles lie. Neck-out needs the bottle's length plus 15 mm of depth; label-forward shows the labels but holds fewer bottles per row.">
                  <select value={r.orientation} onChange={(e) => setType(i, 'orientation', e.target.value)} className={INPUT} style={FIELD_STYLE}>
                    {ORIENTATION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                <Field label="Unit width (mm)" tip="How wide one rack unit is along the wall. A wider unit holds more bottles per row but fewer fit along a wall." hint="400 to 1200."><input type="text" inputMode="numeric" value={r.unitWidthMm} onChange={(e) => setType(i, 'unitWidthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Unit height (mm)" tip="How tall one rack unit is. A taller unit holds more rows. A unit is never taller than the room." hint="1000 to 3000."><input type="text" inputMode="numeric" value={r.unitHeightMm} onChange={(e) => setType(i, 'unitHeightMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Unit depth (mm)" tip="How far one rack unit stands out from the wall. Blank means not set." hint="150 to 1000, or blank."><input type="text" inputMode="numeric" value={r.unitDepthMm} onChange={(e) => setType(i, 'unitDepthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Row pitch (mm)" tip="The vertical distance from one row of bottles to the next. Blank means not set." hint="60 to 300, or blank."><input type="text" inputMode="numeric" value={r.rowPitchMm} onChange={(e) => setType(i, 'rowPitchMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Posts per unit" tip="How many posts one unit has, for the parts list. It does not change the bottle count. Blank means not set." hint="1 to 6, or blank."><input type="text" inputMode="numeric" value={r.postsPerUnit} onChange={(e) => setType(i, 'postsPerUnit', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Rows per unit" tip="How many rows of bottles one unit holds. Blank means it is worked out from the unit height and the row pitch." hint="1 to 60, or blank."><input type="text" inputMode="numeric" value={r.rowsPerUnit} onChange={(e) => setType(i, 'rowsPerUnit', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Bottles per row" tip="Bottles in one row of one unit, neck-out. Blank means it is worked out from the unit width and the bottle size." hint="1 to 40, or blank."><input type="text" inputMode="numeric" value={r.bottlesPerRow} onChange={(e) => setType(i, 'bottlesPerRow', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Bottles per row (labels forward)" tip="Bottles in one row when labels face forward. The supplier gives this figure; it is never worked out. Blank means not set." hint="1 to 40, or blank."><input type="text" inputMode="numeric" value={r.bottlesPerRowLabelForward} onChange={(e) => setType(i, 'bottlesPerRowLabelForward', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Price per rack unit" tip="Added once for each unit of this type in a design. Staff see it in the price breakdown; visitors see it only inside a guide price, and only if the guide price is shown. Blank means no price." hint="For each unit of this type."><input type="text" inputMode="decimal" value={r.pricePerUnit} onChange={(e) => setType(i, 'pricePerUnit', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <div className="space-y-2 pt-5">
                  <Tooltip text="Tick when these numbers are the supplier's or fabricator's real values. Until ticked, the staff planner marks this rack's values as estimated on screen and in the drawing package."><label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}><input type="checkbox" checked={r.confirmed} onChange={(e) => setType(i, 'confirmed', e.target.checked)} />Confirmed by supplier</label></Tooltip>
                  <Tooltip text="Make this the default type: the public planner builds its estimates from it, and new designs in the staff planner start with it."><label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}><input type="radio" name="cellar-default-racktype" checked={(r.id || slugOf(r.name)) === form.defaultRackType} disabled={!r.id && !r.name.trim()} onChange={() => set('defaultRackType', r.id || slugOf(r.name))} />Default type</label></Tooltip>
                </div>
              </div>
              {form.rackTypes.length > 1 && <Tooltip text="Remove this rack type. It stays until you press Save."><button onClick={() => removeType(i)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Remove this rack type</button></Tooltip>}
            </div>
          ))}
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Doors</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Single door width (mm)" tip="The opening width used when a visitor chooses a single door. It takes this much wall, so racks are placed around it." hint="700 to 1300. Standard is 970.">{numInput('singleMm')}</Field>
          <Field label="Double door width (mm)" tip="The total opening width used when a visitor chooses a pair of doors. It takes more wall than a single door." hint="1200 to 2400. Standard is 1500.">{numInput('doubleMm')}</Field>
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Guide price</h3>
          <Tooltip text={form.show ? 'Visitors currently see the guide price. Click to hide it. Hidden prices are never sent from Vault.' : 'The guide price is hidden from visitors. Click to show it (enter at least one amount, then press Save).'}>
          <button
            onClick={() => set('show', !form.show)}
            className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
            style={{ borderColor: form.show ? 'var(--color-primary)' : 'var(--color-border)', color: form.show ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
            aria-pressed={form.show}
          >
            {form.show ? 'Showing to visitors' : 'Hidden'}
          </button>
          </Tooltip>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Price = fixed amount + (the default rack type's price per unit × number of units) + the door price. Visitors see a range around it. Leave any amount blank if it doesn't apply. While this is hidden, none of these amounts leave Vault.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fixed amount" tip="An amount added to every guide price, for things every job has whatever its size. Leave blank if it doesn't apply." hint="Anything charged on every job (design, delivery, glass…).">{numInput('fixed')}</Field>
          <Field label="Single door price" tip="Added when the visitor chooses a single door. Leave blank if it doesn't apply.">{numInput('doorSingle')}</Field>
          <Field label="Double door price" tip="Added when the visitor chooses a double door. Leave blank if it doesn't apply.">{numInput('doorDouble')}</Field>
          <Field label="Range either side (%)" tip="Visitors see a range around the total, not one figure. At 15, a $10,000 total shows $8,500 to $11,500." hint="0 to 50. At 15, a $10,000 job shows $8,500 to $11,500.">{numInput('rangePct')}</Field>
          <Field label="Round to the nearest" tip="Rounds both ends of the range to a tidy figure, so visitors see $13,100 rather than $13,087.">
            <select value={form.roundTo} onChange={(e) => set('roundTo', e.target.value)} className={INPUT} style={FIELD_STYLE}>
              {ROUND_TO.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Currency symbol" tip="The symbol shown before the prices, for example $. Up to three characters." hint="Up to three characters, for example $.">
            <input type="text" value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value)} className={INPUT} style={FIELD_STYLE} />
          </Field>
        </div>
        <Field label="Note shown beside the price" tip="A short sentence shown beside the guide price, such as that it depends on a site measure. Up to 300 characters." hint="Keep it honest: it appears next to the number.">
          <textarea value={form.note} rows={2} maxLength={300} onChange={(e) => set('note', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Check your numbers</p>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            <span>A design with</span>
            <Tooltip text="Try different sizes of cellar: type a number of rack units to see the price a visitor would get. This only previews; it changes nothing."><input type="text" inputMode="numeric" value={exampleUnits} onChange={(e) => setExampleUnits(e.target.value)} className="w-16 px-2 py-1 rounded-lg border text-sm outline-none" style={FIELD_STYLE} aria-label="Number of rack units in the example" /></Tooltip>
            <span>rack units and a single door shows:</span>
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }} data-testid="cellar-lite-price-example">
            {form.show ? (example ?? 'Nothing yet: enter at least one amount.') : 'Nothing: prices are hidden.'}
          </p>
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>On the page</h3>
        <div className="space-y-1">
          <label htmlFor="cellar-accent-text" className="block text-xs font-medium" style={{ color: 'var(--color-text)' }}>Brand colour</label>
          <div className="flex items-center gap-2">
            <Tooltip text="Click to pick the brand colour with a colour chooser.">
              <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(form.accent) ? form.accent : '#4a5a2a'} onChange={(e) => set('accent', e.target.value)} aria-label="Pick the brand colour" className="h-10 w-14 rounded-lg border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
            </Tooltip>
            <Tooltip text="The colour of the planner's buttons, selected options and highlights, so it matches your website. It must be dark enough for white text to be readable on it. Type a hex code such as #4a5a2a.">
              <input id="cellar-accent-text" type="text" value={form.accent} maxLength={7} onChange={(e) => set('accent', e.target.value)} aria-describedby="cellar-accent-hint" className={INPUT} style={FIELD_STYLE} />
            </Tooltip>
          </div>
          <span id="cellar-accent-hint" className="block text-xs" style={{ color: 'var(--color-muted)' }}>For example #4a5a2a (olive green). Pick one, or type a hex code. White text must stay readable on it.</span>
        </div>
        <Field label="Phone number" tip="Shows a Call us button on the planner. On a phone, tapping it dials this number. Leave blank to hide the button." hint="For example: 03 9123 4567. Leave blank to show no call button.">
          <input type="text" inputMode="tel" value={form.phone} maxLength={24} onChange={(e) => set('phone', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
        <Field label="After a visitor asks for a quote" tip="A reassuring line shown once they press Request a quote, such as when you will reply. Leave blank to show nothing." hint="For example: We usually reply within one business day.">
          <textarea value={form.quoteNote} rows={2} maxLength={200} onChange={(e) => set('quoteNote', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
        <Field label="Line under the heading" tip="A short line shown under the planner's heading. Good for saying it's free and quick. Leave blank to show nothing." hint="Say it's free and quick. Leave blank to show nothing.">
          <textarea value={form.promise} rows={2} maxLength={200} onChange={(e) => set('promise', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
      </section>

      <section className={CARD} style={CARD_STYLE} data-testid="cellar-lite-cooling">
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Cooling estimate assumptions</h3>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          The staff Cellar Planner estimates how much cooling a cellar needs: heat through every wall, the ceiling, floor and door (U-value × area × temperature difference), plus lights, people and stock, plus a safety margin. These are the assumptions behind it, shown to staff in the working. It is a guide for choosing a conditioner, never a design: an HVAC engineer still signs off. Staff can set the two temperatures per design. The standard values below are typical; change them to match your supplier's data.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Insulation conductivity (W/m·K)" tip="How well the wall and ceiling insulation conducts heat. The wall's U-value is this divided by its thickness in metres. Polyurethane foam panels are about 0.025; use your panel supplier's figure." hint="0.01 to 0.1. Standard is 0.025.">{numInput('clK')}</Field>
          <Field label="Glass U-value (W/m²·K)" tip="How much heat glass and glazed doors let through. The guide the advisory notes quote asks for about 1.4 (4 mm glass, 16 mm argon, 4 mm glass). Use your glazier's figure." hint="0.5 to 6. Standard is 1.4.">{numInput('clGlass')}</Field>
          <Field label="Uninsulated floor U-value (W/m²·K)" tip="Used only for a floor with no build-up entered, which is treated as a bare slab. A lower number means better insulated." hint="0.1 to 6. Standard is 1.">{numInput('clFloor')}</Field>
          <Field label="Lights, people and stock (W)" tip="Heat added inside the cellar by lighting, people and new bottles, in watts. LED lighting adds little." hint="0 to 5000. Standard is 100.">{numInput('clGains')}</Field>
          <Field label="Safety margin (%)" tip="Added on top of the total to cover door openings and uncertainty." hint="0 to 100. Standard is 20.">{numInput('clMargin')}</Field>
          <Field label="Target temperature (°C)" tip="The temperature the cellar is held at. Wine is usually kept at 12 to 15 °C. Staff can change it per design." hint="0 to 25. Standard is 14.">{numInput('clTarget')}</Field>
          <Field label="Outside design temperature (°C)" tip="The hottest day to design for, where the cellar is. Staff can change it per design." hint="15 to 50. Standard is 35.">{numInput('clAmbient')}</Field>
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE} data-testid="cellar-lite-quote">
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Quote details</h3>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Used on the customer quote PDF that staff make in the Cellar Planner. Visitors to the public planner never see these. A quote can't be made until the business name is filled in.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Business name" tip="Who the quote is from, printed large at the top of the quote. Required before a quote can be made." hint="Up to 80 characters."><input type="text" value={form.qBusinessName} maxLength={80} onChange={(e) => set('qBusinessName', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
          <Field label="Quote valid for (days)" tip="How long a quote stays valid. The quote shows the date it is valid until, counted from the quote date." hint="1 to 365. Standard is 30."><input type="text" inputMode="numeric" value={form.qValidityDays} onChange={(e) => set('qValidityDays', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
        </div>
        <Field label="Address and contact lines" tip="Printed under the business name: your address, phone, email and ABN, one per line (up to six lines are shown)." hint="One item per line, such as the address, phone and ABN.">
          <textarea value={form.qDetails} rows={4} maxLength={300} onChange={(e) => set('qDetails', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
        <Field label="GST note" tip="A short line printed under the total, for example All prices include GST. Leave blank to print nothing." hint="For example: All prices include GST."><input type="text" value={form.qGstNote} maxLength={120} onChange={(e) => set('qGstNote', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
        <Field label="Terms" tip="Your terms and conditions, printed on every quote under the price: deposit, payment, warranty and so on. Leave blank to print none." hint="Up to 1200 characters. Line breaks are kept.">
          <textarea value={form.qTerms} rows={6} maxLength={1200} onChange={(e) => set('qTerms', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Starting rooms</h3>
          {form.presets.length < MAX_PRESETS && (
            <Tooltip text="Add another one-tap starting room for visitors (up to six)."><button onClick={addPreset} className="text-xs px-3 py-1 rounded-lg border font-medium hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Add a room</button></Tooltip>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>One-tap rooms for visitors who don't know their measurements yet. Inside sizes in mm: width 1000–8000, depth 1000–8000, height 1800–3200. Remove them all to hide the buttons.</p>
        {form.presets.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No starting rooms: visitors see only the size boxes.</p>}
        <div className="space-y-3">
          {form.presets.map((p, i) => (
            <div key={i} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Name" tip="The label on the button visitors press, for example Walk-in cellar. Up to 40 characters."><input type="text" value={p.name} maxLength={40} onChange={(e) => setPreset(i, 'name', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Door" tip="Whether this starting room begins with a single door or a pair.">
                  <select value={p.doorStyle} onChange={(e) => setPreset(i, 'doorStyle', e.target.value)} className={INPUT} style={FIELD_STYLE}>
                    <option value="SINGLE">Single</option><option value="DOUBLE">Double</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 grid-cols-3">
                <Field label="Width" tip="Inside width of this starting room in mm, wall to wall. Between 1000 and 8000."><input type="text" inputMode="numeric" value={p.widthMm} onChange={(e) => setPreset(i, 'widthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Depth" tip="Inside depth of this starting room in mm, front to back. Between 1000 and 8000."><input type="text" inputMode="numeric" value={p.depthMm} onChange={(e) => setPreset(i, 'depthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Height" tip="Inside height of this starting room in mm, floor to ceiling. Between 1800 and 3200."><input type="text" inputMode="numeric" value={p.heightMm} onChange={(e) => setPreset(i, 'heightMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
              </div>
              <Tooltip text="Remove this starting room. It stays until you press Save."><button onClick={() => removePreset(i)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Remove this room</button></Tooltip>
            </div>
          ))}
        </div>
      </section>

      {errors.length > 0 && (
        <div className="rounded-xl border px-3 py-2 text-xs space-y-1" role="alert" style={{ borderColor: '#ef4444', color: '#ef4444' }} data-testid="cellar-lite-errors">
          <p className="font-medium">Not saved. Please fix:</p>
          {errors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Tooltip text={dirty ? 'Store your changes. Visitors see them within a minute of saving.' : 'Nothing to save: everything shown here is already stored.'}>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: saved ? '#22c55e' : 'var(--color-primary)' }}
          data-testid="cellar-lite-save"
        >
          {saved && !dirty ? 'Saved ✓' : saving ? 'Saving…' : dirty ? 'Save changes' : 'Save'}
        </button>
        </Tooltip>
        {dirty && <span className="text-xs font-medium" style={{ color: '#f59e0b' }} role="status" data-testid="cellar-lite-unsaved">You have unsaved changes. Visitors won't see them until you save.</span>}
        {!confirmReset ? (
          <Tooltip text="Put every setting on this page back to the standard values and remove your saved copy."><button onClick={() => setConfirmReset(true)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>Reset everything to the standard values</button></Tooltip>
        ) : (
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
            Reset all of these? <Tooltip text="Yes, reset everything now."><button onClick={reset} className="font-semibold hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button></Tooltip>{' / '}
            <Tooltip text="No, keep my settings."><button onClick={() => setConfirmReset(false)} className="hover:opacity-70 transition-opacity">No</button></Tooltip>
          </span>
        )}
      </div>
    </div>
  );
}
