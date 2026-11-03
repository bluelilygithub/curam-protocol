import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_guitar_completed';

const TOTAL_STEPS = 12;

function injectStepCounter(stepIndex) {
  requestAnimationFrame(() => {
    const el = document.querySelector('.shepherd-element.vault-tour');
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

// A part of the page may not be there (no song open, no loop on): show that step in the middle of the screen instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** goTab(name) switches the page to a tab ('Coach', 'Drills', 'Strum', 'Library'). */
export function startGuitarTour({ goTab } = {}) {
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
  // Switch to the tab, give React a moment to draw it, then check the thing this step points at is there.
  const onTab = (stepId, tab, selector) => () => new Promise((resolve) => {
    if (goTab && tab) goTab(tab);
    setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 200);
  });

  tour.addStep({
    id: 'guitar-welcome',
    title: 'Guitar — Quick Tour',
    text: 'Guitar is for learning songs and keeping them sharp. Add songs, say how well you know each one, and Vault builds a short practice list for you, with loops you can slow down and chord changes to drill.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  tour.addStep({
    id: 'guitar-tabs',
    title: 'Four tabs',
    text: 'Coach builds a practice session for the time you have. Drills is for chord changes, Strum is strumming with a backing band, and Library holds your songs: press one to open its chart. Words guitarists use, at the top, explains any term.',
    attachTo: { element: '[data-tour="guitar-tabs"]', on: 'bottom' },
    beforeShowPromise: onTab('guitar-tabs', 'Coach', '[data-tour="guitar-tabs"]'),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-add',
    title: 'Add a song',
    text: 'Paste an Ultimate Guitar chords page, upload an audio file and let Vault work out the chords, or start a blank chart and type them in. Detection from audio is a guess, so check the chords.',
    attachTo: { element: '[data-tour="guitar-add"]', on: 'bottom' },
    beforeShowPromise: onTab('guitar-add', 'Library', '[data-tour="guitar-add"]'),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-songs',
    title: 'Say how well you know it',
    text: 'Mark each song Learning, Polishing or Ready. A Polishing or Ready song turns Rusty if you leave it for 14 days. Press I played this to log a session, with minutes, how clean it was and a note.',
    attachTo: { element: '[data-tour="guitar-songs"]', on: 'top' },
    beforeShowPromise: onTab('guitar-songs', 'Library', '[data-tour="guitar-songs"]'),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-chart',
    title: 'The chord chart',
    text: 'Open a song to see its chart. Click a chord to hear it and see its shapes, double-click one to correct it, and transpose or set a capo above. Press a song in the Library to open it.',
    attachTo: { element: '[data-tour="guitar-chart"]', on: 'right' },
    beforeShowPromise: onTab('guitar-chart', 'Library', '[data-tour="guitar-chart"]'),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-theory',
    title: 'Key, numerals and capo',
    text: 'This box shows the song\'s key, puts a Roman numeral under each chord, marks chords that borrow from elsewhere, and suggests the capo that leaves the fewest barre chords. The key is a guess, so change it if the numerals look wrong. Under it, you can tell Vault the lowest and highest notes you can sing and it suggests the key that suits your voice.',
    attachTo: { element: '[data-tour="guitar-theory"]', on: 'left' },
    beforeShowPromise: onTab('guitar-theory', 'Library', '[data-tour="guitar-theory"]'),
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-simplify',
    title: 'Make it easier',
    text: 'Choose Same sound to move the capo so there are fewer barre chords, or Easier chords to swap hard chords for easy ones (F becomes Fmaj7). The chart then shows the shapes to finger, with the chord it sounds as underneath. It says what changes in the sound.',
    attachTo: { element: '[data-tour="guitar-simplify"]', on: 'left' },
    beforeShowPromise: onTab('guitar-simplify', 'Library', '[data-tour="guitar-simplify"]'),
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-loops',
    title: 'Loops and the tempo trainer',
    text: 'Save a section as a loop, then slow it down without changing the pitch. Start at 70% and tap Clean after each clean pass: after a few in a row the speed goes up. Your best speeds are charted.',
    attachTo: { element: '[data-tour="guitar-loops"]', on: 'left' },
    beforeShowPromise: onTab('guitar-loops', 'Library', '[data-tour="guitar-loops"]'),
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-coach',
    title: 'Your coach',
    text: 'Tell it how long you have and it builds a session from your own songs, loops and chord changes. A chord change comes as a route through the chords between the two, slowly first and then faster. The plan comes from your practice; AI only writes the wording.',
    attachTo: { element: '[data-tour="guitar-coach"]', on: 'bottom' },
    beforeShowPromise: onTab('guitar-coach', 'Coach', '[data-tour="guitar-coach"]'),
    when: { show() { injectStepCounter(9); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-drills',
    title: 'Chord change drills',
    text: 'Drills lists the chord changes your own songs use most, worst first. Above them, Major and minor pairs shows the one note that changes between E and Em, A and Am, and D and Dm. Under it, the Barre chord ladder takes the barre chord in five steps, each cleared with three clean ten-second holds. Press Drill, then choose just the two chords or a progression that goes between them through other chords. Finger moves shows which fingers can stay put, which slide and which lift, and then you tap each clean change for a minute. Stuck on anything? Press the round button at the bottom right and ask the guide.',
    attachTo: { element: '[data-tour="guitar-drills"]', on: 'bottom' },
    beforeShowPromise: onTab('guitar-drills', 'Drills', '[data-tour="guitar-drills"]'),
    when: { show() { injectStepCounter(10); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-strum',
    title: 'Strumming',
    text: 'The arrows show your strumming pattern in time with a click. Your arm swings down on every beat and up in between; solid arrows hit the strings, faint ones are air swings. The ladder starts with a down on every beat and adds one up strum at a time, and a backing band of drums and bass can play along on a chord loop. Below it, the fingerpicking ladder teaches picking one string at a time, from the thumb alone up to Travis picking, with a small tab that lights up in time. At the bottom, the gap click turns the metronome off in gaps while you tap, to show whether your own beat holds steady.',
    attachTo: { element: '[data-tour="guitar-strum"]', on: 'bottom' },
    beforeShowPromise: onTab('guitar-strum', 'Strum', '[data-tour="guitar-strum"]'),
    when: { show() { injectStepCounter(11); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'guitar-setlists',
    title: 'Set lists and play mode',
    text: 'Put songs in playing order in a set list, then press Play for a big chart that follows the song at its tempo. The Play mode button on an open song does the same for one song. Arrow keys and Page keys move through it, so a foot pedal or page turner works. Stuck on anything? Press the round button at the bottom right and ask the guide.',
    attachTo: { element: '[data-tour="guitar-setlists"]', on: 'top' },
    beforeShowPromise: onTab('guitar-setlists', 'Library', '[data-tour="guitar-setlists"]'),
    when: { show() { injectStepCounter(12); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
