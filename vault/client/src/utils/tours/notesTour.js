import Shepherd from 'shepherd.js';
import 'shepherd.js/dist/css/shepherd.css';
import './goalsTour.css';

export const TOUR_KEY = 'vault_tour_notes_completed';

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

// A step whose target is not on screen (no note open yet, an empty list) is shown as a centred card instead of failing.
function safeBeforeShow(tour, stepId, selector) {
  if (!document.querySelector(selector)) {
    const step = tour.getById(stepId);
    if (step) step.options.attachTo = undefined;
  }
}

/**
 * The Notes tour. `show.list()` makes sure the list is on screen (on a phone it closes the open note) and `show.editor()` makes sure a
 * note is open (it opens the first one if there is one); both may return a promise. Nothing is created or changed by the tour.
 */
export function startNotesTour(show = {}) {
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
  // before a step: bring the right part of the screen forward, wait for it to draw, then attach (or fall back to a centred card)
  const inView = (where, stepId, selector) => () => new Promise((resolve) => {
    Promise.resolve(where === 'editor' ? show.editor?.() : show.list?.()).catch(() => {}).finally(() => {
      setTimeout(() => { safeBeforeShow(tour, stepId, selector); resolve(); }, 450);
    });
  });
  const step = (id, n, title, text, selector, where, on = 'bottom') => tour.addStep({
    id, title, text,
    ...(selector ? { attachTo: { element: selector, on } } : {}),
    ...(selector ? { beforeShowPromise: inView(where, id, selector) } : {}),
    when: { show() { injectStepCounter(n); } },
    buttons: [btnBack(), btnNext],
  });

  tour.addStep({
    id: 'notes-welcome',
    title: 'Notes — Quick Tour',
    text: 'Write, speak and find your notes. File them under a project or client, turn to-do lines into real tasks, set reminders, record your voice, and ask questions across everything you have written. Notes are private to you, and Chat can read them only when you switch that on.',
    when: { show() { injectStepCounter(1); } },
    buttons: [btnSecondary('Skip Tour', () => tour.cancel()), { text: 'Start Tour →', action: () => tour.next() }],
  });

  step('notes-new', 2, 'Start a note', 'The + button starts a new note: write one, record your voice (press Start and talk; Change picks how it is written up and whether to keep the audio, and Write up again redoes it another way later), or begin from a template such as Meeting notes or Client call. Talk it through is also here: ask out loud, hear the answers, and keep the conversation as a note. On a phone, the Record button on the home screen opens the recorder straight away.', '[data-tour="notes-new"]', 'list');
  step('notes-search', 3, 'Search', 'Finds notes by words in the title or text, and by the name of a project, client or tag.', '[data-tour="notes-search"]', 'list');
  step('notes-views', 4, 'Saved views', 'Set up a search, dates, tags and grouping you use often, then save it here under a name. One tap brings it all back.', '[data-tour="notes-views"]', 'list');
  step('notes-filters', 5, 'Filters', 'Filter by date range, reminders, tags, project or client. The number on the button shows how many are on.', '[data-tour="notes-filters"]', 'list');
  step('notes-group', 6, 'Group the list', 'Group by date, project, client or tag. Reminders that are due and pinned notes always lead the list.', '[data-tour="notes-group"]', 'list');
  step('notes-list', 7, 'Your notes', 'Click a note to open it. Hover a note for pin, make-one-task and delete (on a phone, tap the three dots). Voice notes, files, tags, reminders and the project show on each row.', '[data-tour="notes-list"]', 'list', 'right');
  step('notes-toolbar', 8, 'Working on a note', 'Pin it, run AI actions, dictate, make a task or take it to a chat. Notes save by themselves a moment after you stop typing, and the history button keeps earlier versions so nothing is lost for good. In a chat, My notes lets that chat read your notes, and the pen under any reply saves it here.', '[data-tour="notes-toolbar"]', 'editor');
  step('notes-filing', 9, 'File it', 'Put the note under a project and a client, and add tags. Tags you already use are offered as you type. Not sure where it goes? The AI button can suggest a project and client from your own lists. Notes not filed yet show an Unfiled chip above the list.', '[data-tour="notes-filing"]', 'editor');
  step('notes-mode', 10, 'Write, Rich and Preview', 'Write is the plain text box. Rich is the enhanced editor: it shows the formatting as you type and has a toolbar for headings, lists, to-dos, links and tables. Preview shows the note formatted so you can tick to-dos. When a note has to-dos that are not tasks yet, Make tasks appears here: it turns them into real tasks with the note\'s project and client, and a due date if the line says one. Tick either the line or the task and the other follows.', '[data-tour="notes-mode"]', 'editor');
  step('notes-reminder', 11, 'Reminders', 'Remind yourself about a note at a time you choose, choose whether it repeats, and tick "also email me" if you want an email as well. A reminder that has come due appears at the top of the list, where you can mark it done or snooze it. A repeating one moves to its next time when you mark it done.', '[data-tour="notes-reminder"]', 'editor');
  step('notes-attach', 12, 'Attach files', 'Attach a PDF, photo, spreadsheet or document to the note: press Attach files, drop files onto the note, or paste an image into the text. Click a file to open it. Files are private to you, and searching by a file name finds the note.', '[data-tour="notes-attach"]', 'editor');
  step('notes-ai', 13, 'AI actions', 'Summarise the note, pull out its to-dos as tasks, tidy it up, or suggest tags and a title. The AI only proposes: nothing changes until you choose. The note text is sent to the AI only when you press one.', '[data-tour="notes-ai"]', 'editor');

  step('notes-ask', 14, 'Ask your notes', 'Ask a question in your own words, such as "what did I agree with Acme in October?". It finds notes by their words and by what they are about, reads the ones that fit and answers only from them, showing which notes it used so you can open them. With Linked records on it also maps the projects, clients, tasks and deals tied to those notes. It never changes a note.', '[data-tour="notes-ask"]', 'list');

  tour.addStep({
    id: 'notes-bin',
    title: 'Recently deleted, and getting help',
    text: 'Deleted notes, templates and views wait 30 days in Recently deleted, so a slip is never final. Stuck? Press the round button at the bottom right and say what you want to do, and the Notes guide will point you to the right buttons. The (i) beside the title explains it all again.',
    attachTo: { element: '[data-tour="notes-bin"]', on: 'bottom' },
    beforeShowPromise: inView('list', 'notes-bin', '[data-tour="notes-bin"]'),
    when: { show() { injectStepCounter(15); } },
    buttons: [
      btnBack(),
      { text: 'Finish Tour ✓', action() { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } tour.complete(); } },
    ],
  });

  tour.on('cancel', () => { try { localStorage.setItem(TOUR_KEY, '1'); } catch (_) { /* ignore */ } });
  tour.start();
  return tour;
}
