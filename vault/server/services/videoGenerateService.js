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
const DEFAULT_REPLICATE_VIDEO_MODEL = process.env.VIDEO_REPLICATE_MODEL || 'minimax/hailuo-2.3';
const DEFAULT_REPLICATE_VIDEO_I2V_MODEL = process.env.VIDEO_REPLICATE_I2V_MODEL || 'minimax/hailuo-2.3';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function resolveVideoProvider() {
  const forced = String(process.env.VIDEO_GENERATE_PROVIDER || '').trim().toLowerCase();
  if (forced === 'replicate') {
    if (!process.env.REPLICATE_API_TOKEN?.trim()) {
      throw new Error('REPLICATE_API_TOKEN is not configured — required when VIDEO_GENERATE_PROVIDER=replicate');
    }
    return 'replicate';
  }
  if (forced === 'fal') {
    if (!process.env.FAL_API_KEY?.trim()) {
      throw new Error('FAL_API_KEY is not configured — required when VIDEO_GENERATE_PROVIDER=fal');
    }
    return 'fal';
  }
  if (process.env.REPLICATE_API_TOKEN?.trim()) return 'replicate';
  if (process.env.FAL_API_KEY?.trim()) return 'fal';
  throw new Error('Configure REPLICATE_API_TOKEN or FAL_API_KEY for video generation');
}

function getVideoGenerateConfig() {
  try {
    const provider = resolveVideoProvider();
    return {
      available: true,
      provider,
      model: provider === 'replicate' ? DEFAULT_REPLICATE_VIDEO_MODEL : DEFAULT_VIDEO_MODEL,
      imageToVideoModel: provider === 'replicate' ? DEFAULT_REPLICATE_VIDEO_I2V_MODEL : DEFAULT_VIDEO_I2V_MODEL,
    };
  } catch {
    return {
      available: false,
      provider: null,
      model: null,
      imageToVideoModel: null,
    };
  }
}

function replicateDuration(durationSec) {
  const n = Number(durationSec);
  if (Number.isFinite(n) && n >= 8) return 10;
  return 6;
}

function resolveReplicateModel(imageToVideo) {
  return imageToVideo ? DEFAULT_REPLICATE_VIDEO_I2V_MODEL : DEFAULT_REPLICATE_VIDEO_MODEL;
}

function buildReplicateInput({ expanded, imageToVideo, seedImageDataUrl, durationSec }) {
  const duration = replicateDuration(durationSec);
  const input = {
    prompt: expanded.video_prompt,
    prompt_optimizer: true,
    duration,
    resolution: '768p',
  };
  if (imageToVideo && seedImageDataUrl) {
    input.first_frame_image = seedImageDataUrl;
  }
  return input;
}

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
    const detail = data?.detail;
    const detailMsg = typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d?.msg || d).join('; ') : null;
    throw new Error(detailMsg || data?.error?.message || data?.error || data?.message || `Video provider failed (${res.status})`);
  }
  return data;
}

function falAuthHeaders(apiKey) {
  return {
    Authorization: `Key ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function submitReplicateVideoRequest(model, input) {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN is not configured');

  const res = await fetch(`https://api.replicate.com/v1/models/${model}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input }),
  });
  const pred = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof pred?.detail === 'string' ? pred.detail : JSON.stringify(pred?.detail || pred?.error || '');
    throw new Error(detail || `Replicate request failed (${res.status})`);
  }
  if (!pred?.id) throw new Error('Replicate did not return a prediction id');
  return pred;
}

async function submitFalVideoRequest(endpoint, body) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured — required for AI video generation');

  const data = await fetchJson(`https://queue.fal.run/${endpoint}`, {
    method: 'POST',
    headers: falAuthHeaders(apiKey),
    body: JSON.stringify(body),
  });

  if (!data?.request_id) throw new Error('Video provider did not return a request id');
  return data;
}

async function fetchFalQueueStatus(endpoint, requestId) {
  const apiKey = process.env.FAL_API_KEY;
  return fetchJson(`https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}/status?logs=1`, {
    headers: { Authorization: `Key ${apiKey}` },
  });
}

