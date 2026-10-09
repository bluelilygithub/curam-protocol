import { useEffect, useMemo, useRef, useState } from 'react';
import { BOTTLE_PROFILES } from '../engine/defaults';
import type { WallSide } from '../enclosure';
import { analyseApp, fullRuns } from '../app/model';
import { badRunIds, planView, rackFaceView, rackWallSummary } from '../views';
import { DrawingView } from '../ui/DrawingView';
import { LiteHelp, LITE_HELP_KEY } from './LiteHelp';
import { BOTTLES, LIMITS, WALLS, LITE_DOOR_WIDTH_MM, LITE_UNIT_WIDTH_MM, decodeDesign, defaultLite, encodeDesign, liteResult, summaryLine, type DoorStyle, type LiteMode, type LiteSettings } from './settings';

// The public "lite" tool. Three or four choices, a plan and a racks picture, a bottle estimate, and a "request a quote" step that hands a design code
// to the page around it (postMessage) or lets the visitor copy it. No login, no server, nothing stored.

const WALL_NAMES: Record<WallSide, string> = { NORTH: 'North', EAST: 'East', SOUTH: 'South', WEST: 'West' };
export const MESSAGE_TYPE = 'cellar-lite:design';

/** Where to send the hand-off: the page that embeds us (its origin comes from the referrer). Null when not embedded, so nothing is ever broadcast. */
export function parentOrigin(): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null;
  try { return new URL(document.referrer).origin; } catch { return null; }
}

function startSettings(): LiteSettings {
  const code = new URLSearchParams(window.location.search).get('d');
  return (code && decodeDesign(code)) || defaultLite();
}

type Draft = { widthMm: string; depthMm: string; heightMm: string; target: string };
const toDraft = (s: LiteSettings): Draft => ({ widthMm: String(s.widthMm), depthMm: String(s.depthMm), heightMm: String(s.heightMm), target: String(s.target) });

