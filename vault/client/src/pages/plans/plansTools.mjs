// What the Plans page shows: its two views (the list of plans and one plan), the hover text for them, the words in the (i) box, and every
// control the guide (the round button) can point at. The ids are the guide's catalogue (server/services/plansTutor.js);
// `node server/services/plansTutor.test.js` fails if the two lists drift apart. `tool` is the view the guide's Open button shows.

export const PLAN_TOOLS = [
  { id: 'list', label: 'Your plans', group: 'Your plans', icon: 'gantt-chart' },
  { id: 'editor', label: 'One plan', group: 'One plan', icon: 'list-checks' },
];

export const GROUPS = ['Your plans', 'One plan'];

export const GROUP_TIPS = {
  'Your plans': 'Start a new plan and see every plan you have: open one, or delete one.',
  'One plan': 'A single plan: its dates, its steps with their lengths and what each waits on, and the timeline that draws them.',
};

export const TOOL_TIPS = {
  list: 'Start a plan, and see all your plans. Click one to open it.',
  editor: 'One plan: set the dates, add steps, say how long each takes and which ones wait on others. The timeline below draws it.',
};

// One short line under the page title for the open view.
export const TOOL_BLURBS = {
  list: 'Steps with dates, and which ones wait on which, drawn as a timeline.',
  editor: 'Add steps, give each a length, and say which wait on others.',
};

// The longer text for the (i) "How Plans work" box.
export const HOW_IT_WORKS = [
  ['Steps and lengths', 'A plan is a list of steps. Give each step a length in working days (one if you leave it alone). A step with a length of zero is a milestone: a point in time, such as a sign-off, shown as a diamond.'],
  ['Start, finish by and length', 'Give any two and Plans fills in the third. A start date plus the step lengths gives the finish. A finish-by date plus the lengths, with no start, suggests the start. With all three it says whether the steps fit, and by how many working days they run over if they do. It never shrinks your lengths by itself.'],
  ['Waits on', 'A step that waits on another starts the working day after it ends. Steps that wait on nothing start together on the first day. A milestone lands on the day the step before it ends, so it adds no day. Steps cannot wait on each other in a circle.'],
  ['Pin a step to a day', 'Change a step\'s own start date to hold it on that day. If a step it waits on runs past that day, the step is marked as clashing; the date is kept, not moved. Press the pin to let it start as soon as it can again.'],
  ['Groups', 'Add a sub-step inside a step and that step becomes a group: it has no length of its own and spans its sub-steps. A step that waits on something, or is waited on, cannot become a group; link its sub-steps instead.'],
  ['The timeline', 'Under the steps, the timeline draws every step as a bar from its first to its last day, with an arrow for each waits-on link and a line for today. Choose Week, Month or Quarter. Click a bar to jump to its step. Drag a bar to move that step to another day (it is then pinned there), or drag its right edge to change its length. A group cannot be dragged: its dates come from its sub-steps.'],
  ['From a diagram', 'In Diagrams, the Make a plan button turns a diagram into a plan: each box a step, each arrow a waits-on, decisions taken as Yes. It asks for the dates and the days each step takes, and links the plan back to the diagram. An Estimate lengths with AI button can suggest the days for each step: it is one AI request that sees only the step names, and every number can be changed.'],
  ['Send to Tasks', 'Plan steps are not Tasks until you send them, so they stay out of your task list, the weekly digest and the calendar. The checklist button on a step sends it to Tasks as a real task: its last day is the due date and its days are the estimate. Send all to Tasks does every step that is not there yet, and a group goes with its sub-steps as subtasks. It is a copy made at that moment: later changes to the plan are not copied to the task. The one thing that comes back is the status: when you tick, start or reopen the task in Tasks, its plan step gets the same status.'],
  ['On the calendar', 'In the Tasks calendar, the Plan steps button in its top bar shows the steps of your plans that are not in Tasks yet, each on the day it ends. They are read-only: click one to open its plan. A step you have sent to Tasks shows as the task itself, so nothing appears twice.'],
  ['Private', 'Your plans are yours alone. A deleted plan waits 30 days in the recycle bin in Settings, and an Undo button appears straight away. A deleted step cannot be undone.'],
  ['Not included yet', 'Making a plan from a note, a task in Tasks keeping its dates or name in step with its plan step (only the status comes back), sharing a plan, and a recycle bin for a single deleted step.'],
];

// Everything the guide can point at: the two views plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'list', label: 'Your plans', tool: 'list' },
  { id: 'new', label: 'Start a plan', tool: 'list' },
  { id: 'search', label: 'Search', tool: 'list' },
  { id: 'delete', label: 'Delete and undo', tool: 'list' },
  { id: 'from-diagram', label: 'Make a plan from a diagram', tool: 'list' },
  { id: 'editor', label: 'One plan', tool: 'editor' },
  { id: 'dates', label: 'Start, finish by and working week', tool: 'editor' },
  { id: 'fit', label: 'Does it fit?', tool: 'editor' },
  { id: 'steps', label: 'Add and edit steps', tool: 'editor' },
  { id: 'length', label: 'Days a step takes', tool: 'editor' },
  { id: 'waits-on', label: 'Waits on', tool: 'editor' },
  { id: 'pin', label: 'Pin a step to a day', tool: 'editor' },
  { id: 'groups', label: 'Groups and sub-steps', tool: 'editor' },
  { id: 'milestones', label: 'Milestones', tool: 'editor' },
  { id: 'status', label: 'Status', tool: 'editor' },
  { id: 'timeline', label: 'The timeline', tool: 'editor' },
  { id: 'tasks', label: 'Send to Tasks', tool: 'editor' },
  { id: 'calendar', label: 'Plan steps on the calendar', tool: 'editor' },
  { id: 'delete-step', label: 'Delete a step', tool: 'editor' },
];
