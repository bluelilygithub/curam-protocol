// The suggestion cards on the Diagrams start screen ("What do you want to do?"). Each card starts something in one click:
//   describe   a new diagram with Draw it for me open          template  New diagram with that template picked (diagramTemplates.mjs)
//   blank      a new empty diagram                            gallery   New diagram, nothing picked
//   file       Open a file (.excalidraw)
// Plain data, so it is tested:  node client/src/pages/drawings/drawingsStarts.test.mjs

export const STARTS = [
  { id: 'describe', action: 'describe', icon: 'sparkles', title: 'Describe it and AI draws it', blurb: 'Say or type the steps, the people or the ideas. It is drawn as boxes and arrows you can change.' },
  { id: 'org', action: 'template', template: 'org-standard', icon: 'user', title: 'Draw an org chart', blurb: 'Who reports to whom: a head, managers and their teams.' },
  { id: 'process', action: 'template', template: 'flow-decision', icon: 'workflow', title: 'Map a process', blurb: 'Steps in order, with a yes / no decision and a loop back.' },
  { id: 'timeline', action: 'template', template: 'timeline-milestones', icon: 'calendar', title: 'Lay out a timeline', blurb: 'A start, the milestones along the way, and a finish.' },
  { id: 'project', action: 'template', template: 'project-wbs', icon: 'gantt-chart', title: 'Break down a project', blurb: 'Phases and their tasks. Make a plan from it afterwards.' },
  { id: 'mindmap', action: 'template', template: 'mindmap', icon: 'lightbulb', title: 'Brainstorm a mind map', blurb: 'A central idea with branches and ideas on each.' },
  { id: 'swot', action: 'template', template: 'mindmap-swot', icon: 'scale', title: 'Weigh it up (SWOT)', blurb: 'Strengths, weaknesses, opportunities and threats.' },
  { id: 'stakeholders', action: 'template', template: 'rel-stakeholders', icon: 'share-2', title: 'Map your stakeholders', blurb: 'Who you work with, around you in the middle.' },
  { id: 'blank', action: 'blank', icon: 'pen-tool', title: 'Start on a blank page', blurb: 'An empty page to sketch on freely.' },
  { id: 'gallery', action: 'gallery', icon: 'layout-grid', title: 'Browse every template', blurb: 'All the built-in templates, and your own.' },
  { id: 'file', action: 'file', icon: 'upload', title: 'Bring in a file', blurb: 'Open a diagram saved from Excalidraw (.excalidraw).' },
];

export const ACTIONS = ['describe', 'template', 'blank', 'gallery', 'file'];
