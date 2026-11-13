'use strict';

// The AI Visibility guide (the round button on Vault's /ai-visibility page): a person says what they want to do or
// understand ("why is my score low", "what does robots.txt have to do with AI", "what should I fix first") and the
// guide points at the real parts of the page, in order, or says plainly that AI Visibility does not do it. It only
// knows what is written here and it never sees any address, score or report. Built on guideCore.js; the ids are the
// page's own, listed in client/src/pages/aiVisibility/aiVisibilityTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/ai-visibility.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'new-audit', label: 'New audit', group: 'Run an audit',
    does: 'The New audit button at the top of the left column opens the start screen: a Page URL box (required), an optional Name and Brand, tick boxes for the AI assistants to ask, a Model drop-down, a Buyer questions box and a Key facts box, then the Run audit button.',
    notes: 'The page must be public: anyone must be able to open it without logging in. One page per audit, not the whole site.' },
  { id: 'saved-audits', label: 'Saved audits', group: 'Run an audit',
    does: 'The left column lists every saved audit with its score, date and website. Search audits filters by name, address or host; Sort orders by newest, oldest, name or score; clicking a run opens its report; the bin icon deletes it after a Yes.',
    notes: 'Audits are kept until deleted. The chosen sort is remembered in this browser.' },
  { id: 'run-audit', label: 'Run audit', group: 'Run an audit',
    does: 'The Run audit button starts the whole audit in the background: it fetches the page as a crawler would, reads robots.txt, renders the page in a real browser, checks its structured data, then runs one live search for each buyer question and puts the question to each ticked AI assistant. It takes one to four minutes; the page shows each step and opens the report when it is ready.',
    notes: 'You can leave the page while it runs. Each question uses one search plus one paid call per ticked assistant. If a run fails, the reason is shown with a Run again button. Nothing is changed on the website.' },
  { id: 'assistants', label: 'AI assistants to ask', group: 'Run an audit',
    does: 'Tick boxes on the start screen for the real AI assistants each question is put to: Claude with web search, Gemini with Google Search, and Perplexity. Each one searches the web itself, the way it would for a customer. An assistant that is not connected is greyed out with the reason.',
    notes: 'Claude and Gemini use the first matching model in Settings → Models; Perplexity needs a PERPLEXITY_API_KEY. Answers vary between runs, accounts and locations, so treat them as a sample.' },
  { id: 'model', label: 'Model', group: 'Run an audit',
    does: 'The Model drop-down on the start screen chooses the connected text model that writes buyer questions from the page when the Buyer questions box is left blank. Left on Workspace default, it uses the default model set in Settings. It does not choose the assistants; the tick boxes do that.',
    notes: 'If no connected text model is found, the technical checks still run and the questions are made from simple templates, so write your own.' },
  { id: 'buyer-questions', label: 'Buyer questions', group: 'Run an audit',
    does: 'A box on the start screen for the questions a real buyer might ask an AI assistant, one per line, up to six. Leave it blank and Vault generates four from the page title, description and headings.',
    notes: 'Use everyday questions ("best temperature-controlled wine fridge for a home cellar"), not keywords.' },
  { id: 'facts-input', label: 'Key facts to check', group: 'Run an audit',
    does: 'A box on the start screen for the facts an answer should state accurately, one per line, up to twelve, such as a temperature range, a plug rating or a lead time.',
    notes: 'Include the units: numbers are matched with their units. The check is a word-and-number match, not an understanding of meaning.' },
  { id: 'scores', label: 'Scores', group: 'Results',
    does: 'A saved audit opens with the overall score in a box at the top right, then six area cards: Technical access, No-JS readability, Structured data, Search ranking, Named by AI assistants and Key-fact accuracy. 80 or more is green, 55 to 79 amber, under 55 red. A line under the cards says which areas were measured.',
    notes: 'The overall score is weighted across the areas that could be measured; an area that could not be measured is left out rather than scored zero.' },
  { id: 'score-areas', label: 'Score areas', group: 'Results',
    does: 'Technical access covers HTTP status, indexability, title, description, language and robots.txt blocks. No-JS readability covers how much of the page a crawler sees without JavaScript. Structured data covers JSON-LD entities and the properties answer engines need. Search ranking covers where the site ranks in a live web search for each question. Named by AI assistants covers whether real assistants named the business and used the site as a source. Key-fact accuracy covers whether the assistants\' answers state the facts you supplied.',
    notes: 'Hover an area card for a one-line reminder of what it measures.' },
  { id: 'suggestions', label: 'Suggestions', group: 'Results',
    does: 'A list near the top of a saved report of what to fix, ordered Fix, then Improve, then Consider. Each suggestion names its area, says what was found and gives a What to do line.',
    notes: 'This is the answer to "what should I fix first": work down the list from the top. It only appears when there is something to suggest.' },
  { id: 'technical', label: 'Technical access', group: 'Results',
    does: 'A card in a saved report with the HTTP status, final URL, title, meta description, robots meta, language, canonical address and whether robots.txt was found. Under it is a table of AI crawlers with Allowed or Blocked, the exact rule that decides each one, and what that crawler does.',
    notes: 'Google-Extended controls Gemini/Vertex training, not Google Search. Blocking GPTBot does not remove a page from Google search results. Sitemaps listed in robots.txt are shown at the bottom.' },
  { id: 'robots', label: 'robots.txt and AI crawlers', group: 'Results',
    does: 'The crawler table in Technical access checks GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and the rest one by one. Each row shows the verdict, the deciding rule and a plain description of what that crawler is for.',
    notes: 'If robots.txt is missing, the table says so and the crawlers are treated as allowed. A rule can allow one crawler and block another.' },
  { id: 'readability', label: 'Readability without JavaScript', group: 'Results',
    does: 'A card in a saved report comparing three numbers: the words in the raw HTML a crawler receives, the words after a real browser has run the JavaScript, and the percentage readable without JavaScript. A sentence says whether the offer is visible without scripts.',
    notes: 'If the browser render fails, the card says so and still shows the raw HTML counts. AI crawlers often do not run JavaScript, so the raw figure is the one that matters most.' },
  { id: 'schema', label: 'Structured data', group: 'Results',
    does: 'A card in a saved report listing the JSON-LD blocks found and their types, any parse errors, a table of entities with missing required and useful properties, and plain findings with what to do.',
    notes: 'Entities include Organization, LocalBusiness, Product, FAQPage and Article. Required properties are the ones an answer engine needs; useful ones make the entity richer.' },
  { id: 'questions', label: 'Buyer questions and AI assistants', group: 'Results',
    does: 'A card in a saved report listing each buyer question with whether it was supplied, generated from the page or made from a template; the search ranking (at what position the site appeared in the top 10, or not at all); then one box per AI assistant with its verdicts, and an expandable answer with the sources it used.',
    notes: 'A failed search or an assistant that could not answer is shown against that question and left out of the score, instead of stopping the audit or counting as zero. Audits run before November 2026 show the earlier simulated version.' },
  { id: 'citation', label: 'Assistant checks', group: 'Results',
    does: 'In each assistant box, two badges say whether that assistant named the business (the brand, a short form or the web address) and whether a page on the site was among the sources it used.',
    notes: 'Search ranking, being named and being used as a source are deliberately separate: an assistant can name a business without citing it, and can cite a site that ranks low.' },
  { id: 'facts', label: 'Key facts across answers', group: 'Results',
    does: 'A table at the bottom of a saved report with one row per supplied fact: whether it was present and how many assistant answers contained it. In each assistant box, the same facts are marked Present or Missing.',
    notes: 'Matching numbers with their units and distinctive words is a heuristic, not proof. Re-read the answer rather than treating a tick as certainty. The card only appears when facts were supplied.' },
  { id: 'copy', label: 'Copy for AI', group: 'Share',
    does: 'The Copy for AI button at the top of a saved report copies the whole report as Markdown text to the clipboard, ready to paste into an AI assistant or a document.',
    notes: 'It copies text only; nothing is sent from Vault.' },
  { id: 'pdf', label: 'Download PDF', group: 'Share',
    does: 'The Download PDF button at the top of a saved report makes a formatted PDF of the whole report and downloads it.',
    notes: 'It is downloaded, not emailed, and there is no live link to share: attach the PDF to an email yourself.' },
];

