// What the AI Visibility page (/ai-visibility) is made of, the plain-words help for it, and the controls its
// guide (the round button) can point at. The ids are the guide's catalogue (server/services/aiVisibilityTutor.js);
// node server/services/aiVisibilityTutor.test.js fails if the two lists drift apart. The "tools" are the places a
// person can be: the new-audit form, the saved list, and the parts of one saved report. `tool` on a guide entry says
// which of those its Open button goes to, and the page marks each part with data-guide="<id>" so it can scroll there.

export const AI_VISIBILITY_TOOLS = [
  { id: 'new-audit', label: 'New audit', group: 'Run an audit', icon: 'radar' },
  { id: 'saved-audits', label: 'Saved audits', group: 'Run an audit', icon: 'list' },
  { id: 'scores', label: 'Scores', group: 'Results', icon: 'gauge' },
  { id: 'suggestions', label: 'Suggestions', group: 'Results', icon: 'check' },
  { id: 'technical', label: 'Technical access', group: 'Results', icon: 'server' },
  { id: 'readability', label: 'Readability without JavaScript', group: 'Results', icon: 'eye' },
  { id: 'schema', label: 'Structured data', group: 'Results', icon: 'code' },
  { id: 'questions', label: 'Buyer questions and AI assistants', group: 'Results', icon: 'message' },
  { id: 'facts', label: 'Key facts across answers', group: 'Results', icon: 'list' },
  { id: 'copy', label: 'Copy for AI', group: 'Share', icon: 'copy' },
  { id: 'pdf', label: 'Download PDF', group: 'Share', icon: 'file' },
];

export const GROUPS = ['Run an audit', 'Results', 'Share'];

export const GROUP_TIPS = {
  'Run an audit': 'Paste one public page address and Vault checks how AI assistants can reach, read and quote it.',
  Results: 'One saved audit: the scores, what to fix, and the evidence behind each check.',
  Share: 'Take the report with you: copy it as text, or download a PDF to send.',
};

export const TOOL_TIPS = {
  'new-audit': 'Start a fresh audit of one public page. Takes one to four minutes in the background: it fetches the page, reads robots.txt, renders it, then searches each question and asks the ticked AI assistants.',
  'saved-audits': 'Every audit you have run, newest first. Click one to reopen its report.',
  scores: 'The overall score and the six areas it is built from. Areas that could not be measured are left out, not scored zero.',
  suggestions: 'What to fix, in order: Fix first, then Improve, then optional ideas.',
  technical: 'What a crawler receives before JavaScript runs, and which AI crawlers robots.txt allows or blocks.',
  readability: 'The same page as raw HTML and after a real browser runs its JavaScript, compared word for word.',
  schema: 'JSON-LD entities checked one by one, including the properties answer engines need.',
  questions: 'Each buyer question: where the site ranks in a live search, then each real AI assistant\'s answer, whether it named the business and whether it used the site as a source.',
  facts: 'Whether the facts you supplied appear in the assistants\' answers. Matching is a heuristic, so re-read the answer.',
  copy: 'Copy the whole report as Markdown text for an AI assistant or a document.',
  pdf: 'Download a formatted PDF of the report to send to a client, manager or developer.',
};

export const TOOL_BLURBS = {
  'new-audit': 'Audit one public page.',
  'saved-audits': 'Reopen an earlier audit.',
  scores: 'The overall score and its areas.',
  suggestions: 'What to fix, in order.',
  technical: 'Crawler access and robots.txt.',
  readability: 'What is visible without JavaScript.',
  schema: 'JSON-LD entities and gaps.',
  questions: 'Search ranking and real assistants.',
  facts: 'Whether your facts appeared.',
  copy: 'Copy the report as text.',
  pdf: 'Download the report as a PDF.',
};

// The longer text for the (i) "How AI Visibility works" box.
export const HOW_IT_WORKS = [
  ['What it does', 'You paste the address of one public page. Vault fetches it the way a crawler would, reads robots.txt, renders it in a real browser and checks its structured data. Then it searches a few realistic buyer questions and puts each one to real AI assistants. It runs in the background and saves a scored report with suggestions.'],
  ['AI access', 'robots.txt is read properly and each AI crawler is checked on its own: GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended and the rest. Each row shows Allowed or Blocked, the exact rule that decides it, and what that crawler is for.'],
  ['Readable without JavaScript', 'AI crawlers often do not run JavaScript. Vault compares the words in the raw HTML with the words after a browser has rendered the page. If most of the offer only appears after scripts run, a crawler may see little of it.'],
  ['Structured data', 'JSON-LD blocks are parsed and each entity (Organization, LocalBusiness, Product, FAQPage, Article and so on) is checked for the properties an answer engine needs. Missing required properties are called out.'],
  ['Search ranking', 'Each question is searched once on the web (Brave, Serper or SerpAPI) and the site\'s position in the top 10 is recorded. This is a search-engine signal, reported on its own.'],
  ['Real AI assistants', 'Each question is then put to Claude with web search, Gemini with Google Search and Perplexity, where connected and ticked. Each assistant searches for itself, as it would for a customer. For each one the report says whether it named the business and whether a page on the site was among its sources. Answers vary between runs, accounts and locations, so treat them as a sample.'],
  ['Key facts', 'The numbers and distinctive terms you supply, with their units, are checked against the assistants\' answers. This is a word-and-number match, not an understanding of meaning, so use it to re-read the answer rather than as proof.'],
  ['Scores and suggestions', 'Six areas are scored where they can be measured: technical access, no-JS readability, structured data, search ranking, named by AI assistants and key-fact accuracy. The overall score is weighted across the areas that could be measured. Suggestions are ordered Fix, Improve, Consider.'],
  ['Copy and PDF', 'Copy for AI puts the whole report on the clipboard as Markdown. Download PDF makes a formatted report. Both are text you take away; Vault does not email or share a live link.'],
  ['What it cannot do', 'It does not change your website, cannot audit a whole site at once, cannot see pages behind a login, and cannot make AI assistants recommend you. It measures a snapshot; re-run it after changes.'],
];

// Everything the guide can point at. `tool` is where the Open button goes.
export const GUIDE_TOOLS = [
  { id: 'new-audit', label: 'New audit', tool: 'new-audit' },
  { id: 'saved-audits', label: 'Saved audits', tool: 'saved-audits' },
  { id: 'run-audit', label: 'Run audit', tool: 'new-audit' },
  { id: 'assistants', label: 'AI assistants to ask', tool: 'new-audit' },
  { id: 'model', label: 'Model', tool: 'new-audit' },
  { id: 'buyer-questions', label: 'Buyer questions', tool: 'new-audit' },
  { id: 'facts-input', label: 'Key facts to check', tool: 'new-audit' },
  { id: 'scores', label: 'Scores', tool: 'scores' },
  { id: 'score-areas', label: 'Score areas', tool: 'scores' },
  { id: 'suggestions', label: 'Suggestions', tool: 'suggestions' },
  { id: 'technical', label: 'Technical access', tool: 'technical' },
  { id: 'robots', label: 'robots.txt and AI crawlers', tool: 'technical' },
  { id: 'readability', label: 'Readability without JavaScript', tool: 'readability' },
  { id: 'schema', label: 'Structured data', tool: 'schema' },
  { id: 'questions', label: 'Buyer questions and AI assistants', tool: 'questions' },
  { id: 'citation', label: 'Assistant checks', tool: 'questions' },
  { id: 'facts', label: 'Key facts across answers', tool: 'facts' },
  { id: 'copy', label: 'Copy for AI', tool: 'copy' },
  { id: 'pdf', label: 'Download PDF', tool: 'pdf' },
];
