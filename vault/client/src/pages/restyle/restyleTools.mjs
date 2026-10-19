// What the CSS page (internal name "restyle") shows in its left-hand list, the hover text for it, and the controls its guide (the round
// button) can point at. The ids are the guide's catalogue (server/services/restyleTutor.js); npm run test:restyle-tutor fails if the two
// lists drift apart. `tool` is the tool the guide's Open button switches to. No CSS jargon in any wording here (see docs/restyle.md).
//
// The tool's job: bring in a page (best of all a live one by its address), change how it looks by clicking and asking, check it, and
// take the CSS away to paste into the real site. `needs` says what a tool waits for: 'selection' (something clicked in the preview),
// 'preview' (a built preview) or 'saved' (a page saved to the account).

export const RESTYLE_TOOLS = [
  { id: 'page', label: 'Your page', group: 'Your page', icon: 'globe' },
  { id: 'styles', label: 'Style files', group: 'Your page', icon: 'palette' },
  { id: 'scrape', label: "Download a page's CSS", group: 'Your page', icon: 'download' },
  { id: 'ask', label: 'Ask in plain English', group: 'Change it', icon: 'sparkles', needs: 'selection' },
  { id: 'scope', label: 'What it applies to', group: 'Change it', icon: 'mouse-pointer', needs: 'selection' },
  { id: 'text', label: 'Text', group: 'Change it', icon: 'type', needs: 'selection' },
  { id: 'enhance', label: 'Text enhancements', group: 'Change it', icon: 'text', needs: 'selection' },
  { id: 'animation', label: 'Animation', group: 'Change it', icon: 'play', needs: 'selection' },
  { id: 'box', label: 'Box', group: 'Change it', icon: 'layout-grid', needs: 'selection' },
  { id: 'brand', label: 'Brand colours and fonts', group: 'Change it', icon: 'swatch' },
  { id: 'changes', label: 'Changes so far', group: 'Check and compare', icon: 'list-checks' },
  { id: 'session', label: 'History of this session', group: 'Check and compare', icon: 'history' },
  { id: 'checks', label: 'Accessibility checks', group: 'Check and compare', icon: 'shield-check', needs: 'preview' },
  { id: 'export', label: 'Export the CSS', group: 'Keep and share', icon: 'download', needs: 'preview' },
  { id: 'saved', label: 'My saved pages', group: 'Keep and share', icon: 'folder-open' },
  { id: 'history', label: 'Page history', group: 'Keep and share', icon: 'archive', needs: 'saved' },
  { id: 'share', label: 'Share a preview', group: 'Keep and share', icon: 'share-2', needs: 'saved' },
];

export const GROUPS = ['Your page', 'Change it', 'Check and compare', 'Keep and share'];

export const GROUP_TIPS = {
  'Your page': 'Bring in the page you want to restyle: load a live page by its address, upload a file or paste it in, add any style files, or just download the CSS of any live page.',
  'Change it': 'Click something in the preview, then change it: ask in plain English, use the controls, or set brand colours and fonts once and use them everywhere.',
  'Check and compare': 'See every change made so far, go back to any point in your session, flip between the original and your version, and check the page can be read by everyone.',
  'Keep and share': 'Take the CSS away to paste into the real site, save the page, go back to an earlier version, or send a client a link to see it.',
};

export const TOOL_TIPS = {
  page: 'Load a live page by its web address, or upload an .html file, or paste the page in. Or load a demo to practise.',
  styles: 'Add the style files that make the page look the way it does (a live page brings its own), put them in order, then build the preview.',
  ask: 'Click something in the preview, then describe the change in your own words, by typing or talking.',
  scrape: 'Type the address of any live page and download the style files it depends on, with a summary of its colours, fonts, sizes and other settings.',
  scope: 'Choose whether a change affects only the thing you clicked or every matching thing, on which screen sizes, and for the mouse-over or selected look. Reset what you changed.',
  text: 'Change the font, size, weight, colour and line spacing of what you clicked, and see if the text is easy enough to read.',
  enhance: 'Capitals, space between letters and alignment for what you clicked.',
  animation: 'Make what you clicked fade in, slide up, pop in, pulse or bounce.',
  box: 'Change the background colour, rounded corners, space around the content and shadow of what you clicked.',
  brand: 'Set your brand colours and fonts once, use them on any change, and apply them across the whole page in one go.',
  changes: 'Every change made so far, in plain words, with what it was before. Take any of them back.',
  session: 'Every change in this session, in order. Go back to any point, go forward again, or take back just one change and keep the rest.',
  checks: 'Look over the whole page for text that is hard to read, pictures with no description and tiny text. Click a problem to jump to it.',
  export: 'Get the finished CSS to paste into your real site (WordPress, Shopify, Squarespace and so on), the whole page as a file, or a report for a developer.',
  saved: 'Save the page with all your changes to your account, update it later, or open one you saved before.',
  history: 'Each time you update a saved page, the old version is kept. Open any earlier version to go back to it.',
  share: 'Make a link a client can open without a Vault login to see the page with your changes, and turn it off whenever you like.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  page: 'Start here: load the page you want to restyle, ideally a live one by its address.',
  styles: 'Add style files, set their order, and build the preview.',
  ask: 'Click something in the preview, then say what you want changed.',
  scrape: 'Get the CSS a live page uses, and a summary of its settings.',
  scope: 'Pick how far a change reaches, on which screens, and for which look.',
  text: 'Change how the text of the clicked item looks.',
  enhance: 'Finer touches for text: capitals, spacing and alignment.',
  animation: 'Give the clicked item a bit of movement.',
  box: 'Change the box around the clicked item.',
  brand: 'Brand colours and fonts, set once and used everywhere.',
  changes: 'Everything you have changed so far.',
  session: 'Go back to any point in this session, or take back one change.',
  checks: 'Check the page can be read by everyone.',
  export: 'Take the CSS away and put it on your real site.',
  saved: 'Save this page with all your changes, or open one you saved earlier.',
  history: 'Go back to an earlier version of a saved page.',
  share: 'Let a client see your version without logging in.',
};

