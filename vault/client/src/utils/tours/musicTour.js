import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_music_completed';

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

// A step whose target isn't on screen (e.g. the options only exist after generating) shows centred
// instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (document.querySelector(selector)) return;
  const step = tour.getById(stepId);
  if (step) step.options.attachTo = undefined;
}

function markDone() {
  try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* private window — just won't remember */ }
}

export function startMusicTour() {
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
  const before = (id, selector) => () => { safeBeforeShow(tour, id, selector); };

  tour.addStep({
    id: 'music-welcome',
    title: 'Music — Quick Tour',
    text: "Music writes instrumental background music for a video you provide. You pick a mood, get three options cut to your video's exact length, preview each against the picture, then export the audio or the video with the music mixed in.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => { markDone(); tour.cancel(); }),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  tour.addStep({
    id: 'music-video',
    title: 'Your video',
    text: "Choose the video you want music for. It's only used to read its length — so the music ends exactly on your last frame — and to preview the mix. Videos up to five minutes are supported; trim longer ones first in Video Tools.",
    attachTo: { element: '[data-tour="music-video"]', on: 'bottom' },
    beforeShowPromise: () => new Promise((resolve) => { before('music-video', '[data-tour="music-video"]')(); resolve(); }),
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'music-mood',
    title: 'Mood, tempo and your own words',
    text: "Pick a ready-made mood — upbeat vlog, cinematic tension, calm corporate, travel montage, suspense, documentary or lo-fi chill — or choose Custom prompt and describe it. Tempo (BPM) is optional. You can type, or tap the mic and say it. It is always instrumental — no vocals.",
    attachTo: { element: '[data-tour="music-mood"]', on: 'top' },
    beforeShowPromise: () => new Promise((resolve) => { before('music-mood', '[data-tour="music-mood"]')(); resolve(); }),
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'music-generate',
    title: 'Generate three options',
    text: "Each press makes three variations with different random seeds so you can compare. It takes about a minute and each generation has a small cost from the music provider. Progress shows as each option arrives, and options are kept for about 90 minutes.",
    attachTo: { element: '[data-tour="music-generate"]', on: 'top' },
    beforeShowPromise: () => new Promise((resolve) => { before('music-generate', '[data-tour="music-generate"]')(); resolve(); }),
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'music-options',
    title: 'Preview, volume and ducking',
    text: "Every option plays against your video. Music volume sets how loud the music sits, and Ducking lowers it while people are talking (off, light or strong — it needs a video with its own sound). Change a setting, then press Update preview to hear it. The final mix is levelled to about -14 LUFS. If your video is longer than one 30-second clip, the music loops with smooth crossfades.",
    attachTo: { element: '[data-tour="music-options"]', on: 'top' },
    beforeShowPromise: () => new Promise((resolve) => { before('music-options', '[data-tour="music-options"]')(); resolve(); }),
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'music-export',
    title: 'Export what you like',
    text: "Export audio (WAV) gives you just the music, cut to length with fades. Export video (MP4) gives you your video with the music mixed in, using the volume and ducking you chose. Nothing is stored permanently — download what you want to keep.",
    when: { show() { injectStepCounter(6); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { markDone(); tour.complete(); } },
    ],
  });

  tour.on('cancel', markDone);
  tour.start();
  return tour;
}
