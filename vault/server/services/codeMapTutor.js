'use strict';

// The Code Map guide (the round button on the admin /code-map page): the admin says what they want to know ("what does amber mean", "why
// is Mood red on Logger", "what changed since last week") and the guide points at the real tabs and controls, in order, and explains what
// each rule means. It only knows what is written here: it sees no code, no run, no finding and no score. Built on guideCore.js; the ids are
// the page's own, listed in client/src/pages/codeMap/codeMapTools.mjs (a test keeps the two in step). See docs/guide-chat.md and
// docs/code-map.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const G = 'Code Map';

const CATALOG = [
  { id: 'overview', label: 'Overview', group: G,
    does: 'The first tab: six numbers (tools, lines of app code, test files, API mounts, import cycles, rule gaps) and What to improve, the ranked findings.',
    notes: 'Findings are ranked high first, then by how many tools they touch.' },
  { id: 'tools', label: 'Tools', group: G,
    does: 'One card per tool in the menu: its group, a preview/parked/off pill, a score bar, lines of code, test files and one dot per rule. Filter by menu group, search by name (or speak), and sort by score, size or name. Click a card for the tool detail panel.',
    notes: 'The score is the share of the rules that apply to the tool that it follows.' },
  { id: 'conventions', label: 'Conventions', group: G,
    does: 'A table with the tools down the side and the 14 rules across the top. Hover a rule name for why it matters; click a cell to see what was found, the usual fix and the evidence underneath.',
    notes: 'Tools are listed lowest score first. The header and first column stay in place while scrolling.' },
  { id: 'map', label: 'Dependency map', group: G,
    does: "A picture of the tools: each circle is a tool (bigger means more code, the colour is its score: green 90 and over, amber 70 and over, red below 70). A solid line means one tool calls the other's API; a dashed line means they share code files. Click a tool to highlight its links, click it again to open its detail. Drag to move, scroll to zoom.",
    notes: 'Hide tools with no links leaves out the ones that stand alone.' },
  { id: 'structure', label: 'Structure', group: G,
    does: 'The code as a whole: Largest files, Import cycles (files that import each other in a loop), Shared foundations (modules most tools depend on), Separate packages (sub-apps beside client and server), and Possibly unused files and backup copies.',
    notes: 'Hotspots (big files that change often) stay empty: they need git history, which the deployed server does not have. Check a possibly unused file before deleting it: it can be loaded by a path built at runtime.' },
  { id: 'changes', label: 'Changes', group: G,
    does: "Compares two finished runs (the latest and the one before unless picked otherwise): how many findings are new, resolved, got worse or got better; the change in the summary numbers; scores that dropped (biggest first); new findings (high first); findings that moved from amber to red or back; tools added or removed; import cycles gained or lost. At the bottom, Security: the Security tab\'s code checks whose status got worse or better, and the lines they found that are new or no longer found (moved lines do not count). The summary line also shows how many security checks got worse and how many new lines there are.",
    notes: 'It needs two finished runs. A change to a rule itself, or a renamed tool, shows up as drift too. Security is only compared when both runs were made after the Security tab existed, and a check with more than 50 lines is compared partly (it says so). The live site check and the AI security review are not part of a run, so they are not compared here.' },
  { id: 'run-analysis', label: 'Run analysis', group: G,
    does: 'The button at the top right. It reads the code as deployed now, in a few seconds, showing each step, and the page stays usable. The line beside the title says when the last run was, how long it took and which commit it saw.',
    notes: 'One run at a time for the whole workspace. The last 30 runs are kept. A run also happens by itself every Sunday at 3:17 am Brisbane time, followed by the live site check. High findings from a run go to the Suggestions inbox, once per rule and tool.' },
  { id: 'findings', label: 'What to improve', group: G,
    does: 'The ranked list on the Overview. Each finding has a severity (high, medium, low), says why it matters and the usual fix, names the tools it affects as buttons that open each tool, and has the evidence (file and line) behind a small Evidence link.',
    notes: 'One finding per rule that has amber or red tools, plus three about structure: a cron job that requires a route file, an import cycle across tools, and leftover backups or possibly unused files.' },
  { id: 'explain-fix', label: 'Explain and plan a fix', group: G,
    does: "A button on each finding (pick the tool first when it names several). It asks the AI model chosen in Settings to explain that finding in that tool and give a step-by-step fix plan, citing file and line. The answer shows under the finding with the files it read.",
    notes: 'It uses only the finding, its evidence and up to 200 lines around each evidence line, from server/ and client/src/ only, and says "I could not tell" rather than guess. It costs one model call each time and counts towards the AI rate limit. It does not change any code.' },
  { id: 'tool-panel', label: 'Tool detail panel', group: G,
    does: "Opens on the right when a tool is clicked anywhere on the page: every rule with its note, the usual fix and the evidence, the APIs the tool owns (with its line in server/index.js, and whether it has the AI rate limit, comes before sign-in or is admin only), linked tools, its biggest files, and the files it owns. Close it with the cross or Escape.",
    notes: 'Files reached by three or more tools are shared and are not listed as owned.' },
  { id: 'tools-filter', label: 'Filter and sort tools', group: G,
    does: 'On the Tools tab: a filter box (name, id, feature flag or page path; it has a microphone), a sort list (rules score lowest first, size largest first, or name) and a row of menu group buttons.',
    notes: '' },
  { id: 'matrix-cell', label: 'Rule cells', group: G,
    does: 'On the Conventions tab: each coloured square is one rule for one tool. Clicking it shows the note, the usual fix and the evidence in the box under the table, with a button to open the tool.',
    notes: '' },
  { id: 'map-highlight', label: 'Highlight a tool', group: G,
    does: "On the Dependency map: a list to pick a tool and highlight its links (the same as clicking it on the map, for the keyboard), an Open button for the highlighted tool, and Hide tools with no links.",
    notes: '' },
  { id: 'run-pickers', label: 'Run pickers', group: G,
    does: 'On the Changes tab: From and to lists of the finished runs (number, date and time, commit) and a Swap button.',
    notes: 'Pick two different runs.' },
  { id: 'context', label: 'Context', group: G,
    does: 'A briefing about how Vault is built, for starting a conversation in the Claude app that knows nothing about Vault (for example to design the next tool). It is built from the latest run, the feature flags and navigation, the last 30 days of the changelog and its open concerns, a Ponytail summary, which outside services are set up (YES or NO only), the installed packages, and three short curated files (about Vault, the rules every tool follows, the shared building blocks). The page shows it as a report and as Markdown for Claude.',
    notes: 'It describes how Vault is built, never what is in it: no client names, amounts, notes, emails, task titles or secret values. It makes no AI call. It needs a finished analysis run first.' },
  { id: 'security', label: 'Security', group: G,
    does: 'Eleven pattern checks for common security mistakes, made with every analysis run: four tiles (gaps, to check, lists for review, pass), then one card per check, gaps first. Each card says what was found, why it matters, the fix, the tools involved (as buttons) and the lines found. Copy security copies it all as Markdown. The checks: every route is in the access list (server/testing/routeManifest.json), public routes (no sign-in) to review, request values pasted into SQL, routes that take an id but never mention the user, secrets written in the code, eval or shell commands built from strings, file paths built from request values without a pattern check, raw HTML put into the page without a sanitizer, sign-in routes without a rate limit, security headers (helmet) and open CORS, and fetching typed web addresses without the SSRF guard.',
    notes: 'No AI and no cost. Pattern checks point at code to read: a gap is not proof of a hole and a pass is not proof there is none. Secret values are cut short and never shown or stored. High gaps go to the Suggestions inbox once per check. A run made before the tab existed shows no checks until the analysis runs again.' },
  { id: 'security-checks', label: 'Security checks', group: G,
    does: 'The cards on the Security tab. Gap (red) means the pattern was found, check (amber) means confirm each line (often shared data or validated elsewhere), for review (blue) is a list to keep an eye on such as the public routes, passes (green) means nothing was found, not applicable (grey) means it does not apply here. Details opens the file and line list (or, for live checks, what the site answered); gaps open it by themselves.',
    notes: 'The checks do not follow a value copied into a variable first, routers built by a factory, or code outside server/ and client/src/.' },
  { id: 'live-check', label: 'Live site checks', group: G,
    does: 'The Live site part of the Security tab, under the code checks. Check the live site tests the running site rather than the code, in a few seconds: the site answers; HTTP goes to HTTPS; the certificate is not about to expire; the security headers (HSTS, Content Security Policy, nosniff, framing, Referrer-Policy, no X-Powered-By); another website cannot call the API from a browser (CORS); ten protected routes refuse a request with no sign-in and with a made-up token; the public routes answer without errors; and a broken request gets no stack trace. The line under the heading says when it last ran, the address checked and how long it took. Copy live checks copies the results.',
    notes: 'It runs when pressed and also every Sunday at 3:17 am Brisbane straight after the weekly analysis (skipped when APP_URL is not set or is a local address). It uses this app\'s own address (APP_URL), sends only GET requests to routes without an id plus one broken request to a path that does not exist, changes nothing and costs nothing. On a local http address the HTTPS, certificate, HSTS and policy checks are not applicable (the policy is only sent in production). The last 10 are kept; failing high checks go to the Suggestions inbox. It cannot check that an admin route refuses a signed-in non-admin: that is crossUser.test.js.' },
  { id: 'ai-security-review', label: 'AI security review', group: G,
    does: 'The last part of the Security tab. Run AI security review asks the standard model in Settings to read every route file (in parts of 500 lines, told how each file is mounted: public or behind the sign-in, admin only, feature flag) and report concrete problems: access (one user reaching another\'s data, a missing admin check, a public route without its own check), injection, SSRF, uploads, XSS, secrets and validation. It first says about how many model calls and how much code, and asks Yes or No; while it runs it shows File x of y. Findings are listed by severity (High, Medium, Low buttons, surest first), each with its category, confidence, file and line, what an attacker could do and the fix. Copy findings and Download CSV export them. The line under the heading says when it last ran, the model, files, model calls, tokens and approximate cost.',
    notes: 'It costs model calls (the first run reads all 173 route files, about 230 calls); later runs only read files that changed. It never runs on a schedule. Only one AI review runs at a time (this one or the AI review tab\'s). Findings are a model\'s reading of the code: low confidence often means the check may be in a helper file it could not see. High findings with high confidence go to the Suggestions inbox. It reads route files only, not the services they call. Usage shows it as code_map_ai_security.' },
  { id: 'knowledge-graph', label: 'Knowledge graph', group: G,
    does: 'The graph Understand-Anything (a Claude Code plugin) made of the code: every file, function and class as a dot coloured by kind, with the links between them. A Layer list shows one layer, Find lights up names and file paths, the kind checkboxes hide or show groups (functions and classes start hidden). Click a dot for its file and lines, its summary, tags and links; the panel otherwise shows the guided tour, where picking a step lights up its code.',
    notes: 'Vault does not make the graph. The owner runs /understand in Claude Code in the vault folder, which uses model calls on their Claude plan, and commits the .ua folder; the tab reads it after the deploy and is empty until then. It shows the code as it was when the graph was made, not as it is now. The summaries were written by an AI model, so check them against the code.' },
  { id: 'ai-review', label: 'AI review', group: G,
    does: 'Every place the server calls an AI model, each with a verdict: Replace (plain code such as a regex, a parser, a lookup or fixed rules would do it as well or better), Hybrid (plain code for the common cases, the model for the rest), Keep (the task needs the model) or Unclear (the review could not tell from the code it saw). Buttons at the top filter by verdict; each item shows the file and line, what the call does, why, and what to do instead, with its tool as a link. Copy review and Download CSV export every verdict. The line under the heading says when it last ran, which model, how many call sites and model calls, tokens and the approximate cost.',
    notes: 'The verdicts come from an AI model reading the code around each call, so they are advice to check, not facts. Call sites are found by text search, so a call made some other way is missed. A prompt built in another file often comes back Unclear.' },
  { id: 'run-ai-review', label: 'Run review', group: G,
    does: 'The button on the AI review tab. It first says about how many model calls the run will make and asks Yes or No. While it runs it shows File x of y and the rest of the page stays usable.',
    notes: 'It never runs on a schedule, only from this button. Files unchanged since the last review keep their verdicts and cost nothing, so a repeat run is cheap. It uses the standard model in Settings, counts towards the AI rate limit and shows in Usage as code_map_ai_review. One review at a time; the last 10 are kept. High-confidence Replace verdicts go to the Suggestions inbox once per call site.' },
  { id: 'build-briefing', label: 'Build briefing', group: G,
    does: 'On the Context tab: builds a new briefing from the latest run and keeps it (the last 10 are listed under Earlier briefings, each with Copy). Copy for Claude puts the Markdown on the clipboard; Download .md saves it. The size in characters and an estimate in tokens are shown next to Copy.',
    notes: 'Paste it as the first message of a new Claude conversation, or add the .md file to a Claude Project as knowledge. A briefing over about 60,000 characters is shortened and says so at the top.' },
  { id: 'owner-notes', label: 'Your notes for Claude', group: G,
    does: 'On the Context tab: a box for your priorities, plans, things you have decided against and what you are unsure about. Save notes keeps them for your account; they go into the next briefing you build.',
    notes: 'Only what you type here goes in; nothing is added from your other tools.' },
  { id: 'claude-md', label: 'CLAUDE.md', group: G,
    does: 'At the bottom of the Context tab: CLAUDE.md (the rules Claude Code follows in this project) shown read-only. It is always in the copy. The copy button puts CLAUDE.md and the ticked docs in one block, each under its own heading, and ends with a list of the docs left out (path, size and one sentence each) so Claude can ask for them.',
    notes: 'A warning shows when CLAUDE.md has changed since the rules summary was written; the summary file then needs refreshing (see docs/code-map.md).' },
  { id: 'docs-picker', label: 'Docs to include', group: G,
    does: 'Above CLAUDE.md on the Context tab: the docs to copy with it. "Always included (you can untick)" holds the default set: client/DESIGN.md, docs/hardening.md and docs/guide-chat.md. "Optional" holds the docs CLAUDE.md links to and a few outside docs/ (ROADMAP.md, BACKUP.md, the planner READMEs), and Other docs opens the rest. Each shows its size in characters and about how many tokens. Your ticks are saved for your account; Reset to defaults goes back to the default set. The copy size is shown next to the copy button.',
    notes: 'The same choice sets the "Docs not included in this copy" list at the end of the briefing. docs/video-tools.md is optional and large (about 20,000 tokens, mostly ffmpeg detail): tick it only for a media-heavy tool or one with background jobs. docs/finance.md holds real business figures.' },
];

