// What the Usage & Cost page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/usageTutor.js); node server/services/usageTutor.test.js fails if the two lists drift apart.
// The page has two tabs, so the two "tools" below are its tabs. `tool` on a guide entry says which tab its Open button shows, and the
// page marks each part with data-guide="<id>" so the button can scroll to it.

export const USAGE_TOOLS = [
  { id: 'overview', label: 'Overview', group: 'Overview', icon: 'usage' },
  { id: 'advice', label: 'Advice', group: 'Advice', icon: 'sparkles' },
];

export const GROUPS = ['Overview', 'Advice'];

export const GROUP_TIPS = {
  Overview: 'Where the money and the tokens went: by day, by model and by feature, and every single call.',
  Advice: 'Where a different model, or a different way of calling it, would cost less or work better.',
};

export const TOOL_TIPS = {
  overview: 'The numbers: what you spent, which models and features it went on, and every call.',
  advice: 'Suggestions on which model each feature should use, with an estimate of what you would save.',
};

export const TOOL_BLURBS = {
  overview: 'Cost, tokens, calls, by model and by feature.',
  advice: 'Where to use a cheaper or a stronger model.',
};

// The longer text for the (i) "How Usage & Cost works" box.
export const HOW_IT_WORKS = [
  ['What it shows', 'Every time Vault asks an AI model something (chat, tasks, emails, shares, guides), it records which model and feature, how many tokens went in and out, and works out an estimated cost. This page adds those up for the period you pick.'],
  ['Tokens', 'A token is about three quarters of a word. Models charge for the words you send (input) and the words they write back (output), and output costs more for each token.'],
  ['Pick a period', 'Today, Week, Month, Quarter, Year or All time, or Custom to choose your own dates. Everything on both tabs follows the period.'],
  ['Overview', 'Four headline numbers, a chart by day, the cost split by model and by feature, and the list of every call. Hover a bar in the chart for that day.'],
  ['Advice', 'Suggestions worked out from your own usage: a small job running on a stronger model than it needs (save money), a job you act on running on a light model (check the quality), and ways a feature is called that could be more efficient. It names your own light and standard models from Settings.'],
  ['An estimate, not an invoice', 'Costs come from published prices and the token counts. A model with no price on file is costed with a generic rate and the Advice tab says so. Your real bill from each provider is the final word.'],
  ['Not AI advice', 'The Advice tab uses fixed rules over your usage log, so it costs nothing and gives the same advice for the same numbers. It cannot judge the quality of an answer: where it suggests a cheaper model, try it and compare.'],
];

// Everything the guide can point at: the two tabs plus the controls on them. `tool` is the tab the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'overview', label: 'Overview', tool: 'overview' },
  { id: 'period', label: 'Period', tool: 'overview' },
  { id: 'custom-dates', label: 'Custom dates', tool: 'overview' },
  { id: 'numbers', label: 'Headline numbers', tool: 'overview' },
  { id: 'over-time', label: 'Over time chart', tool: 'overview' },
  { id: 'by-model', label: 'By model', tool: 'overview' },
  { id: 'by-feature', label: 'By feature', tool: 'overview' },
  { id: 'calls', label: 'Calls list', tool: 'overview' },
  { id: 'advice', label: 'Advice', tool: 'advice' },
  { id: 'advice-save', label: 'Save money suggestions', tool: 'advice' },
  { id: 'advice-quality', label: 'Check quality suggestions', tool: 'advice' },
  { id: 'advice-tune', label: 'Tune suggestions', tool: 'advice' },
  { id: 'advice-note', label: 'Good to know notes', tool: 'advice' },
];
