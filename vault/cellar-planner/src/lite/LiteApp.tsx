import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { WallSide } from '../enclosure';
import { analyseApp, fullRuns } from '../app/model';
import { badRunIds, planView, rackFaceView, rackWallSummary } from '../views';
import { DrawingView } from '../ui/DrawingView';
import { CellarView } from './CellarView';
import { buildScene } from './cellarScene';
import { makeThumb } from './thumbnail';
import { LiteHelp, LITE_HELP_KEY } from './LiteHelp';
import { PriceHelp } from './PriceHelp';
import { QuoteForm } from './QuoteForm';
import { DoorPicker } from './DoorPicker';
import { cardPriceLabel, chosenOptions, effectsOf, featureTotals, priceLabel, resolveFeatures, togglePick, unavailableReason } from './features';
import { STEP_TITLES, stepKeys, type StepKey } from './steps';
import { LengthField, Segmented, Stepper } from './controls';
import { TooltipHost } from '@planner-core/help/TooltipHost';
import { Icon } from '../ui/icons';
import { PHONE_QUERY, PhoneNotice } from './PhoneNotice';
import { PhotoModal } from './PhotoModal';
import { savePicture } from './savePicture';
import { DEFAULT_CONFIG, accentColours, loadConfig, telHref, type LiteConfig, type LitePreset } from './config';
import { FINISH_LOOK } from './finishes';
import { priceRange } from './price';
import { suggestFix } from './fixes';
import { track, type EventName } from './events';
import { clearLastDesign, readLastDesign, readUnit, writeLastDesign, writeUnit } from './remember';
import { LENGTH_UNITS, UNIT_NAMES, describeLength, formatLength, parseLength, rangeText, unitExample, unitSuffix, type LengthUnit } from './units';
import { BOTTLES, DOOR_POSITIONS, FINISHES, FINISH_NAMES, LIMITS, WALLS, decodeDesign, defaultLite, encodeDesign, liteResult, rackUnitCount, summaryLine, type DoorPosition, type DoorStyle, type Finish, type LiteMode, type LiteSettings } from './settings';

// The public "lite" tool: a planner in steps. Space (size, door), racking and finish (bottles, how many, timber), Features (the owner's "Make it yours"
// options, only while the owner has any) and a review (what it is, the guide price, the plan to keep). A large picture (3D, plan, or one wall of racks) is always beside the controls, with the
// capacity, footprint, configuration and quote button along the bottom. The browser remembers only the last design and the chosen unit.

const WALL_NAMES: Record<WallSide, string> = { NORTH: 'North', EAST: 'East', SOUTH: 'South', WEST: 'West' };
const POSITION_NAMES: Record<DoorPosition, string> = { LEFT: 'Left', CENTRE: 'Centre', RIGHT: 'Right' };
const UNIT_SHORT: Record<LengthUnit, string> = { m: 'Metres', ft: 'Feet', mm: 'Millimetres' };
const STEP_MM = 50;
export const MESSAGE_TYPE = 'cellar-lite:design';
export const HEIGHT_TYPE = 'cellar-lite:height';
/** The page around us tells us where its window is relative to our frame, so the picture can stay in view while the page scrolls. */
export const VIEWPORT_TYPE = 'cellar-lite:viewport';
/** Asks the page around us to scroll so the top of the steps (and the picture beside them) is in view. */
export const SCROLL_TYPE = 'cellar-lite:scroll';

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

/** The website help chat's round button (48 px); the title box keeps 56 px free beside the title for it, an 8 px gap plus the button (embedded only, see lite.css). */
const HELP_BTN = 48;

