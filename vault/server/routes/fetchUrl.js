const express = require('express');
const router = express.Router();
const http = require('http');
const https = require('https');

function doGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }

    const mod = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; VaultFetcher/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 12000,
    };

    const req = mod.request(opts, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = new URL(res.headers.location, url).toString();
        return resolve(doGet(next, redirectsLeft - 1));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), statusCode: res.statusCode }));
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.end();
  });
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

function htmlToText(html) {
  return html
    // Remove unwanted blocks entirely
    .replace(/<(script|style|noscript|nav|header|footer|aside|iframe|svg|canvas|form)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    // Block-level tags → newline
    .replace(/<\/?(p|div|article|section|main|h[1-6]|li|tr|br|blockquote)[^>]*>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, ' ')
    // Decode entities
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    // Collapse whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .substring(0, 15000);
}

// POST /api/fetch-url
router.post('/', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'url is required' });
  }

  // Only allow http/https
  let normalised = url.trim();
  if (!normalised.startsWith('http://') && !normalised.startsWith('https://')) {
    normalised = 'https://' + normalised;
  }
  try { new URL(normalised); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  try {
    const { body, statusCode } = await doGet(normalised);
    if (statusCode >= 400) {
      return res.json({ url: normalised, error: `Server returned ${statusCode}`, title: '', content: '' });
    }
    const title = extractTitle(body);
    const content = htmlToText(body);
    res.json({ url: normalised, title, content });
  } catch (err) {
    res.json({ url: normalised, error: err.message, title: '', content: '' });
  }
});

module.exports = router;
