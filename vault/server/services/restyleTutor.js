'use strict';

// The CSS guide (the round button on Vault's /restyle page, shown to people as "CSS"). The tool's job is one thing: restyle a page you
// already have, without writing code, and hand over the CSS to paste into the real site. A person says what they want ("make all the
// buttons my brand green", "show my client how it would look", "get the CSS for the WordPress site") and the guide points at the real
// tools and buttons, in order, or says plainly that the tool does not do it. It only knows what is written here and it never sees any
// page. Built on guideCore.js; the ids are the page's own, listed in client/src/pages/restyle/restyleTools.mjs (a test keeps the two in
// step). The page's rule applies here too: no code words in what the guide says (see docs/restyle.md). See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  // ---- Your page ----
  { id: 'page', label: 'Your page', group: 'Your page',
    does: 'Where the page comes in. Three ways: Web address (type the address of a public page and press Load this page, and the page with its own style files and pictures is fetched and the preview built for you), Upload a file (an .html file), or Paste it in. Anything that could run code is removed, so the preview is a safe still copy.',
    notes: 'Loading a different page starts a fresh set of changes. Pages behind a sign-in cannot be loaded: save the page from your browser and upload it instead.' },
  { id: 'load-address', label: 'Load a page by its address', group: 'Your page',
    does: 'In Your page, choose Web address, type or say the address, and press Load this page. If the page comes up empty or half-built, tick "This page builds itself with JavaScript" and load it again: it is then opened in a real browser first so the page can build itself (slower, and limited to 8 an hour).',
    notes: 'Public pages only. A style file that pulls in another style file does not bring that one in, and a note says so. Pictures are copied in so they show, but some may not. Some websites\' firewalls turn away automatic visitors: the tool asks in several different ways before giving up, and never settles for a words-only copy of the page. If the website still refuses, it says so, and the way round is to open the page in your browser, choose Save page as, and upload that file. The tick box is greyed out on a server where the browser is not set up.' },
  { id: 'demo', label: 'Load a demo', group: 'Your page',
    does: 'The Load a demo button above the preview loads a small practice page (a header, a paragraph, a card with a button, and a picture) and builds the preview straight away, so you can try clicking and changing things without a page of your own.',
    notes: 'It replaces the page in the preview and starts a fresh set of changes.' },
  { id: 'styles', label: 'Style files', group: 'Your page',
    does: 'The style files that make the page look the way it does. A page loaded by its address brings its own. You can add more: drop .css files on the box or choose them, or choose Paste a snippet, give it a name and press Add this snippet. The up and down arrows put them in order (files lower in the list win when two disagree) and the cross removes one. A box lists things worth a look.',
    notes: 'Style files are optional. If your page already has its styles inside it, you may not need any.' },
  { id: 'scrape', label: 'Download a page\'s CSS', group: 'Your page',
    does: 'Type the address of any live page and press Fetch the CSS (tick "This page builds itself with JavaScript" if its styles are added by script). You get every style file the page depends on: the ones it links, the ones those import, and the styles written inside the page, each with its addresses made complete so it works saved on its own. Download all gives a .zip (the files, one combined .css and the settings report); you can also copy or download each file, or get one combined .css. Below that is a summary of the page\'s design settings: its colours, fonts, font files, text sizes, spacing, rounded corners, shadows, variables, screen-size breakpoints and animations, with how often each is used, as a report (.md) or as data (.json). Restyle this page loads it into the editor, and Use its colours as brand colours adds its most-used colours as brand colours.',
    notes: 'Public pages only. Up to 25 style files and 6 MB; a file that imports another is followed two levels. It reads the CSS the page uses, not the page\'s pictures. Nothing is changed or saved on the site or in your account. The JavaScript option is limited to 8 an hour and may be greyed out.' },
  { id: 'build-preview', label: 'Build the preview', group: 'Your page',
    does: 'The Build the preview button (under the style files) puts the page and its style files together in the live preview, which is where you click things to change them. A page loaded by its address is built for you; use this after adding or reordering style files.',
    notes: 'Your changes are kept when you rebuild, and still apply wherever they still match.' },

  // ---- Change it ----
  { id: 'select', label: 'Click in the preview', group: 'Change it',
    does: 'Move the mouse over the preview and things are outlined with a dotted line; click one and it gets a solid outline, and the line above the preview says what you picked. Everything in Change it works on whatever you clicked.',
    notes: 'You have to click something first, or the change tools say so. Clicking a link in the preview does not follow it.' },
  { id: 'device', label: 'Preview sizes', group: 'Change it',
    does: 'The Desktop, Tablet and Phone buttons above the preview show the page at the full window width, 768px wide and 390px wide, so you can see how it looks on each. The page changes shape the way it does on those screens.',
    notes: 'They only change how the preview is shown. To make a change for small screens only, choose it in What it applies to.' },
  { id: 'ask', label: 'Ask in plain English', group: 'Change it',
    does: 'After clicking something in the preview, describe the change in your own words, such as "make this bigger and give it rounded corners". Type it, or tap the microphone and say it, then press Ask for this change. It is made for you, can be undone, and is listed in Changes so far.',
    notes: 'It uses an AI model to turn your words into changes of the look (text, colours, spacing, corners, shadow, animation). It does not change the words on the page. It follows the screen size and look chosen in What it applies to. Needs something clicked first.' },
  { id: 'scope', label: 'What it applies to', group: 'Change it',
    does: 'Chooses how far a change reaches: Just this element (the default each time you click), or every matching item, such as every card or every button, with a count of how many each choice reaches. When the clicked item appears more than once on the page, the same choice is also at the top of Ask in plain English, Text, Text enhancements, Animation and Box, as "Apply the change to" (Just this one, or every one like it), so you do not have to come here for it. When you choose one, all the matching items are outlined in amber so you can see what will change. Reset takes back every change made to that item or those items.',
    notes: 'A change to every matching item is a bigger action, so check the amber outlines first. Needs something clicked first.' },
  { id: 'screen-and-look', label: 'Screen sizes and mouse-over look', group: 'Change it',
    does: 'Two choices in What it applies to. Applies on: all screen sizes, tablets and smaller (up to 768px wide), or phones only (up to 480px wide). Which look: the normal look, how it looks when the mouse is over it (a button turning darker), or when it has been selected with the keyboard. Changes made afterwards are only for that screen size and look, and the preview shows that look while you edit it.',
    notes: 'The choice stays while you click other things, so check it before you change something. The mouse-over choice goes back to normal each time you click a new item.' },
  { id: 'text', label: 'Text', group: 'Change it',
    does: 'For what you clicked: Font (a few common fonts, your brand fonts, and any your files already use), Size, Weight (light, normal, semi-bold, bold), Text colour and Space between lines. Your brand colours come first as quick picks, then the colours your files already use. A note shows whether the text is easy enough to read against its background.',
    notes: 'The readability note uses the standard that people with weak eyesight can read: 4.5 to 1 for normal text, 3 to 1 for large text. Needs something clicked first.' },
  { id: 'enhance', label: 'Text enhancements', group: 'Change it',
    does: 'For what you clicked: Capitalization (normal, ALL CAPS, all lowercase, Title Case), Space between letters, and Alignment (left, centre, right, justify).',
    notes: 'Needs something clicked first.' },
  { id: 'animation', label: 'Animation', group: 'Change it',
    does: 'For what you clicked: an effect drop-down with None, Fade in, Slide up, Pop in, Pulse and Bounce. It plays in the preview when it is set, and the movement it needs is included when you export the CSS.',
    notes: 'Only these six. Needs something clicked first.' },
  { id: 'box', label: 'Box', group: 'Change it',
    does: 'For what you clicked: Background colour, Rounded corners, Space around the content, and Shadow (none, subtle, soft, strong or outline glow). Your brand colours come first as quick picks, then the colours your files already use, and a note shows whether text on that background is easy to read.',
    notes: 'Needs something clicked first.' },
  { id: 'brand', label: 'Brand colours and fonts', group: 'Change it',
    does: 'Set your colours and fonts once: Add a colour, Add a font, or Find the page\'s colours to start from what the page uses. They then appear as quick picks in Text and Box. Below that, Use it across the page applies one choice to everything of a kind in one go: all headings, body text, all links, all buttons, the page background, or the font of all headings or of everything else. If you change a brand colour or font afterwards, everything that uses it follows.',
    notes: 'The brand colours and fonts are saved with the page and go into the exported CSS. Removing one also takes back the changes that used it. Applying across the page needs a built preview.' },

  // ---- Check and compare ----
  { id: 'changes', label: 'Changes so far', group: 'Check and compare',
    does: 'Every change made so far, in plain words, grouped by what it was made to, with what it was before and what it is now, and for which screen size or look. The cross takes one change back; Undo last and Clear all are at the top. For a step-by-step history of the session, use History of this session.',
    notes: 'It is the same list the exported CSS is made from.' },
  { id: 'compare', label: 'Original or with changes', group: 'Check and compare',
    does: 'The With changes and Original buttons above the preview flip between your version of the page and the page as it was before any change, so you can compare. Making a change switches back to With changes.',
    notes: 'The Original view is for looking only. It does not remove your changes.' },
  { id: 'session', label: 'History of this session', group: 'Check and compare',
    does: 'Every change you make in this session is listed here, newest first, with the time and a plain description. On any entry you can press Go back to before this (everything goes back to just before it; the later entries stay in the list, greyed out, so you can come forward again with Go forward to here), or Take back just this (only that change is taken back and the ones made after it are kept). If a later change touched the same thing, that later change is kept and you are told. Undo one step, Redo one step and Back to the start are at the top, and a "You are here" line shows where you are. A slider you drag is one entry, not dozens.',
    notes: 'The history is for this session only: it starts again when you load another page or reload. Saving a page keeps its changes, but not the step-by-step history. Making a new change after going back drops the entries you went back over.' },
  { id: 'source', label: 'HTML source', group: 'Check and compare',
    does: 'Shows the page\'s HTML laid out so it can be read (a live page usually comes on one long line). Along the top choose As fetched (exactly what the website sent, before anything was cleaned), Cleaned page (what the editor works on, with scripts removed), With your changes (the page with your CSS built in), Page CSS (all its style files joined) or Your changes (CSS). Show only lines containing… filters to the lines that mention something (the line numbers stay as in the whole source), Wrap lines avoids sideways scrolling, and Copy and Download save what you are reading. The page stays loaded behind it.',
    notes: 'It is for reading, not editing. As fetched is only there for a page loaded by its address, an upload or a paste, not for a saved page opened later. Very large pages show the first 10000 lines (use the filter, or download the whole thing) and as fetched is cut at 2 MB.' },
  { id: 'undo', label: 'Undo and redo', group: 'Check and compare',
    does: 'The Undo last change and Redo buttons above the preview step back and forward through the history of this session one action at a time. A change to many items at once, or a plain-English request with several changes, is one action, so one click undoes all of it. Changing a brand colour or font is part of the history too.',
    notes: 'For going back further, or taking back one change from the middle, use History of this session.' },
  { id: 'checks', label: 'Accessibility checks', group: 'Check and compare',
    does: 'Press Check the page and it looks over every piece of text and every picture for the three most common problems: text that is hard to read against its background, pictures with no description for screen readers, and tiny text. Click a problem in the list and it is selected in the preview and scrolled into view, so you can fix it.',
    notes: 'It checks the preview as it looks right now, so run it again after fixing things. It is a quick check, not a full audit of the page.' },

  // ---- Keep and share ----
  { id: 'export', label: 'Export the CSS', group: 'Keep and share',
    does: 'Gives you the finished work. The CSS box shows every change written as ordinary styles, with your brand colours at the top and the small-screen rules after the others. Copy the CSS and paste it where your site takes extra styles (WordPress: Appearance, Customize, Additional CSS; Shopify, Squarespace and most site builders have a custom CSS box too). Also: Download .css, Download the page (the whole page with the changes built in) and Download a report (a plain list of every change and where, for a developer). A tick box makes the styles win over the page\'s own; leave it on unless your site already puts yours last.',
    notes: 'The tool cannot change the live website itself: it gives you the CSS to put there. Available once a preview is built.' },
  { id: 'saved', label: 'My saved pages', group: 'Keep and share',
    does: 'Type a name and press Save this page to keep the page with all your changes, brand colours and style files. When a saved page is open, Update replaces it in place (the old version goes into Page history) and Save as a new page makes a separate copy under a new name. Click a saved page to open it, or the cross to delete it.',
    notes: 'Saved to your Vault account, so it works on any device. You need a built preview first.' },
  { id: 'history', label: 'Page history', group: 'Keep and share',
    does: 'Each time you Update a saved page, the version it replaced is kept. Page history lists them, newest first (the last 20), with the date. Open puts an earlier version in the editor, after a Yes/No check; press Update in My saved pages to make it the saved page again.',
    notes: 'Needs a saved page open. A page saved for the first time has no history yet.' },
  { id: 'share', label: 'Share a preview', group: 'Keep and share',
    does: 'Make a preview link: a link anyone can open, with no Vault login, to see the saved page with your changes. They can switch between your version and the original. Copy the link to send it; Stop sharing turns it off and the old link stops working at once.',
    notes: 'The link shows the page as it was last saved, so press Update in My saved pages after more changes. It is read-only, nothing on it can run, and search engines are asked not to list it. Needs a saved page.' },
];

