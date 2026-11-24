'use strict';

// Polite, SSRF-safe reader for the fixed ATO watch list. Each page is checked against robots.txt (including
// Crawl-delay), spaced out, fetched with the honest CuramVault agent through utils/safeFetch, capped at 2 MB,
// and reduced to a short title/excerpt. A blocked or failed page becomes a snapshot with status
// 'blocked'/'unavailable'; the report then says "verify manually" instead of guessing. See docs/shares-compliance.md.

const crypto = require('crypto');
const { fetchPublicFile } = require('../../utils/safeFetch');
const { htmlToText, extractTitle } = require('../htmlFetch');
const { createRobotsChecker } = require('../topicResearch/robots');
const { createThrottle } = require('../topicResearch/sources/http');
const { sourcesForRun, isAllowedAtoUrl, MAX_SOURCES } = require('./sources');

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const EXCERPT_CHARS = 1200;
const PROMPT_CHARS = 5000;
const MIN_TEXT_CHARS = 80;
const DEFAULT_GAP_MS = 2000;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function failedSnapshot(source, fetchedAt, status, reason) {
  return {
    sourceId: source.id,
    label: source.label,
    url: source.url,
    focus: source.focus || '',
    finalUrl: '',
    status,
    reason: String(reason || '').slice(0, 240),
    hash: '',
    title: '',
    excerpt: '',
    promptText: '',
    fetchedAt,
  };
}

function fetchReason(err) {
  const message = String(err?.message || '');
  const match = message.match(/HTTP\s+(\d{3})/i);
  if (match) return `The ATO page returned HTTP ${match[1]}.`;
  if (/too large|size/i.test(message)) return 'The ATO page was too large to read.';
  return 'The ATO page could not be read.';
}

/**
 * Fetch the allow-listed pages. Never throws for one bad page: every page returns a snapshot so a partial
 * report can still be saved. `fetcher`, `robots`, `makeThrottle`, `now` and `sources` are injectable for tests.
 */
async function fetchSources({
  sources = sourcesForRun(),
  fetcher = fetchPublicFile,
  robots = createRobotsChecker(),
  makeThrottle = createThrottle,
  now = Date.now,
  maxSources = MAX_SOURCES,
} = {}) {
  const selected = (Array.isArray(sources) ? sources : []).slice(0, Math.min(maxSources, MAX_SOURCES));
  const throttles = new Map();
  const snapshots = [];

  for (const source of selected) {
    const fetchedAt = new Date(now()).toISOString();
    if (!source || !isAllowedAtoUrl(source.url)) {
      snapshots.push(failedSnapshot(source || {}, fetchedAt, 'blocked', 'This address is not on the ATO allow-list.'));
      continue; // eslint-disable-line no-continue
    }

    let robot;
    try {
      robot = await robots.check(source.url);
    } catch {
      robot = { allowed: false, reason: 'unavailable', crawlDelayMs: null };
    }
    if (!robot?.allowed) {
      const reason = robot?.reason === 'disallowed'
        ? 'robots.txt does not allow this page to be read.'
        : 'robots.txt could not be checked, so this page was left alone.';
      snapshots.push(failedSnapshot(source, fetchedAt, robot?.reason === 'disallowed' ? 'blocked' : 'unavailable', reason));
      continue; // eslint-disable-line no-continue
    }

    const host = new URL(source.url).hostname.toLowerCase();
    if (!throttles.has(host)) {
      const crawlDelay = Math.max(0, Number(robot.crawlDelayMs) || 0);
      throttles.set(host, makeThrottle({ gapMs: Math.max(DEFAULT_GAP_MS, crawlDelay) }));
    }

    try {
      const result = await throttles.get(host)(() => fetcher(source.url, {
        maxBytes: MAX_BYTES,
        timeoutMs: TIMEOUT_MS,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      }));
      const finalUrl = String(result?.finalUrl || source.url);
      if (!isAllowedAtoUrl(finalUrl)) {
        snapshots.push(failedSnapshot(source, fetchedAt, 'blocked', 'The page redirected outside the ATO allow-list.'));
        continue; // eslint-disable-line no-continue
      }

      const buffer = Buffer.isBuffer(result?.buffer) ? result.buffer : Buffer.from(result?.buffer || '');
      const contentType = String(result?.contentType || '').toLowerCase();
      if (contentType && !/html|text\/plain/.test(contentType)) {
        snapshots.push(failedSnapshot(source, fetchedAt, 'unavailable', 'The ATO page was not readable HTML.'));
        continue; // eslint-disable-line no-continue
      }

      const html = buffer.toString('utf8');
      const text = htmlToText(html, PROMPT_CHARS);
      if (text.length < MIN_TEXT_CHARS) {
        snapshots.push(failedSnapshot(source, fetchedAt, 'unavailable', 'The ATO page had no readable text.'));
        continue; // eslint-disable-line no-continue
      }

      snapshots.push({
        sourceId: source.id,
        label: source.label,
        url: source.url,
        focus: source.focus || '',
        finalUrl,
        status: 'ok',
        reason: '',
        hash: sha256(html),
        title: extractTitle(html) || source.label,
        excerpt: text.slice(0, EXCERPT_CHARS),
        promptText: text.slice(0, PROMPT_CHARS),
        fetchedAt,
      });
    } catch (err) {
      snapshots.push(failedSnapshot(source, fetchedAt, 'unavailable', fetchReason(err)));
    }
  }

  return snapshots;
}

module.exports = { fetchSources, sha256, MAX_BYTES, TIMEOUT_MS, EXCERPT_CHARS, PROMPT_CHARS };
