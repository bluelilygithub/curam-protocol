'use strict';

// The Domain guide (the round button on Vault's /domains page, "Domain & Brand"): a person says what they want to do ("I need a name for
// my business", "I already have a book title", "the .com is taken") and the guide points at the real steps and controls, in order, or
// says plainly that Domain does not do it. It only knows what is written here and it never sees any description, name or result.
// Built on guideCore.js; the ids are the page's own, listed in client/src/pages/domains/domainsTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- The journey ----
  { id: 'brief', label: 'Brief', group: 'The journey',
    does: 'Step 1. A short form: what it is and who it is for, names you already have, the tone (four sliders), the naming styles, words to include and to avoid, and what must be free (domain endings and social platforms). Press Generate names when you are ready. Every box has a microphone.',
    notes: 'You only need to say what it is, or give a name you already have. Everything on the form is saved with the set and shown as one plain sentence above the names.' },
  { id: 'names', label: 'Names', group: 'The journey',
    does: 'Step 2. The names made for your brief. Each shows the name, whether each domain ending (.com, .com.au, .org, .io, .ai, .co, .app) is free, taken or not confirmed, a line on where the name comes from, and any risks such as being easy to misspell. Above them are instant filters and a line saying how many are showing. You can shortlist a name, mark it More like this or Less like this, make variations of it, or get more names.',
    notes: 'The AI writes about 180 ideas but code throws most away for free, checks only the best ones for domains, and drops names whose required ending is taken. Free means not registered right now. It is not a trade mark or business name check.' },
  { id: 'shortlist', label: 'Shortlist', group: 'The journey',
    does: 'Step 3. The names you starred, each with its endings, reason and risks. Remove one with its star.',
    notes: 'Only starred names appear here. Star names on the Names step.' },
  { id: 'describe-business', label: 'What is it', group: 'The journey',
    does: 'The big box at the top of the Brief. Say or type what you are naming and what it is like: what it does, who it is for, the feeling. A sentence or two is enough.',
    notes: 'If it mentions a real book, person or business, the AI is told to keep that name exactly. For a name you already have, use Names I already have as well.' },
  { id: 'own-names', label: 'Names I already have', group: 'The journey',
    does: 'The box under the description. Type names you already have, such as a book title, an artist or a business, one per line. Each is always included and checked first, exactly as written and joined into one word (The Staircase Suitcase becomes thestaircasesuitcase), and also without a leading "The". They are marked Your name and are never filtered out.',
    notes: 'Up to five names. They are checked in addition to the other names, so each uses a lookup credit.' },
  { id: 'tone', label: 'Tone', group: 'The journey',
    does: 'Four sliders on the Brief: playful to serious, modern to classic, local to global, premium to approachable. The middle means no preference. The AI is told only about the sliders you moved.',
    notes: 'The tone steers the style of the names. It is a hint, not a rule.' },
  { id: 'styles', label: 'Naming style', group: 'The journey',
    does: 'Tick any of the naming styles on the Brief: descriptive (says what you do), compound (two words joined), invented word, metaphor, or founder or personal name. Tick none for a mix.',
    notes: 'Descriptive and compound names are allowed to be longer than invented ones.' },
  { id: 'requirements', label: 'What must be free', group: 'The journey',
    does: 'On the Brief, tick the domain endings (.com, .com.au, .org, .io, .ai, .co, .app) and social platforms (Instagram, X, TikTok, Facebook, YouTube, LinkedIn, GitHub, Threads) that must be free. A name whose required ending is already taken is dropped before you see it. Required platforms are checked for your shortlist.',
    notes: 'Not confirmed never counts as free. Free means not registered or claimed right now.' },
  { id: 'generate', label: 'Generate names', group: 'The journey',
    does: 'The button at the bottom of the Brief. It makes a round of names and takes you to the Names step. It shows the cost first: about 40 domain lookup credits.',
    notes: 'It can take up to a minute. On the Names step, Update names does the same after you edit the brief.' },
  { id: 'microphone', label: 'Microphone', group: 'The journey',
    does: 'Every text box has a microphone button. Press it, speak, and press it again (or pause, in a short box) to stop. In the description boxes it keeps listening until you stop it. In a name box say "dot" for a full stop and "dash" for a hyphen.',
    notes: 'It needs a browser that supports speech recognition (Chrome or Edge work well). Check what it typed before you generate: names are easily misheard, so type one that comes out wrong.' },
  { id: 'filters', label: 'Filters', group: 'The journey',
    does: 'On the Names step: length, syllables, which endings must be confirmed free, style, starts with, avoid letters, hide hard-to-spell names and shortlisted only. They work instantly on the names you already have, cost nothing and change nothing but what is shown. A line always says how many of how many are showing.',
    notes: 'Filters never hide your own names. Clear filters puts everything back.' },
  { id: 'steering', label: 'More like this and Less like this', group: 'The journey',
    does: 'Buttons on each name. Mark names you like (More like this) and dislike (Less like this), then press Get more names. The next round builds on the brief and your feedback and never repeats names you have seen. You can also press Edit brief to change the tone, styles or words, then Update names.',
    notes: 'Each round checks about 40 names and uses about 40 lookup credits.' },
  { id: 'variations', label: 'Variations', group: 'The journey',
    does: 'A button on each name. It makes prefixes (get-, try-, use-), suffixes (-ly, -hq, -labs), other spellings and your brief words joined on, and checks them. Useful when a favourite name\'s .com is taken.',
    notes: 'Up to 24 variations are checked, using about 24 lookup credits.' },
  // ---- Keep ----
  { id: 'save-set', label: 'Save set', group: 'Keep',
    does: 'At the top of the page, type a name for the set and press Save set. It keeps the brief, every name with its reasons and checks, your shortlist and your feedback. After the first save the button says Update set, and a note says Saved or Unsaved changes. New set starts a different brief; a saved set stays saved.',
    notes: 'A set is kept with your account only. Up to 200 sets.' },
  { id: 'sets', label: 'Saved sets', group: 'Keep',
    does: 'The list of your saved sets with the brief, how many names and how many are shortlisted, and when it was last updated. Open shows the set exactly as saved, with no new lookups. Delete removes one; tick several (or Select all) and press Delete selected to remove many. Deleted sets go to Settings, Recycle bin for 30 days with an Undo.',
    notes: 'Availability changes, so check again before relying on an old set.' },
];

