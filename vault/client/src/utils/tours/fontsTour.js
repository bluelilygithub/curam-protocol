import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_fonts_completed';

const TOTAL_STEPS = 15;

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

/** Switches page mode/tab, then waits a beat for the DOM to update before attaching the step. */
function switchTo(tour, stepId, selector, fn) {
  return () => new Promise((resolve) => {
    fn();
    setTimeout(() => {
      safeBeforeShow(tour, stepId, selector);
      resolve();
    }, 200);
  });
}

/**
 * @param {(mode: 'structural'|'effects') => void} setPageMode
 * @param {(tab: 'transforms'|'kerning'|'presets'|'export') => void} setActiveTab
 */
export function startFontsTour(setPageMode, setActiveTab) {
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

  // ── Step 1: Welcome ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-welcome',
    title: 'Font Customizer — Quick Tour',
    text: "This tool has two modes: Structural Preview, where you pick a Google Font and reshape its letterforms (weight, width, kerning) and export a real, OFL-compliant custom font file — and Effects & Export, where you style that exported font with color/shadow/image-fill CSS and grab a print-ready outlined SVG. This tour walks through the full flow.",
    beforeShowPromise: switchTo(tour, 'fonts-welcome', null, () => setPageMode('structural')),
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Mode switch ──────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-mode-switch',
    title: 'Two Modes',
    text: "Structural Preview (letterform edits, live in your browser) and Effects & Export (color/shadow on the real exported font) are separate tabs here — switch anytime. We'll start in Structural Preview.",
    attachTo: { element: '[data-tour="fonts-mode-switch"]', on: 'bottom' },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: File loader ──────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-file-loader',
    title: 'Load a Font to Preview',
    text: "Drop any .ttf/.otf/.woff here for the live preview below — this is optional. If you're customizing a Google Font, you don't need this step at all; just go straight to the Export tab and pick it from the search box there.",
    attachTo: { element: '[data-tour="fonts-file-loader"]', on: 'bottom' },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Proofing text ────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-proofing',
    title: 'Proofing Text',
    text: "These presets aren't lorem ipsum — each is designed to expose a specific issue: kerning/spacing, ascender/descender height, or counter and stem shape. Switch presets to see how your edits affect different letter combinations, or type your own text.",
    attachTo: { element: '[data-tour="fonts-proofing"]', on: 'bottom' },
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Canvas preview ───────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-canvas',
    title: 'Live Preview',
    text: "Every slider you touch in the panel on the right redraws here instantly — entirely in your browser, no server calls. This is an approximation for fast iteration; the real structural edit happens for real when you export.",
    attachTo: { element: '[data-tour="fonts-canvas"]', on: 'top' },
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Tabs overview ────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-tabs',
    title: 'The Right-Hand Panel',
    text: "Four tabs: Transforms (letterform sliders), Kerning (spacing), Stylesheets (save/reuse your settings), and Export (the actual button that customizes and exports your font). We'll go through each.",
    attachTo: { element: '[data-tour="fonts-tabs"]', on: 'left' },
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Transforms ───────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-transforms-panel',
    title: 'Transforms — Reshape the Letterforms',
    text: "Stem Thickness (bolder/lighter strokes), Proportional Width (wider/narrower), Extend Ascenders/Descenders (taller/shorter b/d/g/y), and Counter Width (wider/narrower bowls in o/e/a). Hover any label for what it actually does under the hood.",
    beforeShowPromise: switchTo(tour, 'fonts-transforms-panel', '[data-tour="fonts-transforms-panel"]', () => setActiveTab('transforms')),
    when: { show() { injectStepCounter(7); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 8: Kerning ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-kerning-panel',
    title: 'Kerning — Fix Loose Spacing',
    text: "Check a group (e.g. diagonal caps like AV/AW) then use the Visual Balance & Rhythm slider to tighten or loosen every pair in that group at once. Need to fix one specific pair like \"To\"? Use Advanced Pairs below for a manual override.",
    beforeShowPromise: switchTo(tour, 'fonts-kerning-panel', '[data-tour="fonts-kerning-panel"]', () => setActiveTab('kerning')),
    when: { show() { injectStepCounter(8); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 9: Stylesheets ──────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-presets-panel',
    title: 'Stylesheets — Save Your Settings',
    text: "Save your current Transforms + Kerning as a named preset — it stores the *recipe* (the slider values), not a rendered result, so you can apply it to a completely different Google Font later.",
    beforeShowPromise: switchTo(tour, 'fonts-presets-panel', '[data-tour="fonts-presets-panel"]', () => setActiveTab('presets')),
    when: { show() { injectStepCounter(9); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 10: Export ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-export-panel',
    title: 'Export — Where It Actually Happens',
    text: "This is the key step: search for an OFL-licensed Google Font (or use whatever you loaded above), give it a genuinely new family name — required, since a font's original license forbids redistributing it under its own name — then Customize → Export. This runs the real pipeline server-side and takes you straight into Effects & Export with the result loaded.",
    attachTo: { element: '[data-tour="fonts-export-panel"]', on: 'left' },
    beforeShowPromise: switchTo(tour, 'fonts-export-panel', '[data-tour="fonts-export-panel"]', () => setActiveTab('export')),
    when: { show() { injectStepCounter(10); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 11: Effects loader ──────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-effects-loader',
    title: 'Effects & Export — Your Real Exported Font',
    text: "After Customize → Export, you land here automatically with your real font file loaded via an actual @font-face — not a preview approximation. You can also drop a file here manually if you ran the export pipeline outside the app.",
    attachTo: { element: '[data-tour="fonts-effects-loader"]', on: 'bottom' },
    beforeShowPromise: switchTo(tour, 'fonts-effects-loader', '[data-tour="fonts-effects-loader"]', () => setPageMode('effects')),
    when: { show() { injectStepCounter(11); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 12: Download the font ───────────────────────────────────────────
  tour.addStep({
    id: 'fonts-effects-download',
    title: 'Download Your Font — Do This Now',
    text: "Nothing in this tool is saved on the server — no library, no history. This is your only chance to keep the .ttf/.woff2/.otf files. Download them now, before you navigate away or close the tab.",
    attachTo: { element: '[data-tour="fonts-effects-download"]', on: 'bottom' },
    when: { show() { injectStepCounter(12); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 13: Fill & Shadows ───────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-effects-fill',
    title: 'Fill & Shadows',
    text: "Solid color, gradient, or an image/texture clipped to the text — plus layered shadows for depth. All CSS, applied live; none of this touches the font file itself.",
    attachTo: { element: '[data-tour="fonts-effects-fill"]', on: 'left' },
    when: { show() { injectStepCounter(13); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 14: CSS snippet ─────────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-effects-css',
    title: 'Copy the CSS',
    text: "Once you're happy with the look, Copy CSS grabs a ready-to-paste snippet — the real @font-face rule plus your fill/shadow styling — for a web project.",
    attachTo: { element: '[data-tour="fonts-effects-css"]', on: 'top' },
    when: { show() { injectStepCounter(14); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 15: Print handoff ───────────────────────────────────────────────
  tour.addStep({
    id: 'fonts-print-handoff',
    title: 'Print Handoff — Outlined SVG',
    text: "For a print vendor or Illustrator/InDesign, Export Outlined SVG flattens your text to vector paths with the color/shadow baked in — no font installation needed on the other end. It's complementary to the real font file, not a replacement: install the actual font if you still need editable text in a layout.",
    attachTo: { element: '[data-tour="fonts-print-handoff"]', on: 'top' },
    when: { show() { injectStepCounter(15); } },
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
