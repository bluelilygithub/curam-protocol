'use strict';

// Topic Research test data: three sets of headlines with the story each one belongs to, labelled by hand by the person who wrote the
// grouping code (so a regression net, not independent proof: see docs/topic-research.md). Each row is [story label, outlet, title, snippet].
// A label shared by several rows means "the same story"; a label used once is a story only that outlet covered.
// The set is deliberately awkward: the cyclone set has three angles on one event that must NOT merge, and the apple set has a name that
// means two unrelated things.

const FIXTURES = {
  heatPumps: [
    ['rebate', 'abc.net.au', 'Queensland households can now claim heat pump rebates of up to $1,000', 'The Queensland government has opened applications for a rebate on heat pump hot water systems.'],
    ['rebate', 'brisbanetimes.com.au', 'Heat pump rebate scheme opens in Queensland', 'Applications are open for the state rebate on heat pump hot water systems for homes.'],
    ['rebate', 'couriermail.com.au', 'State government launches heat pump hot water rebate for Queensland homes', 'Households can apply for money back on a new heat pump hot water system.'],
    ['study', 'theconversation.com', 'Heat pumps cut winter bills by a third, new University of Queensland study finds', 'Researchers measured energy use in 120 Brisbane homes over two winters.'],
    ['study', 'uq.edu.au', 'UQ study: heat pump heating costs far lower than gas in Brisbane homes', 'A University of Queensland team compared heat pump bills with gas heating.'],
    ['installers', 'abc.net.au', 'Installer shortage slows Queensland heat pump boom', 'Tradies are booked out for months as demand for heat pumps surges.'],
    ['installers', 'smh.com.au', 'Tradies in short supply as heat pump demand surges in Queensland', 'Plumbers and electricians say the wait for a heat pump install is growing.'],
    ['guide', 'choice.com.au', 'How to choose a heat pump hot water system', 'A buyer guide to sizes, brands and running costs of heat pump systems.'],
    ['solar-compare', 'canstar.com.au', 'Heat pump vs solar hot water: which is cheaper to run?', 'We compare the running costs of two popular hot water options in Queensland.'],
  ],
  cyclone: [
    ['landfall', 'abc.net.au', 'Cyclone Alfie makes landfall near Cairns as thousands lose power', 'The category three system crossed the coast overnight with destructive winds.'],
    ['landfall', 'couriermail.com.au', 'Thousands without power after Cyclone Alfie hits Far North Queensland', 'Ergon Energy says more than 20,000 homes lost electricity as the cyclone crossed the coast.'],
    ['landfall', 'theguardian.com', 'Cyclone Alfie crosses coast north of Cairns with destructive winds', 'The cyclone made landfall at 2am bringing damaging wind gusts to the coast.'],
    ['flood', 'bom-news.example', 'Flood warnings issued for Burdekin River as Alfie rain moves south', 'The Bureau of Meteorology warns of moderate flooding along the Burdekin River.'],
    ['flood', 'abc.net.au', 'Burdekin River flood warning: residents told to prepare', 'Heavy rain from the ex-cyclone is pushing the Burdekin River higher.'],
    ['insurance', 'afr.com', 'Insurers brace for Cyclone Alfie claims after landfall', 'Insurance companies are preparing for a surge in claims across Far North Queensland.'],
    ['insurance', 'smh.com.au', 'Insurance Council expects Alfie claims to top $200 million', 'The council has declared a catastrophe, opening up faster claims handling.'],
  ],
  apple: [
    ['iphone', 'theverge.com', 'Apple unveils new iPhone with satellite messaging', 'The company showed its latest phone at a launch event, adding satellite texting.'],
    ['iphone', 'techcrunch.com', 'iPhone launch: Apple adds satellite texting to the new phone', 'Apple announced the new iPhone with messaging by satellite.'],
    ['hail', 'abc.net.au', 'Apple growers hit by hail as orchard losses mount', 'Hail has damaged apple crops across the Granite Belt orchards.'],
    ['hail', 'couriermail.com.au', 'Hailstorm destroys apple crops in Granite Belt', 'Growers say the hailstorm wiped out much of this season’s apple harvest.'],
    ['lawsuit', 'reuters.com', 'Apple sues rival over chip patents', 'The company has filed a lawsuit claiming patent infringement over processor designs.'],
  ],
};

// Pairs of labels where a reasonable person could call it one story or two, so the grouping may do either. Everything else is a clear call:
// rows with one label must end up together, rows with different labels (and not listed here) must end up apart.
const MAY_MERGE = {
  heatPumps: [['guide', 'solar-compare']], // two evergreen advice pieces on the same question
  cyclone: [['landfall', 'insurance']], // the insurance follow-up to the landfall itself
  apple: [],
};

/** A set as articles for the grouping code: [{ id, label, domain, title, snippet }]. */
const articlesOf = (name) => FIXTURES[name].map(([label, domain, title, snippet], id) => ({ id, label, domain, title, snippet }));

/**
 * Check a grouping against a set's labels. `assign` is Map id -> cluster index. Returns the problems found (empty = correct):
 * a label split over several clusters, or two labels that may not merge ending up in one cluster.
 */
function gradeGrouping(name, assign) {
  const arts = articlesOf(name);
  const problems = [];
  const labels = [...new Set(arts.map((a) => a.label))];
  const clusterOf = (label) => new Set(arts.filter((a) => a.label === label).map((a) => assign.get(a.id)));
  for (const l of labels) if (clusterOf(l).size > 1) problems.push(`"${l}" was split across ${clusterOf(l).size} groups`);
  const allowed = (a, b) => (MAY_MERGE[name] || []).some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  for (let i = 0; i < labels.length; i += 1) {
    for (let j = i + 1; j < labels.length; j += 1) {
      const shared = [...clusterOf(labels[i])].some((c) => clusterOf(labels[j]).has(c));
      if (shared && !allowed(labels[i], labels[j])) problems.push(`"${labels[i]}" and "${labels[j]}" were merged`);
    }
  }
  return problems;
}

module.exports = { FIXTURES, MAY_MERGE, articlesOf, gradeGrouping };
