import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

// The HTML Content Check tour (compass button beside the title in the tool list, Settings -> HTML Content Check Tour, or
// /html-content-check?tour=1). Like Contract Review's: a step about a tool switches to that tool (goTool, the same as clicking it in the
// list) and points at the main area. With no job open, a job tool shows "works on one job"; the card text says what the tool holds.

export const TOUR_KEY = 'vault_tour_html_content_check_completed';

const TOTAL_STEPS = 12;

// Shepherd keeps earlier cards in the page (hidden), so the counter goes into this step's own card, not the first one found.
function injectStepCounter(stepIndex, card) {
  requestAnimationFrame(() => {
    const el = card || document.querySelector('.shepherd-element.vault-tour');
    if (!el) return;
    let counter = el.querySelector('.vault-tour-step-count');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'vault-tour-step-count';
      const footer = el.querySelector('.shepherd-footer');
      if (footer) footer.parentNode.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

const MAIN = '[data-tour="html-content-check-main"]';
const GUIDE = '[aria-label="Open the HTML Content Check guide"]';

/** goTool(id) shows a tool ('new', 'jobs', 'rounds', ...) or the job screen ('start'). */
export function startHtmlContentCheckTour(goTool) {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();

  const tour = new Shepherd.Tour({
    useModalOverlay: true,
    exitOnEsc: true,
    keyboardNavigation: true,
    defaultStepOptions: {
      scrollTo: { behavior: 'smooth', block: 'center' },
      cancelIcon: { enabled: true },
      classes: 'vault-tour',
    },
  });

  const btnSecondary = (text, action) => ({ text, action, classes: 'vault-tour-btn-secondary' });
  const btnBack = () => btnSecondary('← Back', () => tour.back());
  const btnNext = { text: 'Next →', action: () => tour.next() };
  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } };
  const show = (tool, stepId, selector) => () => new Promise((resolve) => {
    if (tool) goTool(tool);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 450);
  });
  let n = 0;
  const step = (id, title, text, selector, tool, on = 'bottom') => {
    const i = ++n;
    tour.addStep({
      id, title, text,
      attachTo: selector ? { element: selector, on } : undefined,
      beforeShowPromise: show(tool, id, selector || 'body'),
      when: { show() { injectStepCounter(i, this.getElement()); } },
      buttons: [btnBack(), btnNext],
    });
  };

  n++;
  tour.addStep({
    id: 'hcc-welcome',
    title: 'HTML Content Check — Quick Tour',
    text: 'A client asked for edits to a web page and the developer says they are done. HTML Content Check reads the page before and after, shows every change word by word, and lines the changes up against the request. It never decides whether an edit was done: you judge that.',
    when: { show() { injectStepCounter(1, this.getElement()); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step('hcc-jobs', 'Start with a job',
    '"Check a change request" walks you through the whole check; "Just compare a page" keeps a page to see what changes over time. The bar above each tool shows where you are in the job.',
    '[data-tour="html-content-check-jobs"]', 'start');

  step('hcc-menu', 'Or pick a tool',
    'Every tool is also in this list. New job and Your jobs work on their own; the tools under This job need a job open first. The open job is shown at the top, with a cross to close it. Hover any tool for what it does.',
    '[data-tour="html-content-check-menu"]', null, 'right');

  step('hcc-new', 'New job',
    'Enter the page address and paste the change request as you received it. Create job reads the page now, as round 0 (the starting point), and splits the request into numbered lines R1, R2 ...',
    '[data-guide="new"]', 'new', 'top');

  step('hcc-copy', 'Pages that are hard to reach',
    'Load in a real browser is for pages that build themselves with JavaScript (it is also used by itself when a plain fetch finds almost no text). For a staging site or a page behind a login, save it from your browser and choose Use a saved copy instead.',
    '[data-guide="saved-copy"]', 'new', 'top');

  step('hcc-lines', 'Request lines',
    'The request as numbered lines beside the text as pasted. Split a line that asks for two things, join two that belong together, reorder, add or remove, then Save.',
    MAIN, 'lines', 'top');

  step('hcc-rounds', 'Rounds: before and after',
    'Round 0 is the page before the edits. When the developer says they are done, press Check again: that is round 1. Each round shows when and how it was read and how many changes it has. An unchanged page is still kept, and a failed check says why.',
    MAIN, 'rounds', 'top');

  step('hcc-changes', 'Changes, word by word',
    'Every change in reading order: removed words struck through in red, added words underlined in green, and where on the page it is. Switch between since the starting point and since the last round.',
    MAIN, 'changes', 'top');

  step('hcc-self', 'Changes that happen by themselves',
    'Cookie banners, dates, counters and rotating panels can change without anyone editing the page. They are grouped, closed, under the real changes, never thrown away; one that a request line links to moves up into the main list.',
    MAIN, 'changes', 'top');

  step('hcc-match', 'Match to request',
    'The AI suggests which changes answer each request line, with a short reason. Code then lists the lines with no change found and the changes nobody asked for. Click a line to highlight its changes, and Change links to link or unlink by hand. You judge every edit.',
    MAIN, 'changes', 'top');

  step('hcc-details', 'Job details and your jobs',
    'Job details holds the name, address, client, ticket and status, and Delete. Your jobs lists every job with its rounds; a deleted job stays in the recycle bin for 30 days.',
    MAIN, 'details', 'top');

  const last = ++n;
  tour.addStep({
    id: 'hcc-guide',
    title: 'Ask the guide',
    text: 'Not sure where to start? Press the round button and say what you want to check, by typing or talking. The guide points you to the right tools in order. It explains HTML Content Check; it does not see your jobs or pages.',
    attachTo: { element: GUIDE, on: 'left' },
    beforeShowPromise: show('start', 'hcc-guide', GUIDE),
    when: { show() { injectStepCounter(last, this.getElement()); } },
    buttons: [btnBack(), { text: 'Finish Tour ✓', action() { done(); tour.complete(); } }],
  });

  tour.on('cancel', done);
  tour.start();
  return tour;
}
