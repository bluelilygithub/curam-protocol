import React, { cloneElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../utils/apiClient';

// Settings -> Cellar Planner (admin). The owner's numbers for the PUBLIC lite planner: rack unit size, door widths, the price formula, a line of
// text and the starting rooms. Saved to Vault (workspace_settings); the public tool fetches them when it opens. Rules live on the server
// (server/config/cellarLiteConfig.js), which also sends back plain-language reasons when a value is refused. Docs: docs/cellar-planner.md.

const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const INPUT = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-all';
const CARD = 'rounded-2xl border p-6 space-y-4';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const ROUND_TO = [1, 10, 50, 100, 500, 1000];
const MAX_PRESETS = 6;

const toForm = (c) => ({
  promise: c.promise ?? '',
  unitWidthMm: String(c.rack.unitWidthMm), unitHeightMm: String(c.rack.unitHeightMm),
  singleMm: String(c.doors.singleMm), doubleMm: String(c.doors.doubleMm),
  show: !!c.pricing.show, currency: c.pricing.currency ?? '$',
  fixed: c.pricing.fixed ?? '', perUnit: c.pricing.perUnit ?? '', doorSingle: c.pricing.doorSingle ?? '', doorDouble: c.pricing.doorDouble ?? '',
  rangePct: String(c.pricing.rangePct), roundTo: String(c.pricing.roundTo), note: c.pricing.note ?? '',
  presets: (c.presets || []).map((p) => ({ id: p.id, name: p.name, widthMm: String(p.widthMm), depthMm: String(p.depthMm), heightMm: String(p.heightMm), doorStyle: p.doorStyle })),
});
const toConfig = (f) => ({
  version: 1,
  promise: f.promise,
  rack: { unitWidthMm: f.unitWidthMm, unitHeightMm: f.unitHeightMm },
  doors: { singleMm: f.singleMm, doubleMm: f.doubleMm },
  pricing: { show: f.show, currency: f.currency, fixed: f.fixed, perUnit: f.perUnit, doorSingle: f.doorSingle, doorDouble: f.doorDouble, rangePct: f.rangePct, roundTo: f.roundTo, note: f.note },
  presets: f.presets.map((p) => ({ id: p.id, name: p.name, widthMm: p.widthMm, depthMm: p.depthMm, heightMm: p.heightMm, doorStyle: p.doorStyle })),
});

// The label names the field; the hint is attached separately (aria-describedby) so a screen reader hears "Unit width" then the hint, not one long label.
function Field({ label, hint, children }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium" style={{ color: 'var(--color-text)' }}>{label}</label>
      {cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) })}
      {hint && <span id={`${id}-hint`} className="block text-xs" style={{ color: 'var(--color-muted)' }}>{hint}</span>}
    </div>
  );
}

