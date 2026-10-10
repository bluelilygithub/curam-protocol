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
  view?: 'inside' | 'plan' | 'racks';
  /** Which panel (1 space, 2 racking and finishes, 3 review) must be showing for the step. */
  step?: 1 | 2 | 3;
}

/** The tour as data (pure, tested against the screen's data-tour hooks). `step` is which of the three panels must be showing. */
export const LITE_TOUR_STEPS: LiteTourStep[] = [
  { id: 'lt-welcome', title: 'Plan your wine cellar', step: 1, text: 'This takes about a minute, in three steps: your <b>space</b>, your <b>racking and finishes</b>, then a <b>review</b>. You see your cellar and an estimate of how many bottles it holds as you go. Nothing is final and nothing is sent anywhere until you ask for a quote.' },
  { id: 'lt-size', title: '1. How big is the cellar?', target: 'lt-size', on: 'right', step: 1, text: 'Enter the space <b>inside</b> the cellar, wall to wall. Type it, or use the <b>minus</b> and <b>plus</b> buttons. Choose <b>metres</b>, <b>feet</b> or <b>millimetres</b> to suit you. Not measured yet? Try a <b>Quick start</b> room above and change it later.' },
  { id: 'lt-door', title: '2. Where is the door?', target: 'lt-door', on: 'right', step: 1, text: 'Tap the wall the door is on in the little picture, then choose where along that wall it sits (<b>left, centre or right</b>, as you see it standing outside) and whether it is a <b>single</b> or <b>double</b> door.' },
  { id: 'lt-bottle', title: '3. What do you mostly store?', target: 'lt-bottle', on: 'right', step: 2, text: 'Bottles are different shapes. <b>Bordeaux</b> is the usual tall, straight-sided bottle, <b>Burgundy</b> is wider, <b>Champagne</b> wider again, and a <b>Magnum</b> holds 1.5 litres. Choose the one you have most of: wider bottles mean fewer fit.' },
  { id: 'lt-mode', title: '4. How many bottles?', target: 'lt-mode', on: 'right', step: 2, text: 'Choose <b>As many as fit</b> to fill every wall, or <b>A number I choose</b> and say how many you want. We then use only as much rack as that needs.' },
  { id: 'lt-finish', title: '5. Pick a finish', target: 'lt-finish', on: 'right', step: 2, text: 'Choose <b>oak</b>, <b>walnut</b> or <b>black</b> racks and watch the picture change. The finish changes how the racks look, not how many bottles fit.' },
  { id: 'lt-result', title: 'Your estimate', target: 'lt-result', on: 'top', step: 3, text: 'This is roughly how many bottles your choices hold, the floor space, and your setup in a few words. It is built from <b>standard-size rack units</b>, so it is an <b>estimate only, not a quote</b>. It updates as you change anything, and tells you in plain words if a size cannot be built.' },
  { id: 'lt-drawing', title: 'The pictures', target: 'lt-drawing', on: 'left', view: 'inside', step: 3, text: '<b>3D</b> shows what the cellar looks like from the door, with the sizes marked: drag to look around and use the buttons to zoom. <b>Plan</b> looks down from the ceiling. <b>Racks</b> shows one wall with every bottle drawn. In <b>Review</b> you can download your plan as a PDF.' },
  { id: 'lt-quote', title: 'Happy with it?', target: 'lt-quote', on: 'top', step: 3, text: 'Press <b>Request a quote</b> and your choices are added to the enquiry form (or you can copy them into an email). Someone will check the sizes with you and give you a real price. Change anything and try again whenever you like.' },
  { id: 'lt-done', title: 'That is all', step: 1, text: 'Play with the numbers: nothing is saved or sent until you ask for a quote. The <b>Help</b> button at the top explains everything again in plain words, <b>Save design</b> keeps a link to your design, and <b>Take the tour</b> shows this again.' },
];

const selectorOf = (target: string): string => `[data-tour="${target}"]`;

export function startLiteTour(opts: { setView(v: 'inside' | 'plan' | 'racks'): void; getView(): 'inside' | 'plan' | 'racks'; setStep(n: number): void; getStep(): number }): InstanceType<typeof Shepherd.Tour> {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const before = opts.getView();
  const beforeStep = opts.getStep();
  const tour = new Shepherd.Tour({
    useModalOverlay: true, exitOnEsc: true, keyboardNavigation: true,
    defaultStepOptions: { scrollTo: { behavior: 'smooth', block: 'center' }, cancelIcon: { enabled: true }, classes: 'vault-tour' },
  });
  const finish = (): void => {
    try { window.localStorage.setItem(LITE_TOUR_KEY, '1'); } catch { /* it will simply be offered again */ }
    opts.setView(before);
    opts.setStep(beforeStep);
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
        const stepChanged = !!s.step && opts.getStep() !== s.step;
        if (s.step && stepChanged) opts.setStep(s.step);
        window.setTimeout(() => {
          // a step whose element is not on screen is shown as a centred card instead
          if (s.target && !document.querySelector(selectorOf(s.target))) { const step = tour.getById(s.id); if (step) step.options.attachTo = undefined; }
          resolve();
        }, s.view || stepChanged ? 450 : 50);
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
