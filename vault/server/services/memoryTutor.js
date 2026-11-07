'use strict';

// The Memory guide (the round button on Vault's /memory page): a person says what they want to do ("save a fact about me", "find that note about my
// timezone", "stop Claude using something") and the guide points at the real parts of the page, in order, or says plainly that the page does not do
// it. It only knows what is written here and it never sees any memory, search or setting. Built on guideCore.js; the ids are the page's own, listed
// in client/src/pages/memory/memoryTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/semantic-memory.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'memory', label: 'Memory', group: 'Memory',
    does: 'The whole page: a private notebook of short facts about the person (for example "I prefer plain language" or "my time zone is Australia/Brisbane"). In every chat, Vault picks the facts that fit what was just asked and shows them to Claude in the background, so they do not have to be said again.',
    notes: 'Memories are added here on this page only: Chat reads them but never saves a new one, so asking Claude in a chat to remember something does not store it. Memories belong to the signed-in person and nobody else sees them. In the menu the page can be hidden for members until an administrator turns it on.' },
  { id: 'memory-status', label: 'Memory summary line', group: 'Memory',
    does: 'Two small lines inside the "How memory works" box: how many memories are stored, how many of them are searchable (have been prepared for search by meaning), the day of the latest one, and a "Current:" line saying which embedding setup is in use.',
    notes: 'If a red banner says the summary could not be loaded, or the Current line says search by meaning is unavailable, something behind the page is not set up (an embedding model, or the database feature that stores it). Adding, listing and deleting may then fail or search may only show recent memories. The guide cannot see which.' },
  { id: 'add-memory', label: 'Add a memory', group: 'Memory',
    does: 'A text box and an Add button. Type one short fact and press Add (or Enter). It is saved and appears at the top of Recent memories, and a message says Memory saved.',
    notes: 'Keep each memory short and about one thing; a note can be up to about 30,000 characters but short facts work best. The same words saved twice are kept once. It does not search or save from chat, and it cannot edit an existing memory: to change a fact, add the new version and delete the old one.' },
  { id: 'memory-mic', label: 'Microphone', group: 'Memory',
    does: 'The microphone at the right end of the Add a memory box and of the Search memories box. Tap it, say the words, and they are typed into that box; tap again to stop.',
    notes: 'It needs a browser that supports speech and permission for the microphone; if it is not available the button says so and typing still works. Check the words before pressing Add or Search.' },
  { id: 'search-memory', label: 'Search memories', group: 'Memory',
    does: 'A search box with a Search button. It looks for what a fact means, not only the exact words, so "where do I live" can find "my home is in Brisbane". The matches replace the list below and show how close each one is.',
    notes: 'Search by meaning needs an embedding model to be set up. When it is not, Search just shows the most recent memories instead of real matches. An empty search puts the normal list back.' },
  { id: 'clear-search', label: 'Clear search', group: 'Memory',
    does: 'A Clear button that appears after a search. It empties the search box and goes back to the list of recent memories.',
    notes: '' },
  { id: 'memory-list', label: 'Recent memories', group: 'Memory',
    does: 'The list of memories, newest first (titled Search results while a search is showing). Each one shows its words and the day it was saved, and after a search how close a match it is.',
    notes: 'It shows the latest 50 at a time. Memories cannot be edited, sorted or exported from this page.' },
  { id: 'show-more', label: 'Show more / Show less', group: 'Memory',
    does: 'A link on a long memory (over about 220 characters) that opens the whole text or folds it back to a short preview.',
    notes: 'Only long memories have it.' },
  { id: 'delete-memory', label: 'Delete a memory', group: 'Memory',
    does: 'The bin icon on a memory. It asks Delete? Yes / No, and Yes removes that memory for good.',
    notes: 'Deleting is permanent: it does not go to the recycle bin and there is no Undo. Claude stops using that memory from the next chat message.' },
];

const RULES = [
  'Memories are short facts the person saves on this page. In every chat Vault shows Claude up to 8 of the memories that fit the message best, or the 8 most recent when search by meaning is not set up.',
  'Memories are added only on the Memory page. Chat reads memories but never saves them, so never say that asking Claude in a chat to remember something stores it.',
  'Deleting a memory is permanent: there is no recycle bin and no Undo.',
  'There is no edit button: to change a fact, add the new version and delete the old one.',
  'Search by meaning needs an embedding model to be set up. Without one, Search shows the most recent memories instead of matches.',
  'Memories belong to the signed-in person only.',
  'The Open buttons in this chat only switch to a tool (they show the page or scroll to a part of it); they never add, search or delete anything.',
];

const NOT_POSSIBLE = [
  'Saving a memory from a chat: Chat only reads memories. Memories are added on the Memory page.',
  'Editing a memory, sorting the list, tagging or grouping memories, or exporting them to a file.',
  'Recovering a deleted memory: deleting is permanent (no recycle bin).',
  'Sharing memories with someone else, or seeing anyone else\'s memories.',
  'Choosing which memories Claude uses in a particular chat, or turning memories off for one chat: Vault picks the ones that fit each message.',
  'Keeping whole conversations, documents or long notes: Memory is for short facts (use Notes for longer writing).',
  'Choosing the embedding model that powers search by meaning: that is set in Settings, AI Models, by an administrator.',
  'Showing the person what their memories say: the guide cannot see any memory.',
];

const SYSTEM = `You are the guide to Memory in Vault for one person who keeps short facts about themselves so Claude can use the relevant ones in chat. They say, in everyday words, what they want to do. You point them to the right parts of the page, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say this page cannot do.
- You cannot see their memories, searches or settings. Never state or guess what a memory says, how many there are, or which ones Claude will use.
- Be plain and short, as to a friend who is not technical. Explain any word like embedding or "search by meaning" in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Memories are saved on this page only. Chat reads them but never saves them: if the person thinks they can tell Claude in a chat to remember something, say plainly that it will not be kept and that they should add it here.
- Deleting is permanent. Say so before a step that deletes.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Memory guide', feature: 'memory_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'MEMORY TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with Memory, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askMemoryTutor: guide.ask,
};
