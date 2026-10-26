'use strict';

// The Topic Research guide (the round button on Vault's /topic-research page): a person says what they want ("what is trending on solar
// batteries", "keep an eye on a topic", "write a brief") and the guide points at the real controls, in order, or says plainly that Topic
// Research does not do it. It only knows what is written here and it never sees any topic, article or brief. Built on guideCore.js; the ids
// are the page's own, listed in client/src/pages/topicResearch/topicResearchTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/topic-research.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'topics', label: 'Topics', group: 'Find',
    does: 'The first tab. A box at the top to search a topic, and below it your saved topics. Each saved topic shows when it was last searched and can be opened, watched or deleted.',
    notes: 'Deleting a topic puts it in the recycle bin for 30 days, with an Undo.' },
  { id: 'search', label: 'Search a topic', group: 'Find',
    does: 'Type a topic in the box on the Topics tab and press Search. It asks your sources (your RSS feeds, Hacker News, GDELT news, and Reddit, Brave or Google results when those are set up), reads the best pages, groups articles about the same story and ranks the stories. It can take up to half a minute, and shows its steps as it goes.',
    notes: 'Searching a topic again within a day reuses the saved answers of the paid sources so it does not pay twice.' },
  { id: 'watch', label: 'Watch a topic', group: 'Find',
    does: 'On a saved topic, tick Watch and pick how often it refreshes: every 6, 12, 24 or 48 hours, or weekly. A watched topic searches itself in the background and is listed first with its heat and when it last refreshed.',
    notes: 'When the monthly spending limit has been reached, scheduled refreshes use the free sources only. A topic that fails three refreshes in a row raises one alert in the Suggestions inbox.' },
  { id: 'results', label: 'Ranked stories', group: 'Find',
    does: "Open a topic to see its stories ranked best first. Each shows how new it is, how widely it is covered, how much people are talking about it and how much its articles are about your topic, with the articles behind it. A page that looks like a shop (a product or a list of products) is badged Shop page, scored lower and not ticked to begin with. You can change the ranking weights in Settings and re-rank without searching again.",
    notes: 'Scores are a guide to what to look at, not a verdict on what is true. A story that is widely covered but off topic no longer beats an exact one, because topic match is one of the signals.' },
  { id: 'brief', label: 'Research brief', group: 'Find',
    does: "On a search's results, tick up to 12 articles, optionally type your own angle, and press Write a research brief. You get the angle, the key facts with where each came from, gaps, questions to answer and an outline, as notes for your own article. You can copy it or download it as Markdown.",
    notes: "It is not an article. It is checked so it does not copy the sources, and it is refused if this month's spending limit has been reached. Needs an AI model; see Choose the AI model. Before it is written, the Source check looks at the ticked articles." },
  { id: 'check', label: 'Source check before a brief', group: 'Find',
    does: "When you press Generate brief, a quick AI check scores each ticked article from 0 to 3 for how directly it is about your topic. If most are off topic it says what they are mostly about and offers three choices: choose different articles, search again with different words, or write the brief anyway.",
    notes: "A check that cannot run never blocks the brief. It uses the workspace's cheaper model when there is one and counts towards the monthly limit. It judges what each page is about, not whether it is true." },
  { id: 'suggest', label: 'Suggest industry terms', group: 'Find',
    does: "Under the topic box, press Suggest industry terms and the AI model offers up to three other ways to word your topic, the way a manufacturer or trade publication would (for example cooling unit instead of motor). Tick the ones to search as well and press Search: every source is asked each phrasing and the results are merged. The ticked phrases are saved on the topic and used again by Search again and by Watch.",
    notes: "Nothing is searched until you press Search. Each ticked phrase asks Brave and Google again, so it counts towards your monthly limit. If your topic is a question about sizes or amounts, the AI may add a one-sentence note on what the trade actually measures or calls it (for example that cooling is sized by heat load, not motor size); it is labelled AI note (check it), it is only a hint, and it is never searched." },
  { id: 'review', label: 'Structure verdict (second opinion)', group: 'Find',
    does: "At the bottom of a draft, Get a second opinion asks another AI model how it would structure the essay. It is given your research brief and the draft's backbone (each paragraph marked as a sourced fact, a framing line, or a place that needs your input) and the numbered source list by title and site. It is never given any article's text or address. You get a verdict, the thesis it would argue, working titles, a recommended section order (what each section is for, which sources support it, what only you can add), changes to make to the current draft, evidence still missing and risks. Anything the model adds from its own general knowledge, rather than from your brief, is shown apart under From the AI's own knowledge, not your sources, for you to check yourself. Copy it as Markdown. Copy the request for another AI copies the exact request so you can paste it into any other AI yourself (no model is called). Which model gives the verdict is set in Settings, Topic Research, Structure opinion model; left alone it uses the brief model, which is the same opinion twice, so choose a different one.",
    notes: "It is advice for you to weigh, not text to publish, and it can be wrong. Up to five verdicts are kept per draft; they go when the draft is deleted. Each one costs a little and counts towards the monthly limit. The prompt is shown under What the AI was asked and, like the others, is cleared after 30 days." },
  { id: 'links', label: 'For a client or project', group: 'Find',
    does: "Under the search box you can choose a client and/or a project the topic is for (both optional; they are your own Clients and Projects). The topic, its briefs and its drafts then show who they are for, and the topic appears in a Research section on that client's page and that project's page, each item opening Topic Research. Change or remove it later from the topic's results page (Change). A project that belongs to a client also shows that client. On a project's page you can now choose, change or remove its client, and a client's page lists its projects, so the two reference each other.",
    notes: "Deleting a client or project only removes the link; the research stays. Research is private to you, and you can only link your own clients and projects." },
  { id: 'prompts', label: 'What the AI was asked', group: 'Find',
    does: "On a brief, a draft, a source check and the industry-term suggestions, a collapsed panel called What the AI was asked shows the exact prompt that was sent: the model, the rules it was given, the request with the material (other outlets' text is shown as it was sent), and the extra text of a second try if there was one. You can copy the whole prompt. The results page also says which words every source was searched for and which sources were not used this time and why.",
    notes: "A stored prompt contains other outlets' page text, so it is kept for 30 days, like that text, and then cleared; briefs and drafts made before this was added show that it is not kept. The searched-for words and the not-used list are always shown." },
  { id: 'progress', label: 'Progress steps', group: 'Find',
    does: "While a search, brief or draft runs, a box shows named steps with a progress bar: asking sources (how many have answered), saving, reading pages (how many of how many) and ranking; or getting ready, writing and checking. A bar above the topic, brief and draft pages shows where you are: Search, Results, Brief, Draft; each stage that exists is a tab you can click, forwards or back. On a brief or draft that bar stays at the top while you scroll, with the buttons you need next: back to Results, Another angle, Draft article, Copy, and More (Download, Delete). On a brief, each suggested angle has its own Write the outline button (it makes a new brief and keeps this one), the briefs for the search are tabs under the title so you can flip between outlines, and Jump to links reach Facts, Gaps, Angles, Outline and Sources.",
    notes: "The steps are real: each moves when that thing actually happens, not on a timer." },
  { id: 'draft', label: 'Draft article', group: 'Find',
    does: 'On a saved brief, press Draft article, choose a short, medium or long draft and optionally add a note about what to stress. You get a sectioned first draft built from that brief only (not from the articles), with a source number on every factual paragraph and visible "needs your input" markers where the brief had gaps. You can copy it or download it as Markdown, and make another with a different length.',
    notes: 'It is a starting point to edit and fact-check, not a publish-ready article. A claim without a source from the brief is left out and shown as a gap. It warns if it repeats wording from a source. Refused when the monthly spending limit has been reached. If the brief has little to write from (few facts, or many outline sections with no supporting fact) it warns first and asks whether to draft anyway.' },
  { id: 'history', label: 'History', group: 'Look back',
    does: "The History tab lists every past search, brief and draft, newest first. A search box finds them by topic words or by a brief's angle, and All, Searches, Briefs and Drafts filter the list. Open an old search to read its results, or an old brief or draft to read it again.",
    notes: 'It shows the latest 100 of each.' },
  { id: 'settings', label: 'Settings', group: 'Set up',
    does: 'The Settings tab holds your feeds, your site profile, how results are ranked, outlets you trust more or less, and spending this month.',
    notes: "The AI model for briefs is chosen in Vault's main Settings page, under Topic Research." },
  { id: 'feeds', label: 'RSS feeds', group: 'Set up',
    does: 'A list of RSS feed addresses, one per line, that every search reads. Without any, the RSS source is off and the other sources still work.',
    notes: 'Up to 50 feeds.' },
  { id: 'profile', label: 'Your site', group: 'Set up',
    does: 'Say what your site is about, who reads it, your tone and your region. The ranking uses it to judge how well a story fits your site, and the brief uses it to suit your readers.',
    notes: 'Optional, but results fit better when it is filled in.' },
  { id: 'ranking', label: 'How results are ranked', group: 'Set up',
    does: 'Sliders for how much each signal counts (how new, how widely covered, community buzz, search position, outlet weight, topic match) and how fast news goes stale. After saving, press re-rank on a search to apply them to it.',
    notes: 'A signal with no data for a story is left out for that story rather than counted as zero.' },
  { id: 'spending', label: 'Spending this month', group: 'Set up',
    does: "Shows this month's estimated spend on searches and briefs against your monthly limit, and lets you change the limit. 0 means no limit. When the limit is reached, paid search sources and new briefs pause, and a banner says so.",
    notes: 'Amounts are estimates. Search prices count as zero until real per-query prices are set on the server, so for now only briefs add to it. The month is the calendar month in UTC.' },
  { id: 'model', label: 'Choose the AI model', group: 'Set up',
    does: "In Vault's main Settings page, the Topic Research tab lets you pick which of your connected AI models writes research briefs and article drafts, or leave it on the workspace default. Briefs and drafts use that model; the quick source check and the industry-term suggestions use the workspace's cheaper model when it has one. Searching, reading and ranking use no model.",
    notes: 'Models are the ones connected under Settings, AI & Chat. If a chosen model is later removed, the default is used instead.' },
];

