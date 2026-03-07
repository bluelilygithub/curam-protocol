const express = require('express');
const router = express.Router();
const db = require('../db');
const http = require('http');
const https = require('https');
const dns = require('dns');
const { URL } = require('url');

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MB

function isPrivateIp(ip) {
  // IPv6 loopback / link-local / unique-local
  if (ip === '::1') return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // IPv4
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return false;
  const [a, b] = parts;
  if (a === 127) return true;                           // 127.x loopback
  if (a === 10) return true;                            // 10.x RFC-1918
  if (a === 172 && b >= 16 && b <= 31) return true;    // 172.16–31.x RFC-1918
  if (a === 192 && b === 168) return true;              // 192.168.x RFC-1918
  if (a === 169 && b === 254) return true;              // 169.254.x link-local
  if (a === 0) return true;                             // 0.0.0.0
  return false;
}

function checkSsrf(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) return reject(new Error('DNS lookup failed'));
      if (isPrivateIp(address)) return reject(new Error('URL resolves to a private or internal address'));
      resolve();
    });
  });
}

function fetchUrl(rawUrl, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects'));
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error('Invalid URL')); }

    // SSRF check — runs on every hop including redirects
    checkSsrf(parsed.hostname).then(() => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.get(rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaultBot/1.0)' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          return resolve(fetchUrl(res.headers.location, redirectCount + 1));
        }
        const chunks = [];
        let bytesReceived = 0;
        res.on('data', c => {
          bytesReceived += c.length;
          if (bytesReceived > MAX_RESPONSE_BYTES) {
            req.destroy();
            return reject(new Error('Response too large'));
          }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      });
      req.on('error', reject);
      req.setTimeout(10000, () => { req.destroy(); reject(new Error('Request timed out')); });
    }).catch(reject);
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
    const status = (err.message.includes('private') || err.message.includes('DNS') || err.message.includes('too large')) ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/pinned-urls/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM pinned_urls WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
