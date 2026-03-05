const express = require('express');
const router = express.Router();
const db = require('../db');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function fetchUrl(rawUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error('Invalid URL')); }
    const mod = parsed.protocol === 'https:' ? https : http;
    const req = mod.get(rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaultBot/1.0)' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(fetchUrl(res.headers.location, redirectCount + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function parseHtml(html, url) {
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, ' ').trim();
  return { title, content: stripped.substring(0, 15000) };
}

// GET /api/pinned-urls/:projectId
router.get('/:projectId', (req, res) => {
  res.json(db.prepare('SELECT * FROM pinned_urls WHERE projectId=? ORDER BY createdAt ASC').all(req.params.projectId));
});

// POST /api/pinned-urls — fetch + store
router.post('/', async (req, res) => {
  const { projectId, url } = req.body;
  if (!projectId || !url) return res.status(400).json({ error: 'projectId and url required' });
  try {
    const raw = await fetchUrl(url.startsWith('http') ? url : `https://${url}`);
    const { title, content } = parseHtml(raw, url);
    const result = db.prepare(
      'INSERT INTO pinned_urls (projectId, url, title, content) VALUES (?, ?, ?, ?)'
    ).run(projectId, url, title, content);
    res.status(201).json(db.prepare('SELECT * FROM pinned_urls WHERE id=?').get(result.lastInsertRowid));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/pinned-urls/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM pinned_urls WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
