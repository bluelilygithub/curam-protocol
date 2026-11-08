'use strict';

// The Plans guide (the round button on Vault's /plans page): a person says what they want to do ("plan a kitchen reno", "make step B start
// after step A", "will this finish by Friday?") and the guide points at the real views and controls, in order, or says plainly that Plans does
// not do it. It only knows what is written here and never sees any plan. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/plans/plansTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/plans.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'list', label: 'Your plans', group: 'Your plans',
    does: 'Shows every plan you have, newest change first, each as a card with its name, how many steps are done out of how many, its start and finish-by dates when it has them, and its status if it is not active. Click a plan\'s name to open it. Each card has a Delete button.',
    notes: 'Only your own plans appear. You can keep up to 100.' },
  { id: 'new', label: 'Start a plan', group: 'Your plans',
    does: 'The Start a plan box at the top of the list: type or say (with the microphone) a name, optionally pick a Start date and a Finish by date, and press Make plan. The plan is made and opened so you can add its steps.',
    notes: 'The dates are optional and can be set or changed later on the plan. Leaving the name empty makes a plan called Untitled plan. Nothing is asked for the steps here: they are added on the plan itself.' },
  { id: 'search', label: 'Search', group: 'Your plans',
    does: 'The search box above your plans narrows the list to plans whose name or notes have all the words you type. The microphone beside it lets you say the words.',
    notes: 'It searches a plan\'s name and notes, not its steps.' },
  { id: 'delete', label: 'Delete and undo', group: 'Your plans',
    does: 'The Delete button on a plan card asks "Delete? Yes / No". After Yes the plan leaves the list, with all its steps, and a message appears with an Undo button for a few seconds. Afterwards it stays in the recycle bin in Settings for 30 days, where it can still be put back.',
    notes: 'After 30 days a deleted plan is gone for good. Undo brings back the plan with its steps, groups, waits-on links and the same dates.' },
  { id: 'from-diagram', label: 'Make a plan from a diagram', group: 'Your plans',
    does: 'This button is on the Diagrams page, beside To Notes, not on the Plans page, and it only shows when Plans is switched on for the person. It turns a diagram into a plan: each box with writing in it becomes a step, each arrow means the next step waits for the one before, and a decision (diamond) or an end oval becomes a milestone. A box opens asking for the start date, the finish-by date, the working week and the days each step takes, and a line says whether it fits. Create plan makes the plan, links it to the diagram and opens it; the button then reads In a plan and lists the plans made from that diagram. In that box, Estimate lengths with AI suggests the days for each step: it is one AI request that sees only the step names and the plan name, fills in the lengths you have not typed, marks them with a star, and every one can be changed.',
    notes: 'Every decision is taken as Yes: arrows leaving a decision that say No, and steps only reachable through them, are left out unless Include the No branches is ticked. Arrows that loop back to an earlier step are left out because a plan cannot go in circles. A Start oval is dropped. Every step is one working day until a length is typed or estimated. No AI is used unless Estimate lengths with AI is pressed. Up to 40 boxes. A later change to the diagram is not copied into a plan already made.' },
  { id: 'from-note', label: 'Make a plan from a note', group: 'Your plans',
    does: 'This button is in the Notes page, in the toolbar of an open note beside Convert to Task, not on the Plans page, and it only shows when Plans is switched on for the person. It turns the note\'s lists into a plan: a heading becomes a section, each line of a bulleted, numbered or check-box list becomes a step, and indented lines become sub-steps. A length at the end of a line such as (3 days), 3d or 2 weeks (a week is five working days) is used and removed from the name, a line starting Milestone: is a milestone, and a ticked check-box is a step that is already done. A box opens asking for the start date, the finish-by date, the working week and how the steps follow each other: as the note\'s lists say (numbered lists run in order, bullets together), one after another, or all together. A line says whether it fits, and Create plan makes the plan, links it to the note and opens it; the button then reads In a plan.',
    notes: 'Only lists become steps: paragraphs, quotes and code are ignored, and a heading with no list under it is left out. Up to 60 steps. A step is one working day unless the note gives a length or one is typed. No AI is used unless Estimate lengths with AI is pressed, which only suggests numbers for steps whose length is not written in the note. It is a copy: later changes to the note are not copied into a plan already made, and the note is saved first so the plan is made from what is on screen.' },
  { id: 'editor', label: 'One plan', group: 'One plan',
    does: 'An opened plan: at the top its name, dates, working week, status and a line saying whether it fits; then its notes; then the Steps table where every step is edited and added; and under that the timeline. A Plans button at the top goes back to the list.',
    notes: 'Changes save by themselves: a name or notes when you click away, a date or a choice as soon as you change it. There is no Save button.' },
  { id: 'dates', label: 'Start, finish by and working week', group: 'One plan',
    does: 'At the top of a plan: Start is the first day of work, Finish by is the date it must be done by, and Working week chooses Monday to Friday or Every day. Step lengths are counted in working days, so with Monday to Friday a step that runs over a weekend skips it. Clearing the Start date works backwards from the Finish by date.',
    notes: 'Both dates are optional. With no Start date (and no pinned step) nothing can be dated, and the plan says so. The end date cannot be before the start date.' },
  { id: 'client', label: 'Client and client project', group: 'One plan',
    does: 'The Client and Client project boxes at the top of a plan (they are left out when the CRM is not available to the person and the plan has no client) file the plan under one of the person\'s CRM clients and optionally one of that client\'s projects. Choosing a project also chooses its client, and changing the client clears a project of the old one. They can also be chosen when starting a plan or in the Make a plan box. A plan made from a note starts with the note\'s client and project. The client\'s page and the client project\'s page each list their plans and can start a new one, the Plans list has a client filter, and tasks sent from the plan are filed under the client and project. Open beside a box goes to that client or project. A client project\'s start and target end dates follow its plans: the earliest start and the latest finish of its draft and active plans, shown in the project\'s Brief as from its plans.',
    notes: 'Only the person\'s own clients and client projects can be chosen, and a project must belong to the chosen client. A client project is a project made for a client on the Client work page, not an ordinary chat workspace. Deleting a client or project leaves the plan in place, with the link removed. Tasks already sent are not moved if the plan\'s client changes later. The dates the person typed on the project are kept and put back when the plans go away, or when Use my own dates is pressed in the project\'s Brief (Follow its plans turns it back on); typing a different date by hand also turns following off. A plan marked Done or Archived does not count.' },
  { id: 'fit', label: 'Does it fit?', group: 'One plan',
    does: 'The line under the dates in a plan says how the steps compare with the Finish by date: Fits exactly, Fits with some working days to spare, or Over by some working days (with when the steps actually finish, and what to do about it). With a Finish by date but no Start date it suggests a start, and a Use button sets it. With no Finish by date it just says when the plan finishes and how many working days that is.',
    notes: 'It never shortens a step or reorders anything by itself: if it is over, you shorten a step, run two at once (remove a waits-on), or move the end date. If some steps wait on each other in a circle it says so and nothing is dated.' },
  { id: 'steps', label: 'Add and edit steps', group: 'One plan',
    does: 'In the Steps table of a plan: type (or say, with the microphone) a step name in the box under the table, set its days, and press Add (Enter in the name box also adds it). Each row has the step\'s name, start, days, end, what it waits on, its status and three small buttons: milestone, add a sub-step and delete. A name saves when you click away from it.',
    notes: 'A plan can have up to 300 steps. Steps stay in the order they were added, with sub-steps under their group; they cannot be re-ordered by hand yet. The start and end columns are worked out for you.' },
  { id: 'length', label: 'Days a step takes', group: 'One plan',
    does: 'The Days box on a step is how many working days it takes, a whole number from 1 up. Change it and every step after it that waits on it moves, and the fit line updates. A milestone has no days.',
    notes: 'Whole working days only, no hours or part-days. A step left at 1 takes one working day. The most is 3,650 days.' },
  { id: 'waits-on', label: 'Waits on', group: 'One plan',
    does: 'The Waits on column of a step: choose + wait on and pick another step that must finish first. It shows as a small tag with the step\'s name, and the step now starts the working day after that one ends. Pick several and it waits for the last to finish. Press a tag to remove the link. Steps with nothing to wait on start together on the first day.',
    notes: 'A step cannot wait on itself, and two steps cannot wait on each other, directly or through others: that is refused with a message. A group takes no waits-on of its own: link its sub-steps. The only kind of link is finish-then-start; there are no start-together links or gaps.' },
  { id: 'pin', label: 'Pin a step to a day', group: 'One plan',
    does: 'Change the date in a step\'s Starts box and the step is pinned to that day: a small pin button appears beside it, and the step stays there whatever comes before it. Press the pin to unpin it, and it starts as soon as the steps it waits on are done.',
    notes: 'If a step it waits on runs past the pinned day, the step is marked clashes and its end date turns amber; the date is kept, not moved. A pinned start on a weekend moves to the next working day.' },
  { id: 'groups', label: 'Groups and sub-steps', group: 'One plan',
    does: 'The plus button on a step adds a sub-step inside it. The step becomes a group: it is shown with its sub-steps indented under it, has no days of its own, and spans from its first sub-step to its last. Sub-steps can have their own days, waits-on links and pins.',
    notes: 'A step that waits on something, or that something waits on, cannot hold sub-steps (its plus button is greyed out): remove its links first, or link the sub-steps instead. Deleting a group deletes its sub-steps.' },
  { id: 'milestones', label: 'Milestones', group: 'One plan',
    does: 'The diamond button on a step makes it a milestone: a point in time with no length, such as a sign-off or a decision, shown as a diamond on the timeline. A milestone lands on the day the last step it waits on ends, and the step after it starts the next working day. You can also tick Milestone when adding a step. Press the diamond again to make it a normal one-day step.',
    notes: 'A milestone adds no day to the plan. A group cannot be a milestone.' },
  { id: 'status', label: 'Status', group: 'One plan',
    does: 'Each step has a status (To do, In progress, Done) in its row, and the plan has a status at the top (Draft, Active, Done, Archived). The list shows how many steps are done on each plan\'s card.',
    notes: 'They are labels for you. Marking a step Done does not change any date, and the plan status does not change anything either.' },
  { id: 'timeline', label: 'The timeline', group: 'One plan',
    does: 'Under the steps, the timeline draws every dated step as a bar from its first to its last day, a diamond for a milestone, an arrow for each waits-on link and a line for today. Week, Month and Quarter change how much fits on screen (a plan of four weeks or less opens at Week). Click a bar to jump to that step\'s row. Dragging a bar moves the step to another day, and dragging its right edge changes its length. Steps that cannot be dated yet are listed under Unscheduled.',
    notes: 'You can drag a bar to move that step to another day (the step becomes pinned there, as if you had changed its Starts date) or drag its right edge to change its length in working days; the Steps table and the fit line update. A group cannot be dragged because its dates come from its sub-steps, and a milestone can only be moved. The timeline also stretches to show the Finish by date when the steps run past it.' },
  { id: 'tasks', label: 'Send to Tasks', group: 'One plan',
    does: 'In the Steps table, the checklist button on a step sends it to Tasks as a real task: the step\'s last day becomes the due date, its days (at eight hours a day) become the estimate, its status carries over, a milestone stays a milestone, and the plan\'s name and the step\'s notes go in the task\'s notes. On a group it sends the group as a task and its sub-steps as subtasks. Send all to Tasks, above the table, does it for every step not already in Tasks, after asking Yes or No. Steps that wait on each other become tasks that wait on each other. Once a step is in Tasks its button becomes a tick, and pressing the tick opens Tasks. A message offers an Open Tasks link.',
    notes: 'It is a copy made at that moment: later changes to a step\'s dates, name or length are not copied to the task. The one thing that comes back is the status: ticking, starting or reopening the task in Tasks gives its plan step the same status. Changing or deleting the task does not touch the plan otherwise. A step already in Tasks is not sent twice; if its task is deleted, the step can be sent again. A step with no date yet (the plan has no start date) is sent without a due date, and the message says so. A task with a due date shows in the Tasks calendar view like any other.' },
  { id: 'calendar', label: 'Plan steps on the calendar', group: 'One plan',
    does: 'On the Tasks page, in the Calendar view, the Plan steps button in the top bar (shown when Plans is available to the person) turns on a layer of plan steps: every unfinished step of a draft or active plan that is not in Tasks yet appears on the day it ends, named with its plan, with a diamond for a milestone. Click one to open its plan. A step that has been sent to Tasks shows as the task itself, so it never appears twice. The choice is remembered.',
    notes: 'The items are read-only: they cannot be dragged to another day or ticked off there, so change a step on its plan. Only the last day of a step is shown, not its whole length. Finished steps, groups and plans marked Done or Archived are left out.' },
  { id: 'delete-step', label: 'Delete a step', group: 'One plan',
    does: 'The bin button on a step asks "Delete? Yes / No". After Yes the step goes, together with its sub-steps and any waits-on links to it, and the steps that waited on it move earlier.',
    notes: 'A single deleted step cannot be undone and does not go to the recycle bin; only a whole deleted plan can be put back. The question is asked first.' },
];

