import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_news_digest_completed';

const TOTAL_STEPS = 7;

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

export function startNewsDigestTour(navigate) {
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

  // ── Step 1: Welcome ───────────────────────────────────────────────────────
  tour.addStep({
    id: 'news-welcome',
    title: 'News Digest — Quick Tour',
    text: "News Digest is a daily intelligence briefing built around your topics. Vault fetches recent articles from RSS feeds and Google News, then uses AI to produce a structured analysis — not a headline summary. This tour shows you how to get the most out of it.",
    when: { show() { injectStepCounter(1); } },
    buttons: [
      btnSecondary('Skip Tour', () => tour.cancel()),
      { text: 'Start Tour →', action: () => tour.next() },
    ],
  });

  // ── Step 2: Topics ────────────────────────────────────────────────────────
  tour.addStep({
    id: 'news-topics',
    title: 'Topics — What to Monitor',
    text: "Switch to the Topics tab to add the subjects you want covered. Each topic has a title and optional extra keywords. The more specific your keywords, the better the article matching — \"Climate policy Australia\" will produce sharper results than just \"climate\". Drag topics to reorder, or toggle them on/off without deleting.",
    attachTo: { element: '[data-tour="news-tab-toggle"]', on: 'bottom' },
    beforeShowPromise() {
      return new Promise(resolve => {
        navigate('/news-digest');
        setTimeout(() => {
          safeBeforeShow(tour, 'news-topics', '[data-tour="news-tab-toggle"]');
          resolve();
        }, 600);
      });
    },
    when: { show() { injectStepCounter(2); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 3: Generating a digest ───────────────────────────────────────────
  tour.addStep({
    id: 'news-generate',
    title: 'Generating a Digest',
    text: "Digests run automatically each day at your configured time (Settings → News Digest). On the Digest tab, if no digest exists for today you'll see a Generate now button — click it for an immediate run. The Refresh button on an existing digest force-regenerates with today's fresh articles and the latest analysis.",
    attachTo: { element: '[data-tour="news-tab-toggle"]', on: 'bottom' },
    when: { show() { injectStepCounter(3); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 4: Reading the analysis ──────────────────────────────────────────
  tour.addStep({
    id: 'news-analysis',
    title: 'Four Perspectives on Every Topic',
    text: "Each topic card expands into four collapsible blocks: Unbiased Summary (what actually happened today, with timeline, mechanisms, and actor motivations where the articles support them), Left-leaning perspective, Right-leaning perspective, and Common Ground. The analysis is anchored to today's articles — not generic background. A source credibility note flags state media automatically.",
    when: { show() { injectStepCounter(4); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 5: Commentary ────────────────────────────────────────────────────
  tour.addStep({
    id: 'news-commentary',
    title: 'Your Commentary — It Feeds Tomorrow',
    text: "Each expanded card has a Commentary field at the bottom. What you write there is saved per-topic per-date and injected into the next day's analysis as editorial context — so if you flag that a source was misleading or note an angle the AI missed, tomorrow's digest will reflect that. It accumulates over 7 days.",
    when: { show() { injectStepCounter(5); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 6: Per-topic chat ────────────────────────────────────────────────
  tour.addStep({
    id: 'news-chat',
    title: 'Ask Follow-up Questions',
    text: "Below the commentary field, each topic has a Q&A chat window. Ask specific questions — \"Is the US sending troops?\", \"What does this mean for Australian energy prices?\". The AI answers using the last 7 days of summaries and your commentary as context, so it understands the ongoing story rather than treating each question in isolation.",
    when: { show() { injectStepCounter(6); } },
    buttons: [btnBack(), btnNext],
  });

  // ── Step 7: Settings ──────────────────────────────────────────────────────
  tour.addStep({
    id: 'news-settings',
    title: 'Configure Schedule & Sources',
    text: "In Settings → News Digest you can set the time and days the digest auto-runs, toggle built-in sources (ABC News, Guardian Australia, Reuters, Sky News, Google News) on or off, and add your own custom RSS feed URLs. Changes to the schedule take effect immediately — no restart needed.",
    when: { show() { injectStepCounter(7); } },
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