const RULES = [
  'The tool\'s job is to restyle a page you already have and hand over the CSS to paste into the real site. The usual order: load the page (Your page, best of all by its web address), click something in the preview, change it, check it, then export the CSS.',
  'Change it works on whatever has been clicked in the preview. If nothing is clicked, the change tools ask for a click first.',
  'A change affects only the clicked item unless What it applies to is set to every matching item, which is outlined in amber first. A change is for all screen sizes and the normal look unless the screen size or look is chosen in What it applies to.',
  'Changes are kept as a list, not written into the page. The preview, the exported CSS, Changes so far and the shared preview all come from that one list, so what you see is what you export.',
  'Plain English changes are made by an AI model, but only to the look of an item, from a fixed list: font, size, weight, colour, line spacing, background, rounded corners, space around, shadow, capitals, letter spacing, alignment and the six animations.',
  'Every change made in a session is kept as a step in History of this session: the person can go back to any point and forward again, or take back one change and keep the later ones. That history is for the session only.',
  'Brand colours and fonts are set once in Brand colours and fonts; any change that uses one follows it if it is changed later.',
  'The CSS is exported for the person to paste into their own site. The tool does not change the live website.',
  'Save this page keeps the page and all its changes in the account; Update replaces a saved page and keeps the old version in Page history; Share a preview makes a link anyone can open to see the saved page.',
  'The Open buttons in this chat only switch to a tool; they never change, save or download anything by themselves.',
];