const RULES = [
  'The journey is Brief, then Names, then Shortlist. Start with the Brief, press Generate names, filter and steer on the Names step, star the ones you like, and save the set when you want to come back.',
  'If someone already has a name (a book title, an artist, a business), point them at Names I already have: it is always included and checked first.',
  'Every box has a microphone. In a name box, say "dot" for a full stop and "dash" for a hyphen.',
  'Filters are instant and free. Generating names, getting more names and making variations each use domain lookup credits (about 40 for a round, up to 24 for variations).',
  'Nothing is bought, registered or held. Domain only looks things up; the only thing it keeps is a set you save yourself.',
  'A free name is not a safe name: a free domain means it is not registered right now. Trade marks and business names are not checked. Say so if someone asks whether they may use a name.',
  'Never call a name free or safe from memory. You cannot see the results; point at the Names step to see availability.',
  'The description is read by the AI model Vault is set up with, and names are checked with a domain data service. Do not put anything confidential in it.',
  'The Open buttons in this chat only switch to a tool (a step of the page); they never generate or save anything by themselves.',
];

const NOT_POSSIBLE = [
  'Buying or registering a domain, or holding a name for you (do that at a registrar).',
  'Checking trade marks, company or business-name registers, or whether a name is legally safe to use (the Domain page does not check these yet).',
  'Checking social media handles for the whole list at once (required platforms are set on the Brief; the full check is for your shortlist and is not built into the Names step yet).',
  'Changing DNS records, setting up email or pointing a domain at a website (DNS Lookup reads records).',
  'Buying a domain that someone else already owns, or finding out how to contact the owner.',
  'Watching a name or reminding you about an expiry date (a set keeps a snapshot; it does not check again by itself).',
];

const SYSTEM = `You are the guide to Domain (Domain & Brand) in Vault, a private AI workspace. One person uses it to find a name for a business, product or project, and to see whether the domain is free. They say, in everyday words, what they want to do. You point them to the real steps and controls, in order, or say plainly that Domain does not do it.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Domain cannot do.
- You cannot see any description, name or result they have typed or been given. Never state or guess whether a name is available, what it costs or whether it is safe.
- Never say a name is safe to use. A free name only means it is not registered; trade marks are not checked.
- Be plain and short, as to a friend who is not technical. Explain any unusual word (TLD, registrar, syllable) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask about speaking instead of typing, point at the microphone and explain "dot" and "dash".
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Domain guide', feature: 'domains_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'DOMAIN STEPS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your business name or domain, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askDomainsTutor: guide.ask,
};
