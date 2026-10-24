import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_talk_completed';

const TOTAL_STEPS = 6;

function injectStepCounter(stepIndex) {
  requestAnimationFrame(() => {
    const el = document.querySelector('.shepherd-element.vault-tour');
    if (!el) return;
    let counter = el.querySelector('.vault-tour-step-count');
    if (!counter) {
      counter = document.createElement('div');
      counter.className = 'vault-tour-step-count';
      const footer = el.querySelector('.shepherd-footer');
      if (footer) el.insertBefore(counter, footer);
    }
    counter.textContent = `Step ${stepIndex} of ${TOTAL_STEPS}`;
  });
}

/** The Talk it through tour. Nothing is started, sent or saved by it: it only points at the controls. */
export function startTalkTour() {
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
  const finish = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); };

  const step = (id, n, title, text, selector, on = 'bottom') => tour.addStep({
    id, title, text,
    ...(selector && document.querySelector(selector) ? { attachTo: { element: selector, on } } : {}),
    when: { show() { injectStepCounter(n); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'talk-welcome',
    title: 'Talk it through — Quick Tour',
    text: 'Ask questions out loud, hear the answers spoken back, and keep the conversation as a note with a summary. It is a Chat conversation underneath.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step('talk-settings', 2, 'The switches', 'Read aloud speaks each reply. Listen again starts listening by itself after a reply (not possible on an iPhone, where you tap each time). My notes lets the assistant use your own notes that match what you say; it is off unless you switch it on.', '[data-tour="talk-settings"]');
  step('talk-mic', 3, 'The big button', 'Tap it and ask your question; pause when you are done and it is sent. While the reply is being spoken, tap it to interrupt and talk over it.', '[data-tour="talk-mic"]', 'top');
  step('talk-type', 4, 'Typing instead', 'Prefer not to speak, or in a noisy place? Type your question here. It is answered the same way, and spoken back if Read aloud is on.', '[data-tour="talk-type"]', 'top');
  step('talk-end', 5, 'End conversation', 'When you are finished, this writes the conversation up as a note: a summary, decisions, to-dos as tick-boxes, then everything that was said. You check it, file it under a project and client, and save it, or leave without saving. It is only available once you have heard a reply.', '[data-tour="talk-end"]', 'top');

  tour.addStep({
    id: 'talk-help',
    title: 'Getting help',
    text: 'Stuck? Press the round button at the bottom right and tell the guide what you want to do. The (i) beside the title explains it all again, and every button has a hover tip.',
    ...(document.querySelector('[data-tour="talk-info"]') ? { attachTo: { element: '[data-tour="talk-info"]', on: 'bottom' } } : {}),
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), { text: 'Finish Tour ✓', action: finish }],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
