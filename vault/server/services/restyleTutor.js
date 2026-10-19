'use strict';

// The CSS guide (the round button on Vault's /restyle page, shown to people as "CSS"): a person says what they want ("make all the
// headings bigger", "try my page with a different colour scheme", "save this and come back tomorrow") and the guide points at the real
// tools and buttons, in order, or says plainly that the tool does not do it. It only knows what is written here and it never sees any
// page. Built on guideCore.js; the ids are the page's own, listed in client/src/pages/restyle/restyleTools.mjs (a test keeps the two in
// step). The page's rule applies here too: no CSS jargon in what the guide says (see docs/restyle.md). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'page', label: 'Your page', group: 'Your page',
    does: 'Upload your web page as an .html file (drop it on the box or click to choose), or choose Paste it in and press Use this HTML. The page is cleaned first: anything that could run code is removed. If the page has styles written inside it, those are picked up as a style file for you. A note lists anything worth a look.',
    notes: 'Your page has to be an HTML file or pasted HTML: there is no way to type in a web address. Pictures held on other websites may not show in the preview.' },
  { id: 'demo', label: 'Load a demo', group: 'Your page',
    does: 'The Load a demo button above the preview loads a small practice page (a header, a paragraph, a card and a picture) and builds the preview straight away, so you can try clicking and changing things without your own files.',
    notes: 'It replaces what is in the preview, so use it before bringing in your own page, or save first.' },
  { id: 'styles', label: 'Style files', group: 'Your page',
    does: 'Add one or more style files: drop .css files on the box or choose them, or choose Paste a snippet, give it a name and press Add this snippet. Use the up and down arrows to put them in order (files lower in the list win when two disagree) and the cross to remove one.',
    notes: 'Style files are optional. If your page already has its own styles inside it, you may not need any.' },
  { id: 'build-preview', label: 'Build the preview', group: 'Your page',
    does: 'The Build the preview button (under the style files) puts your page and style files together in a live preview, which is where you click things to change them. It is available as soon as a page has been added.',
    notes: 'Press it again after adding or reordering style files. Rebuilding starts from the original, so changes you have not saved are lost.' },
  { id: 'saved', label: 'My saved pages', group: 'Your page',
    does: 'Type a name and press Save this page to keep the page exactly as it looks now, with all your changes and style files. Saved pages are listed below: click one to open it (the preview is built for you), or press the cross to delete it.',
    notes: 'Saved to your Vault account, so it works on any device. You need a built preview before you can save. Each save makes a new saved copy; it does not update the one you opened.' },
  { id: 'select', label: 'Click in the preview', group: 'Change it',
    does: 'Move the mouse over the preview and things are outlined with a dotted line; click one and it gets a solid outline and a line above the preview says what you picked. Everything in Change it works on whatever you clicked.',
    notes: 'You have to click something first, or the change tools say so. Clicking a link in the preview does not follow it.' },
  { id: 'ask', label: 'Ask in plain English', group: 'Change it',
    does: 'After clicking something in the preview, describe the change in your own words in the box, such as "make this bigger and give it rounded corners". Type it, or tap the microphone and say it, then press Ask for this change. The change is made for you and can be undone.',
    notes: 'It uses an AI model to turn your words into changes of the look (text, colours, spacing, corners, shadow, animation). It does not change the words on the page. Needs something clicked first.' },
  { id: 'scope', label: 'What it applies to', group: 'Change it',
    does: 'Chooses how far a change reaches: Just this element (the default each time you click), or every matching item, such as every card or every link in a certain section. When you choose one, all the matching items are outlined in amber so you can see what will change. Reset puts the clicked item (or the matching ones) back to how the page had them.',
    notes: 'A change to every matching item is a bigger action, so check the amber outlines first. Reset only touches the things this tool changes.' },
  { id: 'text', label: 'Text', group: 'Change it',
    does: 'For what you clicked: Font (a few common fonts, plus any your files already use), Size, Weight (light, normal, semi-bold, bold), Text colour and Space between lines. Colours, sizes and fonts your page already uses are offered as quick picks.',
    notes: 'Needs something clicked first.' },
  { id: 'enhance', label: 'Text enhancements', group: 'Change it',
    does: 'For what you clicked: Capitalization (normal, ALL CAPS, all lowercase, Title Case), Space between letters, and Alignment (left, centre, right, justify).',
    notes: 'Needs something clicked first.' },
  { id: 'animation', label: 'Animation', group: 'Change it',
    does: 'For what you clicked: an effect drop-down with None, Fade in, Slide up, Pop in, Pulse and Bounce. It plays in the preview when it is set.',
    notes: 'Only these six. Needs something clicked first.' },
  { id: 'box', label: 'Box', group: 'Change it',
    does: 'For what you clicked: Background colour, Rounded corners, Space around the content, and Shadow (none, subtle, soft, strong or outline glow). Colours and sizes your page already uses are offered as quick picks.',
    notes: 'Needs something clicked first.' },
  { id: 'undo', label: 'Undo last change', group: 'Change it',
    does: 'The Undo last change button above the preview takes back your last action. A change to many items at once is one action, so one click undoes all of it.',
    notes: 'It only goes back through changes made since the preview was built.' },
  { id: 'download', label: 'Download my page', group: 'Change it',
    does: 'The Download my page button above the preview saves the finished page, with all your changes built in, as one .html file.',
    notes: 'Available once a preview is built. Nothing is stored for you by this button: use My saved pages to keep it in Vault.' },
];

