// What the Memory page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are the
// guide's catalogue (server/services/memoryTutor.js); node server/services/memoryTutor.test.js fails if the two lists drift apart.
// Memory is one page with one job, so there is one "tool" below (the page itself); `tool` on a guide entry says which tool its Open button shows,
// and the page marks each part with data-guide="<id>" so the button can scroll to it.

export const MEMORY_TOOLS = [
  { id: 'memory', label: 'Memory', group: 'Memory', icon: 'brain' },
];

export const GROUPS = ['Memory'];

export const GROUP_TIPS = {
  Memory: 'Short facts about you that Vault keeps, so Claude can use the relevant ones in every chat.',
};

export const TOOL_TIPS = {
  memory: 'Your private notebook of short facts: add them, find them by meaning, and delete the ones you no longer want. Claude reads the most relevant ones in every chat.',
};

export const TOOL_BLURBS = {
  memory: 'Short facts Claude can recall in chat.',
};

// The longer text for the (i) "How Memory works" box.
export const HOW_IT_WORKS = [
  ['What it is for', 'Memory is a private notebook of short facts about you, for example "I prefer plain language" or "my time zone is Australia/Brisbane". In every chat, Vault picks the facts that matter for what you just asked and shows them to Claude in the background, so you do not have to say them again.'],
  ['Adding a memory', 'Type a fact in Add a memory (or tap the microphone and say it) and press Add. Keep each one short and about one thing. The same words twice are kept once. Memories are added here only: Chat reads your memories but does not save new ones.'],
  ['Searching by meaning', 'Search memories looks for what a fact means, not only the exact words, so "where do I live" can find "my home is in Brisbane". This needs an embedding model to be set up (the line under the numbers says if it is). Without one, Search shows your most recent memories instead of matches.'],
  ['Which ones Claude sees', 'For each chat message Vault picks up to 8 of your memories that fit it best. When search by meaning is not set up, it uses your 8 most recent instead, so keep the important ones short and specific.'],
  ['Deleting', 'The bin icon on a memory asks Delete? Yes / No, and Yes removes it for good: it does not go to the recycle bin. There is no edit button, so to change a fact, add the new version and delete the old one.'],
  ['What it is not', 'It is not a log of your conversations (Vault does not keep those as memories), not a place for documents or long notes (use Notes), and it is yours alone: nobody else sees your memories.'],
];

// Everything the guide can point at: the page plus the controls on it. `tool` is the tool the Open button shows.
export const GUIDE_TOOLS = [
  { id: 'memory', label: 'Memory', tool: 'memory' },
  { id: 'memory-status', label: 'Memory summary line', tool: 'memory' },
  { id: 'add-memory', label: 'Add a memory', tool: 'memory' },
  { id: 'memory-mic', label: 'Microphone', tool: 'memory' },
  { id: 'search-memory', label: 'Search memories', tool: 'memory' },
  { id: 'clear-search', label: 'Clear search', tool: 'memory' },
  { id: 'memory-list', label: 'Recent memories', tool: 'memory' },
  { id: 'show-more', label: 'Show more / Show less', tool: 'memory' },
  { id: 'delete-memory', label: 'Delete a memory', tool: 'memory' },
];
