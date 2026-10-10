import React, { cloneElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../utils/apiClient';
import Tooltip from './Tooltip';

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
  quoteNote: c.quoteNote ?? '',
  phone: c.phone ?? '',
  accent: c.accent ?? '#4a5a2a',
  photoOn: !!c.photo?.enabled, photoDaily: String(c.photo?.dailyLimit ?? 30), photoPerVisitor: String(c.photo?.perVisitorPerHour ?? 3),
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
  quoteNote: f.quoteNote,
  phone: f.phone,
  accent: f.accent,
  photo: { enabled: f.photoOn, dailyLimit: f.photoDaily, perVisitorPerHour: f.photoPerVisitor },
  rack: { unitWidthMm: f.unitWidthMm, unitHeightMm: f.unitHeightMm },
  doors: { singleMm: f.singleMm, doubleMm: f.doubleMm },
  pricing: { show: f.show, currency: f.currency, fixed: f.fixed, perUnit: f.perUnit, doorSingle: f.doorSingle, doorDouble: f.doorDouble, rangePct: f.rangePct, roundTo: f.roundTo, note: f.note },
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
  const [usage, setUsage] = useState({ photosToday: 0, photoReady: false });

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const res = await api.get('/api/admin/cellar-lite/config');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load the settings.');
      setForm(toForm(data.config));
      setStored(JSON.stringify(toForm(data.config)));
      setDefaults(data.defaults);
      if (data.usage) setUsage(data.usage);
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

      <section className={CARD} style={CARD_STYLE}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Rack units</h3>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Every estimate is built from whole rack units of this size. A wider unit holds more bottles per row; a taller one holds more rows. The unit is never taller than the room it stands in.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Unit width (mm)" tip="How wide one standard rack unit is. Visitors' estimates are built from whole units this wide, so a wider unit holds more bottles per row but fewer fit along a wall." hint="400 to 1200. Standard is 600.">{numInput('unitWidthMm')}</Field>
          <Field label="Unit height (mm)" tip="How tall one rack unit is. A taller unit holds more rows of bottles. A unit is never taller than the visitor's room." hint="1000 to 3000. Standard is 2000.">{numInput('unitHeightMm')}</Field>
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
          Price = fixed amount + (price per rack unit × number of units) + the door price. Visitors see a range around it. Leave any amount blank if it doesn't apply. While this is hidden, none of these amounts leave Vault.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fixed amount" tip="An amount added to every guide price, for things every job has whatever its size. Leave blank if it doesn't apply." hint="Anything charged on every job (design, delivery, glass…).">{numInput('fixed')}</Field>
          <Field label="Price per rack unit" tip="Added once for each whole rack unit in the visitor's design, so bigger cellars cost more. Leave blank if it doesn't apply." hint="For each whole rack unit in the design.">{numInput('perUnit')}</Field>
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

      <section className={CARD} style={CARD_STYLE}>
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold flex-1" style={{ color: 'var(--color-text)' }}>Photo view (AI)</h3>
          <Tooltip text={form.photoOn ? 'The Photo tab is showing to visitors. Click to switch it off. Nothing is spent while it is off.' : 'The Photo tab is hidden and nothing is spent. Click to show it to visitors (then press Save).'}>
            <button
              onClick={() => set('photoOn', !form.photoOn)}
              className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
              style={{ borderColor: form.photoOn ? 'var(--color-primary)' : 'var(--color-border)', color: form.photoOn ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
              aria-pressed={form.photoOn}
              data-testid="cellar-lite-photo-toggle"
            >
              {form.photoOn ? 'Showing to visitors' : 'Off'}
            </button>
          </Tooltip>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Adds a <strong>Photo</strong> button beside 3D, Plan and Racks. When a visitor presses <em>Create my photo</em>, an AI image service turns their 3D picture into a realistic-looking photo. Each new photo costs a few cents; the same design is made once and then remembered. It is labelled as an artist's impression.
        </p>
        {!usage.photoReady && <p className="text-xs" style={{ color: '#f59e0b' }} role="status" data-testid="cellar-lite-photo-key">The server has no image-service key (FAL_API_KEY), so photos cannot be made yet. Add it in Railway first.</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Most new photos per day" tip="The total number of new photos all visitors together can make each day (UTC). When it is used up, visitors are asked to try tomorrow. Set 0 to pause new photos. Repeats of a photo already made are free and don't count." hint="0 to 500. Resets each day (UTC).">{numInput('photoDaily')}</Field>
          <Field label="Most photos per visitor per hour" tip="How many new photos one visitor (by network address) can make in an hour, so one person can't run up the cost." hint="1 to 30.">{numInput('photoPerVisitor')}</Field>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-text)' }} data-testid="cellar-lite-photo-usage">New photos made today: <strong>{usage.photosToday}</strong> of {form.photoDaily || '—'}.</p>
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