const NOT_POSSIBLE = [
  'Changing the live website itself, or publishing to it. The tool gives you CSS to paste into your site\'s own custom CSS box (or to hand to a developer); it cannot log in to your site or edit it.',
  'Keeping the step-by-step history after the page is reloaded or another page is loaded: it is for the current session only (the saved page keeps its changes and its earlier saved versions).',
  'Downloading a page\'s pictures, scripts or the page itself with Download a page\'s CSS: it fetches the style files and a summary of their settings only.',
  'Loading pages behind a sign-in, a paywall or a bot check. Save the page from your browser and upload it instead.',
  'Changing the words, the pictures or the layout structure of the page, or adding and removing items. It changes the look of the items already there.',
  'Running the page\'s own scripts in the preview: menus, sliders and anything else that needs them will not work there. A page that builds itself with JavaScript can be loaded with the browser option, but the preview is still a still copy.',
  'Loading style files that other style files pull in, or fonts held on other websites; the preview may then look a little different from the live page.',
  'Editing the page\'s own style code directly: there is no code editor, only the controls, Brand colours and fonts, and the plain English box.',
  'Showing every possible device or browser: there are three preview sizes, and checking in every browser is up to the person.',
  'A full accessibility audit: Accessibility checks looks only for text that is hard to read, pictures with no description and tiny text.',
];

const SYSTEM = `You are the guide to the CSS tool in Vault for one person who wants to restyle a page they already have, without writing code, and take the CSS away to paste into their real site. They say, in everyday words, what they want to do. You point them to the right tool(s) and buttons, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say the tool cannot do.
- You cannot see their page. Never state or guess what is on it.
- Use plain words, as to a friend who has never written code. Say "the space around it", "the rounded corners", "style files", never code words such as padding, border-radius, selector, class, stylesheet or cascade. "CSS" itself is fine: it is the name of the tool and of what they take away.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Keep to the tool's job. The usual order is: load the page, build the preview, click something in it, change it, check it, export the CSS. If they only want the CSS or the design settings (colours, fonts, sizes) of a live page, that is Download a page's CSS, with no editing needed. If they want to go back on something they did, that is History of this session (or Undo and redo for one step). If they want the result on their website, the answer is Export the CSS and pasting it into their site's custom CSS box; the tool cannot publish it.
- If they ask for something that is not a change to how things look (new words, a new menu, a different layout, editing the live site, a page behind a sign-in), say plainly it is not possible here and say what they could do instead.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'CSS guide', feature: 'restyle_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'CSS TOOLS AND BUTTONS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your page, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askRestyleTutor: guide.ask,
};
