'use strict';

// Intake for the "clip a licensed video" flow — a direct file URL the user has rights to
// (their own hosting, a stock-footage download link, a CC-licensed direct download), streamed
// to disk and handed to the existing ffmpeg clip pipeline in videoFfmpeg.js.
//
// This is deliberately NOT a YouTube/Vimeo/TikTok downloader. Those platforms never serve raw
// video bytes at a plain URL — getting the file requires page-scraping/extractor tooling that
// works around platform protections, which this app does not build (see docs/youtube-agent.md).
// The enforcement here is twofold: an explicit blocklist for known video-platform page domains
// (a clear, honest refusal instead of a confusing generic fetch failure), and a Content-Type
// check that only accepts an actual video file response — a platform page URL returns HTML and
// gets rejected by that check even if the domain blocklist somehow missed it.

const fs = require('fs');
const https = require('https');
const http = require('http');
const { checkSsrf } = require('./htmlFetch');

const MAX_VIDEO_BYTES = Number(process.env.VIDEO_MAX_UPLOAD_MB || 80) * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30000;

// Page URLs, not direct file links — no plain fetch here will ever return raw video bytes,
// so refuse early with a clear message rather than let it fail deep inside ffmpeg.
const BLOCKED_PLATFORM_HOSTS = [
  'youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com',
  'vimeo.com', 'www.vimeo.com',
  'tiktok.com', 'www.tiktok.com',
  'facebook.com', 'www.facebook.com', 'fb.watch',
  'instagram.com', 'www.instagram.com',
  'twitter.com', 'x.com',
  'dailymotion.com', 'www.dailymotion.com',
  'twitch.tv', 'www.twitch.tv', 'clips.twitch.tv',
];

function isBlockedPlatformHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return BLOCKED_PLATFORM_HOSTS.some((blocked) => h === blocked || h.endsWith(`.${blocked}`));
}

/**
 * Streams a direct video file URL to destPath. Rejects platform page URLs, private/internal
 * addresses (SSRF), non-video responses, and anything over MAX_VIDEO_BYTES.
 */
function fetchLicensedVideo(url, destPath) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch { return reject(new Error('Invalid URL')); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return reject(new Error('Only http/https URLs are allowed'));
    }
    if (isBlockedPlatformHost(parsed.hostname)) {
      return reject(new Error(
        `${parsed.hostname} is a video platform page, not a direct file link — this only works with a direct download URL for a video you have rights to (your own hosting, a stock-footage link, or a CC direct-download link).`
      ));
    }

    checkSsrf(parsed.hostname)
      .then(() => {
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request({
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CuramVault/1.0)' },
          timeout: FETCH_TIMEOUT_MS,
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, url).toString();
            return resolve(fetchLicensedVideo(next, destPath));
          }
          if (res.statusCode >= 400) {
            res.resume();
            return reject(new Error(`Server returned ${res.statusCode}`));
          }
          const contentType = String(res.headers['content-type'] || '').toLowerCase();
          const looksLikeVideo = contentType.startsWith('video/') || contentType === 'application/octet-stream';
          if (!looksLikeVideo) {
            res.resume();
            return reject(new Error(`URL did not return a video file (got "${contentType || 'unknown'}"). This needs a direct link to the video file itself, not a webpage.`));
          }
          const contentLength = Number(res.headers['content-length'] || 0);
          if (contentLength > MAX_VIDEO_BYTES) {
            res.resume();
            return reject(new Error(`Video is too large (${Math.round(contentLength / 1024 / 1024)}MB, max ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB)`));
          }

          const out = fs.createWriteStream(destPath);
          let bytes = 0;
          res.on('data', (chunk) => {
            bytes += chunk.length;
            if (bytes > MAX_VIDEO_BYTES) {
              req.destroy();
              out.destroy();
              return reject(new Error(`Video exceeded max size (${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)}MB) while downloading`));
            }
          });
          res.pipe(out);
          out.on('finish', () => resolve({ bytes }));
          out.on('error', reject);
        });
        req.on('timeout', () => { req.destroy(new Error('Request timed out')); });
        req.on('error', reject);
        req.end();
      })
      .catch(reject);
  });
}

module.exports = { fetchLicensedVideo, isBlockedPlatformHost };