const RULES = [
  'The order is: bring in the page (Your page), add style files if there are any, press Build the preview, then click something in the preview and change it.',
  'Change it works on whatever has been clicked in the preview. If nothing is clicked, the change tools ask for a click first.',
  'A change affects only the clicked item unless What it applies to is set to every matching item, which is outlined in amber first.',
  'Undo last change goes back one action at a time. Reset (in What it applies to) puts the clicked item back to how the page had it.',
  'Plain English changes are made by an AI model, but only to the look of an item, from a fixed list: font, size, weight, colour, line spacing, background, rounded corners, space around, shadow, capitals, letter spacing, alignment and the six animations.',
  'Save this page keeps the page and every change in the account. Download my page gives a single .html file.',
  'The Open buttons in this chat only switch to a tool; they never change, save or download anything by themselves.',
];

const NOT_POSSIBLE = [
  'Loading a page by typing its web address: the page has to be uploaded as an .html file or pasted in.',
  'Changing the words, the pictures or the layout structure of the page, or adding and removing items. It changes the look of the items already there.',
  'Running the page\'s own scripts: menus, sliders and anything else that needs them will not work in the preview.',
  'Showing pictures held on other websites reliably: some may not appear in the preview.',
  'Editing a style file\'s code directly: the tool has no code editor, only the controls and the plain English box.',
  'Updating a saved page in place or going back to an earlier version: Save this page always makes a new saved copy, so opening a page and saving it again gives two entries, and the old one has to be deleted by hand.',
  'Checking that the finished page works in every browser or on a phone.',
];

const SYSTEM = `You are the guide to the CSS tool in Vault for one person who wants to change how their web page looks without writing code. They say, in everyday words, what they want to do. You point them to the right tool(s) and buttons, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say the tool cannot do.
- You cannot see their page. Never state or guess what is on it.
- Use plain words only, as to a friend who has never written code. Say "the space around it", "the rounded corners", "style files", never code words such as padding, border-radius, selector, class, stylesheet or cascade.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Remember the order: bring in the page, build the preview, click something in the preview, then change it.
- If they ask for something that is not a change to how things look (new words, a new menu, a different layout, getting a page from a web address), say plainly it is not possible here.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'CSS guide', feature: 'restyle_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'CSS TOOLS AND BUTTONS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to change on your page, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askRestyleTutor: guide.ask,
};
