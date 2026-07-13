'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');
const { fetchYoutubeReference } = require('./youtubeTranscript');

const DEFAULT_VIDEO_MODEL = process.env.VIDEO_GENERATE_MODEL || 'fal-ai/minimax/video-01-live';
const DEFAULT_VIDEO_I2V_MODEL = process.env.VIDEO_GENERATE_I2V_MODEL || 'fal-ai/minimax/video-01-live/image-to-video';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const PROMPT_SYSTEM = `You write concise prompts for AI text-to-video models.
Return ONLY valid JSON. No markdown fences.`;

const ASPECT_MAP = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 720, height: 720 },
};

function isPrivateIp(ip) {
  if (ip === '::1') return true;
  const lower = String(ip).toLowerCase();
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
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

function fetchBinaryUrl(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft <= 0) return reject(new Error('Too many redirects'));
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error('Invalid URL'));
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reject(new Error('Only http(s) image URLs are supported'));
    }

    checkSsrf(parsed.hostname).then(() => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaultVideo/1.0)', Accept: 'image/*,*/*' },
        timeout: 15000,
      }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          return resolve(fetchBinaryUrl(new URL(res.headers.location, url).toString(), redirectsLeft - 1));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Failed to fetch image (${res.statusCode})`));
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_IMAGE_BYTES) {
            req.destroy();
            reject(new Error('Image exceeds 8MB limit'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers.get('content-type') || 'image/jpeg',
        }));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('Image fetch timed out')); });
      req.end();
    }).catch(reject);
  });
}

async function toImageDataUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  if (/^data:image\//i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) {
    const { buffer, contentType } = await fetchBinaryUrl(raw);
    const mime = String(contentType || 'image/jpeg').split(';')[0];
    if (!mime.startsWith('image/')) throw new Error('URL did not return an image');
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }
  throw new Error('Image must be a data URL or public http(s) URL');
}

async function describeImageWithGemini(modelId, imageDataUrl, instruction) {
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured — required to analyse reference images');

  const match = String(imageDataUrl).match(/^data:(image\/[^;]+);base64,(.+)$/i);
  if (!match) throw new Error('Invalid image data URL');

  const genai = new GoogleGenerativeAI(key);
  const gModel = genai.getGenerativeModel({
    model: modelId,
    generationConfig: { maxOutputTokens: 512 },
  });

  const result = await gModel.generateContent([
    { text: instruction },
    { inlineData: { mimeType: match[1], data: match[2] } },
  ]);

  let text = '';
  try {
    text = result.response.text().trim();
  } catch {
    const parts = result.response.candidates?.[0]?.content?.parts || [];
    text = parts.map((p) => p.text || '').join('').trim();
  }
  if (!text) throw new Error('Vision model returned an empty description');
  return text;
}

async function describeReferenceImage(userId, imageDataUrl, purpose = 'suggestion') {
  const { gemini: modelId } = await getModelsForUser(userId);
  if (!modelId) throw new Error('No Gemini model configured — add one in Settings to analyse reference images');

  const instruction = purpose === 'seed'
    ? 'Describe this image for image-to-video generation: subject, composition, lighting, colours, and plausible subtle motion. Max 60 words. Plain prose only.'
    : 'Describe the visual style, mood, lighting, camera feel, and subject of this reference image for a video brief. Max 60 words. Plain prose only.';

  const description = await describeImageWithGemini(modelId, imageDataUrl, instruction);
  logUsage({
    userId,
    model: modelId,
    inputTokens: 0,
    outputTokens: 0,
    feature: 'videos',
  });
  return description;
}

async function expandVideoPrompt(userId, { brief, style, aspect, imageDescription, youtubeRef }) {
  const { light: modelId } = await getModelsForUser(userId);

  const refParts = [];
  if (imageDescription) {
    refParts.push(`Reference image notes: ${imageDescription}`);
  }
  if (youtubeRef) {
    refParts.push(`Reference YouTube video: "${youtubeRef.title}"`);
    if (youtubeRef.transcriptExcerpt) {
      refParts.push(`Transcript excerpt: ${youtubeRef.transcriptExcerpt.slice(0, 1200)}`);
    }
    if (youtubeRef.visualNotes) {
      refParts.push(`Visual notes from thumbnail: ${youtubeRef.visualNotes}`);
    }
    refParts.push('Match pacing and production feel where appropriate, but do not copy branding or identifiable people.');
  }

  const userBrief = brief?.trim() || (youtubeRef
    ? `Short clip inspired by the reference YouTube video "${youtubeRef.title}"`
    : 'Animate the reference image with subtle, natural motion');

  const prompt = `User brief: ${userBrief}
