'use strict';

const express = require('express');
const multer = require('multer');
const { extractSources, MAX_FILE_BYTES, MAX_FILES } = require('../../services/presentations/sources');
const { sendError } = require('./shared');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES } });

router.post('/import', (req, res, next) => {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (err) return sendError(res, err, 'Those files could not be read.');
    return next();
  });
}, async (req, res) => {
  try {
    const out = await extractSources({ files: req.files || [], url: '', userId: req.user.id });
    res.json(out);
  } catch (err) { sendError(res, err, 'That source could not be read.'); }
});

router.post('/import/url', async (req, res) => {
  try {
    const out = await extractSources({ files: [], url: String(req.body?.url || ''), userId: req.user.id });
    res.json(out);
  } catch (err) { sendError(res, err, 'That web address could not be read.'); }
});

module.exports = router;
