// What the Domain page (Domain & Brand) is made of, the plain-words help for it, and the controls its guide (the round button) can
// point at. The ids are the guide's catalogue (server/services/domainsTutor.js); node server/services/domainsTutor.test.js fails if the
// two lists drift apart. The page's menu is its six tools; `tool` on a guide entry says which tool its Open button switches to.

export const DOMAIN_TOOLS = [
  { id: 'suggest', label: 'Name Generator', group: 'Discover', icon: 'sparkles' },
  { id: 'score', label: 'Name Scorer', group: 'Discover', icon: 'sparkles' },
  { id: 'compare', label: 'Compare Names', group: 'Discover', icon: 'sparkles' },
  { id: 'overview', label: 'Domain Profile', group: 'Research', icon: 'search' },
  { id: 'social', label: 'Social Handles', group: 'Launch Readiness', icon: 'shield-check' },
  { id: 'pricing', label: 'Registrar Pricing', group: 'Launch Readiness', icon: 'shield-check' },
  { id: 'board', label: 'Current set', group: 'My sets', icon: 'folder' },
  { id: 'sets', label: 'Saved sets', group: 'My sets', icon: 'folder' },
];

export const GROUPS = ['Discover', 'Research', 'Launch Readiness', 'My sets'];

export const GROUP_TIPS = {
  Discover: 'Come up with brand names, score one, or rank a shortlist.',
  Research: 'Look at a domain that already exists: who registered it, how old it is, how it is regarded.',
  'Launch Readiness': 'Check the name is free on social media and see what registrars charge.',
  'My sets': 'Keep a business idea with its names and results, and come back to it later.',
};

export const TOOL_TIPS = {
  suggest: 'Describe the business and get 16 brand names, each checked for .com, .com.au, .io, .ai, .co and .app.',
  score: 'Type one name and see how memorable, easy to spell and brandable it is.',
  compare: 'Enter two to five candidate names and rank them side by side.',
  overview: 'See who registered a domain, how old it is, and its reputation.',
  social: 'Check whether a name is free on Instagram, X, TikTok, LinkedIn, YouTube, GitHub and more.',
  pricing: 'Compare registration and renewal prices for an ending such as .com.au across registrars.',
  board: 'The set you are working on: run every tool on your preferred name, see all the results together, and save it.',
  sets: 'Your saved sets. Open one to carry on where you left off.',
};

export const TOOL_BLURBS = {
  suggest: '16 names from a description, checked for availability.',
  score: 'Memorability, spelling and brandability.',
  compare: 'Rank up to five names.',
  overview: 'Registration, age and reputation of a domain.',
  social: 'Is the name free on social media?',
  pricing: 'Registration and renewal prices.',
  board: 'Every result for the preferred name, and Save.',
  sets: 'Come back to a saved business idea.',
};

// The longer text for the (i) "How Domain works" box.
export const HOW_IT_WORKS = [
  ['Finding a name', 'Name Generator takes a plain description of the business, or a few keywords, and suggests 16 brand names. Each is checked for .com, .com.au, .io, .ai, .co and .app, and the ones with a free .com or .com.au come first.'],
  ['Scoring and comparing', 'Name Scorer rates one name for how memorable it is, how hard it is to spell and say, how well it reads in other languages and how brandable it is. Compare Names ranks two to five names against each other.'],
  ['Looking at an existing domain', 'Domain Profile shows who registered a domain, when, how old it is and how it is regarded. It reports what is public; it does not buy or change anything.'],
  ['Before you commit', 'Social Handles checks whether the name is free on the big social platforms. Registrar Pricing compares what registrars charge to register and renew, so a cheap first year does not hide an expensive renewal.'],
  ['Table of three', 'On the Name Generator, Table of three puts three suggestions side by side, one per column, each with its domain endings (.com, .com.au, .io, .ai, .co, .app) and its social media handles marked free, taken or unknown. The columns start with your preferred name and shortlist, then the best of the rest, and each can be swapped for any other name. Check social handles looks the names up; the table also appears on Current set and is saved with the set.'],
  ['Sets', 'On the Name Generator, shortlist the names you like and make one the preferred name. Run all tools checks that name in every other tool at once and gathers the results on Current set, where you name and save the set. Saved sets keeps each set with its names and results, so you can open it again later without new lookups, and run the tools again to refresh.'],
  ['Speaking instead of typing', 'Every box has a microphone. Press it, say your description or names, and press it again to stop. In a domain or name box, say "dot" for a full stop and "dash" for a hyphen: "acme wine dot com dot au" becomes acmewine.com.au.'],
  ['Read only', 'Nothing is bought or registered. Names are checked against a domain data service; the description you type is read by the AI model Vault is set up with. The only thing kept is a set you save yourself, with your account.'],
];

// Everything the guide can point at: the six tools plus the controls inside them. `tool` is the tool the Open button switches to.
export const GUIDE_TOOLS = [
  { id: 'suggest', label: 'Name Generator', tool: 'suggest' },
  { id: 'score', label: 'Name Scorer', tool: 'score' },
  { id: 'compare', label: 'Compare Names', tool: 'compare' },
  { id: 'overview', label: 'Domain Profile', tool: 'overview' },
  { id: 'social', label: 'Social Handles', tool: 'social' },
  { id: 'pricing', label: 'Registrar Pricing', tool: 'pricing' },
  { id: 'describe-business', label: 'Describe your business', tool: 'suggest' },
  { id: 'availability', label: 'Availability check', tool: 'suggest' },
  { id: 'add-name', label: 'Add name', tool: 'compare' },
  { id: 'microphone', label: 'Microphone', tool: 'suggest' },
  { id: 'board', label: 'Current set', tool: 'board' },
  { id: 'sets', label: 'Saved sets', tool: 'sets' },
  { id: 'preferred-name', label: 'Preferred name and shortlist', tool: 'suggest' },
  { id: 'suggestion-table', label: 'Table of three', tool: 'suggest' },
  { id: 'delete-set', label: 'Delete sets', tool: 'sets' },
  { id: 'run-all', label: 'Run all tools', tool: 'board' },
  { id: 'save-set', label: 'Save set', tool: 'board' },
];
