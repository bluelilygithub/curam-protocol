// The "What do you want to do?" job tiles for Skill Scanner (shared screen: components/JobStart.jsx), as in Graphics and Video Tools.
// Each job is DATA: a title in plain words and ordered steps, each naming a real tool id from SKILL_SCAN_TOOLS.
//
//   node client/src/pages/skillScan/skillScanGoals.test.mjs   (checks every step names a real tool)

export const SKILL_SCAN_GOALS = [
  {
    id: 'github',
    title: 'Check a skill or plugin from GitHub',
    blurb: 'Paste its link, then read the verdict and what the findings mean.',
    icon: 'shield',
    steps: [
      { tool: 'scan', note: 'Paste the github.com link and press Scan. Every skill in it is checked separately; the progress bar shows which one it is on.' },
      { tool: 'report', note: 'Read the explanation first: it says which findings are normal for what the skill does.' },
    ],
  },
  {
    id: 'local',
    title: 'Check a plugin on my computer',
    blurb: 'Zip its folder and upload it.',
    icon: 'upload',
    steps: [
      { tool: 'scan', note: 'Zip the plugin folder (for example under ~/.claude/plugins/) and press Upload a zip.' },
      { tool: 'report', note: 'Read the explanation and the findings by rule.' },
    ],
  },
  {
    id: 'deeper',
    title: 'Get a deeper AI check',
    blurb: 'An AI model reads the files too, for risks the patterns miss.',
    icon: 'sparkles',
    steps: [
      { tool: 'deep', note: 'Tick Deep scan, then Scan. Slower, costs a little, and sends the files to Anthropic.' },
      { tool: 'report', note: 'Compare what the deep scan found with the static one.' },
    ],
  },
  {
    id: 'share',
    title: 'Keep or share a report',
    blurb: 'Copy it as Markdown or download it.',
    icon: 'download',
    steps: [
      { tool: 'history', note: 'Open the scan you want.' },
      { tool: 'report', note: 'Copy for a note or a message, or download it as Markdown or JSON.' },
    ],
  },
];
