import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_fonts_completed';

const TOTAL_STEPS = 8;

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

function safeBeforeShow(tour, stepId, selector) {
  const el = document.querySelector(selector);
  if (!el) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/** Single-screen tool now — one linear tour, no mode-switching needed. */
export function startFontsTour() {
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

  tour.addStep({
    id: 'fonts-welcome',
    title: 'Font Customizer — Quick Tour',
    text: "Search a Google Font, adjust real structural properties, and download a real, OFL-compliant font file. Every preview you see is the actual exported font — not an approximation.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  tour.addStep({
    id: 'fonts-search',
    title: 'Search & Load a Font',
    text: "Type a few letters, pick a match (OFL-licensed only), or press Enter/click Load to fetch it. A variable font is automatically frozen to a static instance before editing — this step takes a few seconds since it's a real fetch from Google Fonts.",
    attachTo: { element: '[data-tour="fonts-search"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise((resolve) => {
        setTimeout(() => {
          safeBeforeShow(tour, 'fonts-search', '[data-tour="fonts-search"]');
          resolve();
        }, 200);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'fonts-proofing',
    title: 'Preview Text',
    text: "These presets aren't lorem ipsum — each exposes a specific issue: kerning/spacing, ascender/descender height, or counter and stem shape. Switch presets or type your own text; this only appears once a font is loaded.",
    attachTo: { element: '[data-tour="fonts-proofing"]', on: 'bottom' },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'fonts-preview',
    title: 'Real Live Preview',
    text: "About a second after you stop adjusting a slider, this updates with the actual transformed font — the server runs the real structural edit and sends back a real font file, loaded via an actual @font-face. \"Updating preview…\" shows while that's in flight.",
    attachTo: { element: '[data-tour="fonts-preview"]', on: 'top' },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'fonts-transforms-panel',
    title: 'Transforms — Reshape the Letterforms',
    text: "Stem Thickness, Proportional Width, Extend Ascenders/Descenders, Counter Width. Hover any label for exactly what it does. Each change triggers the real preview above after a short pause.",
    attachTo: { element: '[data-tour="fonts-transforms-panel"]', on: 'left' },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'fonts-kerning-panel',
    title: 'Kerning — Fix Loose Spacing',
    text: "Check a group (e.g. diagonal caps like AV/AW) then use Visual Balance & Rhythm to tighten or loosen every pair in that group. Advanced Pairs below lets you override one specific pair manually.",
    attachTo: { element: '[data-tour="fonts-kerning-panel"]', on: 'left' },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'fonts-download',
    title: 'Download — Give It a Real Name',
    text: "Type a genuinely new family name (required — the font's OFL license forbids redistributing it under its own name) and download. This reuses the settings you're already previewing — no transform is re-run, just the final rename + your chosen file formats. Nothing is saved anywhere else, so download before you navigate away.",
    attachTo: { element: '[data-tour="fonts-download"]', on: 'left' },
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'fonts-presets',
    title: 'Saved Settings (Optional)',
    text: "Save your current Transforms + Kerning as a named preset under \"Saved settings\" — it stores the recipe, not a rendered result, so you can reapply it to a completely different font later.",
    when: { show() { injectStepCounter(8); } },
    buttons: [
      btnBack(),
      {
        text: 'Finish Tour ✓',
        action() {
          localStorage.setItem(TOUR_KEY, '1');
          tour.complete();
        },
      },
    ],
  });

  tour.on('cancel', () => localStorage.setItem(TOUR_KEY, '1'));
  tour.start();
  return tour;
}
