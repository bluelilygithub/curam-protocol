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
    ['model', 'does', /Searching, reading and ranking use no model/, 'searching, reading and ranking use no model'],
    ['check', 'does', /from 0 to 3/, 'the source check scores 0 to 3'],
    ['check', 'notes', /never blocks the brief/, 'a check that cannot run never blocks'],
    ['suggest', 'does', /up to three other ways/, 'up to three suggestions'],
    ['suggest', 'notes', /Nothing is searched until you press Search/, 'suggestions do not search by themselves'],
    ['suggest', 'notes', /AI note \(check it\)/, 'the premise note is labelled'],
    ['prompts', 'does', /exact prompt that was sent/, 'the prompt shown is the one sent'],
    ['links', 'does', /Research section on that client/, 'the guide says where linked research shows'],
    ['review', 'does', /never given any article's text/, 'the verdict never gets article text'],
    ['review', 'does', /Structure opinion model/, 'the guide says where the model is chosen'],
    ['review', 'notes', /Up to five verdicts/, 'how many are kept'],
    ['review', 'does', /own general knowledge/, 'its own knowledge is labelled apart'],
    ['links', 'notes', /only removes the link/, 'deleting a client keeps the research'],
    ['prompts', 'does', /not used this time and why/, 'the results say which sources were not used'],
    ['prompts', 'notes', /30 days/, 'stored prompts follow the 30-day rule'],
    ['progress', 'notes', /not on a timer/, 'progress steps are real'],
    ['results', 'does', /Shop page/, 'shop pages are badged'],
    ['draft', 'notes', /warns first/, 'a thin brief warns before drafting'],
    ['draft', 'does', /brief only/, 'a draft is built from the brief only'],
    ['draft', 'notes', /not a publish-ready article/, 'a draft is not publish-ready'],
    ['history', 'notes', /100/, 'history shows 100'],
  ],
  gaps: [/Publishing anything to a website/, /publish-ready article/, /fact-checking/, /Google Trends/, /Facebook/, /paywall/],
  rules: [/never publishes anything/, /30 days/, /monthly limit/],
  system: [/Never promise it is publish-ready or fact-checked/, /Never state or guess what is trending/],
}).catch((e) => { console.error(e); process.exit(1); });
