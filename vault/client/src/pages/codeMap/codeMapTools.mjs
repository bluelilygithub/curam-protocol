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
  { id: 'security', label: 'Security', group: 'Code Map', icon: 'code-map' },
  { id: 'changes', label: 'Changes', group: 'Code Map', icon: 'code-map' },
  { id: 'context', label: 'Context', group: 'Code Map', icon: 'code-map' },
  { id: 'knowledge-graph', label: 'Knowledge graph', group: 'Code Map', icon: 'code-map' },
  { id: 'ai-review', label: 'AI review', group: 'Code Map', icon: 'code-map' },
  { id: 'models', label: 'Models', group: 'Code Map', icon: 'code-map' },
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
  security: 'Pattern checks for common security mistakes: routes missing from the access list, SQL built from request values, secrets in code, shell commands, unsafe paths, raw HTML, sign-in limits, headers and SSRF; plus a live check of the running site (headers, HTTPS, CORS, sign-in), and an AI security review of every route file on request (costs model calls).',
  changes: "What moved between two runs: new and resolved findings, each tool's score, and security checks that got worse or found new lines.",
  context: 'A briefing about how Vault is built, to paste into a new Claude conversation before designing the next tool. No AI call.',
  'knowledge-graph': 'The graph Understand-Anything made of the code: files, functions and classes with plain summaries, layers and a guided tour. Made in Claude Code with /understand and committed; no AI call here.',
  'ai-review': 'Every place the server calls an AI model, and whether plain code would do the job instead. Runs only when you press the button; costs model calls.',
  models: 'Which model each tool uses (default, backup, dedicated), how its calls went in the last 30 days, and what to change, with a short summary. Recommendations only.',
};

export const TOOL_BLURBS = {
  overview: 'Numbers and ranked findings.',
  tools: 'A card per tool.',
  conventions: 'Tools against rules.',
  map: 'How tools link up.',
  structure: 'The code as a whole.',
  security: 'Common security mistakes.',
  changes: 'Drift between two runs.',
  context: 'A briefing for Claude.',
  'knowledge-graph': 'Understand-Anything graph and tour.',
  'ai-review': 'Model calls plain code could do.',
  models: 'Each tool\'s models and how they are doing.',
};

// The longer text for the (i) "How Code Map works" box.
export const HOW_IT_WORKS = [
  ['What it is', "Code Map reads Vault's own source on the server (no git and no network; the analysis itself uses no AI) and works out which code belongs to which tool, then checks each tool against the rules in CLAUDE.md."],
  ['Running it', 'Run analysis reads the code as deployed now. It takes a few seconds and the last 30 runs are kept. A run also happens by itself every Sunday at 3:17 am (Brisbane), followed by the live site check on the Security tab. High findings are sent to your Suggestions inbox, once per tool, so a repeat run does not add them again.'],
  ['Reading a check', "Green follows the rule, amber is worth a look, red is a gap, grey means the rule does not apply. A tool's score is the share of the rules that apply to it that it follows."],
  ['How sure it is', 'The checks match patterns in the code, so they can be wrong both ways. Read the evidence (file and line) before changing anything. Known false positives are listed in docs/code-map.md.'],
  ['Who owns what', 'A file reached by three or more tools counts as shared and belongs to none of them; the rest belongs to the tools that reach it.'],
  ['Explain and plan a fix', 'On a finding, Explain and plan a fix asks the AI model set in Settings to explain that finding and plan a fix, using only its evidence and the lines around it. It costs a model call, shows the files it read, and says "I could not tell" rather than guess.'],
  ['Security', 'Eleven pattern checks for common security mistakes run with every analysis, free: every route in the access list (routeManifest.json), public routes to review, request values pasted into SQL, routes by id with no per-user check, secrets in the code (values are never shown or stored), eval or shell commands from strings, file paths from request values, raw HTML, sign-in rate limits, security headers and CORS, and SSRF. High gaps go to your Suggestions inbox. A pattern check is a pointer to read, not proof. Check the live site (same tab) tests the running site instead of the code: security headers, HTTPS and its certificate, CORS, that protected routes refuse anyone not signed in, and that errors show no code details. It runs when you press it and every Sunday after the weekly analysis, makes about 15 harmless requests to this app\'s own address and costs nothing. Run AI security review (also on that tab) has the standard model read every route file for problems patterns cannot judge, such as one user reaching another\'s data. It costs model calls (it shows how many first), only runs when pressed, and reuses findings for unchanged files. High findings it is sure of go to your Suggestions inbox. They are advice to check, not proof.'],
  ['AI review', 'Run review asks the standard model in Settings to look at every place the server calls an AI model and say whether plain code (regex, parsing, lookups, rules) would do it as well: replace, hybrid, keep or unclear. It runs only when you press the button, never on a schedule. Files unchanged since the last review keep their verdicts at no cost. High-confidence "replace" verdicts go to the Suggestions inbox.'],
  ['Knowledge graph', 'Shows the graph Understand-Anything (a Claude Code plugin) made of the code, with a summary of every file, function and class, the layers and a guided tour. Vault does not make it: run /understand in Claude Code in the vault folder (it uses model calls on your Claude plan) and commit the .ua folder. It shows the code as it was when the graph was made.'],
  ['Models', 'Run check lists every tool that calls an AI model: its default model (the workspace standard or light model), any backup and any model set for it in Settings, what the tool needs (pictures, JSON replies, a long context), and its last 30 days: calls, cost, how long calls take, how many failed and how often the backup answered. Then it flags problems: a model that cannot do what the tool needs, a model id written in the code, a model that is gone from the list or whose key is missing, a failing primary, a high error rate, a newer model of the same family at the same or lower price, and background jobs that could trial the light model. Tools with fewer than 20 calls get no error or cost findings yet. It only recommends: change a model in Settings yourself (each row links there). The check itself is plain code. Pressing Run check also makes one call to the light AI model for the short summary at the top; every number in it is checked against the report, and anything that fails the check is replaced by the wording the app writes itself, so the summary never shows a made-up figure. It also runs every Sunday after the analysis (with the wording the app writes itself, no AI call), and high and medium findings go to your Suggestions inbox once each.'],
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
  { id: 'docs-picker', label: 'Docs to include', tool: 'context' },
  { id: 'security', label: 'Security', tool: 'security' },
  { id: 'security-checks', label: 'Security checks', tool: 'security' },
  { id: 'live-check', label: 'Live site checks', tool: 'security' },
  { id: 'ai-security-review', label: 'AI security review', tool: 'security' },
  { id: 'knowledge-graph', label: 'Knowledge graph', tool: 'knowledge-graph' },
  { id: 'ai-review', label: 'AI review', tool: 'ai-review' },
  { id: 'run-ai-review', label: 'Run review', tool: 'ai-review' },
  { id: 'models', label: 'Models', tool: 'models' },
  { id: 'run-models-check', label: 'Run check (Models)', tool: 'models' },
  { id: 'run-model-test', label: 'Run test (Models test set)', tool: 'models' },
];
