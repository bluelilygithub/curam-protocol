// What the Topic Research page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/topicResearchTutor.js); npm run test:topic-research-tutor fails if the two lists drift apart.
// The page has three tabs; `tool` on a guide entry says which tab its Open button switches to.

export const TOPIC_TOOLS = [
  { id: 'topics', label: 'Topics', group: 'Find', icon: 'search' },
  { id: 'history', label: 'History', group: 'Look back', icon: 'clock' },
  { id: 'settings', label: 'Settings', group: 'Set up', icon: 'settings' },
];

export const GROUPS = ['Find', 'Look back', 'Set up'];

export const GROUP_TIPS = {
  Find: 'Search a topic, see what is trending, keep an eye on it and write a research brief for your own article.',
  'Look back': 'Every past search and brief, newest first, with a search box.',
  'Set up': 'Your feeds, what your site is about, how results are ranked and your monthly spending limit.',
};

export const TOOL_TIPS = {
  topics: 'Type a topic to search it. Your saved topics are listed below; tick Watch to have one refresh by itself.',
  history: 'Every past search, brief and draft you have made. Open an old one to read it again.',
  settings: "Your RSS feeds, your site profile, how results are ranked, outlets you trust and this month's spending.",
};

export const TOOL_BLURBS = {
  topics: 'Search a topic and keep the ones you follow.',
  history: 'Past searches and briefs.',
  settings: 'Feeds, site profile, ranking and spending.',
};

// The longer text for the (i) "How Topic Research works" box.
export const HOW_IT_WORKS = [
  ['What it is for', 'Topic Research finds what is being talked about on a topic right now: news, feeds, forums, search results. It groups articles that tell the same story, ranks the stories, and can write you a research brief. You can then turn a brief into a first draft to edit. It never publishes anything.'],
  ['Search a topic', 'Type a topic on the Topics tab and press Search. It asks your sources, reads the best pages and ranks the stories by how new, how widely covered, how much people are talking and how well they fit your site.'],
  ['Watch a topic', 'Tick Watch on a saved topic and choose how often it refreshes (every 6 hours up to weekly). It searches by itself in the background, so the latest is waiting when you open it.'],
  ['Research brief', 'Pick up to 12 articles from a search and ask for a brief: the angle, the key facts with where each came from, what is missing, and questions to answer. The brief is notes for you. Its wording is checked so it does not copy the articles.'],
  ['Draft article', 'On a brief, press Draft article to get a first draft built from that brief only: a source number on every factual paragraph, and clear "needs your input" markers where the research has gaps. It is a starting point to edit and fact-check, and it warns if it repeats wording from a source.'],
  ['Choosing your words', 'People search in everyday words but the trade writes in its own, so the best articles may never use yours. Under the topic box, Suggest industry terms offers up to three other phrasings. Tick the ones to search as well; every source is asked each one and the results are merged.'],
  ['What the AI was asked', 'Every AI call can be inspected. Open the What the AI was asked panel on a brief, a draft, a source check or the suggestions to read the exact prompt that was sent, and copy it. The results page also lists the words every source was searched for and the sources that were not used and why, so a thin result explains itself.'],
  ['Source check', 'Before a brief is written, a quick check scores each ticked article from 0 to 3 for how directly it is about your topic. If most are off topic it says so and lets you search again, choose other articles or carry on. Shop pages are badged, scored lower and not ticked to begin with.'],
  ['Where you are', 'While a search, brief or draft runs, a box shows each step as it really happens. A bar above the pages shows where you are in the work: Search, Results, Brief, Draft, and every stage that exists is a tab you can click. On a brief or draft it stays at the top while you scroll, with Results, Another angle, Draft article, Copy and More. Each suggested angle has its own Write the outline button, and the briefs for a search are tabs under the title.'],
  ['The model', "Briefs and drafts are written by the AI model you choose in Vault Settings, under Topic Research. Leave it on the default to use the workspace's usual model. The quick source check and the suggestions use the workspace's cheaper model when there is one."],
  ['Spending limit', 'Paid searches and briefs cost a little. Set a monthly limit in Settings; when the estimate reaches it, paid searches and new briefs pause until you raise it or the month ends. Amounts are estimates.'],
  ['Your data', 'Page text is kept for 30 days and then cleared. A deleted topic goes to the recycle bin and can be brought back.'],
];

// Everything the guide can point at: the three tabs plus the controls inside them. `tool` is the tab the Open button switches to.
export const GUIDE_TOOLS = [
  { id: 'topics', label: 'Topics', tool: 'topics' },
  { id: 'search', label: 'Search a topic', tool: 'topics' },
  { id: 'watch', label: 'Watch a topic', tool: 'topics' },
  { id: 'results', label: 'Ranked stories', tool: 'topics' },
  { id: 'brief', label: 'Research brief', tool: 'topics' },
  { id: 'check', label: 'Source check before a brief', tool: 'topics' },
  { id: 'suggest', label: 'Suggest industry terms', tool: 'topics' },
  { id: 'prompts', label: 'What the AI was asked', tool: 'topics' },
  { id: 'progress', label: 'Progress steps', tool: 'topics' },
  { id: 'draft', label: 'Draft article', tool: 'topics' },
  { id: 'history', label: 'History', tool: 'history' },
  { id: 'settings', label: 'Settings', tool: 'settings' },
  { id: 'feeds', label: 'RSS feeds', tool: 'settings' },
  { id: 'profile', label: 'Your site', tool: 'settings' },
  { id: 'ranking', label: 'How results are ranked', tool: 'settings' },
  { id: 'spending', label: 'Spending this month', tool: 'settings' },
  { id: 'model', label: 'Choose the AI model', tool: 'settings' },
];