export default function CellarLiteSettings() {
  const [form, setForm] = useState(null);
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
  const removePreset = (i) => { setForm((f) => ({ ...f, presets: f.presets.filter((_, j) => j !== i) })); setSaved(false); };

  // the same arithmetic the public tool does, so the owner can see what a visitor would be shown
  const example = useMemo(() => {
    if (!form || !form.show) return null;
    const n = (v) => (v === '' || v === null || !Number.isFinite(Number(v)) ? null : Number(v));
    const units = Number(exampleUnits);
    const door = n(form.doorSingle);
    if (!(units > 0) || (n(form.fixed) === null && n(form.perUnit) === null && door === null)) return null;
    const mid = (n(form.fixed) ?? 0) + (n(form.perUnit) ?? 0) * units + (door ?? 0);
    const step = Number(form.roundTo) || 100, spread = (Number(form.rangePct) || 0) / 100;
    const round = (x) => Math.round(x / step) * step;
    const lo = Math.max(0, round(mid * (1 - spread))), hi = Math.max(lo, round(mid * (1 + spread)));
    const fmt = (x) => `${form.currency}${x.toLocaleString('en-AU')}`;
    return lo === hi ? `about ${fmt(lo)}` : `${fmt(lo)} to ${fmt(hi)}`;
  }, [form, exampleUnits]);

  async function save() {
    setSaving(true); setErrors([]); setSaved(false);
    try {
      const res = await api.put('/api/admin/cellar-lite/config', { config: toConfig(form) });
      const data = await res.json();
      if (!res.ok) { setErrors(data.errors?.length ? data.errors : [data.error || 'Could not save.']); return; }
      setForm(toForm(data.config)); setWarnings([]); setSaved(true);
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
      setForm(toForm(data.config)); setWarnings([]); setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErrors([e.message || 'Could not reset.']);
    }
  }

  if (loadError) {
    return (
      <section className={CARD} style={CARD_STYLE}>
        <p className="text-sm" style={{ color: '#ef4444' }}>{loadError}</p>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Try again</button>
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
          <a href="/cellar-lite/" target="_blank" rel="noreferrer" className="underline hover:opacity-70 transition-opacity">Preview the planner</a>
        </p>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border px-3 py-2 text-xs space-y-1" style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>
          <p className="font-medium">Some saved values were not valid and are showing their standard values instead. Save to fix them:</p>
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <section className={CARD} style={CARD_STYLE}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Rack units</h3>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Every estimate is built from whole rack units of this size. A wider unit holds more bottles per row; a taller one holds more rows. The unit is never taller than the room it stands in.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unit width (mm)" hint="400 to 1200. Standard is 600.">{numInput('unitWidthMm')}</Field>
          <Field label="Unit height (mm)" hint="1000 to 3000. Standard is 2000.">{numInput('unitHeightMm')}</Field>
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Doors</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Single door width (mm)" hint="700 to 1300. Standard is 970.">{numInput('singleMm')}</Field>
          <Field label="Double door width (mm)" hint="1200 to 2400. Standard is 1500.">{numInput('doubleMm')}</Field>
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Guide price</h3>
          <button
            onClick={() => set('show', !form.show)}
            className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
            style={{ borderColor: form.show ? 'var(--color-primary)' : 'var(--color-border)', color: form.show ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
            aria-pressed={form.show}
          >
            {form.show ? 'Showing to visitors' : 'Hidden'}
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Price = fixed amount + (price per rack unit × number of units) + the door price. Visitors see a range around it. Leave any amount blank if it doesn't apply. While this is hidden, none of these amounts leave Vault.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fixed amount" hint="Anything charged on every job (design, delivery, glass…).">{numInput('fixed')}</Field>
          <Field label="Price per rack unit" hint="For each whole rack unit in the design.">{numInput('perUnit')}</Field>
          <Field label="Single door price">{numInput('doorSingle')}</Field>
          <Field label="Double door price">{numInput('doorDouble')}</Field>
          <Field label="Range either side (%)" hint="0 to 50. At 15, a $10,000 job shows $8,500 to $11,500.">{numInput('rangePct')}</Field>
          <Field label="Round to the nearest">
            <select value={form.roundTo} onChange={(e) => set('roundTo', e.target.value)} className={INPUT} style={FIELD_STYLE}>
              {ROUND_TO.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          <Field label="Currency symbol" hint="Up to three characters, for example $.">
            <input type="text" value={form.currency} maxLength={3} onChange={(e) => set('currency', e.target.value)} className={INPUT} style={FIELD_STYLE} />
          </Field>
        </div>
        <Field label="Note shown beside the price" hint="Keep it honest: it appears next to the number.">
          <textarea value={form.note} rows={2} maxLength={300} onChange={(e) => set('note', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
        <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Check your numbers</p>
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
            <span>A design with</span>
            <input type="text" inputMode="numeric" value={exampleUnits} onChange={(e) => setExampleUnits(e.target.value)} className="w-16 px-2 py-1 rounded-lg border text-sm outline-none" style={FIELD_STYLE} aria-label="Number of rack units in the example" />
            <span>rack units and a single door shows:</span>
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }} data-testid="cellar-lite-price-example">
            {form.show ? (example ?? 'Nothing yet: enter at least one amount.') : 'Nothing: prices are hidden.'}
          </p>
        </div>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>On the page</h3>
        <Field label="Line under the heading" hint="Say it's free and quick. Leave blank to show nothing.">
          <textarea value={form.promise} rows={2} maxLength={200} onChange={(e) => set('promise', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
      </section>

      <section className={CARD} style={CARD_STYLE}>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Starting rooms</h3>
          {form.presets.length < MAX_PRESETS && (
            <button onClick={addPreset} className="text-xs px-3 py-1 rounded-lg border font-medium hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Add a room</button>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>One-tap rooms for visitors who don't know their measurements yet. Inside sizes in mm: width 1000–8000, depth 1000–8000, height 2000–3200. Remove them all to hide the buttons.</p>
        {form.presets.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No starting rooms: visitors see only the size boxes.</p>}
        <div className="space-y-3">
          {form.presets.map((p, i) => (
            <div key={i} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Name"><input type="text" value={p.name} maxLength={40} onChange={(e) => setPreset(i, 'name', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Door">
                  <select value={p.doorStyle} onChange={(e) => setPreset(i, 'doorStyle', e.target.value)} className={INPUT} style={FIELD_STYLE}>
                    <option value="SINGLE">Single</option><option value="DOUBLE">Double</option>
                  </select>
                </Field>
              </div>
              <div className="grid gap-3 grid-cols-3">
                <Field label="Width"><input type="text" inputMode="numeric" value={p.widthMm} onChange={(e) => setPreset(i, 'widthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Depth"><input type="text" inputMode="numeric" value={p.depthMm} onChange={(e) => setPreset(i, 'depthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Height"><input type="text" inputMode="numeric" value={p.heightMm} onChange={(e) => setPreset(i, 'heightMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
              </div>
              <button onClick={() => removePreset(i)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Remove this room</button>
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
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: saved ? '#22c55e' : 'var(--color-primary)' }}
          data-testid="cellar-lite-save"
        >
          {saved ? 'Saved ✓' : saving ? 'Saving…' : 'Save'}
        </button>
        {!confirmReset ? (
          <button onClick={() => setConfirmReset(true)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: 'var(--color-muted)' }}>Reset everything to the standard values</button>
        ) : (
          <span className="text-xs" style={{ color: 'var(--color-text)' }}>
            Reset all of these? <button onClick={reset} className="font-semibold hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Yes</button>{' / '}
            <button onClick={() => setConfirmReset(false)} className="hover:opacity-70 transition-opacity">No</button>
          </span>
        )}
      </div>
    </div>
  );
}