// The longer text for the (i) "How CSS works" box.
export const HOW_IT_WORKS = [
  ['The job', 'Restyle a page you already have, without writing code, then take the CSS away and paste it into the real site. Load the page, click things and change them, check the result, export the CSS.'],
  ['Your page', 'Type the address of a live page and it is loaded with its own style files and pictures. If the page builds itself with JavaScript (many shops and apps do), tick the box for that and it is loaded in a browser first. You can also upload an .html file or paste the page in. Anything that could run code is removed, so the preview is a safe still copy.'],
  ['Download a page\'s CSS', 'Type the address of any live page and get the style files it depends on (linked, imported, and written inside the page), each with its addresses made complete so it works on its own, as a .zip, one combined .css, or one at a time. You also get a summary of the colours, fonts, text sizes, spacing, rounded corners, shadows, variables, screen-size breakpoints and font files it sets, as a report or as data. From there you can load the page into the editor, or use its colours as brand colours.'],
  ['Change it', 'Click anything in the preview and it is outlined. Ask in plain English ("make this bigger and give it rounded corners") or use Text, Text enhancements, Animation and Box. A change can reach just what you clicked or every matching item, on all screens, tablets and smaller, or phones only, and for the normal look or the mouse-over or selected look. The Desktop, Tablet and Phone buttons above the preview show the page at those widths.'],
  ['Brand colours and fonts', 'Set your colours and fonts once. Use them on any change, or apply one across the page (all headings, all links, all buttons). Change a brand colour later and everything that uses it follows.'],
  ['History of this session', 'Every change you make is listed, newest first. Go back to any point (and forward again), or take back just one change and keep the ones made after it. If a later change touched the same thing, that later one is kept. It starts again when you load another page or reload.'],
  ['Check and compare', 'Changes so far lists everything you changed with what it was before. The Original / With changes switch above the preview shows the page before and after. Accessibility checks finds text that is hard to read, pictures with no description and tiny text.'],
  ['Export the CSS', 'Copy or download the CSS, and paste it where your site takes extra styles (WordPress: Appearance, Customize, Additional CSS; Shopify and Squarespace have a custom CSS box too). Or download the whole page, or a plain report of every change for a developer. The CSS is written to win over the page\'s own styles; you can switch that off.'],
  ['Save, history and sharing', 'Saving keeps the page and all your changes in your account. Update changes the saved page in place and keeps the old version in its history. Share a preview makes a link a client can open without logging in; it shows the page as last saved, and you can turn it off at any time.'],
  ['What it cannot do', 'It changes the look of a page, not its words, pictures or layout structure. The page\'s own scripts do not run in the preview, so menus and sliders that need them will not work. It does not log in to a page for you, so pages behind a sign-in cannot be loaded; save the page from your browser and upload it instead.'],
];

// Everything the guide can point at: the tools plus the buttons and boxes inside and around them.
export const GUIDE_TOOLS = [
  { id: 'page', label: 'Your page', tool: 'page' },
  { id: 'load-address', label: 'Load a page by its address', tool: 'page' },
  { id: 'demo', label: 'Load a demo', tool: 'page' },
  { id: 'styles', label: 'Style files', tool: 'styles' },
  { id: 'build-preview', label: 'Build the preview', tool: 'styles' },
  { id: 'scrape', label: "Download a page's CSS", tool: 'scrape' },
  { id: 'select', label: 'Click in the preview', tool: 'ask' },
  { id: 'device', label: 'Preview sizes', tool: 'ask' },
  { id: 'ask', label: 'Ask in plain English', tool: 'ask' },
  { id: 'scope', label: 'What it applies to', tool: 'scope' },
  { id: 'screen-and-look', label: 'Screen sizes and mouse-over look', tool: 'scope' },
  { id: 'text', label: 'Text', tool: 'text' },
  { id: 'enhance', label: 'Text enhancements', tool: 'enhance' },
  { id: 'animation', label: 'Animation', tool: 'animation' },
  { id: 'box', label: 'Box', tool: 'box' },
  { id: 'brand', label: 'Brand colours and fonts', tool: 'brand' },
  { id: 'changes', label: 'Changes so far', tool: 'changes' },
  { id: 'compare', label: 'Original or with changes', tool: 'changes' },
  { id: 'session', label: 'History of this session', tool: 'session' },
  { id: 'undo', label: 'Undo and redo', tool: 'session' },
  { id: 'checks', label: 'Accessibility checks', tool: 'checks' },
  { id: 'export', label: 'Export the CSS', tool: 'export' },
  { id: 'saved', label: 'My saved pages', tool: 'saved' },
  { id: 'history', label: 'Page history', tool: 'history' },
  { id: 'share', label: 'Share a preview', tool: 'share' },
];