export function LiteApp() {
  const start = useMemo(startSettings, []);
  const [s, setS] = useState<LiteSettings>(start.s);
  const [unit, setUnit] = useState<LengthUnit>(readUnit);
  const [draft, setDraft] = useState<Draft>(() => toDraft(start.s, readUnit()));
  const [restored, setRestored] = useState(start.restored);
  const [stepKey, setStepKey] = useState<StepKey>('space');
  const [view, setView] = useState<'inside' | 'plan' | 'racks'>('inside');
  // Render photo: desktop and tablet only. A phone is told so (the same width the layout treats as a phone).
  const [photoOpen, setPhotoOpen] = useState(false);
  const [isPhone, setIsPhone] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE_QUERY);
    if (!mq) return undefined;
    const on = (): void => setIsPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const [rackWall, setRackWall] = useState<WallSide>('NORTH');
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [priceHelpOpen, setPriceHelpOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState<'' | 'done' | 'failed'>('');
  const [pdf, setPdf] = useState<'' | 'working' | 'done' | 'failed'>('');
  const [thumb, setThumb] = useState('');
  // Features accordion: which groups the visitor has opened or closed (the first starts open)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  // the owner's settings (rack sizes, prices, brand colour, starting rooms): the built-in defaults until the real ones arrive, and still if they never do
  const [cfg, setCfg] = useState<LiteConfig>(DEFAULT_CONFIG);
  const panelTitle = useRef<HTMLHeadingElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  /** The last viewport message from the page around us (frame top, window height): where the sticky footer belongs when embedded. */
  const vpRef = useRef<{ frameTop: number; vh: number } | null>(null);
  const started = useRef(false);
  const stepSeen = useRef(false);
  const quietStep = useRef(false);

  // the feature options: what is chosen for this room, the extras that add to the price, and the picture changes they ask for
  const resolved = useMemo(() => resolveFeatures(cfg.features, s.features, { widthMm: s.widthMm, depthMm: s.depthMm }), [cfg.features, s.features, s.widthMm, s.depthMm]);
  const effects = useMemo(() => effectsOf(chosenOptions(resolved)), [resolved]);
  const hasFeatures = cfg.features.length > 0;
  const keys = stepKeys(hasFeatures);
  const key: StepKey = keys.includes(stepKey) ? stepKey : 'space';
  const step = keys.indexOf(key) + 1;
  const totalSteps = keys.length;

  const result = useMemo(() => liteResult(s, cfg), [s, cfg]);
  const analysis = useMemo(() => analyseApp(result.project), [result]);
  const code = useMemo(() => encodeDesign(s), [s]);
  const price = useMemo(() => priceRange(cfg, rackUnitCount(result.project), s.doorStyle, result.problems.length, resolved.extras), [cfg, result, s.doorStyle, resolved]);
  const summary = useMemo(() => summaryLine(s, result.bottles, cfg) + (price ? ` Guide price shown: ${price.text}.` : ''), [s, result.bottles, cfg, price]);
  const fix = useMemo(() => (result.problems.length ? suggestFix(s, cfg, unit) : null), [s, cfg, unit, result.problems.length]);
  const e = result.project.enclosure;
  const plan = useMemo(() => planView(e, fullRuns(result.project), analysis.racks, { walkwayMm: null, badRuns: badRunIds(analysis.racks.issues), plainLabels: true }), [result, analysis, e]);
  const dims = useMemo(() => ({ width: describeLength(s.widthMm, unit), depth: describeLength(s.depthMm, unit), height: describeLength(s.heightMm, unit) }), [s.widthMm, s.depthMm, s.heightMm, unit]);
  const insideInput = useMemo(() => ({ project: result.project, runs: fullRuns(result.project), analysis: analysis.racks, dims, effects }), [result, analysis, dims, effects]);
  const racks = useMemo(() => rackFaceView(e, fullRuns(result.project), analysis.racks, rackWall, result.project.bottle, { badRuns: badRunIds(analysis.racks.issues) }), [result, analysis, e, rackWall]);
  const embedded = parentOrigin();
  useEffect(() => { if (embedded) document.documentElement.dataset.embedded = '1'; }, [embedded]);
  const say = (name: EventName, detail?: Record<string, string | number | boolean>): void => track(name, embedded, detail);
  const brand = useMemo(() => accentColours(cfg.accent), [cfg.accent]);

  // keep the address reopenable (?d=), remember the design for next time, and keep the page around us in step so its enquiry form is always current
  useEffect(() => {
    try { const u = new URL(window.location.href); u.searchParams.set('d', code); window.history.replaceState(null, '', u); } catch { /* sandboxed frame: skip */ }
    // only a design the visitor has changed is worth remembering: the untouched standard room would just greet them as "welcome back" for nothing
    if (code === encodeDesign(defaultLite())) clearLastDesign(); else writeLastDesign(code);
    const to = parentOrigin();
    if (to) window.parent.postMessage({ type: MESSAGE_TYPE, version: 1, code, summary, bottles: result.bottles, priceText: price?.text ?? '', thumb, requested: false, footer: true }, to);
  }, [code, summary, result.bottles, price, thumb]);

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
      // where the website's help chat button belongs: just right of the title block, level with the title (the page script puts it there)
      const box = document.querySelector('.lite-titlebox')?.getBoundingClientRect(), h1 = document.querySelector('.lite-head h1')?.getBoundingClientRect();
      const helpSpot = box && h1 ? { left: Math.round(box.right - HELP_BTN), top: Math.round(h1.top + window.scrollY + h1.height / 2 - HELP_BTN / 2) } : null;
      const key = `${h}/${top}/${bottom}/${helpSpot ? `${helpSpot.left},${helpSpot.top}` : ''}`;
      if (key !== last) { last = key; window.parent.postMessage({ type: HEIGHT_TYPE, version: 1, height: h, pictureTop: top, pictureBottom: bottom, helpSpot }, to); }
    };
    const ro = new ResizeObserver(() => { if (!raf) raf = requestAnimationFrame(send); });
    ro.observe(document.body);
    send();
    // a script that starts after we did (the website help chat) asks for the last report again: it would otherwise wait for the next change
    const onAsk = (ev: MessageEvent): void => {
      const d = ev.data as { type?: unknown; version?: unknown } | null;
      if (ev.origin !== to || ev.source !== window.parent || !d || d.type !== 'cellar-lite:resend' || d.version !== 1) return;
      last = ''; send();
    };
    window.addEventListener('message', onAsk);
    return () => { ro.disconnect(); window.removeEventListener('message', onAsk); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // The footer is sticky on a phone only (a desktop or tablet visitor has the buttons at the end of the panel). Standalone, CSS sticky keeps it at the bottom of the window. Embedded, the frame is as tall as the planner, so
  // the footer is moved down to the bottom of what the visitor can see (the page script reports it), never above the top of the controls and never past
  // its own place at the end of the page. Skipped when the frame scrolls by itself (CSS sticky works then).
  const placeFooter = (): void => {
    const f = footerRef.current, vp = vpRef.current;
    if (!f) return;
    const root = document.documentElement;
    if (!vp || !isPhoneRef.current || root.scrollHeight > window.innerHeight + 2) { f.style.transform = ''; f.dataset.shift = '0'; return; }
    const cur = Number(f.dataset.shift || 0), r = f.getBoundingClientRect();
    const natBottom = r.bottom - cur + window.scrollY, natTop = r.top - cur + window.scrollY;
    const mainTop = (document.querySelector('.lite-main')?.getBoundingClientRect().top ?? 0) + window.scrollY;
    const visibleBottom = -vp.frameTop + vp.vh;
    const shift = visibleBottom < natBottom ? Math.max(visibleBottom - natBottom, mainTop - natTop) : 0;
    f.style.transform = shift ? `translateY(${Math.round(shift)}px)` : '';
    f.dataset.shift = String(Math.round(shift));
  };
  const isPhoneRef = useRef(isPhone);
  isPhoneRef.current = isPhone;
  const placeFooterRef = useRef(placeFooter);
  placeFooterRef.current = placeFooter;

  // Keeping the picture in view while the page scrolls. When the planner is embedded its frame is as tall as the planner, so CSS "sticky" has nothing
  // to stick to: the page script (cellar-lite-fill.js) sends where the visible window is, and the picture is moved down by that much, inside the planner's
  // own columns. Standalone (or a page without the script), plain CSS sticky does the job. Only on two columns (900 px and wider).
  useEffect(() => {
    const to = parentOrigin();
    if (!to) return undefined;
    const onMessage = (ev: MessageEvent): void => {
      if (ev.origin !== to || ev.source !== window.parent) return;
      const d = ev.data as { type?: unknown; version?: unknown; frameTop?: unknown; viewportH?: unknown; gap?: unknown; topInset?: unknown } | null;
      if (!d || d.type !== VIEWPORT_TYPE || d.version !== 1) return;
      const frameTop = Number(d.frameTop), vh = Number(d.viewportH), gap = Math.min(400, Math.max(0, Number(d.gap) || 12));
      if (!Number.isFinite(frameTop) || !Number.isFinite(vh) || vh < 200 || vh > 5000) return;
      vpRef.current = { frameTop, vh };
      placeFooterRef.current();
      const el = document.querySelector<HTMLElement>('.lite-visual'), main = document.querySelector<HTMLElement>('.lite-main');
      if (!el || !main) return;
      document.documentElement.style.setProperty('--lite-vh', `${Math.round(vh)}px`);
      // Pop-ups and the tour's centred cards belong in the middle of what the visitor can SEE, not in the middle of this frame (which is as tall
      // as the whole planner): tell the CSS where the visible part of the frame starts and how tall it is.
      // topInset: how much of the screen's top the website's own fixed menu covers: nothing of ours goes under it
      const inset = Math.min(300, Math.max(0, Number(d.topInset) || 0));
      const visTop = Math.max(0, -frameTop + inset);
      const visH = Math.max(200, Math.min(vh - inset - Math.max(0, frameTop), window.innerHeight - visTop));
      document.documentElement.style.setProperty('--vis-top', `${Math.round(visTop)}px`);
      document.documentElement.style.setProperty('--vis-h', `${Math.round(visH)}px`);
      el.dataset.follow = '1';
      if (window.innerWidth < 900) { el.style.transform = ''; return; }
      const mainRect = main.getBoundingClientRect();
      const room = Math.max(0, mainRect.height - el.offsetHeight);
      const down = Math.min(room, Math.max(0, -frameTop + gap - mainRect.top));
      el.style.transform = down > 0 ? `translateY(${Math.round(down)}px)` : '';
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => { placeFooterRef.current(); });
  useEffect(() => { void loadConfig().then((r) => setCfg(r.config)); }, []);
  useEffect(() => { if (restored) say('welcome_back'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // moving to another step puts the reader at the top of it: the heading takes focus (screen readers hear the step's name) and the page scrolls to the
  // step strip, so the picture is in view (coming back from the long Features step used to leave you at its empty bottom). Embedded, the page around us
  // does the scrolling (the frame is as tall as the planner): we tell it where the strip is. The tour moves steps itself and scrolls on its own.
  useEffect(() => {
    if (!stepSeen.current) { stepSeen.current = true; return; }
    panelTitle.current?.focus({ preventScroll: true });
    if (quietStep.current) { quietStep.current = false; return; }
    const strip = document.querySelector<HTMLElement>('[data-testid="lite-stepper"]');
    if (!strip) return;
    const to = parentOrigin();
    if (to) window.parent.postMessage({ type: SCROLL_TYPE, version: 1, top: Math.max(0, Math.round(strip.getBoundingClientRect().top + window.scrollY - 8)) }, to);
    else strip.scrollIntoView({ behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }, [key]);

  // ?tour=1 starts the tour straight away; the guide opens only from the Help button (a pop-up on arrival is closed unread by most visitors)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('tour')) window.setTimeout(() => void startTour(), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const closeHelp = (): void => { try { localStorage.setItem(LITE_HELP_KEY, '1'); } catch { /* fine */ } setHelpOpen(false); };
  /** Shepherd is loaded on first use, so it stays out of the page's first download. */
  const startTour = async (): Promise<void> => {
    const m = await import('./liteTour');
    m.startLiteTour({ setView, getView: () => viewRef.current, setStep: (k) => setStepTracked(k, false), getStep: () => keyRef.current });
  };
  const viewRef = useRef(view);
  viewRef.current = view;
  const keyRef = useRef(key);
  keyRef.current = key;

  // The website's help chat (cellar-lite-guide.js, on the page around us) can take the visitor to a step, or open Help or the tour: it sends
  // { type: 'cellar-lite:go', version: 1, id } and we do it. Only from the embedding page; only these ids; a step that is not there is ignored.
  const goRef = useRef<(id: string) => void>(() => undefined);
  goRef.current = (id: string): void => {
    if (id === 'help') { setHelpOpen(true); return; }
    if (id === 'tour') { void startTour(); return; }
    if (id === 'quote') { if (!result.problems.length) ask(); return; }
    if ((stepKeys(hasFeatures) as string[]).includes(id)) setStepTracked(id as StepKey);
  };
  useEffect(() => {
    const to = parentOrigin();
    if (!to) return undefined;
    const onGo = (ev: MessageEvent): void => {
      if (ev.origin !== to || ev.source !== window.parent) return;
      const d = ev.data as { type?: unknown; version?: unknown; id?: unknown } | null;
      if (!d || d.type !== 'cellar-lite:go' || d.version !== 1 || typeof d.id !== 'string') return;
      goRef.current(d.id);
    };
    window.addEventListener('message', onGo);
    return () => window.removeEventListener('message', onGo);
  }, []);

  const setStepTracked = (k: StepKey, count = true): void => { if (!count && k !== keyRef.current) quietStep.current = true; setStepKey(k); if (count) say('step', { step: k }); };

  /** Put a whole design on screen: the settings and the boxes that show them. */
  const show = (next: LiteSettings, u: LengthUnit = unit): void => { setS(next); setDraft(toDraft(next, u)); };
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
  const startAgain = (): void => { clearLastDesign(); setRestored(false); show(defaultLite()); setStepKey('space'); };
  // Request a quote: the visitor's name, email, phone and state are asked for right here (QuoteForm), not on another page.
  const ask = (): void => { say('quote'); setQuoteOpen(true); };

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

  /** Back and Next for the step on screen: they live in the sticky footer so they are always in reach. */
  const stepNav = ((): { back: { label: string; title: string; go: () => void } | null; next: { label: string; title: string; go: () => void; quote?: boolean } } => {
    if (key === 'space') return { back: null, next: { label: 'Next: Racking & finishes', title: 'Next: choose your bottles and the finish of the racks.', go: () => setStepTracked('racking') } };
    if (key === 'racking') return { back: { label: 'Space', title: 'Back to the size and door.', go: () => setStepTracked('space') }, next: { label: `Next: ${STEP_TITLES[keys[2] ?? 'review']}`, title: hasFeatures ? 'Next: choose the finishing touches.' : 'Next: review your cellar.', go: () => setStepTracked(keys[2] ?? 'review') } };
    if (key === 'features') return { back: { label: 'Racking', title: 'Back to the bottles and finish.', go: () => setStepTracked('racking') }, next: { label: 'Next: Review', title: 'Next: review your cellar.', go: () => setStepTracked('review') } };
    return { back: { label: hasFeatures ? 'Features' : 'Racking', title: hasFeatures ? 'Back to the finishing touches.' : 'Back to the bottles and finish.', go: () => setStepTracked(hasFeatures ? 'features' : 'racking') }, next: { label: 'Request a quote', title: 'Ask us for a quote for exactly this design. Nothing is sent until you press Send on the form.', go: ask, quote: true } };
  })();

  /** Back and Next. On a phone they sit in the sticky footer (the quote button is Next on Review); on a desktop or tablet they end the step's panel. */
  const navButtons = (quoteId: string) => (
    <div className="lite-nav two">
      {stepNav.back && <button type="button" className="btn lite-backbtn" onClick={stepNav.back.go} title={stepNav.back.title} data-testid="lite-back"><span aria-hidden="true">&larr;</span><span className="lite-back-label"> {stepNav.back.label}</span></button>}
      <button type="button" className="btn primary lite-next" onClick={stepNav.next.go} title={stepNav.next.title} data-testid={stepNav.next.quote ? quoteId : 'lite-next'}><span className="lite-next-label">{stepNav.next.label} <span aria-hidden="true">&rarr;</span></span></button>
    </div>
  );

  return (
    <div className="lite" data-testid="lite" style={{ '--primary': brand.main, '--primary-dark': brand.dark, '--primary-soft': brand.soft } as CSSProperties}>
      <PhoneNotice show={cfg.mobileNotice.show} text={cfg.mobileNotice.text} phone={cfg.phone} onCall={() => say('call')} />
      <header className="lite-head">
        <div className="lite-head-row">
          <div className="lite-titlebox">
            <h1>Cellar Planner</h1>
            <p className="lite-sub">Create a cellar that fits your space.</p>
          </div>
          <span className="lite-help-btns">
            {/* icons, not words: each has a name for screen readers and a tooltip */}
            <button type="button" className="btn icon labelled" aria-label="Take the tour" title="Take the tour: a guided walk through the screen, one step at a time." onClick={() => void startTour()} data-testid="lite-tour"><Icon name="compass" /><span className="btn-label">Tour</span></button>
            <button type="button" className="btn icon labelled" aria-label="Help" title="Help: the plain-language guide, what each question means." onClick={() => setHelpOpen(true)} data-testid="lite-help-open"><Icon name="info" /><span className="btn-label">Help</span></button>
            <button type="button" className="btn icon labelled" aria-label="Save design" onClick={() => void copyLink()} data-testid="lite-share" title="Save design: copies a link to this exact design. Paste it anywhere to come back to it, or send it to someone."><Icon name="bookmark" /><span className="btn-label">Save</span></button>
            <button type="button" className="btn icon labelled" aria-label="Download my plan (PDF)" aria-busy={pdf === 'working'} disabled={result.problems.length > 0 || pdf === 'working'} onClick={() => void download()} data-testid="lite-download" title={pdf === 'working' ? 'Preparing your plan…' : 'Download my plan (PDF): saves your plan to keep or show someone. It is a preliminary design, not a quote.'}><Icon name="download" /><span className="btn-label">Download</span></button>
            {price && <button type="button" className="btn icon labelled" aria-label="How is this price worked out?" onClick={() => { setPriceHelpOpen(true); say('price_help'); }} title="How is this price worked out? A short outline of how the guide price follows from your choices." data-testid="lite-price-help-open"><Icon name="calc" /><span className="btn-label">Price</span></button>}
          </span>
        </div>
        {pdf === 'done' && <p className="lite-note" role="status" data-testid="lite-download-done">Your plan has been saved.</p>}
        {pdf === 'failed' && <p className="lite-note" role="alert">Could not make the PDF. Please try again.</p>}
        {linkCopied === 'done' && <p className="lite-note" role="status" data-testid="lite-share-done">Link copied. Anyone you send it to sees these choices.</p>}
        {linkCopied === 'failed' && <p className="lite-note" role="status">Could not copy the link automatically. Copy the address from your browser's address bar instead: it holds your design.</p>}
        {cfg.promise && <p className="lite-promise" data-testid="lite-promise">{cfg.promise}</p>}
        <Stepper step={step} steps={keys.map((k) => STEP_TITLES[k])} onGo={(n) => setStepTracked(keys[n - 1] ?? 'space')} />
      </header>

      {restored && (
        <p className="lite-welcome" role="status" data-testid="lite-welcome">
          Welcome back. We kept your last design.{' '}
          <button type="button" className="linklike" onClick={startAgain} title="Forget the last design and begin again with the standard room." data-testid="lite-start-again">Start again</button>
        </p>
      )}

      <div className="lite-main">
        <section className="lite-panel" aria-label={`Step ${step}: ${STEP_TITLES[key]}`} data-testid="lite-panel" data-step={step}>
          {result.problems.length > 0 && (
            <div className="lite-alert" role="alert">
              <p className="lite-problem" data-testid="lite-problem">This size cannot be built as entered: {result.problems[0]}</p>
              {fix
                ? <p className="lite-fix"><button type="button" className="btn primary small" onClick={() => { show(fix.settings); say('fix'); }} title="Apply this one change to your design. You can change it back." data-testid="lite-fix">{fix.text}</button> <span className="lite-note">One change that makes it work.</span></p>
                : <p className="lite-note" data-testid="lite-nofix">Try a bigger room or a smaller bottle style.</p>}
            </div>
          )}

          {key === 'space' && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step 1 of {totalSteps}</p>
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
            </>
          )}

          {key === 'racking' && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step 2 of {totalSteps}</p>
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
            </>
          )}

          {key === 'features' && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step 3 of {totalSteps}</p>
              <h2 tabIndex={-1} ref={panelTitle} className="lite-step-title">Make it yours</h2>
              <p className="lite-lede">The finishing touches that turn storage into a room you show off. Add as much or as little as you like.{price ? ' The guide price updates as you go.' : ''}</p>
              <div data-tour="lt-features" data-testid="lite-features">
                {resolved.groups.map(({ group, chosen }, gi) => {
                  const one = group.mode === 'ONE';
                  const open = openGroups[group.id] ?? gi === 0;
                  // what the closed header says: the pick in a pick-one group, or what has been added in a pick-any group
                  const summaryText = one ? (chosen[0]?.name ?? '') : chosen.length === 0 ? 'None added' : chosen.length === 1 ? (chosen[0]?.name ?? '') : `${chosen.length} chosen`;
                  return (
                    <div className={`feat-group${open ? ' open' : ''}`} key={group.id} data-testid={`feat-group-${group.id}`}>
                      <h3 className="feat-head" id={`feat-h-${group.id}`}>
                        <button type="button" className="feat-toggle" aria-expanded={open} aria-controls={`feat-body-${group.id}`} data-testid={`feat-toggle-${group.id}`}
                          title={open ? `Close ${group.name}.` : `Open ${group.name}.`}
                          onClick={() => setOpenGroups((cur) => ({ ...cur, [group.id]: !(cur[group.id] ?? gi === 0) }))}>
                          <span className="feat-title">{group.name}</span>
                          <span className="feat-summary" data-testid={`feat-summary-${group.id}`}>{summaryText}</span>
                          <span className="feat-chev" aria-hidden="true" />
                        </button>
                      </h3>
                      <div className="feat-body" id={`feat-body-${group.id}`} hidden={!open} role={one ? 'radiogroup' : 'group'} aria-labelledby={`feat-h-${group.id}`}>
                        <p className="feat-hint">{group.hint ? `${group.hint} ` : ''}<span className="feat-mode">{one ? 'Choose one.' : 'Choose any.'}</span></p>
                        <div className="feat-cards">
                          {group.options.filter((o) => o.enabled || chosen.some((c) => c.code === o.code)).map((o) => {
                            const on = chosen.some((c) => c.code === o.code);
                            const why = unavailableReason(o, { widthMm: s.widthMm, depthMm: s.depthMm });
                            const label = cardPriceLabel(o, { widthMm: s.widthMm, depthMm: s.depthMm }, cfg.pricing.currency, cfg.pricing.show);
                            return (
                              <button type="button" key={o.id} role={one ? 'radio' : 'checkbox'} aria-checked={on} aria-disabled={why !== null} disabled={why !== null && !on}
                                className={`feat-card${on ? ' on' : ''}${why ? ' off' : ''}`} data-testid={`feat-${group.id}-${o.id}`}
                                title={why ?? (on && !one ? `Take ${o.name} out of the design.` : `${one ? 'Choose' : 'Add'} ${o.name}.`)}
                                onClick={() => { change({ features: togglePick(cfg.features, s.features, group, o) }); say('feature', { group: group.id, option: o.id }); }}>
                                {on && <span className="feat-tick" aria-hidden="true">&#10003;</span>}
                                {o.badge && <span className="feat-badge">{o.badge === 'POPULAR' ? 'Popular' : 'Recommended'}</span>}
                                <span className="feat-name">{o.name}</span>
                                <span className="feat-desc">{why ?? o.description}</span>
                                {label && <span className="feat-price">{label}</span>}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {key === 'review' && (
            <>
              <p className="lite-eyebrow" data-testid="lite-progress">Step {totalSteps} of {totalSteps}</p>
              <h2 tabIndex={-1} ref={panelTitle} className="lite-step-title">Review</h2>
              <dl className="lite-review" data-testid="lite-review">
                <div><dt>Room</dt><dd data-testid="lite-review-room">{roomText} inside</dd></div>
                <div><dt>Door</dt><dd>{doorText}</dd></div>
                <div><dt>Bottles</dt><dd>{BOTTLE_PROFILES[s.bottle].label}{s.mode === 'TARGET' ? `, about ${s.target} wanted` : ', as many as fit'}</dd></div>
                <div><dt>Racks</dt><dd>{FINISH_NAMES[s.finish]}, {rackUnitCount(result.project)} standard units</dd></div>
                {hasFeatures && <div><dt>Features</dt><dd data-testid="lite-review-features">{resolved.extras.length ? resolved.extras.map((o) => o.name).join(', ') : 'Standard options only'}</dd></div>}
              </dl>
              <p className="lite-note">This is an estimate to help you plan. Rack unit sizes are typical values, and we always measure on site before anything is made.</p>
            </>
          )}
          {!isPhone && navButtons('lite-quote-review')}
        </section>

        <section className="lite-visual" data-tour="lt-drawing" aria-label="Your cellar">
          <div className="lite-visual-head">
            <h2>Your cellar</h2>
            <div className="tabs" role="group" aria-label="Picture">
              <button type="button" className={`tab${view === 'inside' ? ' on' : ''}`} aria-pressed={view === 'inside'} onClick={() => { setView('inside'); say('view', { view: 'inside' }); }} title="What the cellar looks like inside, seen from the door. Drag to look around." data-testid="lite-tab-inside">3D</button>
              <button type="button" className={`tab${view === 'plan' ? ' on' : ''}`} aria-pressed={view === 'plan'} onClick={() => { setView('plan'); say('view', { view: 'plan' }); }} title="The cellar seen from above, with the door and the racks." data-testid="lite-tab-plan">Plan</button>
              <button type="button" className={`tab${view === 'racks' ? ' on' : ''}`} aria-pressed={view === 'racks'} onClick={() => { setView('racks'); say('view', { view: 'racks' }); }} title="One wall seen from inside the cellar, with every bottle drawn." data-testid="lite-tab-racks">Racks</button>
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
              : view === 'plan'
              ? <DrawingView look="warm" finish={s.finish} ctrlZoom key="plan" prims={plan} testid="lite-plan" description={`Plan of the cellar from above: ${roomText} inside, door on the ${s.doorWall.toLowerCase()} wall, about ${result.bottles} bottles.`} />
              : <DrawingView look="warmWall" finish={s.finish} ctrlZoom key={`racks-${rackWall}`} prims={racks} testid="lite-racks" description={`The racks on the ${rackWall.toLowerCase()} wall seen from inside, with each bottle drawn end-on.`} />}
          </div>
          {view === 'inside' && (
            <div className="lite-photo-row" data-testid="lite-photo-row">
              {isPhone ? (
                <p className="lite-note" data-testid="lite-photo-phone">Render photo is not available on a phone. Open this page on a laptop or tablet to make a realistic picture of your cellar.</p>
              ) : (
                <>
                  <button type="button" className="btn" onClick={() => setPhotoOpen(true)} title="Make a realistic picture of your cellar, with lifelike light and shadow. It is drawn by your own computer and takes a few minutes." data-testid="lite-photo-open">Render photo&hellip;</button>
                  <button type="button" className="btn" onClick={() => void savePicture(document.querySelector('[data-testid="lite-inside-canvas"]') ?? document, result.project.name)} title="Save the 3D picture as it is now, straight away, as a PNG file." data-testid="lite-photo-quick">Save picture</button>
                  <span className="lite-note lite-photo-hint">Render photo is a realistic picture and takes a few minutes.</span>
                </>
              )}
            </div>
          )}
          {view === 'racks' && <p className="lite-note lite-units" data-testid="lite-racks-summary" role="status"><strong>{rackWallSummary(analysis.racks, fullRuns(result.project), rackWall).text}</strong> Each circle in the picture is one bottle, so you can count them. The whole cellar is about {result.bottles}.</p>}
          {view !== 'inside' && <p className="lite-note lite-units">The numbers drawn around the edges are sizes in millimetres.</p>}
          {key === 'features' && (
            <div className="lite-added" data-testid="lite-added" aria-live="polite">
              <h3>Added so far</h3>
              {resolved.extras.length === 0
                ? <p className="lite-note">Nothing extra yet. Your cellar is priced with the standard options: {resolved.groups.filter((g) => g.group.mode === 'ONE').map((g) => g.chosen[0]?.name).filter(Boolean).join(', ')}.</p>
                : <ul className="lite-added-list">{resolved.extras.map((o) => <li key={o.code}><span>{o.name}</span>{priceLabel(o, cfg.pricing.currency, cfg.pricing.show) && <span>{priceLabel(o, cfg.pricing.currency, cfg.pricing.show)}</span>}</li>)}</ul>}
              {cfg.pricing.show && (() => {
                const t = featureTotals(resolved.extras), fmt = (n: number): string => `${cfg.pricing.currency}${n.toLocaleString('en-AU')}`;
                return <p className="lite-added-total"><span>Features total</span><strong data-testid="lite-features-total">{t.low === 0 && t.high === 0 ? fmt(0) : t.low === t.high ? fmt(t.low) : `${fmt(t.low)} to ${fmt(t.high)}`}</strong></p>;
              })()}
              {resolved.extras.some((o) => featureTotals([o]).unpriced.length > 0) && cfg.pricing.show && <p className="lite-note">Some of your choices are priced on request: they are not in the total.</p>}
            </div>
          )}
          <p className="lite-note lite-units" data-testid="lite-units">Built from standard-size rack units, about {describeLength(cfg.rack.unitWidthMm, unit)} wide, placed whole along the walls. A gap at the end of a wall is left-over space, not a mistake.</p>
        </section>
      </div>

      <section className="lite-summary" ref={footerRef} data-tour="lt-result" aria-live="polite" data-testid="lite-result">
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
          {isPhone && navButtons('lite-quote')}
          {!isPhone && (
            <>
              <button type="button" className="btn primary lite-cta" onClick={ask} title="Ask us for a quote for exactly this design. Nothing is sent until you press Send on the form." data-testid="lite-quote">Request a quote for this design <span aria-hidden="true">&rarr;</span></button>
              {cfg.phone && (
                <a className="lite-call" href={telHref(cfg.phone)} onClick={() => say('call')} title="Rather talk to someone? Tap to call. On a computer this opens your calling app, if you have one." data-testid="lite-call">Prefer to talk? Call {cfg.phone}</a>
              )}
            </>
          )}
        </div>
      </section>
      <p className="foot">ESTIMATE ONLY: FINAL SITE MEASURE REQUIRED. Rack unit sizes are typical values, not a quote.</p>

      <QuoteForm open={quoteOpen} onClose={() => setQuoteOpen(false)} design={{ code, summary, bottles: result.bottles, priceText: price?.text ?? '' }} phone={cfg.phone} note={cfg.quoteNote} onSent={() => say('quote_sent')} />
      <PriceHelp open={priceHelpOpen && !!price} onClose={() => setPriceHelpOpen(false)} cfg={cfg} facts={{ units: rackUnitCount(result.project), doorStyle: s.doorStyle, bottles: result.bottles, roomText, bottleLabel: BOTTLE_PROFILES[s.bottle].label, extras: resolved.extras.map((o) => o.name) }} />
      <PhotoModal open={photoOpen} onClose={() => setPhotoOpen(false)} input={insideInput} name={result.project.name} />
      <TooltipHost look="vault" />
      <LiteHelp unit={unit} doorSingleMm={cfg.doors.singleMm} doorDoubleMm={cfg.doors.doubleMm} unitWidthMm={cfg.rack.unitWidthMm} open={helpOpen} onClose={closeHelp} onTour={() => { closeHelp(); window.setTimeout(() => void startTour(), 250); }} />
    </div>
  );
}
