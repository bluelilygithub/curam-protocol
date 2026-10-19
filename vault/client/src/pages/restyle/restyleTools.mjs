// What the CSS page (internal name "restyle") shows in its left-hand list, the hover text for it, and the controls its guide (the round
// button) can point at. The ids are the guide's catalogue (server/services/restyleTutor.js); npm run test:restyle-tutor fails if the two
// lists drift apart. `tool` is the tool the guide's Open button switches to. No CSS jargon in any wording here (see docs/restyle.md).
// `needsPage` tools show "Build the preview first" until a preview exists; `needsSelection` ones also need something clicked in it.

export const RESTYLE_TOOLS = [
  { id: 'page', label: 'Your page', group: 'Your page', icon: 'file-text' },
  { id: 'styles', label: 'Style files', group: 'Your page', icon: 'palette' },
  { id: 'saved', label: 'My saved pages', group: 'Your page', icon: 'folder-open' },
  { id: 'ask', label: 'Ask in plain English', group: 'Change it', icon: 'sparkles', needsSelection: true },
  { id: 'scope', label: 'What it applies to', group: 'Change it', icon: 'mouse-pointer', needsSelection: true },
  { id: 'text', label: 'Text', group: 'Change it', icon: 'type', needsSelection: true },
  { id: 'enhance', label: 'Text enhancements', group: 'Change it', icon: 'text', needsSelection: true },
  { id: 'animation', label: 'Animation', group: 'Change it', icon: 'play', needsSelection: true },
  { id: 'box', label: 'Box', group: 'Change it', icon: 'layout-grid', needsSelection: true },
];

export const GROUPS = ['Your page', 'Change it'];

export const GROUP_TIPS = {
  'Your page': 'Bring in your page and any style files, build the preview, and keep pages you want to come back to.',
  'Change it': 'Click something in the preview, then change it here: ask in plain English, or use the controls for text, animation and the box around it.',
};

export const TOOL_TIPS = {
  page: 'Bring in your web page: upload an .html file or paste it. Or load a demo page to try things out.',
  styles: 'Add the style files that make your page look the way it does, put them in order, then build the preview.',
  saved: 'Pages you saved earlier, with every change you made. Open one to carry on, or save the page you are working on.',
  ask: 'Click something in the preview, then describe the change in your own words, by typing or talking.',
  scope: 'Choose whether a change affects only the thing you clicked or every matching thing on the page, and reset it.',
  text: 'Change the font, size, weight, colour and line spacing of what you clicked.',
  enhance: 'Capitals, space between letters and alignment for what you clicked.',
  animation: 'Make what you clicked fade in, slide up, pop in, pulse or bounce when the page loads.',
  box: 'Change the background colour, the rounded corners, the space around the content and the shadow of what you clicked.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  page: 'Start with your page. Upload it or paste it in, then add your style files.',
  styles: 'Add your style files, set their order, and build the preview.',
  saved: 'Save this page with all your changes, or open one you saved earlier.',
  ask: 'Click something in the preview, then say what you want changed.',
  scope: 'Pick how far a change should reach.',
  text: 'Change how the text of the clicked item looks.',
  enhance: 'Finer touches for text: capitals, spacing and alignment.',
  animation: 'Give the clicked item a bit of movement.',
  box: 'Change the box around the clicked item.',
};

// The longer text for the (i) "How CSS works" box.
export const HOW_IT_WORKS = [
  ['Your page', 'Upload your page as an .html file, or paste it in. It is cleaned first: anything that could run code is removed. If the page has styles written inside it, they are picked up as a style file for you. "Load a demo" gives you a small page to practise on.'],
  ['Style files', 'Add one or more style files (.css), or paste a snippet. Files lower in the list win when two disagree, so put the most important last. Style files are optional. Press Build the preview when you are ready.'],
  ['Change it', 'Click anything in the preview and it is outlined. Then use Ask in plain English ("make this bigger and give it rounded corners"), or the Text, Text enhancements, Animation and Box tools. If the page already uses a colour, font or size, it is offered as a quick pick.'],
  ['What it applies to', 'By default a change affects only what you clicked. You can choose every matching item instead, such as every card; the matching ones are outlined before you change anything. Reset puts the clicked item back to how the page had it.'],
  ['Undo, save and download', 'Undo last change takes back your last action (a change to forty items is one undo). My saved pages keeps the page with all your changes so you can come back later. Download my page gives you the finished page as one file.'],
  ['What it cannot do', 'It does not run the page\'s own scripts, so menus and sliders that need them will not work in the preview. Pictures held on other websites may not show. It changes the look of a page, not its words or layout structure.'],
];

// Everything the guide can point at: the tools plus the buttons around the preview.
export const GUIDE_TOOLS = [
  { id: 'page', label: 'Your page', tool: 'page' },
  { id: 'demo', label: 'Load a demo', tool: 'page' },
  { id: 'styles', label: 'Style files', tool: 'styles' },
  { id: 'build-preview', label: 'Build the preview', tool: 'styles' },
  { id: 'saved', label: 'My saved pages', tool: 'saved' },
  { id: 'select', label: 'Click in the preview', tool: 'ask' },
  { id: 'ask', label: 'Ask in plain English', tool: 'ask' },
  { id: 'scope', label: 'What it applies to', tool: 'scope' },
  { id: 'text', label: 'Text', tool: 'text' },
  { id: 'enhance', label: 'Text enhancements', tool: 'enhance' },
  { id: 'animation', label: 'Animation', tool: 'animation' },
  { id: 'box', label: 'Box', tool: 'box' },
  { id: 'undo', label: 'Undo last change', tool: 'ask' },
  { id: 'download', label: 'Download my page', tool: 'ask' },
];
