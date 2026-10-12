import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_fitness_completed';

/**
 * Fitness Planner tour. It grows with the app: add an entry to STEPS when a stage ships.
 *  group:  which screen the step belongs to - 'all' | 'onboarding' | 'baseline' | 'done'
 *  view:   for group 'done', the tab to show first (overview | goal | profile)
 *  since:  the build stage that added it (for the changelog in docs/fitness-planner.md)
 * Steps whose target is not on screen are shown without a highlight rather than skipped or broken.
 */
const STEPS = [
  {
    id: 'fitness-welcome', group: 'all', since: 1,
    title: 'Fitness Planner - Quick Tour',
    text: 'A calm, lifestyle-style planner: tell it where you are, see what is healthy for your age, choose a five-year pace, and follow a varied weekly program. Rest and quiet weeks are normal here, and nothing is ever marked as a failure.',
  },
  {
    id: 'fitness-steps', group: 'onboarding', since: 1, selector: '[data-tour="fitness-steps"]', on: 'bottom',
    title: 'Four quick steps',
    text: 'About you, your fitness, lifestyle, and anything to work around. Once you enter your date of birth and sex, the later steps are pre-filled with typical answers for your age. Change anything that is not you. You rate yourself on a 1-5 scale; nobody checks it.',
  },
  {
    id: 'fitness-baseline', group: 'baseline', since: 1, selector: '[data-tour="fitness-baseline"]', on: 'top',
    title: 'Your baseline',
    text: 'Your ratings against the healthy range for your age, based on WHO guidance. The dot is you now, the hollow dot is how you rated an earlier time, and the shaded band is the healthy range. The wording is written by the AI model set in Settings; the numbers come from fixed rules.',
  },
  {
    id: 'fitness-today', group: 'done', view: 'today', since: 2, selector: '[data-tour="fitness-today"]', on: 'bottom',
    title: 'Today',
    text: 'What is planned today, grouped as warm-up, main and cool-down. Tap any exercise name to see how to do it properly. On a rest day it simply says so: rest is part of the plan.',
  },
  {
    id: 'fitness-log', group: 'done', view: 'log', since: 3, selector: '[data-tour="fitness-log"]', on: 'top',
    title: 'Log what you did',
    text: 'On Today, "Done as planned" is one tap. Here you can catch up on sessions you have not noted (up to 28 days back), add something that was not planned, and weigh in if you want to. Rest and "didn\'t do it" are recorded as they are: neutral, never a mark against you.',
  },
  {
    id: 'fitness-today-tips', group: 'done', view: 'today', since: 3, selector: '[data-tour="fitness-today"]', on: 'bottom',
    title: 'Tips and a look back',
    text: 'Log a session and a lightbulb offers one or two short tips for next time. On the Overview a short reflection looks back at last week. If a note mentions pain, dizziness or chest symptoms you are asked whether to make next week gentler: it only happens if you say yes.',
  },
  {
    id: 'fitness-week-grid', group: 'done', view: 'week', since: 2, selector: '[data-tour="fitness-week-grid"]', on: 'top',
    title: 'Your week',
    text: 'One block per day with a small card for each session. A day changes colour once you have logged it (green done, amber some done, blue rest), always with an icon too. Click a day, a card or its pencil to open the day and log or edit. Drag a card to another day or time; the places to drop appear as you drag. The numbers at the top show what you have done against what the plan asks for. The ? explains the rest.',
  },
  {
    id: 'fitness-month', group: 'done', view: 'month', since: 3, selector: '[data-tour="fitness-month"]', on: 'top',
    title: 'The month',
    text: 'A calendar of the month with each day coloured by how it went, plus an icon and a word so colour is never the only clue. Click a day to open it in the Week. Days from weeks that were never made have no plan to open.',
  },
  {
    id: 'fitness-rest', group: 'done', view: 'week', since: 2, selector: '[data-tour="fitness-rest"]', on: 'bottom',
    title: 'Rest without guilt',
    text: 'Two planned rest days plus a flexible one. Hover a day and press Rest (or open the day): its session moves to a free slot if there is one, otherwise it is let go. Nothing is ever stacked onto later days.',
  },
  {
    id: 'fitness-library-list', group: 'done', view: 'library', since: 2, selector: '[data-tour="fitness-library-list"]', on: 'top',
    title: 'The exercise library',
    text: 'Every exercise in your program comes from here, with steps, common mistakes, why form matters, how hard it should feel, and easier and harder versions. Filter by movement, place or equipment. On any page, "Not for me, hide this exercise" makes your program skip it.',
  },
  {
    id: 'fitness-tabs', group: 'done', view: 'overview', since: 1, selector: '[data-tour="fitness-tabs"]', on: 'bottom',
    title: 'Overview, Goal and Profile',
    text: 'Today and Week are your plan, Library holds the exercises, Overview is the big picture, Goal shows your five years and lets you change the pace, and Profile is where you edit your answers and re-rate. Logging and charts arrive in the next updates.',
  },
  {
    id: 'fitness-goal-card', group: 'done', view: 'overview', since: 1, selector: '[data-tour="fitness-goal-card"]', on: 'bottom',
    title: 'Your five-year goal',
    text: 'The pace you chose and where it leads. You can revisit it any time from the Goal tab; earlier goals are kept in history.',
  },
  {
    id: 'fitness-pace', group: 'done', view: 'goal', since: 1, selector: '[data-tour="fitness-pace"]', on: 'bottom',
    title: 'Choose your pace',
    text: 'Five paces from Gentle to Stretch. Each change re-draws the plan and explains what moved, and nothing is saved until you press the button at the bottom.',
  },
  {
    id: 'fitness-milestones', group: 'done', view: 'goal', since: 1, selector: '[data-tour="fitness-milestones"]', on: 'top',
    title: 'The five years',
    text: 'The Now row is where you are today. Each year shows its focus, weekly targets and the rating you are expected to reach by then. Year one is deliberately gentle. Strength, balance and mobility days can share a session.',
  },
  {
    id: 'fitness-chart', group: 'done', view: 'goal', since: 1, selector: '[data-tour="fitness-chart"]', on: 'top',
    title: 'Weekly aerobic minutes',
    text: 'How your weekly aerobic time builds, against the WHO 150-300 minute band (the shaded area).',
  },
  {
    id: 'fitness-rerate', group: 'done', view: 'profile', since: 1, selector: '[data-tour="fitness-rerate"]', on: 'top',
    title: 'Re-rate every 4-6 weeks',
    text: 'Rate yourself again whenever things change. Earlier ratings are kept so you can see progress, and the Overview reminds you gently when it has been a while.',
  },
  {
    id: 'fitness-help', group: 'all', since: 1, selector: '[data-tour="fitness-help"]', on: 'bottom',
    title: 'Help, tour and starting over',
    text: 'The compass retakes this tour and the (i) explains how it all works. The three-dot menu has "Start over", which lets you retake the wizard from the beginning.',
  },
];

