'use strict';

// The Topic Research guide (the round button on Vault's /topic-research page): points at the page's real controls for a job, or says one is
// missing / the job is beyond Topic Research. JSON only; it sees no topics, articles or briefs. Mounted at /api/topic-research-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askTopicResearchTutor } = require('../services/topicResearchTutor');

module.exports = makeGuideRouter({ ask: askTopicResearchTutor, source: 'topicResearchTutor', productName: 'Topic Research', logTag: '[topic-research/tutor]' });
