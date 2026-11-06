'use strict';

// The Usage & Cost guide (the round button on Vault's /usage page): a person says what they want to understand ("where is my money
// going", "which model does this use", "how do I spend less") and the guide points at the real parts of the page, in order, or says
// plainly that the page does not do it. It only knows what is written here and it never sees any spending, call or setting. Built on
// guideCore.js; the ids are the page's own, listed in client/src/pages/usage/usageTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'overview', label: 'Overview', group: 'Overview',
    does: 'The first tab. It shows the headline numbers, a chart by day, the cost split by model and by feature, and the list of every call, all for the period chosen at the top.',
    notes: 'It shows estimates, not an invoice.' },
  { id: 'period', label: 'Period', group: 'Overview',
    does: 'The row of buttons at the top right picks the period: Today, Week, Month, Quarter, Year, Custom or All time. Everything on both tabs, including the Advice, follows it. Week, Month, Quarter and Year start at the beginning of the current one, in Sydney time.',
    notes: 'Today and Week are small samples, so the Advice tab is firmer on Month or Quarter.' },
  { id: 'custom-dates', label: 'Custom dates', group: 'Overview',
    does: 'Choosing Custom shows a From and a To date. Both must be filled in before anything loads. The last day is included.',
    notes: 'Nothing loads until both dates are chosen.' },
  { id: 'numbers', label: 'Headline numbers', group: 'Overview',
    does: 'Four cards: Estimated cost (with the average per call), Total tokens, Input tokens (with how many were written back) and API calls (with how many features and models). Hover a card for what it means.',
    notes: 'Cost is worked out from published prices and token counts. A model with no price on file is costed with a generic rate, so the Advice tab says when that is the case.' },
  { id: 'over-time', label: 'Over time chart', group: 'Overview',
    does: 'A bar for each day (each week for Year, each month for All time), as tall as that day\'s cost. Hover a bar for its date, cost, tokens and calls. The busiest day is named above it.',
    notes: 'It only appears when the period has more than one day of use.' },
  { id: 'by-model', label: 'By model', group: 'Overview',
    does: 'A bar split by model and a list under it: each model\'s cost, calls, tokens and share of the cost, most expensive first. Use it to see which model takes the money.',
    notes: 'It lists up to ten models.' },
  { id: 'by-feature', label: 'By feature', group: 'Overview',
    does: 'The features that spent the most, most expensive first, each with cost, calls and tokens. It shows the top eight; Show all lists every feature. A feature is a part of Vault such as chat, tasks, the email digest or shares.',
    notes: 'It shows what a feature spent, not which model it used: look at the Calls list for that, or the Advice tab.' },
  { id: 'calls', label: 'Calls list', group: 'Overview',
    does: 'Every single call in the period, newest first: the time, the model, the feature, tokens in and out, and the cost. Fifty to a page, with Prev and Next under it.',
    notes: 'It shows no text of what was asked or answered, only the counts.' },
  { id: 'advice', label: 'Advice', group: 'Advice',
    does: 'The second tab. It reads your usage for the period and lists suggestions on which model each feature should use and how it is called, with an estimate of the saving. A number on the tab says how many suggestions there are. It names your own light and standard models from Settings.',
    notes: 'It is worked out by fixed rules, not by an AI, so it costs nothing and gives the same advice for the same numbers. It cannot judge whether an answer was good: try a suggested change and compare.' },
  { id: 'advice-save', label: 'Save money suggestions', group: 'Advice',
    does: 'A Save money card says a small, well-defined job (such as tasks, goals, email tags or a guide chat) ran on a stronger and dearer model than it needs. It names your light model, estimates the cost on it and shows the saving.',
    notes: 'It only appears when your light model in Settings really is a light one. To act on it, change which model that feature uses in Settings.' },
  { id: 'advice-quality', label: 'Check quality suggestions', group: 'Advice',
    does: 'A Check quality card says a job you act on (such as shares observations or contract review) ran on a light model. It shows what your standard model would cost for the same work, as extra cost, so you can decide whether better answers are worth it.',
    notes: 'Only worth acting on if the answers have been shallow or wrong. If they are good, leave it.' },
  { id: 'advice-tune', label: 'Tune suggestions', group: 'Advice',
    does: 'A Tune card points at how a feature is called: one feature running on several models, many tiny calls that could be sent as one, answers far longer than what was sent, or chat prompts that are never reused from the cache.',
    notes: 'These do not always save money; each says what to try.' },
  { id: 'advice-note', label: 'Good to know notes', group: 'Advice',
    does: 'A Good to know card is something worth knowing with nothing to fix: one feature taking more than half the spend, or a model with no price on file so its cost is a generic guess.',
    notes: 'A model with no price on file needs its price added to the cost list before the numbers are exact.' },
];

const RULES = [
  'Pick the period first at the top right; both tabs follow it. The Advice tab is firmer on Month or Quarter than on Today.',
  'Every cost on the page is an estimate from token counts and published prices, not an invoice. The provider\'s own bill is the final word.',
  'The Advice tab uses fixed rules over the usage log, not an AI, and it cannot judge whether an answer was good.',
  'Advice about a cheaper or stronger model names the person\'s own light and standard models from Settings; with none set it skips the model advice.',
  'The page only reads and shows: it never changes a model, a setting or a limit.',
  'It shows only the usage of the person who is signed in.',
  'The Open buttons in this chat only switch to a tool (they show a tab or scroll to a part of the page); they never change anything.',
];

const NOT_POSSIBLE = [
  'Changing which model a feature uses, or any other setting: that is done in Settings, not on this page.',
  'Setting a budget, a limit or an alert when spending passes an amount.',
  'Showing what was asked or answered in a call: only the counts, model and feature are recorded.',
  'Showing the real invoice or balance from a provider: every figure is an estimate.',
  'Exporting the numbers to a file or a spreadsheet.',
  'Costs of things billed per picture, per clip or per search rather than per token, where no tokens are recorded.',
  'Seeing other people\'s usage: it shows only the signed-in person\'s own.',
];

const SYSTEM = `You are the guide to Usage & Cost in Vault for one person who wants to understand what their AI use costs and where to spend less. They say, in everyday words, what they want to know. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see any of their spending, calls or settings. Never state or guess a number, a cost, a model or which feature costs most.
- Be plain and short, as to a friend who is not technical. Explain any AI word (token, input, output, model) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Costs are estimates. If they ask for an exact bill, say the provider's own invoice is the final word.
- Changing a model is done in Settings, not on this page. Say so plainly.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Usage & Cost guide', feature: 'usage_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'USAGE & COST TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to know about your spending, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askUsageTutor: guide.ask,
};
