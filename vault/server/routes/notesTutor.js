'use strict';

// The Notes guide (the round button on Vault's /notes page): points at Notes' real controls for a job, or says one is missing / the job
// is beyond Notes. JSON only; it reads no notes. Mounted at /api/notes-tutor behind the AI rate limit.
const { makeGuideRouter } = require('./guideRouter');
const { askNotesTutor } = require('../services/notesTutor');

module.exports = makeGuideRouter({ ask: askNotesTutor, source: 'notesTutor', productName: 'Notes', logTag: '[notes/tutor]' });
