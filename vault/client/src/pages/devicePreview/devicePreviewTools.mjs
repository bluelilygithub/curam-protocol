// What the Device preview page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids
// are the guide's catalogue (server/services/devicePreviewTutor.js); npm run test:device-preview-tutor fails if the two lists drift apart.
// The page has no tool menu, so the "tools" below are its areas (Countries is a view of its own, opened by the Screens / Countries switch): `tool` on a guide entry says which area its Open button scrolls
// to (the page marks each area with data-guide="show" / "choose-screens" / "turn").

export const DEVICE_PREVIEW_TOOLS = [
  { id: 'show', label: 'Show the page', group: 'Show a page', icon: 'search' },
  { id: 'choose-screens', label: 'Choose screens', group: 'Choose screens', icon: 'smartphone' },
  { id: 'turn', label: 'How to view', group: 'Choose screens', icon: 'layout-grid' },
  { id: 'countries', label: 'Countries', group: 'Countries', icon: 'globe' },
];

export const GROUPS = ['Show a page', 'Choose screens', 'Countries'];

export const GROUP_TIPS = {
  'Show a page': 'Type the address of a public web page and load it.',
  'Choose screens': 'Pick which phones, tablets and monitors to show it on, and how to look at them.',
  Countries: 'See the page as visitors in other countries see it (when Countries is switched on for you).',
};

export const TOOL_TIPS = {
  show: 'The address box and the Show the page button.',
  'choose-screens': 'Real phone, tablet and monitor sizes to choose from, or a size of your own. Up to four at once.',
  turn: 'Turn phones and tablets on their side, and choose how big each one is drawn.',
  countries: 'The Countries view: the page captured from up to twelve countries, with what differs between them.',
};

export const TOOL_BLURBS = {
  show: 'Type an address and load the page.',
  'choose-screens': 'Phones, tablets, monitors or your own size.',
  turn: 'Upright or on its side, and how big.',
  countries: 'The page as other countries see it.',
};

// The longer text for the (i) "How Device preview works" box.
export const HOW_IT_WORKS = [
  ['Type the address', 'Type the address of a public page and press Show the page. The page and its style files are loaded for you.'],
  ['Choose screens', "Tap up to four phones, tablets or monitors, or add a width and height of your own. They appear side by side, each as wide as that screen, so the page changes shape the way it does on that device."],
  ['Compare', 'Turn phones and tablets on their side, or change how big each one is drawn (Fit shrinks them to fit the page).'],
  ['Countries', 'When it is switched on for you, Countries shows the page as visitors in other countries see it: each country is opened through an internet connection there, pictures are taken on the screens you choose, and a plain list says what differs. Checks are saved.'],
  ['What it cannot do', "Sizes are the screen's width and height in CSS pixels, so treat the height as close, not exact. The page is shown without its scripts (menus that open and sliders will not work), and pages that need a login cannot be loaded. It only looks: to change a page's styling, use the Style editor."],
];

// Everything the guide can point at: the three areas plus the controls inside them. `tool` is the area the Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'address', label: 'Address box', tool: 'show' },
  { id: 'script-option', label: 'Builds itself with JavaScript', tool: 'show' },
  { id: 'show', label: 'Show the page', tool: 'show' },
  { id: 'choose-screens', label: 'Choose screens', tool: 'choose-screens' },
  { id: 'own-size', label: 'Your own size', tool: 'choose-screens' },
  { id: 'turn', label: 'Turn on its side', tool: 'turn' },
  { id: 'size-on-screen', label: 'Size on screen', tool: 'turn' },
  { id: 'countries', label: 'Screens or Countries', tool: 'countries' },
  { id: 'country-list', label: 'Countries to check', tool: 'countries' },
  { id: 'country-screens', label: 'Screens for the check', tool: 'countries' },
  { id: 'country-start', label: 'Check these countries', tool: 'countries' },
  { id: 'country-results', label: 'Pictures by country', tool: 'countries' },
  { id: 'country-differences', label: 'What differs', tool: 'countries' },
  { id: 'country-summary', label: 'Summarise with AI', tool: 'countries' },
  { id: 'country-saved', label: 'Saved checks', tool: 'countries' },
];
