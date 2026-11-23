// What the Business Profiler page is made of, the plain-words help for it, and the controls its guide can point at. The ids are the
// guide's catalogue (server/services/bipTutor.js); a test fails if the two drift apart.

export const BIP_TOOLS = [
  { id: 'search', label: 'Profile a domain', group: 'Profile', icon: 'search' },
  { id: 'profiles', label: 'Saved profiles', group: 'Profile', icon: 'list' },
  { id: 'profile', label: 'Profile cards', group: 'Profile', icon: 'briefcase' },
  { id: 'conflicts', label: 'Confidence & conflicts', group: 'Review', icon: 'alert-triangle' },
  { id: 'refresh', label: 'Re-scan & refresh', group: 'Review', icon: 'refresh-cw' },
  { id: 'export', label: 'Download PDF', group: 'Review', icon: 'download' },
];

export const GROUPS = ['Profile', 'Review'];

export const GROUP_TIPS = {
  Profile: 'Start with a domain, then open a saved profile to read all the cards.',
  Review: 'Check where sources disagree, refresh one module, or download the profile.',
};

export const TOOL_TIPS = {
  search: 'Type a domain and press Profile. BIP reads public registration, DNS, the website and the sources you have configured.',
  profiles: 'Every saved profile, newest first. Open one to see the full report.',
  profile: 'Seven cards: entity, people, locations, products, digital footprint, reputation and financial indicators.',
  conflicts: 'Every value is kept, with its source. ✅ means 2+ sources agree, ⚠️ one source, ❌ sources disagree.',
  refresh: 'Re-scan everything, or refresh just one section. Results are cached for 30 days.',
  export: 'Download the saved profile as a PDF.',
};

export const TOOL_BLURBS = {
  search: 'One domain in, a full public-source profile.',
  profiles: 'Past profiles, newest first.',
  profile: 'The seven cards that make up the report.',
  conflicts: 'See every value and where sources disagree.',
  refresh: 'Update the whole profile or one module.',
  export: 'A PDF copy of the profile.',
};

// The longer text for the (i) "How Business Profiler works" box.
export const HOW_IT_WORKS = [
  ['What it does', 'BIP gathers public information about a domain into one saved profile: registration, DNS, the website, business registers, map listings, review sites and the visible tech stack.'],
  ['Two stages', 'First it reads the domain registration, DNS and the public pages of the website. Then it uses that seed to look up the business in ABN Lookup, ASIC, Google Places, Google search, review sites and social links.'],
  ['Confidence, not guesses', 'The same fact from several sources is shown with all of its values and where each came from. Two or more agreeing sources are marked ✅. One source is ⚠️. Disagreements are ❌ and BIP never picks a winner for you.'],
  ['Caching', 'A profile is kept for 30 days. Opening it again shows the saved report; use Re-scan to fetch fresh data, or the refresh icon on a single card to update just that source.'],
  ['What it cannot do', 'ASIC does not provide a free public register feed, so BIP says when a manual check is needed. Revenue and funding are not published by these sources, so the financial card is labelled estimates from public sources and leaves unknown figures blank.'],
  ['Saved and recoverable', 'Profiles stay until you delete them. A deleted profile goes to Vault’s recycle bin for 30 days, so it can be put back.'],
];

// Everything the guide can point at. `tool` is the box or section its Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'search', label: 'Profile a domain', tool: 'search' },
  { id: 'profiles', label: 'Saved profiles', tool: 'profiles' },
  { id: 'profile', label: 'Profile cards', tool: 'profile' },
  { id: 'conflicts', label: 'Confidence & conflicts', tool: 'conflicts' },
  { id: 'refresh', label: 'Re-scan & refresh', tool: 'refresh' },
  { id: 'export', label: 'Download PDF', tool: 'export' },
];
