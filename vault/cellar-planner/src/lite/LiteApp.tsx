import { useEffect, useMemo, useRef, useState } from 'react';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { WallSide } from '../enclosure';
import { analyseApp, fullRuns } from '../app/model';
import { badRunIds, planView, rackFaceView, rackWallSummary } from '../views';
import { DrawingView } from '../ui/DrawingView';
import { CellarView } from './CellarView';
import { LiteHelp, LITE_HELP_KEY } from './LiteHelp';
import { PriceHelp } from './PriceHelp';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { DEFAULT_CONFIG, loadConfig, type LiteConfig, type LitePreset } from './config';
import { priceRange } from './price';
import { suggestFix } from './fixes';
import { track, type EventName } from './events';
import { clearLastDesign, readLastDesign, readUnit, writeLastDesign, writeUnit } from './remember';
import { LENGTH_UNITS, UNIT_NAMES, describeLength, formatLength, parseLength, rangeText, unitExample, unitSuffix, type LengthUnit } from './units';
import { BOTTLES, LIMITS, WALLS, decodeDesign, defaultLite, encodeDesign, liteResult, rackUnitCount, summaryLine, type DoorStyle, type LiteMode, type LiteSettings } from './settings';

// The public "lite" tool. A few choices, a picture of the inside, a plan and a racks picture, a bottle estimate (and a guide price when the owner has
// switched one on), and a "request a quote" step that hands a design code to the page around it (postMessage) or lets the visitor copy it. No login,
// no server of its own; the browser remembers only the last design and the chosen unit.

const WALL_NAMES: Record<WallSide, string> = { NORTH: 'North', EAST: 'East', SOUTH: 'South', WEST: 'West' };
const UNIT_SHORT: Record<LengthUnit, string> = { m: 'Metres', ft: 'Feet', mm: 'Millimetres' };
export const MESSAGE_TYPE = 'cellar-lite:design';
export const HEIGHT_TYPE = 'cellar-lite:height';

/**
 * Where to send the hand-off: the page that embeds us. The browser's own list of ancestor origins is used when it has one (Chrome, Safari), else
 * the origin of the referrer (Firefox). Null when not embedded, so nothing is ever broadcast.
 */
export function parentOrigin(): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null;
  try {
    const ancestor = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins?.[0];
    if (ancestor && ancestor !== 'null') return new URL(ancestor).origin;
  } catch { /* fall through to the referrer */ }
  try { return new URL(document.referrer).origin; } catch { return null; }
}

/** Where the visitor starts: a link's design, else the design remembered from last time, else the standard one. */
function startSettings(): { s: LiteSettings; restored: boolean } {
  const fromLink = new URLSearchParams(window.location.search).get('d');
  const linked = fromLink ? decodeDesign(fromLink) : null;
  if (linked) return { s: linked, restored: false };
  const last = readLastDesign();
  const back = last ? decodeDesign(last) : null;
  return back ? { s: back, restored: true } : { s: defaultLite(), restored: false };
}

type LengthKey = 'widthMm' | 'depthMm' | 'heightMm';
type Draft = { widthMm: string; depthMm: string; heightMm: string; target: string };
const toDraft = (s: LiteSettings, unit: LengthUnit): Draft => ({ widthMm: formatLength(s.widthMm, unit), depthMm: formatLength(s.depthMm, unit), heightMm: formatLength(s.heightMm, unit), target: String(s.target) });

