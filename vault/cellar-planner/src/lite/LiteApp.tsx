import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { WallSide } from '../enclosure';
import { analyseApp, fullRuns } from '../app/model';
import { badRunIds, planView, rackFaceView, rackWallSummary } from '../views';
import { DrawingView } from '../ui/DrawingView';
import { CellarView } from './CellarView';
import { PhotoView } from './PhotoView';
import { buildScene } from './cellarScene';
import { makeThumb } from './thumbnail';
import { LiteHelp, LITE_HELP_KEY } from './LiteHelp';
import { PriceHelp } from './PriceHelp';
import { DoorPicker } from './DoorPicker';
import { LengthField, Segmented, Stepper } from './controls';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { DEFAULT_CONFIG, accentColours, loadConfig, telHref, type LiteConfig, type LitePreset } from './config';
import { FINISH_LOOK } from './finishes';
import { priceRange } from './price';
import { suggestFix } from './fixes';
import { track, type EventName } from './events';
import { clearLastDesign, readLastDesign, readUnit, writeLastDesign, writeUnit } from './remember';
import { LENGTH_UNITS, UNIT_NAMES, describeLength, formatLength, parseLength, rangeText, unitExample, unitSuffix, type LengthUnit } from './units';
import { BOTTLES, DOOR_POSITIONS, FINISHES, FINISH_NAMES, LIMITS, WALLS, decodeDesign, defaultLite, encodeDesign, liteResult, rackUnitCount, summaryLine, type DoorPosition, type DoorStyle, type Finish, type LiteMode, type LiteSettings } from './settings';

// The public "lite" tool: a three-step planner. Step 1 is the space (size, door), step 2 the racking and finish (bottles, how many, timber), step 3 the
// review (what it is, the guide price, the plan to keep). A large picture (3D, plan, or one wall of racks) is always beside the controls, with the
// capacity, footprint, configuration and quote button along the bottom. The browser remembers only the last design and the chosen unit.