const RULES = [
  'Run an audit first (New audit), then open it from the left column; the report belongs to a saved audit.',
  'Audit one public page at a time: pages behind a login or on a private network cannot be read.',
  'Leave Buyer questions blank to generate four from the page; supply up to six of your own.',
  'Key facts should include units, because numbers are matched with them; the match is a heuristic, not proof.',
  'For "what should I fix" questions, Suggestions is the answer, starting at the top with Fix; the score cards and evidence cards explain why.',
  'Scores are a snapshot of the audit and areas that could not be measured are left out, not scored zero. Run the audit again after changes.',
  'The Open buttons in this chat only switch to a tool (they open a screen or scroll to a part of the page); they never run an audit or change anything.',
];

const NOT_POSSIBLE = [
  'Changing the website itself: AI Visibility only audits and reports; changes are made on the site by whoever maintains it.',
  'Auditing pages behind a login or on a private network.',
  'Auditing a whole site at once: it checks one address per audit.',
  'Making AI assistants recommend or rank a business: it asks them and measures the answers, it cannot control them.',
  'Running audits on a schedule or sending an alert when visibility changes.',
  'Emailing the PDF report from Vault or sharing a live link to an audit: download the PDF and attach it yourself.',
  'Seeing a page\'s live state between audits: the report is a snapshot from the run.',
  'Keyword search volumes or Google rankings: use the SEO tool or SERP Tracker for those.',
  'Proving that a fact is true: the key-fact check only asks whether the words and numbers appear in the answers.',
];

const SYSTEM = `You are the guide to AI Visibility in Vault for one person who wants to know whether AI assistants can reach, read and quote a public web page, and what to improve. They say, in everyday words, what they want to do or understand. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say AI Visibility cannot do.
- You cannot see any address, score, report or answer. Never state or guess a score, a cause, a crawler verdict or what their page needs fixing; send them to the part of the page that shows it.
- Be plain and short, as to a friend who is not technical. Explain any web word (robots.txt, crawler, JavaScript, JSON-LD, structured data, canonical) in a few everyday words the first time you use it. General explanations of what a check or a kind of fix means are fine.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask what to fix, send them to Suggestions and start at the top. If they want the website changed, say AI Visibility only audits and reports and the change is made on the site.
- An audit is a snapshot and cannot control what an AI assistant says; say so if they ask about guarantees or monitoring.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'AI Visibility guide', feature: 'ai_visibility_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'AI VISIBILITY TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do in AI Visibility, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askAiVisibilityTutor: guide.ask,
};