const RULES = [
  'Type a topic on the Topics tab and press Search. Open it from the list to see the ranked stories.',
  "A draft is a starting point built from one research brief only. Check every fact against its sources and edit it before you use it. Topic Research never publishes anything and never rewrites another outlet's article.",
  'A brief is notes with where each fact came from. It is checked against the sources so it does not copy them.',
  'Scores rank what to look at first. They do not say what is true.',
  'Paid searches, briefs and drafts pause when the monthly limit is reached; free sources and reading old results carry on.',
  'Page text is kept for 30 days then cleared. Deleted topics can be restored from the recycle bin.',
  'The Open buttons in this chat only switch to a tool; they never search or write anything by themselves.',
];

const NOT_POSSIBLE = [
  "Publishing anything to a website, or rewriting another outlet's article.",
  'A finished, publish-ready article: a draft is a first draft that needs your edits and a fact-check.',
  "Copying or republishing another site's article.",
  'Checking whether a story is true, or fact-checking a claim.',
  'Google Trends charts or exact search volumes.',
  'Searching social networks other than Reddit and Hacker News (no Facebook, X or Instagram).',
  'Sending alerts by email when a watched topic changes (watched topics refresh quietly; a repeated failure shows in the Suggestions inbox).',
  'Reading pages behind a login or a paywall, or pages that ask robots to keep out.',
];

const SYSTEM = `You are the guide to Topic Research in Vault for one person who researches what is trending on a topic so they can write their own article. They say, in everyday words, what they want to do. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Topic Research cannot do.
- You cannot see any topic, article, brief or result they have. Never state or guess what is trending or what a search found.
- Be plain and short, as to a friend who is not technical. Explain any special word (heat, GDELT, RSS) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- A draft is a first draft built from a brief for the writer to edit. Never promise it is publish-ready or fact-checked, never offer to rewrite another outlet's article, and never offer to publish anything.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Topic Research guide', feature: 'topic_research_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'TOPIC RESEARCH TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with a topic, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askTopicResearchTutor: guide.ask,
};
