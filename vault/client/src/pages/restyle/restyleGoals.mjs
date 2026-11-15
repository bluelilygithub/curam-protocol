// The "What do you want to do?" job screen for the Style editor (internal name "restyle"; shared screen: components/JobStart.jsx,
// same as Video Tools, PDF Tools and Graphics). Each job is DATA: a title in plain words and ordered steps, each naming a real tool
// id from RESTYLE_TOOLS (restyleTools.mjs) and one line on what to do there. No CSS jargon (see docs/restyle.md).
//
// Unlike Video and PDF Tools nothing has to be carried between steps: the page, the preview and the changes stay loaded while you
// move from tool to tool. When the preview is first built (or something is first clicked) during a job, the page moves on to the
// job's next step instead of the usual "Ask in plain English" (RestylePage.jsx).
//
//   node client/src/pages/restyle/restyleGoals.test.mjs   (checks every step names a real tool)

export const RESTYLE_GOALS = [
  {
    id: 'refresh',
    title: 'Give a live page a new look',
    blurb: 'Load it by its address, change what you like, take the CSS away.',
    icon: 'sparkles',
    steps: [
      { tool: 'page', note: 'Type the web address of the page and load it.' },
      { tool: 'ask', note: 'Click something in the preview and say how it should look.' },
      { tool: 'checks', note: 'Check the new look is still easy for everyone to read.' },
      { tool: 'export', note: 'Copy the CSS and paste it into your site\'s custom CSS box.' },
    ],
  },
  {
    id: 'brand',
    title: 'Put your brand on a page',
    blurb: 'Your colours and fonts on every heading, link and button.',
    icon: 'swatch',
    steps: [
      { tool: 'page', note: 'Load the page you want to brand.' },
      { tool: 'brand', note: 'Add your colours and fonts, then use them across the page.' },
      { tool: 'changes', note: 'Look over what changed, and take back anything you do not want.' },
      { tool: 'export', note: 'Copy the CSS and paste it into your site.' },
    ],
  },
  {
    id: 'fix',
    title: 'Fix one thing that looks wrong',
    blurb: 'A heading too big, a button the wrong colour, text too tight.',
    icon: 'wand',
    steps: [
      { tool: 'page', note: 'Load the page with the problem.' },
      { tool: 'ask', note: 'Click the thing that looks wrong and say what it should be.' },
      { tool: 'scope', note: 'Choose just this one, or every one like it.' },
      { tool: 'export', note: 'Copy the small piece of CSS into your site.' },
    ],
  },
  {
    id: 'phones',
    title: 'Make it look right on phones',
    blurb: 'Change how a page looks on small screens only.',
    icon: 'smartphone',
    steps: [
      { tool: 'page', note: 'Load the page, then press Phone above the preview.' },
      { tool: 'scope', note: 'Click something, then choose "Phones only".' },
      { tool: 'text', note: 'Make the text a size that reads well on a phone.' },
      { tool: 'box', note: 'Give things more or less space around them.' },
      { tool: 'export', note: 'Copy the CSS; the phone changes only apply on phones.' },
    ],
  },
  {
    id: 'readable',
    title: 'Make a page easier to read',
    blurb: 'Find hard-to-read text and tiny text, and fix each one.',
    icon: 'eye',
    steps: [
      { tool: 'page', note: 'Load the page you want to check.' },
      { tool: 'checks', note: 'Run the checks, then click a problem to jump to it.' },
      { tool: 'text', note: 'Make the text darker, bigger or more spaced out.' },
      { tool: 'export', note: 'Copy the CSS into your site.' },
    ],
  },
  {
    id: 'client',
    title: 'Show a client a new look',
    blurb: 'Make the changes, save them, send a link that needs no login.',
    icon: 'share-2',
    steps: [
      { tool: 'page', note: 'Load the client\'s page.' },
      { tool: 'ask', note: 'Click things and say how they should look.' },
      { tool: 'saved', note: 'Give the page a name and save it.' },
      { tool: 'share', note: 'Make a link and send it to the client.' },
    ],
  },
  {
    id: 'borrow',
    title: 'Borrow the look of another site',
    blurb: 'Take its colours and use them on your own page.',
    icon: 'palette',
    steps: [
      { tool: 'scrape', note: 'Type the other site\'s address, then add its colours as brand colours.' },
      { tool: 'page', note: 'Load your own page.' },
      { tool: 'brand', note: 'Use those colours across your page.' },
      { tool: 'export', note: 'Copy the CSS into your site.' },
    ],
  },
  {
    id: 'saved',
    title: 'Carry on with a saved page',
    blurb: 'Open a page you saved, change more, update the CSS.',
    icon: 'folder-open',
    steps: [
      { tool: 'saved', note: 'Open the page you saved before.' },
      { tool: 'ask', note: 'Click things and keep changing them.' },
      { tool: 'export', note: 'Copy the new CSS; save again in My saved pages to keep it.' },
    ],
  },
  {
    id: 'practise',
    title: 'Try it on a practice page',
    blurb: 'A small demo page to click and change, nothing to lose.',
    icon: 'graduation-cap',
    steps: [
      { tool: 'page', note: 'Press Load a demo at the top right.' },
      { tool: 'ask', note: 'Click the header or a button and ask for a change.' },
      { tool: 'text', note: 'Try the font, size and colour controls.' },
      { tool: 'box', note: 'Try rounded corners, a shadow and a background colour.' },
    ],
  },
];
