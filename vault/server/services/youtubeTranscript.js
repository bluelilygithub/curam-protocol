'use strict';

/**
 * YouTube transcript fetcher — no external dependency.
 * Uses YouTube's InnerTube API to retrieve captions, with an oEmbed title lookup.
 */

const https = require('https');

const YOUTUBE_HOSTNAME_RE = /^(www\.)?youtube\.com$/;
const VIDEO_ID_RE = /(?:youtube\.com\/(?:[^/]+\/[^/]+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (YOUTUBE_HOSTNAME_RE.test(parsed.hostname)) {
      const v = parsed.searchParams.get('v');
      if (v && v.length === 11) return v;
    }
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('/')[0];
      if (id && id.length === 11) return id;
    }
  } catch { /* fall through to regex */ }
  const m = url.match(VIDEO_ID_RE);
  return m ? m[1] : null;
}

function isYoutubeUrl(url) {
  return extractVideoId(url) !== null;
}

// Simple HTTPS GET — returns raw body string
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000, ...options }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(httpsGet(res.headers.location, options));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// HTTPS POST — returns parsed JSON
function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        'User-Agent': 'com.google.android.youtube/20.10.38 (Linux; U; Android 14)',
        ...headers,
      },
      timeout: 10000,
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new Error('Invalid JSON response')); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')); });
    req.write(bodyStr);
    req.end();
  });
}

// Fetch video title via oEmbed (no API key needed)
async function fetchVideoTitle(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const body = await httpsGet(url);
    const data = JSON.parse(body);
    return data.title || null;
  } catch {
    return null;
  }
}

const decodeEntities = (t) => t
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)));

// Parse caption XML into timed segments [{ start, dur, text }] (seconds). Handles YouTube's two formats: newer <p t="ms" d="ms"> and legacy
// <text start="s" dur="s">.
function parseCaptionSegments(xml) {
  const segments = [];
  // Try TTML <p> tags first (newer format)
  const pRe = /<p\s+([^>]*)>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = pRe.exec(xml)) !== null) {
    const t = /\bt="(\d+)"/.exec(m[1]);
    if (!t) continue;
    const d = /\bd="(\d+)"/.exec(m[1]);
    const text = decodeEntities(m[2].replace(/<s[^>]*>([^<]*)<\/s>/g, '$1').replace(/<[^>]+>/g, '')).trim();
    if (text) segments.push({ start: Number(t[1]) / 1000, dur: d ? Number(d[1]) / 1000 : 0, text });
  }
  if (segments.length > 0) return segments;

  // Fall back to legacy <text> tags
  const textRe = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  while ((m = textRe.exec(xml)) !== null) {
    const text = decodeEntities(m[3]).trim();
    if (text) segments.push({ start: Number(m[1]) || 0, dur: Number(m[2]) || 0, text });
  }
  return segments;
}

// The same captions as plain text (timestamps dropped).
function parseCaptionXml(xml) {
  return parseCaptionSegments(xml).map((s) => s.text).join(' ');
}

// Fetch the raw caption track list for a video via InnerTube (shared by
// fetchYoutubeTranscript and fetchYoutubeCaptionLanguages).
async function fetchCaptionTracks(videoId) {
  let captionTracks;
  let playability = null;
  try {
    const data = await httpsPost(
      'https://www.youtube.com/youtubei/v1/player?prettyPrint=false',
      {
        context: { client: { clientName: 'ANDROID', clientVersion: '20.10.38' } },
        videoId,
      }
    );
    captionTracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    playability = data?.playabilityStatus || null;
  } catch (err) {
    throw new Error(`Failed to fetch video metadata: ${err.message}`);
  }

  if (!Array.isArray(captionTracks) || captionTracks.length === 0) {
    // "No captions" is only true when YouTube says the video is playable and still lists none. A private, removed, age-restricted or
    // robot-checked video has no caption list either, but that is a different problem and the person needs to be told which.
    if (playability && playability.status && playability.status !== 'OK') {
      const reason = String(playability.reason || playability.status);
      const e = new Error(`Video not readable: ${reason}`);
      e.code = 'UNPLAYABLE';
      e.reason = reason;
      throw e;
    }
    throw new Error('No captions available for this video');
  }
  return captionTracks;
}

// List available caption languages for a video, without fetching the transcript text.
async function fetchYoutubeCaptionLanguages(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Not a valid YouTube URL');

  const captionTracks = await fetchCaptionTracks(videoId);
  return captionTracks.map(t => ({
    languageCode: t.languageCode,
    name:         t.name?.simpleText || t.languageCode,
    isDefault:    t.languageCode === 'en',
  }));
}

async function fetchYoutubeTranscript(url, languageCode) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Not a valid YouTube URL');

  // Step 1: get caption track list via InnerTube
  const captionTracks = await fetchCaptionTracks(videoId);

  // Requested language, else prefer English, else fall back to first available
  const track = (languageCode && captionTracks.find(t => t.languageCode === languageCode))
    || captionTracks.find(t => t.languageCode === 'en')
    || captionTracks[0];
  const trackUrl = track.baseUrl;

  // Safety: ensure track URL is from youtube.com
  try {
    const parsed = new URL(trackUrl);
    if (!parsed.hostname.endsWith('.youtube.com')) throw new Error('Unexpected caption host');
  } catch (err) {
    throw new Error(`Invalid caption track URL: ${err.message}`);
  }

  // Step 2: fetch the caption XML
  let xml;
  try {
    xml = await httpsGet(trackUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaultBot/1.0)' },
    });
  } catch (err) {
    throw new Error(`Failed to fetch captions: ${err.message}`);
  }

  const segments = parseCaptionSegments(xml);
  const transcriptText = segments.map((x) => x.text).join(' ');
  if (!transcriptText) throw new Error('Could not parse caption data');

  // Step 3: get the title (best-effort)
  const videoTitle = await fetchVideoTitle(videoId);
  const title = videoTitle || 'YouTube Video';

  const header = `[YouTube Transcript: ${title}]\n\n`;
  const content = (header + transcriptText).substring(0, 50000);

  // `segments` has the timing (seconds) for callers that need it; `content` is the capped plain text everything else uses.
  return { title, content, segments, languageCode: track.languageCode };
}

async function fetchYoutubeReference(url) {
  const videoId = extractVideoId(url);
  if (!videoId) throw new Error('Not a valid YouTube URL');

  const thumbnailUrl = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
  const title = (await fetchVideoTitle(videoId)) || 'YouTube video';
  let transcriptExcerpt = '';
  try {
    const t = await fetchYoutubeTranscript(url);
    transcriptExcerpt = String(t.content || '')
      .replace(/^\[YouTube Transcript:[^\]]*\]\s*/i, '')
      .trim()
      .slice(0, 2000);
  } catch {
    // Captions optional — title + thumbnail still useful
  }

  return {
    videoId,
    title,
    thumbnailUrl,
    transcriptExcerpt,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

module.exports = { parseCaptionSegments, parseCaptionXml, isYoutubeUrl, fetchYoutubeTranscript, extractVideoId, fetchYoutubeReference, fetchYoutubeCaptionLanguages };
