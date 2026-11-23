// What the Business Profiler page is made of, the plain-words help for it, and the controls its guide can point at. The ids are the
// guide's catalogue (server/services/bipTutor.js); a test fails if the two drift apart (node server/services/bipTutor.test.js).
// The page is laid out like Video Tools: these tools in the list on the left (ToolSidebar), the job tiles (bipGoals.mjs) on the start screen.

export const BIP_TOOLS = [
  { id: 'search', label: 'Profile a domain', group: 'Profile', icon: 'search' },
  { id: 'profiles', label: 'Saved profiles', group: 'Profile', icon: 'list' },
  { id: 'profile', label: 'Profile cards', group: 'Report', icon: 'briefcase', needsProfile: true },
  { id: 'conflicts', label: 'Confidence & conflicts', group: 'Report', icon: 'alert-triangle', needsProfile: true },
  { id: 'refresh', label: 'Re-scan & sources', group: 'Report', icon: 'refresh-cw', needsProfile: true },
  { id: 'export', label: 'Download PDF', group: 'Keep & share', icon: 'download', needsProfile: true },
  { id: 'save', label: 'Save to Note & Client', group: 'Keep & share', icon: 'sticky-note', needsProfile: true },
];

export const GROUPS = ['Profile', 'Report', 'Keep & share'];

export const GROUP_TIPS = {
  Profile: 'Start with a domain, or open a profile you saved earlier.',
  Report: 'Read the open profile: its cards, where sources agree or disagree, and the sources it used.',
  'Keep & share': 'Download the open profile as a PDF, or keep it in Notes and the CRM.',
};

export const TOOL_TIPS = {
  search: 'Type a domain and press Profile. BIP reads public registration, DNS, the website and the sources you have configured.',
  profiles: 'Every saved profile, newest first. Open one to see the full report.',
  profile: 'An AI summary, then seven cards: entity, people, locations, products, digital footprint, reputation and financial indicators.',
  conflicts: 'Every value is kept, with its source. ✅ means 2+ sources agree, ⚠️ one source, ❌ sources disagree.',
  refresh: 'Re-scan everything, refresh just one source, and see what each source returned or why it was skipped.',
  export: 'Download the saved profile as a PDF.',
  save: 'Save the profile as a new note (optionally under a project) that links back here, and file it under a new or existing client.',
};

export const TOOL_BLURBS = {
  search: 'One domain in, a full public-source profile.',
  profiles: 'Past profiles, newest first.',
  profile: 'The seven cards that make up the report.',
  conflicts: 'See every value and where sources disagree. Choose a value to record your decision; nothing is deleted.',
  refresh: 'Update the whole profile or one source, and see what each source did.',
  export: 'A PDF copy of the profile.',
  save: 'A linked note, and a link to a client.',
};

// The longer text for the (i) "How Business Profiler works" box.
export const HOW_IT_WORKS = [
  ['What it does', 'BIP gathers public information about a domain into one saved profile: registration, DNS, the website, business registers, map listings, review sites and the visible tech stack.'],
  ['Two stages', 'First it reads the domain registration, DNS and the public pages of the website. Then it uses that seed to look up the business in ABN Lookup, ASIC, Google Places, Google search, review sites and social links.'],
  ['Confidence, not guesses', 'The same fact from several sources is shown with all of its values and where each came from. Two or more agreeing sources are marked ✅. One source is ⚠️. Disagreements are ❌ and BIP never picks a winner for you.'],
  ['Research beyond the website', 'BIP reads the business’s legal, team and history pages (where the ABN usually is), then the public ABN Lookup page for that ABN (registered names, location history and ACN), then searches other websites (press, interviews, review sites) when Vault has a web search key. Every fact from another site shows its page, its exact words and who is saying it: a register, an independent source, the company itself, or an estimate.'],
  ['Summary', 'When a profile finishes, AI writes three paragraphs about the business from the profile’s data only: what it does, where it is and how long it appears to have operated, and its online presence and gaps. Any year or number it could not find in the data is flagged to check. Regenerate writes it again; it is also in the PDF and Save to Note.'],
  ['Caching', 'A profile is kept for 30 days. Opening it again shows the saved report; use Re-scan to fetch fresh data, or the refresh icon on a single card to update just that source.'],
  ['What it cannot do', 'ASIC does not provide a free public register feed, so BIP says when a manual check is needed. Revenue and funding are not published by these sources, so the financial card is labelled estimates from public sources and leaves unknown figures blank.'],
  ['Saved and recoverable', 'Profiles stay until you delete them. A deleted profile goes to Vault’s recycle bin for 30 days, so it can be put back.'],
];

// Everything the guide can point at. `tool` is the tool its Open button switches to.
export const GUIDE_TOOLS = BIP_TOOLS.map(({ id, label }) => ({ id, label, tool: id }));
