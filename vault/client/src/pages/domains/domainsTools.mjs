// What the Domain page (Domain & Brand) is made of, the plain-words help for it, and the controls its guide (the round button) can
// point at. The ids are the guide's catalogue (server/services/domainsTutor.js); node server/services/domainsTutor.test.js fails if the
// two lists drift apart. The page is a guided journey: its menu is the steps, and `tool` on a guide entry says which step its Open
// button switches to. Later steps (Check, Decide) are added here and in the catalogue as they are built.

export const DOMAIN_TOOLS = [
  { id: 'brief', label: 'Brief', group: 'The journey', icon: 'sparkles' },
  { id: 'names', label: 'Names', group: 'The journey', icon: 'sparkles' },
  { id: 'shortlist', label: 'Shortlist', group: 'The journey', icon: 'sparkles' },
  { id: 'sets', label: 'Saved sets', group: 'Keep', icon: 'folder' },
];

export const GROUPS = ['The journey', 'Keep'];

export const GROUP_TIPS = {
  'The journey': 'From a description of what you are naming to a short list of names you like.',
  Keep: 'Your saved sets: come back to a naming brief later, or delete the ones you no longer need.',
};

export const TOOL_TIPS = {
  brief: 'Describe what you are naming, the tone and style you want, and what must be free.',
  names: 'See the names made for your brief, filter them instantly, and steer a new round.',
  shortlist: 'The names you starred.',
  sets: 'Your saved sets. Open one to carry on, or delete the ones you no longer need.',
};

export const TOOL_BLURBS = {
  brief: 'What it is, the tone, and what must be free.',
  names: 'Reasons, risks, filters and steering.',
  shortlist: 'Your starred names.',
  sets: 'Come back to a saved brief.',
};

// The longer text for the (i) "How Domain works" box.
export const HOW_IT_WORKS = [
  ['The journey', 'You describe what you are naming, and the tool makes names, explains each one, and shows whether the domain is free. You shortlist the ones you like. Everything is saved with a set so you can come back to it.'],
  ['The brief', 'Say what it is and who it is for, move the tone sliders (playful or serious, modern or classic, local or global, premium or approachable), choose naming styles, and add words to include or avoid. Tick the domain endings and social platforms that must be free. Every box has a microphone.'],
  ['Names you already have', 'If you already have a name, such as a book title, an artist or a business, type it in Names I already have (one per line). It is always included, checked first exactly as written, and marked Your name. If you mention a name in the description, such as a book called The Suitcase or an artist named Dorothy Stoner, the page offers to add it for you. Names are also built around it, for example the title or surname joined with gallery, exhibitions or collection.'],
  ['How names are made', 'The AI writes about 180 ideas. Code then throws most of them away for free: names that are too long, filler words, words you asked to avoid, names that are hard to spell when heard, names too close to a famous brand or to each other. Only the best 40 or so are checked for domains, and a name with a required ending already taken is dropped. About 12 are shown, each with a reason and any risks.'],
  ['Filters and steering', 'Filters work instantly on the names you have and cost nothing: length, syllables, which endings are free, style, first letters, letters to avoid, hard-to-spell names. A line always says how many are showing. To steer, mark names More like this or Less like this and press Get more names, change the brief, or press Variations on a favourite to try prefixes, suffixes and other spellings.'],
  ['Talk it through', 'Under the names, add more detail or ask a question. Ask about these names gets an answer from the names and their checks, and changes nothing. Add to the brief and get new names puts what you wrote into the brief and makes a new round that builds on it. The conversation is saved with the set.'],
  ['Credits', 'Each round checks about 40 names, which uses about 40 domain lookup credits. The cost is shown before you press the button. Filters, shortlisting and opening a saved set cost nothing.'],
  ['Free is not safe', 'A free domain means it is not registered right now. It is not a trade mark or business name check.'],
];

// Everything the guide can point at: the steps plus the controls inside them. `tool` is the step the Open button switches to.
export const GUIDE_TOOLS = [
  { id: 'brief', label: 'Brief', tool: 'brief' },
  { id: 'names', label: 'Names', tool: 'names' },
  { id: 'shortlist', label: 'Shortlist', tool: 'shortlist' },
  { id: 'sets', label: 'Saved sets', tool: 'sets' },
  { id: 'describe-business', label: 'What is it', tool: 'brief' },
  { id: 'own-names', label: 'Names I already have', tool: 'brief' },
  { id: 'notes', label: 'Anything else we should know', tool: 'brief' },
  { id: 'tone', label: 'Tone', tool: 'brief' },
  { id: 'styles', label: 'Naming style', tool: 'brief' },
  { id: 'requirements', label: 'What must be free', tool: 'brief' },
  { id: 'generate', label: 'Generate names', tool: 'brief' },
  { id: 'microphone', label: 'Microphone', tool: 'brief' },
  { id: 'filters', label: 'Filters', tool: 'names' },
  { id: 'steering', label: 'More like this and Less like this', tool: 'names' },
  { id: 'variations', label: 'Variations', tool: 'names' },
  { id: 'talk', label: 'Talk it through', tool: 'names' },
  { id: 'save-set', label: 'Save set', tool: 'names' },
];
