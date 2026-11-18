// The "What do you want to do?" job screen for PDF Tools (shared screen: components/JobStart.jsx). Each job is DATA:
// a title in plain words and ordered steps, each naming a real tool id from MODES in PdfPage.jsx and one line on
// what to do there. A result moves to the next step through "Continue with…" in the result window.
//
//   node client/src/pages/pdf/pdfGoals.test.mjs   (checks every step names a real tool)

export const PDF_GOALS = [
  {
    id: 'scan',
    title: 'Tidy up a scanned document',
    blurb: 'Drop the blank backs, turn pages upright, make the text searchable.',
    icon: 'scan-text',
    steps: [
      { tool: 'removeblank', note: 'Remove the empty backs of scanned sheets.' },
      { tool: 'rotate', note: 'Turn any sideways or upside-down pages the right way up.' },
      { tool: 'ocr', note: 'Add hidden text so the scan can be searched and copied.' },
      { tool: 'compress', note: 'Make the file smaller; scans are often very large.' },
    ],
  },
  {
    id: 'sign',
    title: 'Fill in and sign a form',
    blurb: 'Type the answers, add your signature, lock it so it cannot change.',
    icon: 'pen-tool',
    steps: [
      { tool: 'fill', note: 'Type your answers into the form boxes.' },
      { tool: 'sign', note: 'Draw, type or upload your signature and place it on the page.' },
      { tool: 'flatten', note: 'Fix the answers in place so nobody can edit them.' },
    ],
  },
  {
    id: 'combine',
    title: 'Put several documents into one',
    blurb: 'Turn Word or Excel files into PDFs, join them, number the pages.',
    icon: 'combine',
    steps: [
      { tool: 'officetopdf', note: 'Turn each Word, Excel or PowerPoint file into a PDF.' },
      { tool: 'merge', note: 'Add all the PDFs in the order you want them.' },
      { tool: 'pagenumbers', note: 'Number the pages of the joined document.' },
      { tool: 'compress', note: 'Make the file small enough to email.' },
    ],
  },
  {
    id: 'confidential',
    title: 'Send a confidential document',
    blurb: 'Mark it confidential, then lock it with a password.',
    icon: 'lock',
    steps: [
      { tool: 'watermark', note: 'Stamp CONFIDENTIAL (or your own word) across every page.' },
      { tool: 'protect', note: 'Set a password; send it to the reader separately.' },
    ],
  },
  {
    id: 'edit-words',
    title: 'Change the words in a PDF',
    blurb: 'Turn it into Word, edit it there, turn it back into a PDF.',
    icon: 'file-pen',
    steps: [
      { tool: 'pdftooffice', note: 'Get an editable Word copy, then make your changes in Word.' },
      { tool: 'officetopdf', note: 'Load the edited Word file and turn it back into a PDF.' },
      { tool: 'compare', note: 'Check what changed against the original, if you want.' },
    ],
  },
  {
    id: 'make-form',
    title: 'Make a fillable form',
    blurb: 'Start from Word, add boxes people can type in, check them.',
    icon: 'pen-line',
    steps: [
      { tool: 'officetopdf', note: 'Turn your Word layout into a PDF.' },
      { tool: 'fielddesigner', note: 'Draw text boxes, tick boxes and dropdowns onto the page.' },
      { tool: 'inspect', note: 'Check every box is there and named sensibly.' },
    ],
  },
  {
    id: 'some-pages',
    title: 'Send only some of the pages',
    blurb: 'Pick the pages you need, put them in order, make it small.',
    icon: 'file-stack',
    steps: [
      { tool: 'split', note: 'Pull out the pages you need, such as 1-3,7.' },
      { tool: 'organize', note: 'Reorder, delete or add pages from another PDF.' },
      { tool: 'compress', note: 'Make the file smaller to share.' },
    ],
  },
  {
    id: 'review',
    title: 'Review a new version',
    blurb: 'See what changed between two versions and mark it up.',
    icon: 'columns',
    steps: [
      { tool: 'compare', note: 'Load the old and new versions and see the differences.' },
      { tool: 'annotate', note: 'Highlight, strike out and add notes for the author.' },
    ],
  },
  {
    id: 'report',
    title: 'Finish a report before sending',
    blurb: 'Header and footer, page numbers, proper title, smaller file.',
    icon: 'file-text',
    steps: [
      { tool: 'headerfooter', note: 'Add the title, date and "page x of y" to every page.' },
      { tool: 'metadata', note: 'Set the title and author people see when they open it.' },
      { tool: 'compress', note: 'Make the file small enough to email.' },
    ],
  },
  {
    id: 'handouts',
    title: 'Print handouts',
    blurb: 'Several pages per sheet, trimmed margins, less paper.',
    icon: 'printer',
    steps: [
      { tool: 'crop', note: 'Trim wide margins so the content prints bigger.' },
      { tool: 'nup', note: 'Fit 2, 4, 6 or 9 pages on each sheet.' },
    ],
  },
  {
    id: 'web-page',
    title: 'Put a PDF page on a website',
    blurb: 'Turn a page into a phone-friendly web page with its pictures, ready to upload.',
    icon: 'globe',
    steps: [
      { tool: 'pdftohtml', note: 'Pick the pages, check it at phone width, ask for changes, download the zip.' },
      { tool: 'rotate', note: 'Only if the page came out sideways: turn it upright, then Continue with PDF → HTML.' },
    ],
  },
  {
    id: 'pictures',
    title: 'Get the pictures out',
    blurb: 'Save pages as pictures, or pull out the photos inside.',
    icon: 'images',
    steps: [
      { tool: 'pdf2img', note: 'Save whole pages as PNG or JPG pictures.' },
      { tool: 'extractimages', note: 'Pull out the photos and graphics inside the PDF.' },
    ],
  },
];