const RULES = [
  'Your plans is the list, where a new plan is started; one plan is where its dates and steps are set. The Start a plan box and the plan cards are on the list; the dates, the Steps table and the timeline are inside an opened plan. Make a plan from a diagram is a button on the Diagrams page.',
  'Changes in a plan save by themselves. There is no Save button to press.',
  'Plan steps are not Tasks until the person sends them: until then they do not appear in the task list, the weekly digest, the attention list or the calendar. Send to Tasks copies a step into Tasks once; only the status of the task comes back to the step, and nothing else is kept in step.',
  'All lengths are whole working days. Dates are worked out for the person: they give the start and the lengths, and Plans works out when each step lands and whether it fits.',
  'A step starts the working day after the steps it waits on end. A milestone lands on the day the step before it ends. Steps that wait on nothing start together on the first day.',
  'Plans does not use AI to make a plan or its dates. The only AI in Plans is this guide chat and the Estimate lengths with AI button in the Make a plan box, which sends only the step names and the plan name and suggests numbers the person can change. Nothing else in a plan is ever sent to a model.',
  'Delete on a plan asks first and shows an Undo button; a deleted plan also waits 30 days in the recycle bin in Settings. Deleting a single step cannot be undone.',
  'Plans are private to the person. There is no sharing and no planning together with other people.',
  'The Open buttons in this chat only switch to a tool (a view of the page); they never add, change or delete a step or a plan by themselves.',
];

