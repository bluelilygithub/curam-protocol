// What Presentations is made of, the plain-words help for it, and what its guide can point at.
// Used by client/src/pages/PresentationsPage.jsx (the ToolSidebar list, the line under each tool, the (i) boxes) and checked against
// the guide's catalogue (server/services/presentationsTutor.js) by node server/services/presentationsTutor.test.js.
// The start-screen jobs live in presentationGoals.mjs and name these ids.

export const PRESENTATIONS_TOOLS = [
  { id: 'create', label: 'Create deck', group: 'Make', icon: 'sparkles' },
  { id: 'import', label: 'Import source', group: 'Make', icon: 'file-up' },
  { id: 'templates', label: 'Themes', group: 'Design', icon: 'palette' },
  { id: 'slides', label: 'Slide editor', group: 'Design', icon: 'pen-line' },
  { id: 'export', label: 'Export', group: 'Finish', icon: 'download' },
  { id: 'decks', label: 'My decks', group: 'Library', icon: 'folder-open' },
];

export const GROUPS = ['Make', 'Design', 'Finish', 'Library'];

export const GROUP_TIPS = {
  Make: 'Start a deck: from a written brief, or from a document, web page or pictures.',
  Design: 'Choose how the deck looks, then edit its words and pictures.',
  Finish: 'Make the finished files: editable PowerPoint, PDF, HTML preview or PNGs.',
  Library: 'Decks saved on the server and decks recently opened on this device.',
};

// The hover tips on the tool list.
export const TOOL_TIPS = {
  create: 'Write a short brief and make a slide deck from it, using the theme you chose. Runs in the background; you can edit the result afterwards.',
  import: 'Pull the text and pictures out of a PDF, Word document, text file, web page or images, ready to make into slides.',
  templates: 'Pick a built-in theme, save your own, import colours and fonts from a PowerPoint theme, or apply your Brand Kit on top.',
  slides: 'Change the words, pictures and order of the slides. Everything is kept in one deck so the preview and exports stay in step.',
  export: 'Download the deck as an editable PPTX, a PDF, an HTML preview or one PNG per slide.',
  decks: 'Open decks you saved, duplicate or delete them, and see decks you opened recently on this device.',
};

// The line under the job bar when a tool is open.
export const TOOL_BLURBS = {
  create: 'A brief in plain words is enough. Add imported text or pictures if you have them.',
  import: 'Up to 10 files at once, or one web page. The extracted text is editable before you use it.',
  templates: 'The theme sets colours, font and title size. Your Brand Kit can be laid over the top.',
  slides: 'Edit the words, pictures and order of the slides. The preview and every export use this one deck.',
  export: 'PPTX keeps the words editable; PDF, HTML and PNGs render from the same preview.',
  decks: 'Saved decks live on the server. Recent decks are an opt-in list kept only in this browser.',
};

// The (?) box next to each tool's heading.
export const TOOL_HELP = {
  create: {
    what: 'Give Vault a brief in plain language and it writes a short outline, then fills it out as slides.',
    features: [
      '6–12 slides by default, with a 20-slide maximum',
      'Uses the workspace models configured by your admin, not a hard-coded provider',
      'Works from a brief alone, or from text and images brought in by Import source',
      'Runs in the background with progress, Cancel and Resume',
      'The finished deck opens in the slide editor; nothing is exported until you ask',
    ],
  },
  import: {
    what: 'Turn documents, web pages and pictures into source material for a deck.',
    features: [
      'PDF, DOCX, TXT/MD, .pptx/.potx and images, up to 10 files at once',
      'Or paste a web page address to fetch its text safely on the server',
      'Extracted text appears in an editable box before you use it',
      'Images become references the slide editor and preview can show directly',
      'Files handed over from another Vault tool are picked up automatically',
    ],
  },
  templates: {
    what: 'Choose the look of the deck before you generate it, or save your own theme.',
    features: [
      'Six built-in themes: Paper, Ink, Warm, Ocean, Forest and Mono',
      'Save a theme with your own colours, font and title size',
      'Importing a .pptx/.potx takes its colours and fonts, not its PowerPoint masters',
      'Brand Kit is an override on top of the chosen theme',
      'The current deck is previewed so you can see the effect',
    ],
  },
  slides: {
    what: 'Make the deck say what you want, then save it.',
    features: [
      'Edit the deck title, subtitle and each slide’s title, body, bullets, image and notes',
      'Use one of five layouts: Title, Bullets, Two column, Picture or Closing',
      'Add, delete and reorder slides, up to the server’s slide limit',
      'The live preview uses the same renderer as PDF and PNG export',
      'Save to My decks, or hand the deck to another tool with Use in…',
    ],
  },
  export: {
    what: 'Make the finished files from the current deck.',
    features: [
      'PPTX keeps text as editable text boxes',
      'PDF and per-slide PNGs render from the same HTML as the preview',
      'HTML preview is a single self-contained file',
      'Apply the Brand Kit override at export time if you want it',
      'Long exports run in the background with progress and Cancel',
    ],
  },
  decks: {
    what: 'Find a deck again and manage your library.',
    features: [
      'Open a saved deck straight into the slide editor',
      'Duplicate a deck before trying a big change',
      'Deleted decks go to the recycle bin for 30 days',
      'Recent decks on this device are opt-in browser history, not a backup',
    ],
  },
};

// The (i) "How Presentations works" box.
export const HOW_IT_WORKS = [
  ['Make', 'Create deck writes a short outline and turns it into slides from a brief. Import source pulls text and pictures from documents, web pages and images.'],
  ['Design', 'Themes picks a look (or brings one from PowerPoint, or from your Brand Kit). Slide editor changes the words, pictures and slide order.'],
  ['Finish', 'Export makes an editable PPTX, a PDF, an HTML preview or per-slide PNGs.'],
  ['Library', 'My decks reopens, duplicates and deletes saved decks; opt-in recent decks are kept in this browser only.'],
  ['One deck', 'There is one deck model behind the preview and every export, so they do not drift apart. Long jobs run in the background with progress, Cancel and Resume.'],
];

// Everything the guide's Open buttons can show: the six tools. `tool` is the tool the button opens.
export const GUIDE_TOOLS = PRESENTATIONS_TOOLS.map(({ id, label }) => ({ id, label, tool: id }));

export const labelFor = (id) => PRESENTATIONS_TOOLS.find((t) => t.id === id)?.label || id;