export function LiteApp() {
  const start = useMemo(startSettings, []);
  const [s, setS] = useState<LiteSettings>(start.s);
  const [unit, setUnit] = useState<LengthUnit>(readUnit);
  const [draft, setDraft] = useState<Draft>(() => toDraft(start.s, readUnit()));
  const [restored, setRestored] = useState(start.restored);
  const [view, setView] = useState<'inside' | 'plan' | 'racks'>('inside');
  const [rackWall, setRackWall] = useState<WallSide>('NORTH');
  const [asked, setAsked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [priceHelpOpen, setPriceHelpOpen] = useState(false);
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');
  const [linkCopied, setLinkCopied] = useState<'' | 'done' | 'failed'>('');
  const [pdf, setPdf] = useState<'' | 'working' | 'done' | 'failed'>('');
  // the owner's settings (rack sizes, prices, starting rooms): the built-in defaults until the real ones arrive, and still if they never do
  const [cfg, setCfg] = useState<LiteConfig>(DEFAULT_CONFIG);
  const codeBox = useRef<HTMLTextAreaElement>(null);
  const sentBox = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const result = useMemo(() => liteResult(s, cfg), [s, cfg]);
  const analysis = useMemo(() => analyseApp(result.project), [result]);
  const code = useMemo(() => encodeDesign(s), [s]);
  const price = useMemo(() => priceRange(cfg, rackUnitCount(result.project), s.doorStyle, result.problems.length), [cfg, result, s.doorStyle]);
  const summary = useMemo(() => summaryLine(s, result.bottles, cfg) + (price ? ` Guide price shown: ${price.text}.` : ''), [s, result.bottles, cfg, price]);
  const fix = useMemo(() => (result.problems.length ? suggestFix(s, cfg, unit) : null), [s, cfg, unit, result.problems.length]);
  const e = result.project.enclosure;
  const plan = useMemo(() => planView(e, fullRuns(result.project), analysis.racks, { walkwayMm: null, badRuns: badRunIds(analysis.racks.issues), plainLabels: true }), [result, analysis, e]);
  const insideInput = useMemo(() => ({ project: result.project, runs: fullRuns(result.project), analysis: analysis.racks }), [result, analysis]);
  const racks = useMemo(() => rackFaceView(e, fullRuns(result.project), analysis.racks, rackWall, result.project.bottle, { badRuns: badRunIds(analysis.racks.issues) }), [result, analysis, e, rackWall]);
  const embedded = parentOrigin();
  const say = (name: EventName, detail?: Record<string, string | number | boolean>): void => track(name, embedded, detail);

  // keep the address reopenable (?d=), remember the design for next time, and keep the page around us in step so its enquiry form is always current
  useEffect(() => {
    try { const u = new URL(window.location.href); u.searchParams.set('d', code); window.history.replaceState(null, '', u); } catch { /* sandboxed frame: skip */ }
    // only a design the visitor has changed is worth remembering: the untouched standard room would just greet them as "welcome back" for nothing
    if (code === encodeDesign(defaultLite())) clearLastDesign(); else writeLastDesign(code);
    const to = parentOrigin();
    if (to) window.parent.postMessage({ type: MESSAGE_TYPE, version: 1, code, summary, bottles: result.bottles, priceText: price?.text ?? '', requested: asked }, to);
  }, [code, summary, result.bottles, price, asked]);

  // the first change to the design counts as "started" (once)
  useEffect(() => {
    if (started.current) return;
    if (code !== encodeDesign(start.s)) { started.current = true; say('start'); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // the page around us can size the frame to fit, so the visitor scrolls one page, not a page within a page
  useEffect(() => {
    const to = parentOrigin();
    if (!to || typeof ResizeObserver === 'undefined') return undefined;
    let raf = 0, last = 0;
    const send = (): void => {
      raf = 0;
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (h !== last) { last = h; window.parent.postMessage({ type: HEIGHT_TYPE, version: 1, height: h }, to); }
    };
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(send); });
    ro.observe(document.body);
    send();
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // After "Request a quote": always bring the revealed panel into view so the visitor does not have to hunt for it. When embedded, the page around
  // us then scrolls on to its own enquiry form (cellar-lite-fill.js), which wins because its scroll starts after this one.
  useEffect(() => {
    if (!asked) return;
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    sentBox.current?.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'center' });
  }, [asked]);

  useEffect(() => { void loadConfig().then((r) => setCfg(r.config)); }, []);
  useEffect(() => { if (restored) say('welcome_back'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ?tour=1 starts the tour straight away; the guide opens only from the Help button (a pop-up on arrival is closed unread by most visitors)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('tour')) window.setTimeout(() => void startTour(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeHelp = (): void => { try { localStorage.setItem(LITE_HELP_KEY, '1'); } catch { /* fine */ } setHelpOpen(false); };
  /** Shepherd is loaded on first use, so it stays out of the page's first download. */
  const startTour = async (): Promise<void> => {
    const m = await import('./liteTour');
    m.startLiteTour({ setView, getView: () => viewRef.current });
  };
  const viewRef = useRef(view);
  viewRef.current = view;

  /** Put a whole design on screen: the settings and the boxes that show them. */
  const show = (next: LiteSettings, u: LengthUnit = unit): void => { setS(next); setDraft(toDraft(next, u)); setAsked(false); };

  const chooseUnit = (u: LengthUnit): void => { setUnit(u); writeUnit(u); setDraft(toDraft(s, u)); say('unit', { unit: u }); };

  const setNum = (key: LengthKey | 'target', text: string): void => {
    setDraft((d) => ({ ...d, [key]: text }));
    if (key === 'target') {
      const n = Number(text);
      if (text.trim() !== '' && Number.isFinite(n)) setS((cur) => ({ ...cur, target: Math.round(n) }));
      return;
    }
    const mm = parseLength(text, unit);
    if (mm !== null) setS((cur) => ({ ...cur, [key]: mm }));
  };
  /** On leaving a field, snap every value into its allowed range and show it. */
  const settle = (): void => { const n = decodeDesign(encodeDesign(s)); if (n) { setS(n); setDraft(toDraft(n, unit)); } };
  const rangeNote = (key: LengthKey | 'target'): string => {
    if (key === 'target') {
      const n = Number(draft.target), [lo, hi] = LIMITS.target;
      return draft.target.trim() === '' || !Number.isFinite(n) || n < lo || n > hi ? `Between ${lo} and ${hi}.` : '';
    }
    const mm = parseLength(draft[key], unit);
    const [lo, hi] = LIMITS[key];
    return mm === null || mm < lo || mm > hi ? rangeText(LIMITS[key], unit) : '';
  };

  /** A starting room replaces the size (and door style) only; the wall, bottle and bottle-count choices stay as the visitor had them. */
  const startFrom = (p: LitePreset): void => { show({ ...s, widthMm: p.widthMm, depthMm: p.depthMm, heightMm: p.heightMm, doorStyle: p.doorStyle }); say('preset', { room: p.id }); };
  /** A starting room counts as chosen while the size and door style still match it exactly; changing any of them un-highlights it. */
  const isPreset = (p: LitePreset): boolean => s.widthMm === p.widthMm && s.depthMm === p.depthMm && s.heightMm === p.heightMm && s.doorStyle === p.doorStyle;
  /** The standalone planner's own address with this design's code: opens exactly these choices (the embedding page is left out). */
  const designLink = (): string => { const u = new URL(window.location.href); u.search = ''; u.hash = ''; u.searchParams.set('d', code); return u.toString(); };
  const copyLink = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(designLink()); setLinkCopied('done'); say('link_copied'); } catch { setLinkCopied('failed'); }
  };
  const download = async (): Promise<void> => {
    setPdf('working');
    try { const { downloadPlan } = await import('./planPdf'); await downloadPlan(result.project, code); setPdf('done'); say('plan_downloaded'); } catch { setPdf('failed'); }
  };
  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(`${summary}\nDesign code: ${code}`); setCopied('done'); } catch { codeBox.current?.select(); setCopied('failed'); }
  };
  const startAgain = (): void => { clearLastDesign(); setRestored(false); show(defaultLite()); };

  const roomText = `${formatLength(s.widthMm, unit)} × ${formatLength(s.depthMm, unit)} × ${formatLength(s.heightMm, unit)} ${unit === 'ft' ? '' : unit}`.trim();
  const numField = (key: LengthKey, label: string, hint: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input"><input type="text" inputMode="decimal" value={draft[key]} onChange={(ev) => setNum(key, ev.target.value)} onBlur={settle} title={`${hint} Type it ${unitExample(unit)}.`} placeholder={formatLength(key === 'heightMm' ? 2400 : 2750, unit)} data-testid={`lite-${key}`} /><span className="unit">{unitSuffix(unit)}</span></span>
      <small className="field-hint">{hint}</small>
      {rangeNote(key) && <span className="field-err" role="alert">{rangeNote(key)}</span>}
    </label>
  );
  const maxFit = result.maxBottles;

  return (
    <div className="lite" data-testid="lite">
      <header className="lite-head">
        <div className="lite-head-row">
          <h1>Plan your wine cellar</h1>
          <span className="lite-help-btns">
            <button type="button" className="btn" title="A guided walk through the screen, one step at a time." onClick={() => void startTour()} data-testid="lite-tour">Take the tour</button>
            <button type="button" className="btn" title="The plain-language guide: what each question means." onClick={() => setHelpOpen(true)} data-testid="lite-help-open">Help</button>
          </span>
        </div>
        <p>Tell us the size of the room and how you store your wine. You will see what it could look like and an estimate of the bottles it holds.</p>
        {cfg.promise && <p className="lite-promise" data-testid="lite-promise">{cfg.promise}</p>}
        <ol className="lite-steps" aria-label="How it works" data-testid="lite-steps">
          <li><b>1</b> Room size</li>
          <li><b>2</b> Door and bottles</li>
          <li><b>3</b> Your cellar{cfg.pricing.show ? ' and price' : ''}</li>
        </ol>
      </header>

      {restored && (
        <p className="lite-welcome" role="status" data-testid="lite-welcome">
          Welcome back. We kept your last design.{' '}
          <button type="button" className="linklike" onClick={startAgain} title="Forget the last design and begin again with the standard room." data-testid="lite-start-again">Start again</button>
        </p>
      )}

      {cfg.presets.length > 0 && (
        <section className="lite-presets" aria-label="Start from a typical room" data-testid="lite-presets">
          <span className="lite-presets-label">Not sure where to start? Try a typical room:</span>
          <span className="lite-presets-row">
            {cfg.presets.map((p) => (
              <button type="button" key={p.id} className={`btn${isPreset(p) ? ' primary' : ''}`} aria-pressed={isPreset(p)} onClick={() => startFrom(p)} data-testid={`lite-preset-${p.id}`} title={`${describeLength(p.widthMm, unit)} × ${describeLength(p.depthMm, unit)} × ${describeLength(p.heightMm, unit)} inside`}>{p.name}</button>
            ))}
          </span>
        </section>
      )}

      <section className="lite-controls" aria-label="Your cellar">
        <div className="lite-unitpick" role="group" aria-label="Measure in" data-testid="lite-units-pick">
          <span className="lite-unitpick-label">Measure in:</span>
          {LENGTH_UNITS.map((u) => (
            <button type="button" key={u} className={`tab small${unit === u ? ' on' : ''}`} aria-pressed={unit === u} onClick={() => chooseUnit(u)} title={`Type sizes in ${UNIT_NAMES[u].toLowerCase()} (${unitExample(u)}).`} data-testid={`lite-unit-${u}`}>{UNIT_SHORT[u]}</button>
          ))}
        </div>
        <div className="lite-grid">
          <div className="lite-sizes" data-tour="lt-size">
            {numField('widthMm', 'Inside width', 'Side to side on the drawing, wall to wall.')}
            {numField('depthMm', 'Inside depth', 'Front to back, wall to wall.')}
            {numField('heightMm', 'Inside height', 'Floor to ceiling.')}
          </div>
          <div className="lite-sizes" data-tour="lt-door">
            <label className="field">
              <span className="field-label">Door on the</span>
              <select value={s.doorWall} onChange={(ev) => setS({ ...s, doorWall: ev.target.value as WallSide })} title="Which wall of the drawing the door is on. South is the bottom, North the top, West the left, East the right." data-testid="lite-door">
                {WALLS.map((w) => <option key={w} value={w}>{WALL_NAMES[w]} wall</option>)}
              </select>
              <small className="field-hint">South is the bottom of the drawing, North the top, West the left, East the right.</small>
            </label>
            <label className="field">
              <span className="field-label">Door type</span>
              <select value={s.doorStyle} onChange={(ev) => setS({ ...s, doorStyle: ev.target.value as DoorStyle })} title="One door, or a pair of doors that open together. A pair takes more wall." data-testid="lite-door-style">
                <option value="SINGLE">Single door (one)</option>
                <option value="DOUBLE">Double door (a pair)</option>
              </select>
              <small className="field-hint">{s.doorStyle === 'DOUBLE' ? `Two doors that open together, about ${describeLength(cfg.doors.doubleMm, unit)} across: easier to carry things through, but it takes more wall.` : `One door, about ${describeLength(cfg.doors.singleMm, unit)} wide.`}</small>
            </label>
          </div>
          <label className="field" data-tour="lt-bottle">
            <span className="field-label">Main bottle style</span>
            <select value={s.bottle} onChange={(ev) => setS({ ...s, bottle: ev.target.value as LiteSettings['bottle'] })} title="The bottle you have most of. Wider bottles mean fewer fit." data-testid="lite-bottle">
              {BOTTLES.map((b) => <option key={b} value={b}>{BOTTLE_PROFILES[b].label}</option>)}
            </select>
            <small className="field-hint">The bottle you have most of. Wider bottles mean fewer fit.</small>
          </label>
          <label className="field" data-tour="lt-mode">
            <span className="field-label">How many bottles</span>
            <select value={s.mode} onChange={(ev) => setS({ ...s, mode: ev.target.value as LiteMode })} title="Fill every wall with racks, or tell us how many bottles you want." data-testid="lite-mode">
              <option value="FILL">As many as fit</option>
              <option value="TARGET">A number I choose</option>
            </select>
            <small className="field-hint">Fill every wall, or tell us how many you want.</small>
          </label>
          {s.mode === 'TARGET' && (
            <div className="field">
              <label htmlFor="lite-target-input" className="field-label">Bottles wanted</label>
              <span className="field-input"><input id="lite-target-input" type="text" inputMode="numeric" value={draft.target} onChange={(ev) => setNum('target', ev.target.value)} onBlur={settle} title="How many bottles you want the cellar to hold, from 1 to 5000. We use just enough racks for that number." data-testid="lite-target" /></span>
              {maxFit >= 10 && (
                <input
                  type="range" className="lite-slider" min={1} max={Math.max(maxFit, s.target)} step={Math.max(1, Math.round(maxFit / 200))}
                  value={Math.min(s.target, Math.max(maxFit, s.target))} aria-label="Bottles wanted, slider"
                  onChange={(ev) => { const n = Number(ev.target.value); setS((cur) => ({ ...cur, target: n })); setDraft((d) => ({ ...d, target: String(n) })); }}
                  title="Drag to choose how many bottles. The far end is the most this room holds." data-testid="lite-target-slider"
                />
              )}
              {rangeNote('target') && <span className="field-err" role="alert">{rangeNote('target')}</span>}
            </div>
          )}
        </div>
      </section>

      <section className="lite-result" data-tour="lt-result" aria-live="polite" data-testid="lite-result">
        {result.problems.length > 0 ? (
          <>
            <p className="lite-problem" data-testid="lite-problem">This size cannot be built as entered: {result.problems[0]}</p>
            {fix
              ? <p className="lite-fix"><button type="button" className="btn primary small" onClick={() => { show(fix.settings); say('fix'); }} title="Apply this one change to your design. You can change it back." data-testid="lite-fix">{fix.text}</button> <span className="lite-note">One change that makes it work.</span></p>
              : <p className="lite-note" data-testid="lite-nofix">Try a bigger room or a smaller bottle style.</p>}
          </>
        ) : (
          <>
            <p className="lite-total"><strong data-testid="lite-bottles">About {result.bottles} bottles</strong> <span className="lite-tag">estimate only, not a quote</span></p>
            {price && <p className="lite-price" data-testid="lite-price">Guide price: <strong>{price.text}</strong>{cfg.pricing.note && <span className="lite-price-note"> {cfg.pricing.note}</span>}</p>}
            {s.mode === 'TARGET' && result.maxBottles < s.target && <p className="lite-note" data-testid="lite-short">This room holds about {result.maxBottles} at most, fewer than the {s.target} you asked for. Try a bigger room or a smaller bottle style.</p>}
            {s.mode === 'TARGET' && result.maxBottles >= s.target && <p className="lite-note">The room could hold about {result.maxBottles} if every wall were full.</p>}
          </>
        )}
        <p className="lite-share">
          <button type="button" className="btn small" onClick={() => void copyLink()} data-testid="lite-share" title="Copies an address that opens this exact design, to keep or send to someone.">Copy a link to this design</button>
          <button type="button" className="btn small" disabled={result.problems.length > 0 || pdf === 'working'} onClick={() => void download()} data-testid="lite-download" title="Saves your plan as a PDF to keep or show someone. It is a preliminary design, not a quote.">{pdf === 'working' ? 'Preparing…' : 'Download my plan (PDF)'}</button>
          {price && <button type="button" className="btn small" onClick={() => { setPriceHelpOpen(true); say('price_help'); }} title="A short outline of how the guide price follows from your choices." data-testid="lite-price-help-open">How is this price worked out?</button>}
          {linkCopied === 'done' && <span className="lite-note" role="status" data-testid="lite-share-done"> Link copied. Anyone you send it to sees these choices.</span>}
          {linkCopied === 'failed' && <span className="lite-note" role="status"> Could not copy automatically. Use the Request a quote button instead: it shows your design to copy.</span>}
          {pdf === 'done' && <span className="lite-note" role="status" data-testid="lite-download-done"> Your plan has been saved.</span>}
          {pdf === 'failed' && <span className="lite-note" role="alert"> Could not make the PDF. Please try again.</span>}
        </p>
      </section>

      <section className="lite-drawing" data-tour="lt-drawing" aria-label="Drawings">
        <div className="tabs" role="group" aria-label="Drawing">
          <button type="button" className={`tab${view === 'inside' ? ' on' : ''}`} aria-pressed={view === 'inside'} onClick={() => { setView('inside'); say('view', { view: 'inside' }); }} title="What the cellar looks like inside, seen from the door. Drag to look around." data-testid="lite-tab-inside">Inside view</button>
          <button type="button" className={`tab${view === 'plan' ? ' on' : ''}`} aria-pressed={view === 'plan'} onClick={() => { setView('plan'); say('view', { view: 'plan' }); }} title="The cellar seen from above, with the door and the racks." data-testid="lite-tab-plan">Plan from above</button>
          <button type="button" className={`tab${view === 'racks' ? ' on' : ''}`} aria-pressed={view === 'racks'} onClick={() => { setView('racks'); say('view', { view: 'racks' }); }} title="One wall seen from inside the cellar, with every bottle drawn." data-testid="lite-tab-racks">Racks on a wall</button>
          {view === 'racks' && WALLS.map((w) => <button type="button" key={w} className={`tab small${rackWall === w ? ' on' : ''}`} aria-pressed={rackWall === w} onClick={() => setRackWall(w)} title={`Show the racks on the ${WALL_NAMES[w].toLowerCase()} wall.`} data-testid={`lite-wall-${w}`}>{WALL_NAMES[w]}</button>)}
        </div>
        <div className="lite-canvas">
          {view === 'inside'
            ? <CellarView key="inside" input={insideInput} testid="lite-inside" description={`The inside of the cellar seen from the door: ${result.bottles} bottles on racks along the walls.`} />
            : view === 'plan'
            ? <DrawingView look="warm" ctrlZoom key="plan" prims={plan} testid="lite-plan" description={`Plan of the cellar from above: ${roomText} inside, door on the ${s.doorWall.toLowerCase()} wall, about ${result.bottles} bottles.`} />
            : <DrawingView look="warmWall" ctrlZoom key={`racks-${rackWall}`} prims={racks} testid="lite-racks" description={`The racks on the ${rackWall.toLowerCase()} wall seen from inside, with each bottle drawn end-on.`} />}
        </div>
        {view === 'racks' && <p className="lite-note lite-units" data-testid="lite-racks-summary" role="status"><strong>{rackWallSummary(analysis.racks, fullRuns(result.project), rackWall).text}</strong> Each circle in the picture is one bottle, so you can count them. The whole cellar is about {result.bottles}.</p>}
        {view !== 'inside' && <p className="lite-note lite-units">The numbers drawn around the edges are sizes in millimetres.</p>}
        <p className="lite-note lite-units" data-testid="lite-units">Built from standard-size rack units, about {describeLength(cfg.rack.unitWidthMm, unit)} wide, placed whole along the walls. A gap at the end of a wall is left-over space, not a mistake.</p>
        <p className="foot">ESTIMATE ONLY: FINAL SITE MEASURE REQUIRED. Rack unit sizes are typical values, not a quote.</p>
      </section>

      <section className="lite-ask" aria-label="Request a quote">
        {!asked ? (
          <button type="button" className="btn primary lite-cta" data-tour="lt-quote" onClick={() => { setAsked(true); say('quote'); }} title="Ask us for a quote for exactly this design. Nothing is sent until you press Send on the form." data-testid="lite-quote">Request a quote for this design <span aria-hidden="true">&rarr;</span></button>
        ) : (
          <div className="lite-sent" ref={sentBox} data-testid="lite-sent">
            <p><strong>Your design is ready to send.</strong> {embedded ? 'Taking you to the contact form with your design filled in. If nothing happens, copy it below and paste it into the form.' : 'Copy it into your enquiry.'}</p>
            {cfg.quoteNote && <p className="lite-note" data-testid="lite-quote-note">{cfg.quoteNote}</p>}
            <label className="field">
              <span className="field-label">Your design</span>
              <textarea ref={codeBox} readOnly rows={3} value={`${summary}\nDesign code: ${code}`} title="Your design as text, ready to copy." data-testid="lite-code" onFocus={(ev) => ev.target.select()} />
            </label>
            <div className="row">
              <button type="button" className="btn" onClick={() => void copy()} title="Copies your design so you can paste it into the enquiry form." data-testid="lite-copy">Copy my design</button>
              <button type="button" className="btn" onClick={() => { setAsked(false); setCopied(''); }} title="Go back and change the design.">Keep editing</button>
            </div>
            {copied === 'done' && <p className="lite-note" role="status">Copied.</p>}
            {copied === 'failed' && <p className="lite-note" role="status">Could not copy automatically: the text above is selected, so copy it by hand.</p>}
          </div>
        )}
      </section>
      <PriceHelp open={priceHelpOpen && !!price} onClose={() => setPriceHelpOpen(false)} cfg={cfg} facts={{ units: rackUnitCount(result.project), doorStyle: s.doorStyle, bottles: result.bottles, roomText, bottleLabel: BOTTLE_PROFILES[s.bottle].label }} />
      <TooltipHost />
      <LiteHelp unit={unit} doorSingleMm={cfg.doors.singleMm} doorDoubleMm={cfg.doors.doubleMm} unitWidthMm={cfg.rack.unitWidthMm} open={helpOpen} onClose={closeHelp} onTour={() => { closeHelp(); window.setTimeout(() => void startTour(), 250); }} />
    </div>
  );
}