const RULES = [
  'Code Map reads the code as it is deployed, on the server. It makes no AI call except Explain and plan a fix, the AI review and the AI security review (each only when its button is pressed), and never changes code.',
  'Colours: green follows the rule, amber is worth a look (not necessarily wrong), red is a gap, grey means the rule does not apply to that tool.',
  'The checks are pattern matches in the code, so they can be wrong both ways: always read the evidence before changing anything. docs/code-map.md lists the known false positives.',
  'A file reached by three or more tools is shared and belongs to none of them; a problem in a shared file is not charged to any tool.',
  'The 14 rules: Feature flag parity (the tool\'s flag is in both featureAccess.js lists with the same default). Lifecycle entry (a flag that ships off has a preview or parked entry on both sides). AI rate limit (routes that call a model have aiLimiter). No hardcoded model ids (models come from Settings). Model resolver (code that calls a model picks it through getModelsForUser). apiClient (no raw fetch to /api from the page). SSRF guard (a web address typed by a person is fetched only through safeFetch or htmlFetch). Tests (at least one test file covers the tool, two if it is over 3,000 lines). Guide chat (the tool has a guide). Docs (docs/<tool>.md exists). Recycle bin (its deletes go to the recycle bin). getIcon (icons through getIcon). Shared Dialog (no hand-written full-screen overlay). Logger (five or fewer console calls in its server code).',
  'Severity: high means fix soon (also raised in the Suggestions inbox), medium means fix when next working on the tool, low is housekeeping.',
  'The Open buttons in this chat only switch to a tool (they show a tab or scroll to a part of it); they never run an analysis, explain a finding or change anything.',
];