async function fetchFalQueueResult(endpoint, requestId) {
  const apiKey = process.env.FAL_API_KEY;
  return fetchJson(`https://queue.fal.run/${endpoint}/requests/${encodeURIComponent(requestId)}`, {
    headers: { Authorization: `Key ${apiKey}` },
  });
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

async function buildGenerationPayload(userId, options) {
  const {
    brief,
    style,
    aspect,
    durationSec,
    seedImage,
    seedImageMode = 'animate',
    youtubeUrl,
    useYoutubeThumbnailAsSeed = false,
  } = options;

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

  return {
    endpoint,
    body,
    imageToVideo,
    seedImageDataUrl,
    expanded,
    dims,
    durationSec: replicateDuration(durationSec || body.duration),
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
  };
}

async function startVideoGeneration(userId, options) {
  const provider = resolveVideoProvider();
  const prepared = await buildGenerationPayload(userId, options);
  const shared = {
    provider,
    mode: prepared.imageToVideo ? 'image-to-video' : 'text-to-video',
    video_prompt: prepared.expanded.video_prompt,
    negative_prompt: prepared.expanded.negative_prompt,
    aspect: options.aspect,
    width: prepared.dims.width,
    height: prepared.dims.height,
    durationSec: prepared.durationSec,
    references: prepared.references,
    status: 'IN_QUEUE',
  };

  if (provider === 'replicate') {
    const model = resolveReplicateModel(prepared.imageToVideo);
    const input = buildReplicateInput({
      expanded: prepared.expanded,
      imageToVideo: prepared.imageToVideo,
      seedImageDataUrl: prepared.seedImageDataUrl,
      durationSec: prepared.durationSec,
    });
    const pred = await submitReplicateVideoRequest(model, input);
    return {
      ...shared,
      model,
      requestId: pred.id,
      pollUrl: pred.urls?.get || null,
      queuePosition: null,
    };
  }

  const queue = await submitFalVideoRequest(prepared.endpoint, prepared.body);
  return {
    ...shared,
    model: prepared.endpoint,
    endpoint: prepared.endpoint,
    requestId: queue.request_id,
    statusUrl: queue.status_url,
    responseUrl: queue.response_url,
    pollUrl: null,
    queuePosition: queue.queue_position ?? null,
  };
}

async function finalizeVideoResult(preparedMeta, falResult) {
  const videoUrl = resolveVideoUrl(falResult);
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
    ...preparedMeta,
    videoUrl,
    inline,
    status: 'COMPLETED',
  };
}

async function pollReplicateVideoGeneration({ requestId, pollUrl, meta = {} }) {
  const token = process.env.REPLICATE_API_TOKEN;
  const url = pollUrl || `https://api.replicate.com/v1/predictions/${encodeURIComponent(requestId)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const pred = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(pred?.detail || pred?.error || `Replicate status failed (${res.status})`);
  }

  if (pred.status === 'failed' || pred.status === 'canceled') {
    throw new Error(pred.error || `Video generation ${pred.status}`);
  }

  if (pred.status === 'succeeded') {
    const out = pred.output;
    const videoUrl = typeof out === 'string' ? out : (Array.isArray(out) ? out[0] : out?.url);
    if (!videoUrl) throw new Error('Replicate returned no video URL');
    return finalizeVideoResult(meta, { video: { url: videoUrl } });
  }

  const status = ['starting', 'processing'].includes(pred.status) ? 'IN_PROGRESS' : 'IN_QUEUE';
  return {
    status,
    requestId,
    provider: 'replicate',
    model: pred.model || meta.model,
    logs: pred.logs || [],
    ...meta,
  };
}

async function pollVideoGeneration({ provider, endpoint, requestId, pollUrl, meta = {} }) {
  if (provider === 'replicate') {
    return pollReplicateVideoGeneration({ requestId, pollUrl, meta });
  }

  const status = await fetchFalQueueStatus(endpoint, requestId);

  if (status.status === 'FAILED' || (status.status === 'COMPLETED' && status.error)) {
    throw new Error(status.error || status.error_type || 'Video generation failed');
  }

  if (status.status !== 'COMPLETED') {
    return {
      status: status.status,
      requestId,
      endpoint,
      queuePosition: status.queue_position ?? null,
      logs: status.logs || [],
      ...meta,
    };
  }

  const falResult = await fetchFalQueueResult(endpoint, requestId);
  const completed = await finalizeVideoResult(meta, falResult);
  return completed;
}

async function generateVideo(userId, options) {
  const started = await startVideoGeneration(userId, options);
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i += 1) {
    const polled = await pollVideoGeneration({
      provider: started.provider,
      endpoint: started.endpoint,
      requestId: started.requestId,
      pollUrl: started.pollUrl,
      meta: {
        provider: started.provider,
        endpoint: started.endpoint,
        mode: started.mode,
        video_prompt: started.video_prompt,
        negative_prompt: started.negative_prompt,
        aspect: started.aspect,
        width: started.width,
        height: started.height,
        durationSec: started.durationSec,
        references: started.references,
      },
    });
    if (polled.status === 'COMPLETED') return polled;
    await new Promise((resolve) => setTimeout(resolve, 2500));
  }
  throw new Error('Video generation timed out — try again or use the provider URL from status');
}

module.exports = {
  generateVideo,
  startVideoGeneration,
  pollVideoGeneration,
  getVideoGenerateConfig,
  resolveVideoProvider,
  expandVideoPrompt,
  buildYoutubeContext,
  toImageDataUrl,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_I2V_MODEL,
  DEFAULT_REPLICATE_VIDEO_MODEL,
  DEFAULT_REPLICATE_VIDEO_I2V_MODEL,
};
