'use strict';

// node server/services/serpTrackerTutor.test.js   (the SERP Tracker guide). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./serpTrackerTutor');

checkGuide({
  name: 'serpTrackerTutor',
  service,
  askName: 'askSerpTrackerTutor',
  feature: 'serp_tracker_guide',
  toolsFile: 'serpTracker/serpTrackerTools.mjs',
  menuExport: 'SERP_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'lookup',
  exampleStepId: 'lookup-run',
  facts: [
    ['site-switcher', 'notes', /up to 20 sites/, 'up to 20 sites'],
    ['add-site', 'notes', /once/, 'each address can be tracked once'],
    ['delete-site', 'does', /30 days/, 'a deleted site is kept 30 days'],
    ['delete-site', 'notes', /Undo cannot bring a site back/, 'an Undo can be blocked by re-adding the same address'],
    ['client-link', 'notes', /your own clients/, 'only the person\'s own clients can be linked'],
    ['site-address', 'notes', /each address once/, 'each address once'],
    ['keywords', 'does', /\|/, 'a target page follows a bar'],
    ['keywords', 'notes', /only searched every day when Daily tracking is switched on/, 'the saved searches are only searched daily when tracking is on'],
    ['daily-tracking', 'notes', /OFF until the person switches it on/, 'daily tracking is off until switched on'],
    ['daily-tracking', 'notes', /up to three reads/, 'a miss is read again before it is called not found'],
    ['run-tracking', 'notes', /costs money/, 'run tracking now costs money'],
    ['tracked-rankings', 'notes', /never as not found/, 'a failed search is not not-found'],
    ['kw-new', 'notes', /All history/, 'new does not work for all history'],
    ['save-site', 'does', /saves nothing/, 'a bad form saves nothing'],
    ['spending', 'notes', /not verified/, 'an unverified account is refused'],
    ['lookup-form', 'does', /10, 20, 50, 100 or 200/, 'the depths are named'],
    ['lookup-form', 'does', /expected cost/, 'the expected cost is shown'],
    ['find-my-site', 'does', /top 100/, 'find my site searches the top 100'],
    ['find-my-site', 'does', /top 200/, 'and can go to 200'],
    ['find-my-site', 'does', /tried again \(up to 4 times\)/, 'a short answer is retried'],
    ['find-my-site', 'does', /how many results were really checked/, 'it says how many results were checked'],
    ['find-my-site', 'notes', /could be further down/, 'a short answer may hide the site'],
    ['find-my-site', 'notes', /Searching past 200 is not available/, 'nothing is searched beyond 200'],
    ['find-my-site', 'notes', /needs a site/, 'it needs a site'],
    ['lookup-run', 'notes', /monthly limit/, 'the monthly limit stops searches'],
    ['lookup-result', 'notes', /never as "not ranked"/, 'an empty search is a failure, not not-ranked'],
    ['lookup-result', 'notes', /charges for it/, 'a failed search is still charged'],
    ['select-delete', 'does', /Select all/, 'select all exists'],
    ['select-delete', 'notes', /30 days/, 'deleted lookups are kept 30 days'],
    ['run-now', 'notes', /free/, 'run now only reads the free balance'],
  ],
  gaps: [/competitor\'s position every day/, /weekly report/, /more than 20 sites/, /top 200/, /CRM client page/, /spending limit or the DataForSEO login/, /map pack/, /exporting/, /other people/],
  rules: [/paid search/, /monthly limit/, /would pass it/, /never "not ranked"/, /how many were actually checked/, /recycle bin for 30 days/, /up to 20 sites/, /own CRM clients/],
  system: [/Never state or guess a ranking/, /not built yet/],
}).catch((e) => { console.error(e); process.exit(1); });
