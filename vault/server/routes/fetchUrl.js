const express = require('express');
const router = express.Router();
const { isYoutubeUrl, fetchYoutubeTranscript } = require('../services/youtubeTranscript');
const { fetchHtml, extractTitle, htmlToText, normaliseHttpUrl } = require('../services/htmlFetch');

router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  let normalised;
  try {
    normalised = normaliseHttpUrl(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    if (isYoutubeUrl(normalised)) {
      try {
        const { title, content } = await fetchYoutubeTranscript(normalised);
        return res.json({ url: normalised, title, content });
      } catch (ytErr) {
        console.warn('[fetch-url] YouTube transcript failed, falling back to webpage:', ytErr.message);
      }
    }

    const { body, statusCode } = await fetchHtml(normalised);
    if (statusCode >= 400) {
      return res.json({ url: normalised, error: `Server returned ${statusCode}`, title: '', content: '' });
    }
    const title = extractTitle(body);
    const content = htmlToText(body);
    res.json({ url: normalised, title, content });
  } catch (err) {
    const status = (err.message.includes('private') || err.message.includes('DNS') || err.message.includes('too large')) ? 400 : 500;
    res.status(status).json({ url: normalised, error: err.message, title: '', content: '' });
  }
});

module.exports = router;
