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
    does: 'Type a topic in the box on the Topics tab and press Search. It asks your sources (your RSS feeds, Hacker News, GDELT news, and Reddit, Brave or Google results when those are set up), reads the best pages, groups articles about the same story and ranks the stories. It can take up to half a minute.',
    notes: 'Searching a topic again within a day reuses the saved answers of the paid sources so it does not pay twice.' },
  { id: 'watch', label: 'Watch a topic', group: 'Find',
    does: 'On a saved topic, tick Watch and pick how often it refreshes: every 6, 12, 24 or 48 hours, or weekly. A watched topic searches itself in the background and is listed first with its heat and when it last refreshed.',
    notes: 'When the monthly spending limit has been reached, scheduled refreshes use the free sources only. A topic that fails three refreshes in a row raises one alert in the Suggestions inbox.' },
  { id: 'results', label: 'Ranked stories', group: 'Find',
    does: 'Open a topic to see its stories ranked best first. Each shows how new it is, how widely it is covered, how much people are talking about it and how well it fits your site, with the articles behind it. You can change the ranking weights in Settings and re-rank without searching again.',
    notes: 'Scores are a guide to what to look at, not a verdict on what is true.' },
  { id: 'brief', label: 'Research brief', group: 'Find',
    does: "On a search's results, tick up to 12 articles, optionally type your own angle, and press Write a research brief. You get the angle, the key facts with where each came from, gaps, questions to answer and an outline, as notes for your own article. You can copy it or download it as Markdown.",
    notes: "It is not an article. It is checked so it does not copy the sources, and it is refused if this month's spending limit has been reached. Needs an AI model; see Choose the AI model." },
  { id: 'draft', label: 'Draft article', group: 'Find',
    does: 'On a saved brief, press Draft article, choose a short, medium or long draft and optionally add a note about what to stress. You get a sectioned first draft built from that brief only (not from the articles), with a source number on every factual paragraph and visible "needs your input" markers where the brief had gaps. You can copy it or download it as Markdown, and make another with a different length.',
    notes: 'It is a starting point to edit and fact-check, not a publish-ready article. A claim without a source from the brief is left out and shown as a gap. It warns if it repeats wording from a source or from the brief. Refused when the monthly spending limit has been reached.' },
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
    does: 'Sliders for how much each signal counts (how new, how widely covered, community buzz, search position, fit to your site) and how fast news goes stale. After saving, press re-rank on a search to apply them to it.',
    notes: 'A signal with no data for a story is left out for that story rather than counted as zero.' },
  { id: 'spending', label: 'Spending this month', group: 'Set up',
    does: "Shows this month's estimated spend on searches and briefs against your monthly limit, and lets you change the limit. 0 means no limit. When the limit is reached, paid search sources and new briefs pause, and a banner says so.",
    notes: 'Amounts are estimates. Search prices count as zero until real per-query prices are set on the server, so for now only briefs add to it. The month is the calendar month in UTC.' },
  { id: 'model', label: 'Choose the AI model', group: 'Set up',
    does: "In Vault's main Settings page, the Topic Research tab lets you pick which of your connected AI models writes research briefs and article drafts, or leave it on the workspace default. Briefs and drafts are the only parts of Topic Research that use an AI model.",
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