export function LiteApp() {
  const [s, setS] = useState<LiteSettings>(startSettings);
  const [draft, setDraft] = useState<Draft>(() => toDraft(startSettings()));
  const [view, setView] = useState<'plan' | 'racks'>('plan');
  const [rackWall, setRackWall] = useState<WallSide>('NORTH');
  const [asked, setAsked] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [copied, setCopied] = useState<'' | 'done' | 'failed'>('');
  const codeBox = useRef<HTMLTextAreaElement>(null);

  const result = useMemo(() => liteResult(s), [s]);
  const analysis = useMemo(() => analyseApp(result.project), [result]);
  const code = useMemo(() => encodeDesign(s), [s]);
  const summary = useMemo(() => summaryLine(s, result.bottles), [s, result.bottles]);
  const e = result.project.enclosure;
  const plan = useMemo(() => planView(e, fullRuns(result.project), analysis.racks, { walkwayMm: null, badRuns: badRunIds(analysis.racks.issues), plainLabels: true }), [result, analysis, e]);
  const racks = useMemo(() => rackFaceView(e, fullRuns(result.project), analysis.racks, rackWall, result.project.bottle, { badRuns: badRunIds(analysis.racks.issues) }), [result, analysis, e, rackWall]);

  // keep the address reopenable (?d=), and keep the page around us in step so its enquiry form is always current
  useEffect(() => {
    try { const u = new URL(window.location.href); u.searchParams.set('d', code); window.history.replaceState(null, '', u); } catch { /* sandboxed frame: skip */ }
    const to = parentOrigin();
    if (to) window.parent.postMessage({ type: MESSAGE_TYPE, version: 1, code, summary, bottles: result.bottles, requested: asked }, to);
  }, [code, summary, result.bottles, asked]);

  // first visit: the guide opens once (the Help button reopens it); ?tour=1 starts the tour straight away
  useEffect(() => {
    try { if (!localStorage.getItem(LITE_HELP_KEY)) setHelpOpen(true); } catch { /* storage blocked: skip the auto-open */ }
    if (new URLSearchParams(window.location.search).has('tour')) { setHelpOpen(false); window.setTimeout(() => void startTour(), 400); }
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

  const setNum = (key: 'widthMm' | 'depthMm' | 'heightMm' | 'target', text: string): void => {
    setDraft((d) => ({ ...d, [key]: text }));
    const n = Number(text);
    if (text.trim() !== '' && Number.isFinite(n)) setS((cur) => ({ ...cur, [key]: Math.round(n) }));
  };
  /** On leaving a field, snap every value into its allowed range and show it. */
  const settle = (): void => { const n = decodeDesign(encodeDesign(s)); if (n) { setS(n); setDraft(toDraft(n)); } };
  const rangeNote = (key: 'widthMm' | 'depthMm' | 'heightMm' | 'target'): string => {
    const n = Number(draft[key]);
    const [lo, hi] = LIMITS[key];
    return draft[key].trim() === '' || !Number.isFinite(n) || n < lo || n > hi ? `Between ${lo} and ${hi}${key === 'target' ? '' : ' mm'}.` : '';
  };

  const copy = async (): Promise<void> => {
    try { await navigator.clipboard.writeText(`${summary}\nDesign code: ${code}`); setCopied('done'); } catch { codeBox.current?.select(); setCopied('failed'); }
  };

  const numField = (key: 'widthMm' | 'depthMm' | 'heightMm', label: string, hint: string) => (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-input"><input type="text" inputMode="numeric" value={draft[key]} onChange={(ev) => setNum(key, ev.target.value)} onBlur={settle} data-testid={`lite-${key}`} /><span className="unit">mm</span></span>
      <small className="field-hint">{hint}</small>
      {rangeNote(key) && <span className="field-err" role="alert">{rangeNote(key)}</span>}
    </label>
  );

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
        <p>Tell us the size of the room and how you store your wine. You will see a plan and an estimate of the bottles it holds.</p>
      </header>

      <section className="lite-controls" aria-label="Your cellar">
        <div className="lite-grid">
          <div className="lite-sizes" data-tour="lt-size">
            {numField('widthMm', 'Inside width', 'Side to side on the drawing, wall to wall.')}
            {numField('depthMm', 'Inside depth', 'Front to back, wall to wall.')}
            {numField('heightMm', 'Inside height', 'Floor to ceiling.')}
          </div>
          <div className="lite-sizes" data-tour="lt-door">
            <label className="field">
              <span className="field-label">Door on the</span>
              <select value={s.doorWall} onChange={(ev) => setS({ ...s, doorWall: ev.target.value as WallSide })} data-testid="lite-door">
                {WALLS.map((w) => <option key={w} value={w}>{WALL_NAMES[w]} wall</option>)}
              </select>
              <small className="field-hint">South is the bottom of the drawing, North the top, West the left, East the right.</small>
            </label>
            <label className="field">
              <span className="field-label">Door type</span>
              <select value={s.doorStyle} onChange={(ev) => setS({ ...s, doorStyle: ev.target.value as DoorStyle })} data-testid="lite-door-style">
                <option value="SINGLE">Single door (one)</option>
                <option value="DOUBLE">Double door (a pair)</option>
              </select>
              <small className="field-hint">{s.doorStyle === 'DOUBLE' ? `Two doors that open together, about ${LITE_DOOR_WIDTH_MM.DOUBLE} mm across: easier to carry things through, but it takes more wall.` : `One door, about ${LITE_DOOR_WIDTH_MM.SINGLE} mm wide.`}</small>
            </label>
          </div>
          <label className="field" data-tour="lt-bottle">
            <span className="field-label">Main bottle style</span>
            <select value={s.bottle} onChange={(ev) => setS({ ...s, bottle: ev.target.value as LiteSettings['bottle'] })} data-testid="lite-bottle">
              {BOTTLES.map((b) => <option key={b} value={b}>{BOTTLE_PROFILES[b].label}</option>)}
            </select>
            <small className="field-hint">The bottle you have most of. Wider bottles mean fewer fit.</small>
          </label>
          <label className="field" data-tour="lt-mode">
            <span className="field-label">How many bottles</span>
            <select value={s.mode} onChange={(ev) => setS({ ...s, mode: ev.target.value as LiteMode })} data-testid="lite-mode">
              <option value="FILL">As many as fit</option>
              <option value="TARGET">A number I choose</option>
            </select>
            <small className="field-hint">Fill every wall, or tell us how many you want.</small>
          </label>
          {s.mode === 'TARGET' && (
            <label className="field">
              <span className="field-label">Bottles wanted</span>
              <span className="field-input"><input type="text" inputMode="numeric" value={draft.target} onChange={(ev) => setNum('target', ev.target.value)} onBlur={settle} data-testid="lite-target" /></span>
              {rangeNote('target') && <span className="field-err" role="alert">{rangeNote('target')}</span>}
            </label>
          )}
        </div>
      </section>

      <section className="lite-result" data-tour="lt-result" aria-live="polite" data-testid="lite-result">
        {result.problems.length > 0 ? (
          <p className="lite-problem" data-testid="lite-problem">This size cannot be built as entered: {result.problems[0]}</p>
        ) : (
          <>
            <p className="lite-total"><strong data-testid="lite-bottles">About {result.bottles} bottles</strong> <span className="lite-tag">estimate only, not a quote</span></p>
            {s.mode === 'TARGET' && result.maxBottles < s.target && <p className="lite-note" data-testid="lite-short">This room holds about {result.maxBottles} at most, fewer than the {s.target} you asked for. Try a bigger room or a smaller bottle style.</p>}
            {s.mode === 'TARGET' && result.maxBottles >= s.target && <p className="lite-note">The room could hold about {result.maxBottles} if every wall were full.</p>}
          </>
        )}
      </section>

      <section className="lite-drawing" data-tour="lt-drawing" aria-label="Drawings">
        <div className="tabs" role="group" aria-label="Drawing">
          <button type="button" className={`tab${view === 'plan' ? ' on' : ''}`} aria-pressed={view === 'plan'} onClick={() => setView('plan')} data-testid="lite-tab-plan">Plan from above</button>
          <button type="button" className={`tab${view === 'racks' ? ' on' : ''}`} aria-pressed={view === 'racks'} onClick={() => setView('racks')} data-testid="lite-tab-racks">Racks on a wall</button>
          {view === 'racks' && WALLS.map((w) => <button type="button" key={w} className={`tab small${rackWall === w ? ' on' : ''}`} aria-pressed={rackWall === w} onClick={() => setRackWall(w)} data-testid={`lite-wall-${w}`}>{WALL_NAMES[w]}</button>)}
        </div>
        <div className="lite-canvas">
          {view === 'plan'
            ? <DrawingView key="plan" prims={plan} testid="lite-plan" description={`Plan of the cellar from above: ${s.widthMm} by ${s.depthMm} millimetres inside, door on the ${s.doorWall.toLowerCase()} wall, about ${result.bottles} bottles.`} />
            : <DrawingView key={`racks-${rackWall}`} prims={racks} testid="lite-racks" description={`The racks on the ${rackWall.toLowerCase()} wall seen from inside, with each bottle drawn end-on.`} />}
        </div>
        {view === 'racks' && <p className="lite-note lite-units" data-testid="lite-racks-summary" role="status"><strong>{rackWallSummary(analysis.racks, fullRuns(result.project), rackWall).text}</strong> Each circle in the picture is one bottle, so you can count them. The whole cellar is about {result.bottles}.</p>}
        <p className="lite-note lite-units" data-testid="lite-units">Built from standard-size rack units, about {LITE_UNIT_WIDTH_MM} mm wide, placed whole along the walls. A gap at the end of a wall is left-over space, not a mistake.</p>
        <p className="foot">ESTIMATE ONLY: FINAL SITE MEASURE REQUIRED. Rack unit sizes are typical values, not a quote.</p>
      </section>

      <section className="lite-ask" aria-label="Request a quote">
        {!asked ? (
          <button type="button" className="btn primary lite-cta" data-tour="lt-quote" onClick={() => setAsked(true)} data-testid="lite-quote">Request a quote for this design</button>
        ) : (
          <div className="lite-sent" data-testid="lite-sent">
            <p><strong>Your design is ready to send.</strong> {parentOrigin() ? 'It has been added to the enquiry form on this page; check your details there and send it.' : 'Copy it into your enquiry.'}</p>
            <label className="field">
              <span className="field-label">Your design</span>
              <textarea ref={codeBox} readOnly rows={3} value={`${summary}\nDesign code: ${code}`} data-testid="lite-code" onFocus={(ev) => ev.target.select()} />
            </label>
            <div className="row">
              <button type="button" className="btn" onClick={() => void copy()} data-testid="lite-copy">Copy my design</button>
              <button type="button" className="btn" onClick={() => { setAsked(false); setCopied(''); }}>Keep editing</button>
            </div>
            {copied === 'done' && <p className="lite-note" role="status">Copied.</p>}
            {copied === 'failed' && <p className="lite-note" role="status">Could not copy automatically: the text above is selected, so copy it by hand.</p>}
          </div>
        )}
      </section>
      <LiteHelp open={helpOpen} onClose={closeHelp} onTour={() => { closeHelp(); window.setTimeout(() => void startTour(), 250); }} />
    </div>
  );
}
