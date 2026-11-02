'use strict';

// The Guitar guide (the round button on Vault's /guitar page): points at the page's real controls for a job, or says one is
// missing / the job is beyond Guitar. JSON only; it sees no songs, chords or scores. Mounted at /api/guitar-tutor behind the AI rate limit.

const { makeGuideRouter } = require('./guideRouter');
const { askGuitarTutor } = require('../services/guitarTutor');

module.exports = makeGuideRouter({ ask: askGuitarTutor, source: 'guitarTutor', productName: 'Guitar', logTag: '[guitar/tutor]' });
