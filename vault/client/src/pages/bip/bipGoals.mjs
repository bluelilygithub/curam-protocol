// The "What do you want to do?" job tiles for Business Profiler (shared screen: components/JobStart.jsx), like Video Tools'
// videoGoals.mjs. Each job is DATA: a title in plain words and ordered steps, each naming a real tool id from BIP_TOOLS.
//
//   node client/src/pages/bip/bipGoals.test.mjs   (checks every step names a real tool)

export const BIP_GOALS = [
  {
    id: 'check',
    title: 'Check out a business',
    blurb: 'Who are they, where are they, how long have they been around?',
    icon: 'search',
    steps: [
      { tool: 'search', note: 'Type their domain, for example saleslogs.com, and press Profile.' },
      { tool: 'profile', note: 'Read the summary and the cards: entity, people, locations, products and reputation.' },
      { tool: 'ask', note: 'Ask anything the cards do not make clear, by typing or speaking. Save the answers worth keeping.' },
      { tool: 'conflicts', note: 'Look at any ❌: sources disagree and you decide which value is right.' },
    ],
  },
  {
    id: 'meeting',
    title: 'Prepare for a meeting or sales call',
    blurb: 'Profile them, then keep the facts in a note with your project.',
    icon: 'briefcase',
    steps: [
      { tool: 'search', note: 'Profile their domain.' },
      { tool: 'profile', note: 'Skim the cards for what they do and who you may meet.' },
      { tool: 'save', note: 'Save to Note, filed under the project for this meeting.' },
    ],
  },
  {
    id: 'crm',
    title: 'Add a business to the CRM',
    blurb: 'Make a client from the profile, linked both ways.',
    icon: 'building',
    steps: [
      { tool: 'search', note: 'Profile their domain (or open a saved profile).' },
      { tool: 'conflicts', note: 'Settle any ❌ first, so the client gets the right name, ABN and phone.' },
      { tool: 'save', note: 'Create client from profile, or link it to a client you already have.' },
    ],
  },
  {
    id: 'recheck',
    title: 'Bring a saved profile up to date',
    blurb: 'Re-scan an older profile, or refresh just one source.',
    icon: 'refresh-cw',
    steps: [
      { tool: 'profiles', note: 'Open the profile you want to update.' },
      { tool: 'refresh', note: 'Re-scan everything, or refresh one source. See why any source was skipped.' },
    ],
  },
  {
    id: 'share',
    title: 'Share a profile',
    blurb: 'A PDF copy to send or attach.',
    icon: 'download',
    steps: [
      { tool: 'profiles', note: 'Open the profile to share.' },
      { tool: 'export', note: 'Download the PDF.' },
    ],
  },
];
