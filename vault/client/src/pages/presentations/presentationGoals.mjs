// The "What do you want to do?" screen for Presentations (shared screen: components/JobStart.jsx).
// Each job is DATA: a title and ordered steps, each naming a real tool id from toolRegistry.js.
//
//   node client/src/pages/presentations/presentationGoals.test.mjs

export const PRESENTATION_GOALS = [
  {
    id: 'brief',
    title: 'Make a deck from a brief',
    blurb: 'Write what you want to say, then edit the slides and export.',
    icon: 'sparkles',
    steps: [
      { tool: 'create', note: 'Describe the deck and generate the first version.' },
      { tool: 'slides', note: 'Check the words, pictures and slide order.' },
      { tool: 'export', note: 'Download a PPTX, PDF, HTML preview or PNGs.' },
    ],
  },
  {
    id: 'document',
    title: 'Turn a document into slides',
    blurb: 'Bring in a file or web page, then build the deck from its text.',
    icon: 'file-text',
    steps: [
      { tool: 'import', note: 'Import a PDF, DOCX, TXT/MD, web URL or images.' },
      { tool: 'create', note: 'Turn the extracted text into a slide deck.' },
      { tool: 'slides', note: 'Tidy up the slides before you share them.' },
      { tool: 'export', note: 'Choose the file format and download.' },
    ],
  },
  {
    id: 'brand',
    title: 'Make a deck in my brand',
    blurb: 'Pick or import a theme, apply the Brand Kit, then make the deck.',
    icon: 'palette',
    steps: [
      { tool: 'templates', note: 'Choose a theme or import one from PowerPoint.' },
      { tool: 'create', note: 'Write the brief and generate the deck in that theme.' },
      { tool: 'slides', note: 'Edit the words and pictures until they sound right.' },
      { tool: 'export', note: 'Export an editable, branded deck.' },
    ],
  },
  {
    id: 'saved',
    title: 'Reopen a saved deck',
    blurb: 'Pick up a deck from your library, edit it, and export it again.',
    icon: 'library',
    steps: [
      { tool: 'decks', note: 'Open a saved or recently viewed deck.' },
      { tool: 'slides', note: 'Make the changes you need.' },
      { tool: 'export', note: 'Save out the updated version.' },
    ],
  },
];

/** Index of `toolId` among the goal's steps, or -1 (same helper as Graphics/Video). */
export function stepIndex(goal, toolId) {
  return goal ? goal.steps.findIndex((s) => s.tool === toolId) : -1;
}
