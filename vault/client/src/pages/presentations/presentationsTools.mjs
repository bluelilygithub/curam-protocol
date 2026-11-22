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
  Finish: 'Make the finished files: editable PowerPoint, PDF, HTML preview or PNGs. Notes travel with every format.',
  Library: 'Decks saved on the server and decks recently opened on this device.',
};

// The hover tips on the tool list.
export const TOOL_TIPS = {
  create: 'Write a brief, set the audience, tone, length and slide count, and optionally review the outline first. Low-cost AI placeholder pictures can be added as the deck is made.',
  import: 'Pull text and pictures from a PDF, Word document, text file, web page or images. A .pptx/.potx file opens straight into the slide editor as an editable deck.',
  templates: 'Pick a design (how slides are laid out and decorated) and a colour theme. Save your own colours, import them from PowerPoint, or apply your Brand Kit on top.',
  slides: 'Change the words, pictures, layout and order of the slides. Generate and preview AI pictures before inserting them, add shapes, charts, tables and inline formatting, rewrite one slide, and undo or redo edits. Presenter view shows notes, the next slide and a timer.',
  export: 'Download the deck as an editable PPTX with speaker notes, a PDF with notes pages, an HTML preview or a zip of PNGs with notes.txt. Finished files can be downloaded again.',
  decks: 'Open saved decks, duplicate or delete them, roll back to a saved version (including autosaves), re-download exports, and see decks opened recently on this device.',
};

// The line under the job bar when a tool is open.
export const TOOL_BLURBS = {
  create: 'A brief in plain words is enough. Add audience, tone, length and slide count, or review the outline before the deck is written.',
  import: 'Up to 10 files at once, or one web page. Extracted text is editable; PowerPoint files become editable slides.',
  templates: 'A design lays out and decorates every slide; a colour theme sets colours, font and title size. Your Brand Kit can be laid over the top.',
  slides: 'Edit words, pictures, shapes, charts, tables and notes. Undo or redo with the buttons or Ctrl+Z outside a text field, then press Present for the full-screen show.',
  export: 'PPTX keeps the words editable with speaker notes; PDF, HTML and PNGs render from the same preview and include notes pages.',
  decks: 'Saved decks live on the server with version history and re-downloadable exports. Recent decks are an opt-in browser-only list.',
};