Style: ${style || 'product b-roll'}
Aspect: ${aspect || '16:9'}
${refParts.length ? `\nReferences:\n${refParts.join('\n')}\n` : ''}
Return JSON:
{"video_prompt":"One paragraph describing subject, motion, camera, lighting, mood — max 80 words","negative_prompt":"things to avoid, max 30 words"}`;

  const result = await callModel(modelId, prompt, {
    system: PROMPT_SYSTEM,
    maxTokens: 1024,
    returnUsage: true,
  });
  logUsage({
    userId,
    model: result.model,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    feature: 'videos',
  });

  const parsed = parseModelJson(String(result.text || '').trim());
  return {
    video_prompt: parsed?.video_prompt || userBrief,
    negative_prompt: parsed?.negative_prompt || '',
  };
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error?.message || data?.error || `Video provider failed (${res.status})`);
  }
  return data;
}

function resolveVideoUrl(data) {
  return data?.video?.url
    || data?.video_url
    || data?.output?.url
    || (Array.isArray(data?.videos) ? data.videos[0]?.url : null)
    || null;
}

async function downloadVideoBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated video (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 50 * 1024 * 1024) {
    throw new Error('Generated video exceeds 50MB — use the provider URL directly');
  }
  return { buffer: buf, contentType: res.headers.get('content-type') || 'video/mp4' };
}

function resolveFalEndpoint({ imageToVideo }) {
  const raw = imageToVideo ? DEFAULT_VIDEO_I2V_MODEL : DEFAULT_VIDEO_MODEL;
  return String(raw).replace(/^https:\/\/fal\.run\//, '').replace(/^\/+/, '');
}

async function buildYoutubeContext(userId, youtubeUrl, { describeThumbnail = true } = {}) {
  const ref = await fetchYoutubeReference(youtubeUrl);
  if (describeThumbnail && process.env.GEMINI_API_KEY) {
    try {
      const thumbDataUrl = await toImageDataUrl(ref.thumbnailUrl);
      ref.visualNotes = await describeReferenceImage(userId, thumbDataUrl, 'suggestion');
    } catch (err) {
      console.warn('[videos] YouTube thumbnail analysis skipped:', err.message);
    }
  }
  return ref;
}

async function generateVideo(userId, {
  brief,
  style,
  aspect,
  durationSec,
  seedImage,
  seedImageMode = 'animate',
  youtubeUrl,
  useYoutubeThumbnailAsSeed = false,
}) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured — required for AI video generation');

  let seedImageDataUrl = seedImage ? await toImageDataUrl(seedImage) : null;
  let effectiveSeedMode = seedImageMode === 'suggest' ? 'suggest' : 'animate';
  let youtubeRef = null;

  if (youtubeUrl?.trim()) {
    youtubeRef = await buildYoutubeContext(userId, youtubeUrl.trim(), { describeThumbnail: true });
    if (useYoutubeThumbnailAsSeed && !seedImageDataUrl) {
      seedImageDataUrl = await toImageDataUrl(youtubeRef.thumbnailUrl);
      effectiveSeedMode = 'animate';
    }
  }

  if (!brief?.trim() && !youtubeRef && !seedImageDataUrl) {
    throw new Error('Add a brief, reference image, or YouTube example');
  }

  let imageDescription = null;
  if (seedImageDataUrl && effectiveSeedMode === 'suggest') {
    imageDescription = await describeReferenceImage(userId, seedImageDataUrl, 'suggestion');
  }

  const expanded = await expandVideoPrompt(userId, {
    brief,
    style,
    aspect,
    imageDescription,
    youtubeRef,
  });

  const dims = ASPECT_MAP[aspect] || ASPECT_MAP['16:9'];
  const imageToVideo = Boolean(seedImageDataUrl && effectiveSeedMode === 'animate');
  const endpoint = resolveFalEndpoint({ imageToVideo });

  const body = {
    prompt: expanded.video_prompt,
    prompt_optimizer: true,
  };

  if (imageToVideo) {
    body.image_url = seedImageDataUrl;
  } else {
    body.aspect_ratio = aspect === '9:16' ? '9:16' : aspect === '1:1' ? '1:1' : '16:9';
    if (durationSec) body.duration = Math.min(10, Math.max(3, Number(durationSec) || 5));
  }

  const data = await fetchJson(`https://fal.run/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const videoUrl = resolveVideoUrl(data);
  if (!videoUrl) throw new Error('Video provider did not return a video URL');

  let inline = null;
  try {
    const dl = await downloadVideoBuffer(videoUrl);
    inline = {
      contentType: dl.contentType,
      base64: dl.buffer.toString('base64'),
      size: dl.buffer.length,
    };
  } catch (err) {
    console.warn('[videos] inline download skipped:', err.message);
  }

  return {
    provider: 'fal',
    endpoint,
    mode: imageToVideo ? 'image-to-video' : 'text-to-video',
    videoUrl,
    video_prompt: expanded.video_prompt,
    negative_prompt: expanded.negative_prompt,
    aspect,
    width: dims.width,
    height: dims.height,
    durationSec: body.duration || durationSec || null,
    references: {
      seedImageMode: seedImageDataUrl ? effectiveSeedMode : null,
      youtube: youtubeRef ? {
        title: youtubeRef.title,
        url: youtubeRef.url,
        thumbnailUrl: youtubeRef.thumbnailUrl,
        usedThumbnailAsSeed: Boolean(useYoutubeThumbnailAsSeed && effectiveSeedMode === 'animate' && seedImageDataUrl),
      } : null,
      imageDescription,
      youtubeVisualNotes: youtubeRef?.visualNotes || null,
    },
    inline,
  };
}

module.exports = {
  generateVideo,
  expandVideoPrompt,
  buildYoutubeContext,
  toImageDataUrl,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_I2V_MODEL,
};
