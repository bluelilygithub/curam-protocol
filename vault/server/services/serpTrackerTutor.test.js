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
    ['site-address', 'notes', /One site per person/, 'one site per person'],
    ['keywords', 'does', /\|/, 'a target page follows a bar'],
    ['keywords', 'notes', /not collected every day yet/, 'the saved searches are not collected daily yet'],
    ['save-site', 'does', /saves nothing/, 'a bad form saves nothing'],
    ['spending', 'notes', /not verified/, 'an unverified account is refused'],
    ['lookup-form', 'does', /10, 20, 50 or 100/, 'the depths are named'],
    ['lookup-run', 'notes', /monthly limit/, 'the monthly limit stops searches'],
    ['lookup-result', 'notes', /never as "not ranked"/, 'an empty search is a failure, not not-ranked'],
    ['lookup-result', 'notes', /charges for it/, 'a failed search is still charged'],
    ['select-delete', 'does', /Select all/, 'select all exists'],
    ['select-delete', 'notes', /30 days/, 'deleted lookups are kept 30 days'],
    ['run-now', 'notes', /free/, 'run now only reads the free balance'],
  ],
  gaps: [/every day and showing a history/, /weekly report/, /more than one site/, /spending limit or the DataForSEO login/, /map pack/, /exporting/, /other people/],
  rules: [/paid search/, /monthly limit/, /never "not ranked"/, /recycle bin for 30 days/],
  system: [/Never state or guess a ranking/, /not built yet/],
}).catch((e) => { console.error(e); process.exit(1); });