// The (?) box next to each tool's heading.
export const TOOL_HELP = {
  create: {
    what: 'Give Vault a brief in plain language and it plans a slide-by-slide outline, then fills it out as slides.',
    features: [
      'Choose the audience, tone, talk length and slide count (6 to 20) before generating',
      'Review outline first lets you edit headings, points, picture ideas and notes before the deck is written',
      'Optionally add a few small, low-cost AI placeholder pictures as the deck is made; a missing image provider never blocks the deck',
      'Uses the workspace models configured by your admin, not a hard-coded provider',
      'Works from a brief alone, or from text and images brought in by Import source',
      'Runs in the background with progress, Cancel and Resume',
    ],
  },
  import: {
    what: 'Turn documents, web pages and pictures into source material for a deck.',
    features: [
      'PDF, DOCX, TXT/MD, .pptx/.potx and images, up to 10 files at once',
      'PowerPoint files are parsed into real slides with text, notes, tables and pictures, then opened in the editor',
      'Or paste a web page address to fetch its text safely on the server',
      'Extracted text appears in an editable box before you use it',
      'Files handed over from another Vault tool are picked up automatically',
    ],
  },
  templates: {
    what: 'Choose the look of the deck: a design for the layout and decoration, and a colour theme.',
    features: [
      'Eight designs: Clean, Underline, Banded, Sidebar, Split, Framed, Bold and Corner, each shown on sample slides',
      'Six built-in colour themes: Paper, Ink, Warm, Ocean, Forest and Mono; any design works with any colours',
      'Save a theme with your own colours, font and title size',
      'Importing a .pptx/.potx takes its colours and fonts; slides themselves open in the editor as editable deck slides',

      'Brand Kit is an override on top of the chosen theme',
      'The current deck is previewed so you can see the effect',
    ],
  },
  slides: {
    what: 'Make the deck say what you want, then save it.',
    features: [
      'Edit the deck title, subtitle, aspect and each slide’s title, body, bullets, image and notes',
      'Thirteen layouts: Title, Section header, Bullets, Agenda, Two column, Comparison, Three columns, Big numbers, Quote, Timeline, Picture, Full picture and Closing',
      'Comparison, Three columns and Big numbers have their own column boxes',
      'Undo and redo with the buttons or Ctrl+Z / Ctrl+Shift+Z outside a text field; duplicate, add, delete and reorder slides',
      'Add extra pictures and shapes, bar/line/pie charts, tables, slide backgrounds and inline bold/italic/underline formatting',
      'Ask the model to rewrite one slide in place, or describe a small AI picture and generate one',
      'Generated AI pictures wait in a tray: preview each one, then Add to slide or Use as slide picture. Pictures added automatically with a new deck or slide can be previewed and promoted here too',
      'The live preview uses the same renderer as PDF and PNG export',
      'Present plays the deck full screen: arrow keys, Space and Page Up/Down move, type a number and press Enter to jump, Escape ends the show',
      'Presenter view (V) shows speaker notes, the next slide and a pauseable timer that can be reset',
      'Choose a transition between slides: None, Fade, Push, Wipe or Zoom. It is saved with the deck',
      'Save to My decks, or hand the deck to another tool with Use in…',
    ],
  },
  export: {
    what: 'Make the finished files from the current deck.',
    features: [
      'PPTX keeps text as editable text boxes and carries speaker notes; it is a real PowerPoint file you can import again',
      'PDF and per-slide PNGs render from the same HTML as the preview and include notes pages; the PNG zip also has notes.txt',
      'HTML preview is a single self-contained file with slides and notes pages',
      'Finished downloads are saved against the deck so you can re-download them later',
      'Apply the Brand Kit override at export time if you want it; its font is embedded in HTML/PDF/PNG and its family is used in PPTX',
      'Long exports run in the background with progress and Cancel',
    ],
  },
  decks: {
    what: 'Find a deck again and manage your library.',
    features: [
      'Open a saved deck straight into the slide editor',
      'Saved decks autosave after edits; the last 30 states are kept as versions you can roll back to',
      'Duplicate a deck before trying a big change',
      'See and re-download exports made for each saved deck',
      'Deleted decks go to the recycle bin for 30 days',
      'Recent decks on this device are opt-in browser history, not a backup',
    ],
  },
};

// The (i) "How Presentations works" box.
export const HOW_IT_WORKS = [
  ['Make', 'Create deck plans an editable outline and turns it into slides from a brief, with optional low-cost placeholder pictures. Import source pulls text, notes, slides and pictures from documents, PowerPoint files, web pages and images.'],
  ['Design', 'Themes picks a design (bands, panels, frames, accents) and a colour theme, or brings colours from PowerPoint or your Brand Kit. Slide editor changes words, pictures, shapes, charts, tables, layout and order, with undo and redo.'],
  ['Finish', 'Export makes an editable PPTX, a PDF, an HTML preview or per-slide PNGs. Speaker notes go into every format. Presenter view shows notes, the next slide and a timer.'],
  ['Library', 'My decks reopens, duplicates, restores and deletes saved decks, and re-downloads exports; opt-in recent decks are kept in this browser only.'],
  ['One deck', 'There is one canonical deck model behind the browser edits, preview and every export, so they do not drift apart. Long jobs run in the background with progress, Cancel and Resume.'],
];

// Everything the guide's Open buttons can show: the six tools. `tool` is the tool the button opens.
export const GUIDE_TOOLS = PRESENTATIONS_TOOLS.map(({ id, label }) => ({ id, label, tool: id }));

export const labelFor = (id) => PRESENTATIONS_TOOLS.find((t) => t.id === id)?.label || id;
