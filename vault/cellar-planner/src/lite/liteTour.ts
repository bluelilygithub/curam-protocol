// The guided tour for the public lite tool (Shepherd.js, the same library and look as the full planner). Written for someone who has never seen
// a cellar plan: plain words, no jargon, one thing per step. Loaded on first use (dynamic import) so it stays out of the page's first download.
import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import '@planner-core/help/tour.css';
import { injectStepCounter } from '@planner-core/help/tourCard';

export const LITE_TOUR_KEY = 'cellar-lite:tour-done:v1';

export interface LiteTourStep {
  id: string; title: string; text: string;
  /** `data-tour` value of the element to point at; omitted = centred card. */
  target?: string;
  on?: 'top' | 'bottom' | 'left' | 'right';
  /** Which drawing must be showing for the step. */
  view?: 'plan' | 'racks';
}

/** The tour as data (pure, tested against the screen's data-tour hooks). */
export const LITE_TOUR_STEPS: LiteTourStep[] = [
  { id: 'lt-welcome', title: 'Plan your wine cellar', text: 'This takes about a minute. You tell us how big the room is and how you keep your wine, and you see a drawing and an estimate of how many bottles it holds. Nothing is final and nothing is sent anywhere until you ask for a quote.' },
  { id: 'lt-size', title: '1. How big is the cellar?', target: 'lt-size', on: 'bottom', text: 'Enter the space <b>inside</b> the cellar, from wall to wall, in millimetres (1 metre is 1000 mm, so a 2.7 metre wall is 2700). <b>Width</b> is side to side on the drawing, <b>depth</b> is front to back, and <b>height</b> is floor to ceiling. Not measured yet? Use your best guess: we always confirm the real sizes on site.' },
  { id: 'lt-door', title: '2. Where is the door, and what kind?', target: 'lt-door', on: 'bottom', text: 'Pick the side of the drawing the door is on. <b>South</b> is the bottom of the drawing, <b>North</b> the top, <b>West</b> the left and <b>East</b> the right. Then choose a <b>single door</b> (one door, about 970 mm wide) or a <b>double door</b> (a pair that open together, about 1500 mm across: easier to carry things through, but it takes more of the wall). The drawing shows the door and the way it swings open.' },
  { id: 'lt-bottle', title: '3. What do you mostly store?', target: 'lt-bottle', on: 'bottom', text: 'Bottles are different shapes. <b>Bordeaux</b> is the usual tall, straight-sided bottle (most reds, many whites). <b>Burgundy</b> is wider, <b>Champagne</b> wider again, and a <b>Magnum</b> holds 1.5 litres. Choose the one you have most of: wider bottles need more room, so fewer fit.' },
  { id: 'lt-mode', title: '4. How many bottles?', target: 'lt-mode', on: 'bottom', text: 'Choose <b>As many as fit</b> to fill every wall, or <b>A number I choose</b> and type how many you want. We then use only as much rack as that needs.' },
  { id: 'lt-result', title: 'Your estimate', target: 'lt-result', on: 'top', text: 'This is roughly how many bottles your choices hold. It is built from <b>standard-size rack units</b> (ready-made blocks about 600 mm wide), so it is an <b>estimate only, not a quote</b>. It updates as you change anything above, and tells you in plain words if a size cannot be built.' },
  { id: 'lt-drawing', title: 'The drawings', target: 'lt-drawing', on: 'top', view: 'plan', text: '<b>Plan from above</b> shows the room as if you were looking down from the ceiling: the walls, the door, and the racks in orange. <b>Racks on a wall</b> shows the wall as you would see it standing inside, with every bottle drawn. Each orange block is one or more standard rack units placed whole, so the empty gaps you may see at the end of a wall are just left-over space. Drag to move the drawing, pinch or scroll to zoom, and press <b>Fit</b> to bring it all back.' },
  { id: 'lt-quote', title: 'Happy with it?', target: 'lt-quote', on: 'top', text: 'Press <b>Request a quote</b> and your choices are added to the enquiry form on this page (or you can copy them into an email). Someone will check the sizes with you and give you a real price. Change anything and try again whenever you like.' },
  { id: 'lt-done', title: 'That is all', text: 'Play with the numbers: nothing is saved or sent until you ask for a quote. The <b>Help</b> button at the top explains everything again in plain words, and <b>Take the tour</b> shows this again.' },
];

const selectorOf = (target: string): string => `[data-tour="${target}"]`;

export function startLiteTour(opts: { setView(v: 'plan' | 'racks'): void; getView(): 'plan' | 'racks' }): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const before = opts.getView();
  const tour = new Shepherd.Tour({
    useModalOverlay: true, exitOnEsc: true, keyboardNavigation: true,
    defaultStepOptions: { scrollTo: { behavior: 'smooth', block: 'center' }, cancelIcon: { enabled: true }, classes: 'vault-tour' },
  });
  const finish = (): void => {
    try { window.localStorage.setItem(LITE_TOUR_KEY, '1'); } catch { /* it will simply be offered again */ }
    opts.setView(before);
  };
  tour.on('complete', finish);
  tour.on('cancel', finish);
  const secondary = (text: string, action: () => void) => ({ text, action, classes: 'vault-tour-btn-secondary' });

  LITE_TOUR_STEPS.forEach((s, i) => {
    const first = i === 0, last = i === LITE_TOUR_STEPS.length - 1;
    tour.addStep({
      id: s.id, title: s.title, text: s.text,
      ...(s.target ? { attachTo: { element: selectorOf(s.target), on: s.on ?? 'bottom' } } : {}),
      beforeShowPromise: () => new Promise<void>((resolve) => {
        if (s.view && opts.getView() !== s.view) opts.setView(s.view);
        window.setTimeout(() => {
          // a step whose element is not on screen is shown as a centred card instead
          if (s.target && !document.querySelector(selectorOf(s.target))) { const step = tour.getById(s.id); if (step) step.options.attachTo = undefined; }
          resolve();
        }, s.view ? 450 : 50);
      }),
      when: { show() { injectStepCounter(i + 1, LITE_TOUR_STEPS.length); } },
      buttons: first
        ? [secondary('Skip', () => tour.cancel()), { text: 'Start the tour →', action: () => tour.next() }]
        : last
          ? [secondary('← Back', () => tour.back()), { text: 'Finish', action: () => tour.complete() }]
          : [secondary('← Back', () => tour.back()), { text: 'Next →', action: () => tour.next() }],
    });
  });
  tour.start();
  return tour;
}
