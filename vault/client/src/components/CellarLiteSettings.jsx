import React, { cloneElement, useCallback, useEffect, useId, useMemo, useState } from 'react';
import api from '../utils/apiClient';
import Tooltip from './Tooltip';

// Cellar Planner -> Settings (admin). The owner's numbers, shared by the PUBLIC lite planner and the staff Cellar Planner: the rack types (sizes, bottle
// counts, price per unit, "confirmed by the supplier"), door widths, the price formula, a line of text and the starting rooms. Saved to Vault (workspace_settings); the public tool fetches them when it opens. Rules live on the server
// (server/config/cellarLiteConfig.js), which also sends back plain-language reasons when a value is refused. Docs: docs/cellar-planner.md.

const FIELD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' };
const INPUT = 'w-full px-3 py-2.5 rounded-xl border text-sm outline-none transition-all';
const CARD = 'rounded-2xl border p-6 space-y-4';
const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
const ROUND_TO = [1, 10, 50, 100, 500, 1000];
const MAX_PRESETS = 6;
const MAX_RACK_TYPES = 8;
const MAX_FEATURE_GROUPS = 10;
const MAX_FEATURE_OPTIONS = 8;
const FEATURE_BADGES = [['', 'No badge'], ['POPULAR', 'Popular'], ['RECOMMENDED', 'Recommended']];
const FEATURE_EFFECTS = [['NONE', 'Nothing'], ['DOOR_TIMBER', 'Timber doors at the front'], ['GLASS_DOORS', 'Glass doors at the front'], ['GLASS_FRONT', 'Full glass front'], ['LIGHT_DOWNLIGHTS', 'Ceiling downlights (glowing spots)'], ['LIGHT_RACK_LED', 'LED strips along the racks'], ['LIGHT_BACKLIT', 'Backlit racks'], ['CENTRE_BENCH', 'Tasting bench on the floor'], ['CENTRE_ISLAND', 'Island on the floor'], ['WALL_TIMBER', 'Timber-lined walls'], ['WALL_STONE', 'Stone walls'], ['FLOOR_STONE', 'Stone floor'], ['FLOOR_OAK', 'Oak floor']];
// the figures from the design mockup, by option id: offered as a one-click starting point for blank prices, never applied on their own
const EXAMPLE_FEATURE_PRICES = {
  'glass-doors': [2800, 3600], 'full-glass-front': [7500, 9800], 'in-rack-led': [1600, 2200], 'backlit-wall': [3400, 4500],
  'magnum-large-format': [900, 1300], 'champagne-bins': [700, 1000], 'label-forward-display': [1200, 1700], 'case-storage': [600, 900],
  'tasting-bench': [2900, 3900], 'island-with-drawers': [6500, 8500], 'ducted-split': [2400, 3200],
  'timber-lined': [2600, 3500], 'stone-feature-wall': [3800, 5200], 'stone-tile': [1500, 2200], 'engineered-oak': [1300, 1900],
};
const blank = (v) => (v === null || v === undefined ? '' : String(v));
const optionToForm = (o) => ({ code: o.code, id: o.id, name: o.name, description: o.description ?? '', badge: o.badge ?? '', included: !!o.included, low: blank(o.low), high: blank(o.high), minWidthMm: blank(o.minWidthMm), minDepthMm: blank(o.minDepthMm), effect: o.effect || 'NONE', enabled: o.enabled !== false });
const groupToForm = (g) => ({ id: g.id, name: g.name, hint: g.hint ?? '', mode: g.mode === 'ANY' ? 'ANY' : 'ONE', options: (g.options || []).map(optionToForm) });
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
  mnShow: c.mobileNotice?.show !== false, mnText: c.mobileNotice?.text ?? '',
  guideOn: c.guide?.enabled === true,
  qBusinessName: c.quote?.businessName ?? '', qDetails: c.quote?.details ?? '', qTerms: c.quote?.terms ?? '', qValidityDays: String(c.quote?.validityDays ?? 30), qGstNote: c.quote?.gstNote ?? '',
  singleMm: String(c.doors.singleMm), doubleMm: String(c.doors.doubleMm),
  show: !!c.pricing.show, currency: c.pricing.currency ?? '$',
  fixed: c.pricing.fixed ?? '', doorSingle: c.pricing.doorSingle ?? '', doorDouble: c.pricing.doorDouble ?? '',
  rangePct: String(c.pricing.rangePct), roundTo: String(c.pricing.roundTo), note: c.pricing.note ?? '',
  presets: (c.presets || []).map((p) => ({ id: p.id, name: p.name, widthMm: String(p.widthMm), depthMm: String(p.depthMm), heightMm: String(p.heightMm), doorStyle: p.doorStyle })),
  features: (c.features || []).map(groupToForm),
});
const toConfig = (f) => ({
  version: 1,
  promise: f.promise,
  quoteNote: f.quoteNote,
  phone: f.phone,
  accent: f.accent,
  rackTypes: f.rackTypes.map(typeToConfig), defaultRackType: f.defaultRackType,
  cooling: { panelConductivity: f.clK, glassU: f.clGlass, floorU: f.clFloor, internalGainsW: f.clGains, marginPct: f.clMargin, targetC: f.clTarget, ambientC: f.clAmbient },
  mobileNotice: { show: f.mnShow, text: f.mnText },
  guide: { enabled: f.guideOn },
  quote: { businessName: f.qBusinessName, details: f.qDetails, terms: f.qTerms, validityDays: f.qValidityDays, gstNote: f.qGstNote },
  doors: { singleMm: f.singleMm, doubleMm: f.doubleMm },
  pricing: { show: f.show, currency: f.currency, fixed: f.fixed, doorSingle: f.doorSingle, doorDouble: f.doorDouble, rangePct: f.rangePct, roundTo: f.roundTo, note: f.note },
  presets: f.presets.map((p) => ({ id: p.id, name: p.name, widthMm: p.widthMm, depthMm: p.depthMm, heightMm: p.heightMm, doorStyle: p.doorStyle })),
  features: f.features.map((g) => ({ id: g.id, name: g.name, hint: g.hint, mode: g.mode, options: g.options.map((o) => ({ code: o.code, id: o.id, name: o.name, description: o.description, badge: o.badge, included: o.included, low: o.low, high: o.high, minWidthMm: o.minWidthMm, minDepthMm: o.minDepthMm, effect: o.effect, enabled: o.enabled })) })),
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


const OPEN_KEY = 'cellar-settings:open:v1';
const PANEL_IDS = ['rack', 'features', 'doors', 'price', 'onpage', 'mobile', 'guide', 'rooms', 'quote', 'cooling'];

/** A collapsible card: the header always shows the title and a one-line summary of what is set, so nothing is hidden or easy to miss. */
function Panel({ id, title, summary, warn, open, onToggle, testid, children }) {
  const bodyId = `cellar-set-${id}`;
  return (
    <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-testid={testid}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="w-full flex items-center gap-3 px-5 py-4 text-left hover:opacity-80 transition-opacity"
        style={{ transitionDuration: '200ms' }}
        data-testid={`cellar-set-${id}-toggle`}
      >
        <span aria-hidden="true" className="inline-block text-sm transition-transform" style={{ color: 'var(--color-muted)', transform: open ? 'rotate(90deg)' : 'none', transitionDuration: '200ms' }}>▸</span>
        <span className="text-base font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>{title}</span>
        <span className="flex-1 min-w-0 truncate text-xs text-right" style={{ color: warn ? '#f59e0b' : 'var(--color-muted)' }}>{summary}</span>
      </button>
      {open && <div id={bodyId} className="px-6 pb-6 pt-4 space-y-4 border-t" style={{ borderColor: 'var(--color-border)' }}>{children}</div>}
    </section>
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

  // which cards are open is remembered in this browser (a convenience only)
  const [openIds, setOpenIds] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => PANEL_IDS.includes(x)) : []; } catch { return []; }
  });
  const rememberOpen = (ids) => { setOpenIds(ids); try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* not remembered */ } };
  const togglePanel = (id) => rememberOpen(openIds.includes(id) ? openIds.filter((x) => x !== id) : [...openIds, id]);

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
  const touch = () => { setSaved(false); setErrors([]); };
  const setGroup = (gi, key, value) => { setForm((f) => ({ ...f, features: f.features.map((g, j) => {
    if (j !== gi) return g;
    const next = { ...g, [key]: value };
    // a pick-any group has no standard option; a pick-one group needs exactly one
    if (key === 'mode') next.options = g.options.map((o, i) => ({ ...o, included: value === 'ONE' ? i === Math.max(0, g.options.findIndex((x) => x.included)) : false }));
    return next;
  }) })); touch(); };
  const setOpt = (gi, oi, key, value) => { setForm((f) => ({ ...f, features: f.features.map((g, j) => (j === gi ? { ...g, options: g.options.map((o, i) => (i === oi ? { ...o, [key]: value } : o)) } : g)) })); touch(); };
  const setStandard = (gi, oi) => { setForm((f) => ({ ...f, features: f.features.map((g, j) => (j === gi ? { ...g, options: g.options.map((o, i) => ({ ...o, included: i === oi })) } : g)) })); touch(); };
  const addGroup = () => { setForm((f) => ({ ...f, features: [...f.features, { id: '', name: '', hint: '', mode: 'ONE', options: [{ ...optionToForm({ code: '', id: '', name: '', included: true }) }] }] })); setSaved(false); };
  const removeGroup = (gi) => { setForm((f) => ({ ...f, features: f.features.filter((_, j) => j !== gi) })); setSaved(false); };
  const addOpt = (gi) => { setForm((f) => ({ ...f, features: f.features.map((g, j) => (j === gi ? { ...g, options: [...g.options, optionToForm({ code: '', id: '', name: '', included: false })] } : g)) })); setSaved(false); };
  const removeOpt = (gi, oi) => { setForm((f) => ({ ...f, features: f.features.map((g, j) => {
    if (j !== gi) return g;
    const options = g.options.filter((_, i) => i !== oi);
    if (g.mode === 'ONE' && options.length && !options.some((o) => o.included)) options[0] = { ...options[0], included: true };
    return { ...g, options };
  }) })); setSaved(false); };
  const fillExamplePrices = () => { setForm((f) => ({ ...f, features: f.features.map((g) => ({ ...g, options: g.options.map((o) => {
    const ex = EXAMPLE_FEATURE_PRICES[o.id];
    return ex && !o.included && o.low === '' && o.high === '' ? { ...o, low: String(ex[0]), high: String(ex[1]) } : o;
  }) })) })); touch(); };
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

  // one line per card, so the page reads as an overview before anything is opened
  const typeCount = form.rackTypes.length;
  const defaultType = form.rackTypes.find((r) => r.id === form.defaultRackType) || form.rackTypes[0];
  const unconfirmed = form.rackTypes.filter((r) => !r.confirmed).length;
  const optionCount = form.features.reduce((n, g) => n + g.options.length, 0);
  const rackSummary = `${typeCount} type${typeCount === 1 ? '' : 's'}${defaultType ? ` · standard: ${defaultType.name || 'unnamed'}` : ''}${unconfirmed ? ` · ${unconfirmed} not confirmed by supplier` : ''}`;
  const featureSummary = form.features.length ? `${form.features.length} group${form.features.length === 1 ? '' : 's'}, ${optionCount} option${optionCount === 1 ? '' : 's'}` : 'None: the Features step is off';
  const doorSummary = `Single ${form.singleMm} mm · double ${form.doubleMm} mm`;
  const priceSummary = form.show ? `Shown to visitors, range ± ${form.rangePct}%` : 'Hidden from visitors';
  const pageSummary = `Colour ${form.accent || 'standard'} · ${form.phone ? `call ${form.phone}` : 'no phone number'}`;
  const mobileSummary = form.mnShow ? 'Shown on phones' : 'Off';
  const guideSummary = form.guideOn ? 'On: visitors see the help button' : 'Off';
  const roomsSummary = `${form.presets.length} starting room${form.presets.length === 1 ? '' : 's'}`;
  const quoteSummary = form.qBusinessName ? `From ${form.qBusinessName}` : 'Business name not set';
  const coolingSummary = `Target ${form.clTarget} °C · outside ${form.clAmbient} °C · margin ${form.clMargin}%`;
  const warnOf = { rack: unconfirmed > 0, quote: !form.qBusinessName };
  const pp = (id, title, summary) => ({ id, title, summary, warn: !!warnOf[id], open: openIds.includes(id), onToggle: togglePanel });

  return (
    <div className="space-y-6" data-testid="cellar-lite-settings">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-muted)' }}>Cellar Planner settings</h2>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          These settings are shared by the public planner on your website and by the staff Cellar Planner. The <strong>rack types</strong> (sizes, bottle counts, price per unit, confirmed by supplier), <strong>feature options</strong> (with a low and high price each), door widths, guide price and starting rooms control the public tool: changes show to visitors within a minute of saving, and if this page can't be reached the planner uses its built-in values, so it never goes blank. Staff also use the full rack catalogue, the <strong>quote details</strong> and the <strong>cooling assumptions</strong> below (staff only: visitors never see them).{' '}
          <Tooltip text="Opens the public planner as Vault hosts it, in a new tab. It reads the settings you have saved, so you can see the effect of a change."><a href="/cellar-lite/" target="_blank" rel="noreferrer" className="underline hover:opacity-70 transition-opacity">Preview the planner</a></Tooltip>
        </p>
      </div>

      <div className="flex items-center gap-3 text-xs" data-testid="cellar-set-bar">
        <span style={{ color: 'var(--color-muted)' }}>{openIds.length} of {PANEL_IDS.length} sections open</span>
        <button type="button" onClick={() => rememberOpen([...PANEL_IDS])} className="underline underline-offset-2 hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }} data-testid="cellar-set-expand">Open all</button>
        <button type="button" onClick={() => rememberOpen([])} className="underline underline-offset-2 hover:opacity-70 transition-opacity" style={{ color: 'var(--color-primary)' }} data-testid="cellar-set-collapse">Close all</button>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border px-3 py-2 text-xs space-y-1" style={{ borderColor: '#f59e0b', color: '#f59e0b' }}>
          <p className="font-medium">Some saved values were not valid and are showing their standard values instead. Save to fix them:</p>
          {warnings.map((w) => <p key={w}>{w}</p>)}
        </div>
      )}

      <div className="pt-2" data-testid="cellar-group">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Products and prices</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>What you sell and what it costs. These feed the public planner, the staff planner and the quote.</p>
      </div>

      <Panel {...pp('rack', 'Rack types', rackSummary)} testid="cellar-lite-racktypes">
        <div className="flex items-center gap-3">
          <span className="flex-1" />
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
      </Panel>

      <Panel {...pp('features', 'Feature options', featureSummary)} testid="cellar-lite-features">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex-1" />
          <Tooltip text="Fill in the low and high price of any option that has none, with the figures from the design mockup (for example $2,800 to $3,600 for frameless glass doors). Options you have already priced are left alone. They are examples to adjust, and nothing is saved until you press Save."><button onClick={fillExamplePrices} className="text-xs px-3 py-1 rounded-lg border font-medium hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }} data-testid="cellar-lite-features-examples">Fill example prices</button></Tooltip>
          {form.features.length < MAX_FEATURE_GROUPS && (
            <Tooltip text="Add another group of choices, such as Lighting or Flooring (up to ten groups)."><button onClick={addGroup} className="text-xs px-3 py-1 rounded-lg border font-medium hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }} data-testid="cellar-lite-add-featuregroup">+ Add a group</button></Tooltip>
          )}
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          The finishing touches in the public planner's <strong>Make it yours</strong> step, and in the staff planner's <strong>Features</strong> panel. Each option has a <strong>low</strong> and a <strong>high</strong> price. The public guide price adds every chosen option's low to the bottom of the range and its high to the top. A staff quote uses one amount per option: halfway between the two unless staff type another for that design. In a <strong>pick one</strong> group exactly one option is the standard (<strong>Included</strong>, costs nothing extra); a <strong>pick any</strong> group has no standard. Leave a price blank if you don't know it: it shows as "price on request" and a quote can't be made with that option chosen until it has a price. Remove every group to switch the Features step off.
        </p>
        {form.features.length === 0 && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No feature groups: the public planner has no Features step.</p>}
        <div className="space-y-4">
          {form.features.map((g, gi) => (
            <div key={gi} className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} data-testid="cellar-lite-featuregroup">
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <Field label="Group name" tip="The heading of this group of choices, for example Lighting. Up to 40 characters."><input type="text" value={g.name} maxLength={40} onChange={(e) => setGroup(gi, 'name', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                <Field label="Visitors" tip="Pick one: the visitor chooses one option, and the standard one is already chosen. Pick any: the visitor can add as many options as they like.">
                  <select value={g.mode} onChange={(e) => setGroup(gi, 'mode', e.target.value)} className={INPUT} style={FIELD_STYLE}>
                    <option value="ONE">Pick one</option><option value="ANY">Pick any</option>
                  </select>
                </Field>
              </div>
              <Field label="Line under the heading" tip="A short sentence under the group's name, up to 160 characters. Leave blank to show nothing."><input type="text" value={g.hint} maxLength={160} onChange={(e) => setGroup(gi, 'hint', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
              <div className="space-y-3">
                {g.options.map((o, oi) => (
                  <div key={oi} className="rounded-lg border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }} data-testid="cellar-lite-featureoption">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Option name" tip="What the choice is called, for example Frameless glass doors. Up to 40 characters."><input type="text" value={o.name} maxLength={40} onChange={(e) => setOpt(gi, oi, 'name', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                      <Field label="Short description" tip="One line under the name. Up to 120 characters."><input type="text" value={o.description} maxLength={120} onChange={(e) => setOpt(gi, oi, 'description', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                    </div>
                    <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                      <Field label="Low price" tip="The least this option is likely to cost. Added to the bottom of the guide price range. Blank means no price (price on request). The standard (included) option adds nothing, whatever is typed here." hint={o.included ? 'Not used: included.' : ''}><input type="text" inputMode="decimal" value={o.low} disabled={o.included} onChange={(e) => setOpt(gi, oi, 'low', e.target.value)} className={INPUT} style={FIELD_STYLE} data-testid="cellar-lite-feature-low" /></Field>
                      <Field label="High price" tip="The most this option is likely to cost. Added to the top of the guide price range. Staff quotes use halfway between low and high unless they type an amount. Leave blank to use the low price only." hint={o.included ? 'Not used: included.' : ''}><input type="text" inputMode="decimal" value={o.high} disabled={o.included} onChange={(e) => setOpt(gi, oi, 'high', e.target.value)} className={INPUT} style={FIELD_STYLE} data-testid="cellar-lite-feature-high" /></Field>
                      <Field label="Smallest room width (mm)" tip="The option is greyed out, with a reason, when the visitor's room is narrower than this. Blank means any width." hint="1000 to 8000, or blank."><input type="text" inputMode="numeric" value={o.minWidthMm} onChange={(e) => setOpt(gi, oi, 'minWidthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} /></Field>
                      <Field label="Smallest room depth (mm)" tip="The option is greyed out, with a reason, when the visitor's room is shallower than this. Blank means any depth." hint="1000 to 8000, or blank."><input type="text" inputMode="numeric" value={o.minDepthMm} onChange={(e) => setOpt(gi, oi, 'minDepthMm', e.target.value)} className={INPUT} style={FIELD_STYLE} data-testid="cellar-lite-feature-mindepth" /></Field>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Badge" tip="A small label on the option card to draw the eye.">
                        <select value={o.badge} onChange={(e) => setOpt(gi, oi, 'badge', e.target.value)} className={INPUT} style={FIELD_STYLE}>
                          {FEATURE_BADGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </Field>
                      <Field label="Changes the 3D picture" tip="What choosing this option does to the 3D picture a visitor sees. Everything else about an option is text and price only.">
                        <select value={o.effect} onChange={(e) => setOpt(gi, oi, 'effect', e.target.value)} className={INPUT} style={FIELD_STYLE}>
                          {FEATURE_EFFECTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </Field>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      {g.mode === 'ONE' && (
                        <Tooltip text="Make this the standard choice of the group: already chosen for every visitor, shown as Included, and costing nothing extra."><label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}><input type="radio" name={`cellar-feature-standard-${gi}`} checked={o.included} onChange={() => setStandard(gi, oi)} />Standard (included)</label></Tooltip>
                      )}
                      <Tooltip text="Untick to hide this option from visitors and staff without deleting it. A saved design that already uses it keeps working."><label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text)' }}><input type="checkbox" checked={o.enabled} onChange={(e) => setOpt(gi, oi, 'enabled', e.target.checked)} />Available</label></Tooltip>
                      {g.options.length > 1 && <Tooltip text="Remove this option. It stays until you press Save. Designs that chose it simply stop showing it."><button onClick={() => removeOpt(gi, oi)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Remove this option</button></Tooltip>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-4">
                {g.options.length < MAX_FEATURE_OPTIONS && <Tooltip text="Add another choice to this group (up to eight)."><button onClick={() => addOpt(gi)} className="text-xs px-3 py-1 rounded-lg border font-medium hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'transparent' }}>+ Add an option</button></Tooltip>}
                <Tooltip text="Remove this whole group and its options. It stays until you press Save."><button onClick={() => removeGroup(gi)} className="text-xs hover:opacity-70 transition-opacity" style={{ color: '#ef4444' }}>Remove this group</button></Tooltip>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel {...pp('doors', 'Doors', doorSummary)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Single door width (mm)" tip="The opening width used when a visitor chooses a single door. It takes this much wall, so racks are placed around it." hint="700 to 1300. Standard is 970.">{numInput('singleMm')}</Field>
          <Field label="Double door width (mm)" tip="The total opening width used when a visitor chooses a pair of doors. It takes more wall than a single door." hint="1200 to 2400. Standard is 1500.">{numInput('doubleMm')}</Field>
        </div>
      </Panel>

      <Panel {...pp('price', 'Guide price', priceSummary)}>
        <div className="flex items-center gap-3">
          <span className="flex-1" />
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
      </Panel>

      <div className="pt-2" data-testid="cellar-group">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Public website planner</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>What visitors see on your website page.</p>
      </div>

      <Panel {...pp('onpage', 'On the page', pageSummary)}>
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
      </Panel>

      <Panel {...pp('mobile', 'Message on phones', mobileSummary)} testid="cellar-lite-mobile">
        <div className="flex items-center gap-3">
          <span className="flex-1" />
          <Tooltip text={form.mnShow ? 'Visitors on a phone-sized screen see a note saying the planner is best on a computer or tablet. Click to switch it off (then press Save).' : 'The note is switched off. Click to show it to visitors on a phone-sized screen (then press Save).'}>
            <button
              onClick={() => set('mnShow', !form.mnShow)}
              className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
              style={{ borderColor: form.mnShow ? 'var(--color-primary)' : 'var(--color-border)', color: form.mnShow ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
              aria-pressed={form.mnShow}
              data-testid="cellar-lite-mobile-toggle"
            >
              {form.mnShow ? 'Showing on phones' : 'Off'}
            </button>
          </Tooltip>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          The public planner is made for a desktop computer or a tablet. On a phone-sized screen (under 700 pixels wide) visitors see this note first, with a button to carry on anyway and, if you have set a phone number, a link to call you instead. It never blocks them.
        </p>
        <Field label="Wording" tip="What visitors on a phone read, after the heading Best on a computer or tablet. Leave blank to use the standard wording." hint="Up to 300 characters. Blank uses the standard wording.">
          <textarea value={form.mnText} rows={3} maxLength={300} onChange={(e) => set('mnText', e.target.value)} className={INPUT} style={FIELD_STYLE} />
        </Field>
      </Panel>

      <Panel {...pp('guide', 'Website help chat', guideSummary)} testid="cellar-lite-guide">
        <div className="flex items-center gap-3">
          <span className="flex-1" />
          <Tooltip text={form.guideOn ? 'The round help button is showing on the website page. Click to switch it off (then press Save).' : 'The help chat is off. Click to turn it on for website visitors (then press Save).'}>
            <button
              onClick={() => set('guideOn', !form.guideOn)}
              className="text-xs px-3 py-1 rounded-lg border font-medium transition-all hover:opacity-80"
              style={{ borderColor: form.guideOn ? 'var(--color-primary)' : 'var(--color-border)', color: form.guideOn ? 'var(--color-primary)' : 'var(--color-muted)', background: 'transparent' }}
              aria-pressed={form.guideOn}
              data-testid="cellar-lite-guide-toggle"
            >
              {form.guideOn ? 'On' : 'Off'}
            </button>
          </Tooltip>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          A round help button on your website's planner page. Visitors ask in their own words how to use the planner and it points them to the right step. It never quotes a price or gives engineering advice, and visitors can send the chat to your admin email. <b>Every answer is a paid AI call</b>, so it is limited per visitor and per day, and it stays off until you switch it on here. It also needs the page script from the planner's website folder (see docs/cellar-planner.md).
        </p>
      </Panel>

      <Panel {...pp('rooms', 'Starting rooms', roomsSummary)}>
        <div className="flex items-center gap-3">
          <span className="flex-1" />
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
      </Panel>

      <div className="pt-2" data-testid="cellar-group">
        <h3 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--color-muted)' }}>Staff planner and quote</h3>
        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Used only inside Vault: the customer quote and the indicative cooling figure.</p>
      </div>

      <Panel {...pp('quote', 'Quote details', quoteSummary)} testid="cellar-lite-quote">
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
      </Panel>

      <Panel {...pp('cooling', 'Cooling estimate assumptions', coolingSummary)} testid="cellar-lite-cooling">
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
      </Panel>

      {errors.length > 0 && (
        <div className="rounded-xl border px-3 py-2 text-xs space-y-1" role="alert" style={{ borderColor: '#ef4444', color: '#ef4444' }} data-testid="cellar-lite-errors">
          <p className="font-medium">Not saved. Please fix:</p>
          {errors.map((e) => <p key={e}>{e}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 sticky bottom-0 py-3 px-4 -mx-4 border-t z-10" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }} data-testid="cellar-set-savebar">
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