function injectStepCounter(stepIndex, total) {
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
    counter.textContent = `Step ${stepIndex} of ${total}`;
  });
}

/** @param {{ stage: string, goTo: (view: string) => void }} opts */
export function startFitnessTour({ stage, goTo }) {
  if (Shepherd.activeTour) Shepherd.activeTour.cancel();
  const group = stage === 'profile' || stage === 'ratings' ? 'onboarding' : stage === 'baseline' ? 'baseline' : 'done';
  const steps = STEPS.filter((s) => s.group === 'all' || s.group === group);
  const total = steps.length;

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
  const done = () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } };

  steps.forEach((s, i) => {
    const first = i === 0;
    const last = i === total - 1;
    const stepDef = {
      id: s.id,
      title: s.title,
      text: s.text,
      when: { show() { injectStepCounter(i + 1, total); } },
      buttons: first
        ? [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }]
        : [
          btnSecondary('← Back', () => tour.back()),
          last ? { text: 'Finish Tour ✓', action() { done(); tour.complete(); } } : { text: 'Next →', action: () => tour.next() },
        ],
    };
    if (s.selector) {
      stepDef.attachTo = { element: s.selector, on: s.on || 'bottom' };
      stepDef.beforeShowPromise = () => new Promise((resolve) => {
        if (s.view) goTo(s.view);
        setTimeout(() => {
          if (!document.querySelector(s.selector)) {
            const step = tour.getById(s.id);
            if (step) step.options.attachTo = undefined;
          }
          resolve();
        }, s.view ? 500 : 50);
      });
    }
    tour.addStep(stepDef);
  });

  tour.on('cancel', done);
  tour.start();
  return tour;
}