const NOT_POSSIBLE = [
  'Letting the AI choose the lengths without the person seeing them: Estimate lengths with AI only suggests numbers that the person can change. Plans are made from a diagram (Make a plan in Diagrams) or from a note (Make a plan in Notes), not from an email, a chat or a file.',
  'Dragging a group\'s bar, or stretching a milestone: a group\'s dates come from its sub-steps, so drag a sub-step instead, and a milestone has no length.',
  'Dragging a plan step on the Tasks calendar, or ticking it there: plan steps on the calendar are read-only, so open the plan to change them.',
  'Keeping a task\'s dates, name or length in step with its plan step: only the status comes back from Tasks. Change the task in Tasks, or delete it and send the step again.',
  'Putting a single deleted step back: only a whole deleted plan can be undone.',
  'Re-ordering steps by hand: they stay in the order they were added, with sub-steps under their group.',
  'Hours or part-days, people, costs or resources, or a highlighted critical path: lengths are whole working days only.',
  'Any kind of link except finish-then-start: there are no start-together links, overlaps or gaps between steps.',
  'Keeping a plan up to date with the diagram it was made from: a plan made from a diagram is a copy, and later changes to the diagram are not copied into it.',
  'Sharing a plan with other people, a link to it, or planning together.',
];

const SYSTEM = `You are the guide to Plans in Vault for one person who plans work as steps with lengths and dates. They say, in everyday words, what they want to do. You point them to the right view and controls and say plainly when Plans cannot do something.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Plans cannot do.
- You cannot see any plan, its name, its steps or its dates. Never state or guess what a person's plans contain, and never add, change or delete anything yourself: point at the controls.
- Be plain and short, as to a friend who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about where each control is: the list of plans, or inside an opened plan, or the Diagrams page for Make a plan from a diagram.
- Plans itself costs nothing to use. The only AI in it is the Estimate lengths with AI button (one AI request) and this guide chat; do not say otherwise.
- If they ask for something in the list of things Plans does not do, say so plainly and, where the notes allow, suggest the nearest thing that does work (for example, a plan can be made from a diagram, and dates can be changed in the Steps table).
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Plans guide', feature: 'plans_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'PLANS VIEWS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to plan or do, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askPlansTutor: guide.ask,
};
