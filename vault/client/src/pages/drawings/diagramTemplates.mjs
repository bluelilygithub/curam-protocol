// Diagram templates: a built-in library of starting diagrams. Each one builds the same STRUCTURE "Draw it for me" gets from the AI
// ({ kind, direction, nodes, edges }, see server/services/drawingDiagram.js), so the editor lays it out and draws it with placeDiagram,
// no AI involved. A template's options (how many managers, how many steps...) are plain numbers or choices; direction and look are
// chosen in the gallery for every template. Pure, so it is unit-tested:  node client/src/pages/drawings/diagramTemplates.test.mjs

export const MAX_NODES = 40; // the same limit as "Draw it for me" and "Change it", so a template can always be changed by voice

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DEPARTMENTS = ['Finance', 'Operations', 'Sales', 'Marketing', 'People', 'Technology'];
const PHASES = ['Discovery', 'Design', 'Build', 'Test', 'Launch', 'Review'];

/** A small builder: add(label, shape) returns the new node's id; link(a, b, label) joins two. */
function graph(kind, direction) {
  const nodes = [];
  const edges = [];
  return {
    add(label, shape = 'box') { const id = `n${nodes.length + 1}`; nodes.push({ id, label, shape }); return id; },
    link(from, to, label) { edges.push(label ? { from, to, label } : { from, to }); },
    chain(ids) { for (let i = 0; i + 1 < ids.length; i += 1) this.link(ids[i], ids[i + 1]); },
    done() { return { kind, direction, nodes, edges }; },
  };
}

const num = (key, label, min, max, dflt) => ({ key, label, type: 'number', min, max, default: dflt });
const pick = (key, label, choices, dflt) => ({ key, label, type: 'select', choices, default: dflt });
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

export const TEMPLATE_GROUPS = ['Org charts', 'Projects', 'Timelines', 'Processes', 'Mind maps', 'Relationships'];