const NOT_POSSIBLE = [
  'Fixing the code: Code Map only reports. Explain and plan a fix writes a plan; a person makes the change.',
  'Seeing code, runs, findings or scores in this chat: the guide cannot see any of them. Open the tab or the tool panel instead.',
  'Hotspots and change history: git history is not on the server, so files that change often are not shown.',
  'Checking the separate packages (cellar planner, shelf and the other sub-apps): they are listed but not checked against the rules.',
  'Switching a rule off, or marking one finding as a false positive so it stops showing: a rule is changed in server/services/codeMap/rules.js.',
  'Keeping more than the last 30 runs, or running two analyses at once.',
  'Choosing the model Explain and plan a fix uses on this page: it uses the standard model set in Settings.',
];

const SYSTEM = `You are the guide to Code Map in Vault, an admin page that reads Vault's own source code and checks each tool against the project's rules. The admin says, in everyday words, what they want to know or do. You point them to the right tabs and controls, in order, explain what each part and each rule means, and how to read a check.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see any code, run, finding, score or tool result. Never state or guess why a particular tool fails a rule, what a finding says, or what a score is: send them to the place on the page that shows it, or to Explain and plan a fix.
- Be plain and short. The admin knows the app but explain any check in a sentence.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- The checks are pattern matches and can be wrong: when someone asks whether to trust a result, say to read the evidence first.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Code Map guide', feature: 'code_map_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'CODE MAP TABS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to know about Code Map, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askCodeMapTutor: guide.ask,
};
