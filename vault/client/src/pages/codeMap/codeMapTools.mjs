// What the Code Map page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are the
// guide's catalogue (server/services/codeMapTutor.js); node server/services/codeMapTutor.test.js fails if the two lists drift apart.
// The page's "tools" are its tabs (the ids are the ?view= values); `tool` on a guide entry says which tab its Open button shows, and the page
// marks each part with data-guide="<id>" so the button can scroll to it.

export const CODE_MAP_TOOLS = [
  { id: 'overview', label: 'Overview', group: 'Code Map', icon: 'code-map' },
  { id: 'tools', label: 'Tools', group: 'Code Map', icon: 'code-map' },
  { id: 'conventions', label: 'Conventions', group: 'Code Map', icon: 'code-map' },
  { id: 'map', label: 'Dependency map', group: 'Code Map', icon: 'code-map' },
  { id: 'structure', label: 'Structure', group: 'Code Map', icon: 'code-map' },
  { id: 'changes', label: 'Changes', group: 'Code Map', icon: 'code-map' },
  { id: 'context', label: 'Context', group: 'Code Map', icon: 'code-map' },
];

export const GROUPS = ['Code Map'];

export const GROUP_TIPS = {
  'Code Map': "A read of Vault's own code: every tool, the code it owns, how it follows the rules in CLAUDE.md, and what to improve first.",
};

// Also the hover tips on the page's tabs.
export const TOOL_TIPS = {
  overview: 'Summary numbers and the ranked list of what to improve.',
  tools: 'One card per tool: score, size, tests and a dot per rule.',
  conventions: 'Every tool against every rule, with the evidence for each cell.',
  map: "Which tools call each other's APIs or share code files.",
  structure: 'Largest files, import cycles, shared foundations, separate packages and possibly unused files.',
  changes: "What moved between two runs: new and resolved findings, and each tool's score.",
  context: 'A briefing about how Vault is built, to paste into a new Claude conversation before designing the next tool. No AI call.',
};

export const TOOL_BLURBS = {
  overview: 'Numbers and ranked findings.',
  tools: 'A card per tool.',
  conventions: 'Tools against rules.',
  map: 'How tools link up.',
  structure: 'The code as a whole.',
  changes: 'Drift between two runs.',
  context: 'A briefing for Claude.',
};

// The longer text for the (i) "How Code Map works" box.
export const HOW_IT_WORKS = [
  ['What it is', "Code Map reads Vault's own source on the server (no git and no network; the analysis itself uses no AI) and works out which code belongs to which tool, then checks each tool against the rules in CLAUDE.md."],
  ['Running it', 'Run analysis reads the code as deployed now. It takes a few seconds and the last 30 runs are kept. A run also happens by itself every Sunday at 3:17 am (Brisbane). High findings are sent to your Suggestions inbox, once per tool, so a repeat run does not add them again.'],
  ['Reading a check', "Green follows the rule, amber is worth a look, red is a gap, grey means the rule does not apply. A tool's score is the share of the rules that apply to it that it follows."],
  ['How sure it is', 'The checks match patterns in the code, so they can be wrong both ways. Read the evidence (file and line) before changing anything. Known false positives are listed in docs/code-map.md.'],
  ['Who owns what', 'A file reached by three or more tools counts as shared and belongs to none of them; the rest belongs to the tools that reach it.'],
  ['Explain and plan a fix', 'On a finding, Explain and plan a fix asks the AI model set in Settings to explain that finding and plan a fix, using only its evidence and the lines around it. It costs a model call, shows the files it read, and says "I could not tell" rather than guess.'],
  ['Context', 'Build briefing makes a description of how Vault is built (tools, rules, building blocks, recent changes, outside services as YES or NO, your notes) to paste into a new Claude conversation or a Claude Project before designing the next tool. It uses no AI and never includes what is in your tools: no client names, amounts, notes or secret values. The last 10 are kept to copy again.'],
];

// Everything the guide can point at: the tabs plus the controls on them. `tool` is the tab the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'overview', label: 'Overview', tool: 'overview' },
  { id: 'tools', label: 'Tools', tool: 'tools' },
  { id: 'conventions', label: 'Conventions', tool: 'conventions' },
  { id: 'map', label: 'Dependency map', tool: 'map' },
  { id: 'structure', label: 'Structure', tool: 'structure' },
  { id: 'changes', label: 'Changes', tool: 'changes' },
  { id: 'run-analysis', label: 'Run analysis', tool: 'overview' },
  { id: 'findings', label: 'What to improve', tool: 'overview' },
  { id: 'explain-fix', label: 'Explain and plan a fix', tool: 'overview' },
  { id: 'tool-panel', label: 'Tool detail panel', tool: 'tools' },
  { id: 'tools-filter', label: 'Filter and sort tools', tool: 'tools' },
  { id: 'matrix-cell', label: 'Rule cells', tool: 'conventions' },
  { id: 'map-highlight', label: 'Highlight a tool', tool: 'map' },
  { id: 'run-pickers', label: 'Run pickers', tool: 'changes' },
  { id: 'context', label: 'Context', tool: 'context' },
  { id: 'build-briefing', label: 'Build briefing', tool: 'context' },
  { id: 'owner-notes', label: 'Your notes for Claude', tool: 'context' },
  { id: 'claude-md', label: 'CLAUDE.md', tool: 'context' },
];