export const TEMPLATES = [
  // ---- org charts ----
  {
    id: 'org-standard', group: 'Org charts', name: 'Org chart', direction: 'down',
    hint: 'One person at the top, managers under them, and a team under each manager.',
    options: [num('managers', 'Managers', 1, 6, 3), num('staff', 'People per manager', 0, 5, 2)],
    build: (o, dir) => {
      const g = graph('org', dir);
      const top = g.add('Chief executive');
      for (const m of range(o.managers)) {
        const mid = g.add(`Manager ${m}`);
        g.link(top, mid);
        for (const s of range(o.staff)) g.link(mid, g.add(`Team member ${m}.${s}`));
      }
      return g.done();
    },
  },
  {
    id: 'org-team', group: 'Org charts', name: 'Small team', direction: 'down',
    hint: 'A team leader and the people who report to them.',
    options: [num('members', 'Team members', 2, 12, 5)],
    build: (o, dir) => {
      const g = graph('org', dir);
      const lead = g.add('Team leader');
      for (const i of range(o.members)) g.link(lead, g.add(`Team member ${i}`));
      return g.done();
    },
  },
  {
    id: 'org-departments', group: 'Org charts', name: 'Departments', direction: 'down',
    hint: 'A board and chief executive over named departments, each with a head and teams.',
    options: [num('departments', 'Departments', 2, 6, 4), num('teams', 'Teams per department', 0, 4, 2)],
    build: (o, dir) => {
      const g = graph('org', dir);
      const ceo = g.add('Chief executive');
      g.link(g.add('Board'), ceo);
      for (const d of DEPARTMENTS.slice(0, o.departments)) {
        const head = g.add(`Head of ${d}`);
        g.link(ceo, head);
        for (const t of range(o.teams)) g.link(head, g.add(`${d} team ${t}`));
      }
      return g.done();
    },
  },
  // ---- projects ----
  {
    id: 'project-wbs', group: 'Projects', name: 'Work breakdown', direction: 'down',
    hint: 'The project split into phases, and each phase into tasks.',
    options: [num('phases', 'Phases', 2, 6, 4), num('tasks', 'Tasks per phase', 1, 5, 3)],
    build: (o, dir) => {
      const g = graph('org', dir);
      const top = g.add('Project');
      for (const [i, p] of PHASES.slice(0, o.phases).entries()) {
        const ph = g.add(p);
        g.link(top, ph);
        for (const t of range(o.tasks)) g.link(ph, g.add(`Task ${i + 1}.${t}`));
      }
      return g.done();
    },
  },
  {
    id: 'project-lifecycle', group: 'Projects', name: 'Project lifecycle', direction: 'right',
    hint: 'Start, plan, do the work, check it, finish, with a loop back when a check finds problems.',
    options: [],
    build: (_o, dir) => {
      const g = graph('flow', dir);
      const start = g.add('Start the project', 'start-end');
      const plan = g.add('Plan');
      const work = g.add('Do the work');
      const ok = g.add('Checks passed?', 'decision');
      const end = g.add('Close the project', 'start-end');
      g.chain([start, plan, work, ok]);
      g.link(ok, end, 'Yes');
      g.link(ok, work, 'No');
      return g.done();
    },
  },
  {
    id: 'project-phases', group: 'Projects', name: 'Phases with tasks', direction: 'right',
    hint: 'Phases one after another, each with its tasks branching off.',
    options: [num('phases', 'Phases', 2, 6, 4), num('tasks', 'Tasks per phase', 0, 4, 2)],
    build: (o, dir) => {
      const g = graph('flow', dir);
      const phases = PHASES.slice(0, o.phases).map((p) => g.add(p));
      g.chain(phases);
      phases.forEach((ph, i) => { for (const t of range(o.tasks)) g.link(ph, g.add(`Task ${i + 1}.${t}`)); });
      return g.done();
    },
  },
  // ---- timelines ----
  {
    id: 'timeline-steps', group: 'Timelines', name: 'Simple timeline', direction: 'right',
    hint: 'Events in order, one after another.',
    options: [num('events', 'Events', 3, 12, 5)],
    build: (o, dir) => {
      const g = graph('timeline', dir);
      g.chain(range(o.events).map((i) => g.add(`Event ${i}`)));
      return g.done();
    },
  },
  {
    id: 'timeline-milestones', group: 'Timelines', name: 'Milestones', direction: 'right',
    hint: 'A start, the milestones along the way, and a finish.',
    options: [num('milestones', 'Milestones', 1, 10, 4)],
    build: (o, dir) => {
      const g = graph('timeline', dir);
      g.chain([g.add('Start', 'start-end'), ...range(o.milestones).map((i) => g.add(`Milestone ${i}`)), g.add('Finish', 'start-end')]);
      return g.done();
    },
  },
  {
    id: 'timeline-months', group: 'Timelines', name: 'Months', direction: 'right',
    hint: 'One box per month, starting from the month you choose.',
    options: [pick('start', 'Starting month', MONTHS, MONTHS[new Date().getMonth()]), num('months', 'Months', 2, 12, 6)],
    build: (o, dir) => {
      const g = graph('timeline', dir);
      const first = Math.max(0, MONTHS.indexOf(o.start));
      g.chain(range(o.months).map((i) => g.add(MONTHS[(first + i - 1) % 12])));
      return g.done();
    },
  },
  {
    id: 'timeline-quarters', group: 'Timelines', name: 'Quarters', direction: 'right',
    hint: 'Quarters of the year (Q1 to Q4) across one or more years.',
    options: [num('year', 'First year', 2000, 2100, new Date().getFullYear()), num('years', 'Years', 1, 3, 1)],
    build: (o, dir) => {
      const g = graph('timeline', dir);
      const ids = [];
      for (let y = 0; y < o.years; y += 1) for (const q of range(4)) ids.push(g.add(`Q${q} ${o.year + y}`));
      g.chain(ids);
      return g.done();
    },
  },
  // ---- processes ----
  {
    id: 'flow-basic', group: 'Processes', name: 'Simple process', direction: 'down',
    hint: 'A start, the steps in order, and an end.',
    options: [num('steps', 'Steps', 1, 12, 4)],
    build: (o, dir) => {
      const g = graph('flow', dir);
      g.chain([g.add('Start', 'start-end'), ...range(o.steps).map((i) => g.add(`Step ${i}`)), g.add('End', 'start-end')]);
      return g.done();
    },
  },
  {
    id: 'flow-decision', group: 'Processes', name: 'Process with a decision', direction: 'down',
    hint: 'Steps leading to a yes/no question: Yes goes on, No goes back and tries again.',
    options: [num('before', 'Steps before the question', 1, 6, 2)],
    build: (o, dir) => {
      const g = graph('flow', dir);
      const steps = range(o.before).map((i) => g.add(`Step ${i}`));
      const q = g.add('Is it right?', 'decision');
      const after = g.add('Next step');
      g.chain([g.add('Start', 'start-end'), ...steps, q]);
      g.link(q, after, 'Yes');
      g.link(q, steps[steps.length - 1], 'No');
      g.link(after, g.add('End', 'start-end'));
      return g.done();
    },
  },
  {
    id: 'flow-approval', group: 'Processes', name: 'Approval', direction: 'down',
    hint: 'Submit, review, approve or send back for changes.',
    options: [num('levels', 'Approval levels', 1, 3, 1)],
    build: (o, dir) => {
      const g = graph('flow', dir);
      const submit = g.add('Submit the request', 'start-end');
      const revise = g.add('Make the changes');
      let prev = submit;
      for (const l of range(o.levels)) {
        const who = o.levels === 1 ? 'Approved?' : `Approved at level ${l}?`;
        const q = g.add(who, 'decision');
        g.link(prev, q, prev === submit ? undefined : 'Yes');
        g.link(q, revise, 'No');
        prev = q;
      }
      g.link(prev, g.add('Done', 'start-end'), 'Yes');
      g.link(revise, submit, 'Resubmit');
      return g.done();
    },
  },
  {
    id: 'flow-swimsteps', group: 'Processes', name: 'Hand-offs between people', direction: 'right',
    hint: 'Work passing from one person or team to the next.',
    options: [num('people', 'People or teams', 2, 8, 4)],
    build: (o, dir) => {
      const g = graph('flow', dir);
      g.chain(range(o.people).map((i) => g.add(`Person ${i}: their part`)));
      return g.done();
    },
  },
  // ---- mind maps ----
  {
    id: 'mindmap', group: 'Mind maps', name: 'Mind map', direction: 'right',
    hint: 'A central idea with branches, and ideas on each branch.',
    options: [num('branches', 'Branches', 2, 8, 4), num('ideas', 'Ideas per branch', 0, 3, 2)],
    build: (o, dir) => {
      const g = graph('mindmap', dir);
      const centre = g.add('Central idea', 'start-end');
      for (const b of range(o.branches)) {
        const br = g.add(`Branch ${b}`);
        g.link(centre, br);
        for (const i of range(o.ideas)) g.link(br, g.add(`Idea ${b}.${i}`));
      }
      return g.done();
    },
  },
  {
    id: 'mindmap-swot', group: 'Mind maps', name: 'SWOT', direction: 'right',
    hint: 'Strengths, weaknesses, opportunities and threats around one subject.',
    options: [num('points', 'Points under each', 0, 4, 2)],
    build: (o, dir) => {
      const g = graph('mindmap', dir);
      const centre = g.add('Subject', 'start-end');
      for (const s of ['Strengths', 'Weaknesses', 'Opportunities', 'Threats']) {
        const br = g.add(s);
        g.link(centre, br);
        for (const i of range(o.points)) g.link(br, g.add(`${s.replace(/s$/, '')} ${i}`));
      }
      return g.done();
    },
  },
  // ---- relationships ----
  {
    id: 'rel-stakeholders', group: 'Relationships', name: 'Stakeholders', direction: 'down',
    hint: 'Who you work with, around you in the middle.',
    options: [num('stakeholders', 'Stakeholders', 2, 10, 5)],
    build: (o, dir) => {
      const g = graph('relationship', dir);
      const us = g.add('Us', 'start-end');
      for (const i of range(o.stakeholders)) g.link(us, g.add(`Stakeholder ${i}`));
      return g.done();
    },
  },
];

/** The settings a template starts with: each option's default. */
export function defaultValues(t) {
  return Object.fromEntries(t.options.map((op) => [op.key, op.default]));
}

/** A template's diagram for the chosen values (cleaned: numbers kept in range, a choice not offered falls back to the default). */
export function buildTemplate(id, values = {}, direction) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`No such template: ${id}`);
  const o = {};
  for (const op of t.options) {
    const v = values[op.key];
    if (op.type === 'number') { const n = Math.round(Number(v)); o[op.key] = Number.isFinite(n) ? Math.min(op.max, Math.max(op.min, n)) : op.default; }
    else o[op.key] = op.choices.includes(v) ? v : op.default;
  }
  return t.build(o, direction === 'down' || direction === 'right' ? direction : t.direction);
}