const WALL_NAMES: Record<WallSide, string> = { NORTH: 'North', EAST: 'East', SOUTH: 'South', WEST: 'West' };
const POSITION_NAMES: Record<DoorPosition, string> = { LEFT: 'Left', CENTRE: 'Centre', RIGHT: 'Right' };
const UNIT_SHORT: Record<LengthUnit, string> = { m: 'Metres', ft: 'Feet', mm: 'Millimetres' };
const STEPS = ['Space', 'Racking & finishes', 'Review'];
const STEP_LABELS = ['space', 'racking', 'review'];
const STEP_MM = 50;
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
  const [step, setStep] = useState(1);
  const [view, setView] = useState<'inside' | 'plan' | 'racks' | 'photo'>('inside');
  const [rackWall, setRackWall] = useState<WallSide>('NORTH');
  const [asked, setAsked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [priceHelpOpen, setPriceHelpOpen] = useState(false);
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');
  const [linkCopied, setLinkCopied] = useState<'' | 'done' | 'failed'>('');
  const [pdf, setPdf] = useState<'' | 'working' | 'done' | 'failed'>('');
  const [thumb, setThumb] = useState('');
  // the owner's settings (rack sizes, prices, brand colour, starting rooms): the built-in defaults until the real ones arrive, and still if they never do
  const [cfg, setCfg] = useState<LiteConfig>(DEFAULT_CONFIG);
  const codeBox = useRef<HTMLTextAreaElement>(null);
  const sentBox = useRef<HTMLDivElement>(null);
  const panelTitle = useRef<HTMLHeadingElement>(null);
  const started = useRef(false);
  const stepSeen = useRef(false);

  const result = useMemo(() => liteResult(s, cfg), [s, cfg]);
  const analysis = useMemo(() => analyseApp(result.project), [result]);
  const code = useMemo(() => encodeDesign(s), [s]);
  const price = useMemo(() => priceRange(cfg, rackUnitCount(result.project), s.doorStyle, result.problems.length), [cfg, result, s.doorStyle]);
  const summary = useMemo(() => summaryLine(s, result.bottles, cfg) + (price ? ` Guide price shown: ${price.text}.` : ''), [s, result.bottles, cfg, price]);
  const fix = useMemo(() => (result.problems.length ? suggestFix(s, cfg, unit) : null), [s, cfg, unit, result.problems.length]);
  const e = result.project.enclosure;
  const plan = useMemo(() => planView(e, fullRuns(result.project), analysis.racks, { walkwayMm: null, badRuns: badRunIds(analysis.racks.issues), plainLabels: true }), [result, analysis, e]);
  const dims = useMemo(() => ({ width: describeLength(s.widthMm, unit), depth: describeLength(s.depthMm, unit), height: describeLength(s.heightMm, unit) }), [s.widthMm, s.depthMm, s.heightMm, unit]);
  const insideInput = useMemo(() => ({ project: result.project, runs: fullRuns(result.project), analysis: analysis.racks, dims }), [result, analysis, dims]);
  const racks = useMemo(() => rackFaceView(e, fullRuns(result.project), analysis.racks, rackWall, result.project.bottle, { badRuns: badRunIds(analysis.racks.issues) }), [result, analysis, e, rackWall]);
  const embedded = parentOrigin();
  const say = (name: EventName, detail?: Record<string, string | number | boolean>): void => track(name, embedded, detail);
  const brand = useMemo(() => accentColours(cfg.accent), [cfg.accent]);

  // keep the address reopenable (?d=), remember the design for next time, and keep the page around us in step so its enquiry form is always current
  useEffect(() => {
    try { const u = new URL(window.location.href); u.searchParams.set('d', code); window.history.replaceState(null, '', u); } catch { /* sandboxed frame: skip */ }
    // only a design the visitor has changed is worth remembering: the untouched standard room would just greet them as "welcome back" for nothing
    if (code === encodeDesign(defaultLite())) clearLastDesign(); else writeLastDesign(code);
    const to = parentOrigin();
    if (to) window.parent.postMessage({ type: MESSAGE_TYPE, version: 1, code, summary, bottles: result.bottles, priceText: price?.text ?? '', thumb, requested: asked }, to);
  }, [code, summary, result.bottles, price, asked, thumb]);

  // a small picture for the page's phone bar, redrawn a moment after the design stops changing (only when embedded: standalone nobody shows it)
  useEffect(() => {
    if (!embedded || result.problems.length) return undefined;
    const t = window.setTimeout(() => { try { setThumb(makeThumb(buildScene({ ...insideInput, dims: undefined, yawDeg: 0 }), s.finish)); } catch { setThumb(''); } }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insideInput, result.problems.length, s.finish]);

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
    let raf = 0, last = '';
    const send = (): void => {
      raf = 0;
      const h = Math.ceil(document.documentElement.scrollHeight);
      // where the big picture sits in the page, so the page around us knows when it is on screen
      const pic = document.querySelector('.lite-visual')?.getBoundingClientRect();
      const top = pic ? Math.round(pic.top + window.scrollY) : 0, bottom = pic ? Math.round(pic.bottom + window.scrollY) : 0;
      const key = `${h}/${top}/${bottom}`;
      if (key !== last) { last = key; window.parent.postMessage({ type: HEIGHT_TYPE, version: 1, height: h, pictureTop: top, pictureBottom: bottom }, to); }
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
  useEffect(() => { if (view === 'photo' && !cfg.photo.enabled) setView('inside'); }, [view, cfg.photo.enabled]);
  useEffect(() => { if (restored) say('welcome_back'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // moving to another step puts the reader at the top of it (screen readers hear the step's name)
  useEffect(() => {
    if (!stepSeen.current) { stepSeen.current = true; return; }
    panelTitle.current?.focus({ preventScroll: true });
  }, [step]);

  // ?tour=1 starts the tour straight away; the guide opens only from the Help button (a pop-up on arrival is closed unread by most visitors)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('tour')) window.setTimeout(() => void startTour(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeHelp = (): void => { try { localStorage.setItem(LITE_HELP_KEY, '1'); } catch { /* fine */ } setHelpOpen(false); };
  /** Shepherd is loaded on first use, so it stays out of the page's first download. */
  const startTour = async (): Promise<void> => {
    const m = await import('./liteTour');
    m.startLiteTour({ setView: (v) => setView(v), getView: () => (viewRef.current === 'photo' ? 'inside' : viewRef.current), setStep: (n) => setStepTracked(n, false), getStep: () => stepRef.current });
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  const stepRef = useRef(step);
  stepRef.current = step;

  const setStepTracked = (n: number, count = true): void => { setStep(n); if (count) say('step', { step: STEP_LABELS[n - 1] }); };

  /** Put a whole design on screen: the settings and the boxes that show them. */
  const show = (next: LiteSettings, u: LengthUnit = unit): void => { setS(next); setDraft(toDraft(next, u)); setAsked(false); };
  const change = (patch: Partial<LiteSettings>): void => setS((cur) => ({ ...cur, ...patch }));

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
  /** The minus and plus buttons beside a size: 50 mm a click, kept inside the allowed range. */
  const bump = (key: LengthKey, dir: -1 | 1): void => {
    const [lo, hi] = LIMITS[key];
    show({ ...s, [key]: Math.min(hi, Math.max(lo, s[key] + dir * STEP_MM)) });
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
  const startAgain = (): void => { clearLastDesign(); setRestored(false); show(defaultLite()); setStep(1); };
  const ask = (): void => { setAsked(true); say('quote'); };

  // a non-breaking space before the unit, so "m" never wraps onto a line of its own
  const withUnit = (t: string): string => (unit === 'ft' ? t : `${t} ${unit}`);
  const roomText = withUnit(`${formatLength(s.widthMm, unit)} × ${formatLength(s.depthMm, unit)} × ${formatLength(s.heightMm, unit)}`);
  const footprint = withUnit(`${formatLength(s.widthMm, unit)} × ${formatLength(s.depthMm, unit)}`);
  const doorText = `${s.doorStyle === 'DOUBLE' ? 'Double' : 'Single'} door · ${WALL_NAMES[s.doorWall]} wall · ${POSITION_NAMES[s.doorPos]}`;
  const configuration = `${s.doorStyle === 'DOUBLE' ? 'Double' : 'Single'} door · ${POSITION_NAMES[s.doorPos]} · ${FINISH_NAMES[s.finish]}`;
  const maxFit = result.maxBottles;
  const numField = (key: LengthKey, label: string, hint: string) => (
    <LengthField label={label} hint={`${hint} Type it ${unitExample(unit)}.`} value={draft[key]} suffix={unitSuffix(unit)} placeholder={formatLength(key === 'heightMm' ? 2400 : 2750, unit)} error={rangeNote(key)} onType={(t) => setNum(key, t)} onBlur={settle} onStep={(d) => bump(key, d)} testid={`lite-${key}`} />
  );

  return (
    <div className="lite" data-testid="lite" style={{ '--primary': brand.main, '--primary-dark': brand.dark, '--primary-soft': brand.soft } as CSSProperties}>
      <header className="lite-head">
        <div className="lite-head-row">
          <div>
            <h1>Cellar Planner</h1>
            <p className="lite-sub">Create a cellar that fits your space.</p>
          </div>
          <span className="lite-help-btns">
            <button type="button" className="btn" title="A guided walk through the screen, one step at a time." onClick={() => void startTour()} data-testid="lite-tour">Take the tour</button>
            <button type="button" className="btn" title="The plain-language guide: what each question means." onClick={() => setHelpOpen(true)} data-testid="lite-help-open">Help</button>
            <button type="button" className="btn" onClick={() => void copyLink()} data-testid="lite-share" title="Saves a link to this exact design. Paste it anywhere to come back to it, or send it to someone.">Save design</button>
          </span>
        </div>
        {linkCopied === 'done' && <p className="lite-note" role="status" data-testid="lite-share-done">Link copied. Anyone you send it to sees these choices.</p>}
        {linkCopied === 'failed' && <p className="lite-note" role="status">Could not copy automatically. Use the Request a quote button instead: it shows your design to copy.</p>}
        {cfg.promise && <p className="lite-promise" data-testid="lite-promise">{cfg.promise}</p>}
        <Stepper step={step} steps={STEPS} onGo={(n) => setStepTracked(n)} />
      </header>

      {restored && (
        <p className="lite-welcome" role="status" data-testid="lite-welcome">
          Welcome back. We kept your last design.{' '}
          <button type="button" className="linklike" onClick={startAgain} title="Forget the last design and begin again with the standard room." data-testid="lite-start-again">Start again</button>
        </p>
      )}

      <div className="lite-main">
        <section className="lite-panel" aria-label={`Step ${step}: ${STEPS[step - 1]}`} data-testid="lite-panel" data-step={step}>
          {result.problems.length > 0 && (
            <div className="lite-alert" role="alert">
              <p className="lite-problem" data-testid="lite-problem">This size cannot be built as entered: {result.problems[0]}</p>
              {fix
                ? <p className="lite-fix"><button type="button" className="btn primary small" onClick={() => { show(fix.settings); say('fix'); }} title="Apply this one change to your design. You can change it back." data-testid="lite-fix">{fix.text}</button> <span className="lite-note">One change that makes it work.</span></p>
                : <p className="lite-note" data-testid="lite-nofix">Try a bigger room or a smaller bottle style.</p>}
            </div>
          )}

          {asked && (
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

          {step === 1 && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step 1 of 3</p>
              <h2 tabIndex={-1} ref={panelTitle} className="lite-step-title">Your space</h2>
              {cfg.presets.length > 0 && (
                <div className="lite-presets" aria-label="Start from a typical room" data-testid="lite-presets">
                  <span className="lite-presets-label">Quick start:</span>
                  <span className="lite-presets-row">
                    {cfg.presets.map((p) => (
                      <button type="button" key={p.id} className={`btn small${isPreset(p) ? ' primary' : ''}`} aria-pressed={isPreset(p)} onClick={() => startFrom(p)} data-testid={`lite-preset-${p.id}`} title={`${describeLength(p.widthMm, unit)} × ${describeLength(p.depthMm, unit)} × ${describeLength(p.heightMm, unit)} inside`}>{p.name}</button>
                    ))}
                  </span>
                </div>
              )}
              <div className="lite-group" data-tour="lt-size">
                <div className="lite-group-head">
                  <h3>Dimensions</h3>
                  <span className="lite-unitpick" role="group" aria-label="Measure in" data-testid="lite-units-pick">
                    {LENGTH_UNITS.map((u) => (
                      <button type="button" key={u} className={`tab small${unit === u ? ' on' : ''}`} aria-pressed={unit === u} onClick={() => chooseUnit(u)} title={`Type sizes in ${UNIT_NAMES[u].toLowerCase()} (${unitExample(u)}).`} data-testid={`lite-unit-${u}`}>{UNIT_SHORT[u]}</button>
                    ))}
                  </span>
                </div>
                {numField('widthMm', 'Width', 'Side to side on the drawing, wall to wall, inside.')}
                {numField('depthMm', 'Depth', 'Front to back, wall to wall, inside.')}
                {numField('heightMm', 'Height', 'Floor to ceiling, inside.')}
              </div>
              <div className="lite-group" data-tour="lt-door">
                <h3>Door</h3>
                <DoorPicker wall={s.doorWall} pos={s.doorPos} double={s.doorStyle === 'DOUBLE'} widthMm={s.widthMm} depthMm={s.depthMm} doorMm={s.doorStyle === 'DOUBLE' ? cfg.doors.doubleMm : cfg.doors.singleMm} onPick={(w) => { change({ doorWall: w }); say('door_pick'); }} />
                <p className="field-hint">Tap the wall the door is on. The drawing is the room seen from above: the top is North, the bottom South, the left West and the right East.</p>
                <h3 className="lite-sub-h">Where along that wall</h3>
                <Segmented<DoorPosition> label="Where along the wall the door is" value={s.doorPos} onChange={(v) => change({ doorPos: v })} testid="lite-doorpos"
                  options={DOOR_POSITIONS.map((p) => ({ value: p, label: POSITION_NAMES[p], title: p === 'CENTRE' ? 'The door in the middle of the wall.' : `The door toward the ${p.toLowerCase()} end, as you see it standing outside facing the door.`, testid: `lite-doorpos-${p}` }))} />
                <h3 className="lite-sub-h">Single or double door</h3>
                <Segmented<DoorStyle> label="Door type" value={s.doorStyle} onChange={(v) => change({ doorStyle: v })} testid="lite-doorstyle"
                  options={[{ value: 'SINGLE', label: 'Single door', title: 'One door. It takes less wall.', testid: 'lite-doorstyle-SINGLE' }, { value: 'DOUBLE', label: 'Double door', title: 'A pair of doors that open together. Easier to carry things through, but it takes more wall.', testid: 'lite-doorstyle-DOUBLE' }]} />
                <p className="field-hint" data-testid="lite-doorhint">{s.doorStyle === 'DOUBLE' ? `Two doors that open together, about ${describeLength(cfg.doors.doubleMm, unit)} across.` : `One door, about ${describeLength(cfg.doors.singleMm, unit)} wide.`}</p>
              </div>
              <div className="lite-nav">
                <button type="button" className="btn primary lite-next" onClick={() => setStepTracked(2)} title="Next: choose your bottles and the finish of the racks." data-testid="lite-next"><span className="lite-next-label">Next: Racking &amp; finishes <span aria-hidden="true">&rarr;</span></span><span className="lite-next-sub">Step 2 of 3</span></button>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step 2 of 3</p>
              <h2 tabIndex={-1} ref={panelTitle} className="lite-step-title">Racking &amp; finishes</h2>
              <div className="lite-group" data-tour="lt-bottle">
                <h3><label htmlFor="lite-bottle-select">Main bottle style</label></h3>
                <select id="lite-bottle-select" value={s.bottle} onChange={(ev) => change({ bottle: ev.target.value as LiteSettings['bottle'] })} title="The bottle you have most of. Wider bottles mean fewer fit." data-testid="lite-bottle">
                  {BOTTLES.map((b) => <option key={b} value={b}>{BOTTLE_PROFILES[b].label}</option>)}
                </select>
                <p className="field-hint">The bottle you have most of. Wider bottles mean fewer fit.</p>
              </div>
              <div className="lite-group" data-tour="lt-mode">
                <h3>How many bottles</h3>
                <Segmented<LiteMode> label="How many bottles" value={s.mode} onChange={(v) => change({ mode: v })} testid="lite-mode"
                  options={[{ value: 'FILL', label: 'As many as fit', title: 'Fill every wall with racks.', testid: 'lite-mode-FILL' }, { value: 'TARGET', label: 'A number I choose', title: 'Tell us how many bottles you want. We use just enough racks for that number.', testid: 'lite-mode-TARGET' }]} />
                {s.mode === 'TARGET' && (
                  <div className="lite-target">
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
                    {result.problems.length === 0 && result.maxBottles < s.target && <p className="lite-note" data-testid="lite-short">This room holds about {result.maxBottles} at most, fewer than the {s.target} you asked for. Try a bigger room or a smaller bottle style.</p>}
                    {result.problems.length === 0 && result.maxBottles >= s.target && <p className="lite-note">The room could hold about {result.maxBottles} if every wall were full.</p>}
                  </div>
                )}
              </div>
              <div className="lite-group" data-tour="lt-finish">
                <h3>Rack finish</h3>
                <div className="finish" role="radiogroup" aria-label="Rack finish" data-testid="lite-finish">
                  {FINISHES.map((f: Finish) => (
                    <button type="button" key={f} role="radio" aria-checked={s.finish === f} className={`finish-btn${s.finish === f ? ' on' : ''}`} onClick={() => { change({ finish: f }); say('finish', { finish: f.toLowerCase() }); }} title={`${FINISH_NAMES[f]} racks. This changes how the racks look; it does not change the number of bottles.`} data-testid={`lite-finish-${f}`}>
                      <span className="finish-swatch" style={{ background: FINISH_LOOK[f].swatch }} aria-hidden="true" />
                      {FINISH_NAMES[f]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="lite-nav two">
                <button type="button" className="btn lite-backbtn" onClick={() => setStepTracked(1)} title="Back to the size and door." data-testid="lite-back"><span aria-hidden="true">&larr;</span> Space</button>
                <button type="button" className="btn primary lite-next" onClick={() => setStepTracked(3)} title="Next: review your cellar." data-testid="lite-next"><span className="lite-next-label">Next: Review <span aria-hidden="true">&rarr;</span></span><span className="lite-next-sub">Step 3 of 3</span></button>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step 3 of 3</p>
              <h2 tabIndex={-1} ref={panelTitle} className="lite-step-title">Review</h2>
              <dl className="lite-review" data-testid="lite-review">
                <div><dt>Room</dt><dd data-testid="lite-review-room">{roomText} inside</dd></div>
                <div><dt>Door</dt><dd>{doorText}</dd></div>
                <div><dt>Bottles</dt><dd>{BOTTLE_PROFILES[s.bottle].label}{s.mode === 'TARGET' ? `, about ${s.target} wanted` : ', as many as fit'}</dd></div>
                <div><dt>Racks</dt><dd>{FINISH_NAMES[s.finish]}, {rackUnitCount(result.project)} standard units</dd></div>
              </dl>
              <p className="lite-share">
                <button type="button" className="btn small" disabled={result.problems.length > 0 || pdf === 'working'} onClick={() => void download()} data-testid="lite-download" title="Saves your plan as a PDF to keep or show someone. It is a preliminary design, not a quote.">{pdf === 'working' ? 'Preparing…' : 'Download my plan (PDF)'}</button>
                {price && <button type="button" className="btn small" onClick={() => { setPriceHelpOpen(true); say('price_help'); }} title="A short outline of how the guide price follows from your choices." data-testid="lite-price-help-open">How is this price worked out?</button>}
                {pdf === 'done' && <span className="lite-note" role="status" data-testid="lite-download-done"> Your plan has been saved.</span>}
                {pdf === 'failed' && <span className="lite-note" role="alert"> Could not make the PDF. Please try again.</span>}
              </p>
              <p className="lite-note">This is an estimate to help you plan. Rack unit sizes are typical values, and we always measure on site before anything is made.</p>
              <div className="lite-nav two">
                <button type="button" className="btn lite-backbtn" onClick={() => setStepTracked(2)} title="Back to the bottles and finish." data-testid="lite-back"><span aria-hidden="true">&larr;</span> Racking</button>
                <button type="button" className="btn primary lite-next" onClick={ask} title="Ask us for a quote for exactly this design. Nothing is sent until you press Send on the form." data-testid="lite-quote-review"><span className="lite-next-label">Request a quote <span aria-hidden="true">&rarr;</span></span><span className="lite-next-sub">Final step</span></button>
              </div>
            </>
          )}
        </section>

        <section className="lite-visual" data-tour="lt-drawing" aria-label="Your cellar">
          <div className="lite-visual-head">
            <h2>Your cellar</h2>
            <div className="tabs" role="group" aria-label="Picture">
              <button type="button" className={`tab${view === 'inside' ? ' on' : ''}`} aria-pressed={view === 'inside'} onClick={() => { setView('inside'); say('view', { view: 'inside' }); }} title="What the cellar looks like inside, seen from the door. Drag to look around." data-testid="lite-tab-inside">3D</button>
              <button type="button" className={`tab${view === 'plan' ? ' on' : ''}`} aria-pressed={view === 'plan'} onClick={() => { setView('plan'); say('view', { view: 'plan' }); }} title="The cellar seen from above, with the door and the racks." data-testid="lite-tab-plan">Plan</button>
              <button type="button" className={`tab${view === 'racks' ? ' on' : ''}`} aria-pressed={view === 'racks'} onClick={() => { setView('racks'); say('view', { view: 'racks' }); }} title="One wall seen from inside the cellar, with every bottle drawn." data-testid="lite-tab-racks">Racks</button>
              {cfg.photo.enabled && <button type="button" className={`tab${view === 'photo' ? ' on' : ''}`} aria-pressed={view === 'photo'} onClick={() => { setView('photo'); say('view', { view: 'photo' }); }} title="A realistic photo-style picture of your cellar, made on request by AI." data-testid="lite-tab-photo">Photo</button>}
            </div>
          </div>
          {view === 'racks' && (
            <div className="tabs lite-walls" role="group" aria-label="Which wall">
              {WALLS.map((w) => <button type="button" key={w} className={`tab small${rackWall === w ? ' on' : ''}`} aria-pressed={rackWall === w} onClick={() => setRackWall(w)} title={`Show the racks on the ${WALL_NAMES[w].toLowerCase()} wall.`} data-testid={`lite-wall-${w}`}>{WALL_NAMES[w]}</button>)}
            </div>
          )}
          <div className="lite-canvas">
            {view === 'inside'
              ? <CellarView key="inside" input={insideInput} finish={s.finish} testid="lite-inside" description={`The inside of the cellar seen from the door: ${result.bottles} bottles on racks along the walls.`} />
              : view === 'photo'
              ? <PhotoView key="photo" input={insideInput} finish={s.finish} doorStyle={s.doorStyle} code={code} canMake={result.problems.length === 0} onMade={() => say('photo')} />
              : view === 'plan'
              ? <DrawingView look="warm" finish={s.finish} ctrlZoom key="plan" prims={plan} testid="lite-plan" description={`Plan of the cellar from above: ${roomText} inside, door on the ${s.doorWall.toLowerCase()} wall, about ${result.bottles} bottles.`} />
              : <DrawingView look="warmWall" finish={s.finish} ctrlZoom key={`racks-${rackWall}`} prims={racks} testid="lite-racks" description={`The racks on the ${rackWall.toLowerCase()} wall seen from inside, with each bottle drawn end-on.`} />}
          </div>
          {view === 'racks' && <p className="lite-note lite-units" data-testid="lite-racks-summary" role="status"><strong>{rackWallSummary(analysis.racks, fullRuns(result.project), rackWall).text}</strong> Each circle in the picture is one bottle, so you can count them. The whole cellar is about {result.bottles}.</p>}
          {(view === 'plan' || view === 'racks') && <p className="lite-note lite-units">The numbers drawn around the edges are sizes in millimetres.</p>}
          <p className="lite-note lite-units" data-testid="lite-units">Built from standard-size rack units, about {describeLength(cfg.rack.unitWidthMm, unit)} wide, placed whole along the walls. A gap at the end of a wall is left-over space, not a mistake.</p>
        </section>
      </div>

      <section className="lite-summary" data-tour="lt-result" aria-live="polite" data-testid="lite-result">
        <div className="lite-cell">
          <span className="lite-cell-label">Estimated capacity</span>
          <strong className="lite-cell-value" data-testid="lite-bottles">{result.problems.length ? '—' : `${result.bottles} bottles`}</strong>
          <small className="lite-cell-note">Estimate only, not a quote.</small>
        </div>
        <div className="lite-cell">
          <span className="lite-cell-label">Footprint</span>
          <strong className="lite-cell-value" data-testid="lite-footprint">{footprint}</strong>
        </div>
        <div className="lite-cell">
          <span className="lite-cell-label">Configuration</span>
          <strong className="lite-cell-value" data-testid="lite-config">{configuration}</strong>
        </div>
        {price && (
          <div className="lite-cell">
            <span className="lite-cell-label">Guide price</span>
            <strong className="lite-cell-value" data-testid="lite-price">{price.text}{cfg.pricing.note && <small className="lite-price-note"> {cfg.pricing.note}</small>}</strong>
          </div>
        )}
        <div className="lite-cell lite-cta-cell" data-tour="lt-quote">
          <button type="button" className="btn primary lite-cta" onClick={ask} title="Ask us for a quote for exactly this design. Nothing is sent until you press Send on the form." data-testid="lite-quote">Request a quote for this design <span aria-hidden="true">&rarr;</span></button>
          {cfg.phone && (
            <a className="lite-call" href={telHref(cfg.phone)} onClick={() => say('call')} title="Rather talk to someone? Tap to call. On a computer this opens your calling app, if you have one." data-testid="lite-call">Prefer to talk? Call {cfg.phone}</a>
          )}
        </div>
      </section>
      <p className="foot">ESTIMATE ONLY: FINAL SITE MEASURE REQUIRED. Rack unit sizes are typical values, not a quote.</p>

      <PriceHelp open={priceHelpOpen && !!price} onClose={() => setPriceHelpOpen(false)} cfg={cfg} facts={{ units: rackUnitCount(result.project), doorStyle: s.doorStyle, bottles: result.bottles, roomText, bottleLabel: BOTTLE_PROFILES[s.bottle].label }} />
      <TooltipHost />
      <LiteHelp unit={unit} doorSingleMm={cfg.doors.singleMm} doorDoubleMm={cfg.doors.doubleMm} unitWidthMm={cfg.rack.unitWidthMm} open={helpOpen} onClose={closeHelp} onTour={() => { closeHelp(); window.setTimeout(() => void startTour(), 250); }} />
    </div>
  );
}
