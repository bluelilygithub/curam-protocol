'use strict';

// node server/services/topicResearchTutor.test.js   (npm run test:topic-research-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./topicResearchTutor');

checkGuide({
  name: 'topicResearchTutor',
  service,
  askName: 'askTopicResearchTutor',
  feature: 'topic_research_guide',
  toolsFile: 'topicResearch/topicResearchTools.mjs',
  menuExport: 'TOPIC_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'search',
  exampleStepId: 'brief',
  facts: [
    ['search', 'does', /Hacker News.*GDELT/s, 'the sources are named'],
    ['watch', 'does', /6, 12, 24 or 48 hours, or weekly/, 'the refresh choices are listed'],
    ['brief', 'does', /up to 12 articles/, 'the brief article limit'],
    ['brief', 'notes', /not an article/, 'a brief is not an article'],
    ['spending', 'does', /0 means no limit/, '0 means no limit'],
    ['spending', 'notes', /estimates/, 'amounts are estimates'],
    ['model', 'does', /only part of Topic Research that uses an AI model/, 'only the brief uses a model'],
    ['history', 'notes', /100/, 'history shows 100'],
  ],
  gaps: [/Writing or rewriting a finished article/, /fact-checking/, /Google Trends/, /Facebook/, /paywall/],
  rules: [/never writes, rewrites or publishes an article/, /30 days/, /monthly limit/],
  system: [/Never offer to write their article/, /Never state or guess what is trending/],
}).catch((e) => { console.error(e); process.exit(1); });
