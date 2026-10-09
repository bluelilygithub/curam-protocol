'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { calculateCost, calculateVideoCost, hasVideoPricing } = require('./costCalculator');
const { parseModelJson } = require('../utils/parseModelJson');
const { fetchYoutubeReference } = require('./youtubeTranscript');

const DEFAULT_VIDEO_MODEL = process.env.VIDEO_GENERATE_MODEL || 'fal-ai/minimax/video-01-live';
const DEFAULT_VIDEO_I2V_MODEL = process.env.VIDEO_GENERATE_I2V_MODEL || 'fal-ai/minimax/video-01-live/image-to-video';
const DEFAULT_REPLICATE_VIDEO_MODEL = process.env.VIDEO_REPLICATE_MODEL || 'minimax/hailuo-2.3';
const DEFAULT_REPLICATE_VIDEO_I2V_MODEL = process.env.VIDEO_REPLICATE_I2V_MODEL || 'minimax/hailuo-2.3';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// `preferred` is an optional PER-REQUEST override (the Create tool's provider
// picker) — honoured only when that provider's key is actually configured,
// so a request can't silently succeed against a provider that isn't set up.
// `VIDEO_GENERATE_PROVIDER` remains a deploy-wide forced default and still
// wins over the request when set, since that's an operator's hard choice.
function resolveVideoProvider(preferred) {
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
  const wanted = String(preferred || '').trim().toLowerCase();
  if (wanted === 'replicate' && process.env.REPLICATE_API_TOKEN?.trim()) return 'replicate';
  if (wanted === 'fal' && process.env.FAL_API_KEY?.trim()) return 'fal';
  if (process.env.REPLICATE_API_TOKEN?.trim()) return 'replicate';
  if (process.env.FAL_API_KEY?.trim()) return 'fal';
  throw new Error('Configure REPLICATE_API_TOKEN or FAL_API_KEY for video generation');
}

function getVideoGenerateConfig() {
  const availableProviders = {
    replicate: Boolean(process.env.REPLICATE_API_TOKEN?.trim()),
    fal: Boolean(process.env.FAL_API_KEY?.trim()),
  };
  try {
    const provider = resolveVideoProvider();
    return {
      available: true,
      provider,
      model: provider === 'replicate' ? DEFAULT_REPLICATE_VIDEO_MODEL : DEFAULT_VIDEO_MODEL,
      imageToVideoModel: provider === 'replicate' ? DEFAULT_REPLICATE_VIDEO_I2V_MODEL : DEFAULT_VIDEO_I2V_MODEL,
      availableProviders,
      models: {
        replicate: DEFAULT_REPLICATE_VIDEO_MODEL,
        fal: DEFAULT_VIDEO_MODEL,
      },
      videoModels: listVideoModels(availableProviders),
    };
  } catch {
    return {
      available: false,
      provider: null,
      model: null,
      imageToVideoModel: null,
      availableProviders,
      models: {
        replicate: DEFAULT_REPLICATE_VIDEO_MODEL,
        fal: DEFAULT_VIDEO_MODEL,
      },
    };
  }
}

// Which selectable models the page can offer. Only Hailuo runs on FAL; everything else needs Replicate.
function listVideoModels(availableProviders) {
  return Object.entries(VIDEO_MODELS).map(([id, def]) => ({
    id,
    label: def.label,
    capabilities: def.capabilities,
    available: id === 'hailuo' ? true : Boolean(availableProviders.replicate),
  }));
}

function replicateDuration(durationSec) {
  const n = Number(durationSec);
  if (Number.isFinite(n) && n >= 8) return 10;
  return 6;
}

function resolveReplicateModel(imageToVideo) {
  return imageToVideo ? DEFAULT_REPLICATE_VIDEO_I2V_MODEL : DEFAULT_REPLICATE_VIDEO_MODEL;
}

// Selectable Replicate models. Hailuo stays the default. The capability flags drive both validation here
// and which controls the page shows, so a model only offers what its API actually accepts.
// Input names (from each model's Replicate API schema):
//   minimax/hailuo-2.3         prompt, first_frame_image, duration (6, or 10 at 768p), resolution, prompt_optimizer
//   bytedance/seedance-1-pro   prompt, image, last_frame_image (needs image), duration 2-12, resolution,
//                              aspect_ratio (ignored when image is given), fps, seed, camera_fixed
const DEFAULT_SEEDANCE_MODEL = process.env.VIDEO_SEEDANCE_MODEL || 'bytedance/seedance-1-pro';
const VIDEO_MODELS = {
  hailuo: {
    label: 'Hailuo 2.3',
    capabilities: { promptOptimizer: true, endFrame: false, seed: false, cameraFixed: false },
  },
  seedance: {
    label: 'Seedance 1 Pro',
    capabilities: { promptOptimizer: false, endFrame: true, seed: true, cameraFixed: true },
  },
};

function resolveModelKey(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(VIDEO_MODELS, key) ? key : 'hailuo';
}

function seedanceDuration(durationSec) {
  const n = Math.round(Number(durationSec));
  return Math.min(12, Math.max(2, Number.isFinite(n) ? n : 5));
}

/** Seed from the request: a non-negative whole number, otherwise "let the provider choose". */
function parseSeed(value) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 2147483647 ? n : null;
}

/**
 * Reject option combinations the chosen model/provider cannot honour — before any paid prompt or
 * provider call. A control the model lacks is an error, never silently dropped.
 */
function assertModelOptions(provider, options) {
  const key = resolveModelKey(options.model);
  const caps = VIDEO_MODELS[key].capabilities;
  if (key !== 'hailuo' && provider !== 'replicate') {
    throw new Error(`${VIDEO_MODELS[key].label} runs on Replicate only — set REPLICATE_API_TOKEN or pick Hailuo`);
  }
  if (options.endImage && !caps.endFrame) {
    throw new Error(`${VIDEO_MODELS[key].label} has no end-frame option — choose Seedance 1 Pro to set where the clip finishes`);
  }
  if (options.endImage && !options.seedImage) {
    throw new Error('An end frame needs a starting image as well — add a reference image (animate it) first');
  }
  if (options.endImage && options.seedImageMode === 'suggest') {
    throw new Error('An end frame needs the reference image set to "animate it", not "use as inspiration"');
  }
  if (parseSeed(options.seed) != null && !caps.seed) {
    throw new Error(`${VIDEO_MODELS[key].label} has no seed option`);
  }
  if (options.cameraFixed && !caps.cameraFixed) {
    throw new Error(`${VIDEO_MODELS[key].label} has no camera-fixed option`);
  }
  return key;
}

function buildReplicateInput({
  modelKey = 'hailuo', expanded, imageToVideo, seedImageDataUrl, endImageDataUrl,
  durationSec, aspect, seed, cameraFixed, promptOptimizer,
}) {
  if (modelKey === 'seedance') {
    const input = { prompt: expanded.video_prompt, duration: seedanceDuration(durationSec) };
    if (imageToVideo && seedImageDataUrl) {
      input.image = seedImageDataUrl;
      // Seedance ignores aspect_ratio when an image is given (the image decides), so only send it without one.
      if (endImageDataUrl) input.last_frame_image = endImageDataUrl;
    } else {
      input.aspect_ratio = ['16:9', '9:16', '1:1'].includes(aspect) ? aspect : '16:9';
    }
    const s = parseSeed(seed);
    if (s != null) input.seed = s;
    if (cameraFixed) input.camera_fixed = true;
    return input;
  }

  const duration = replicateDuration(durationSec);
  const input = {
    prompt: expanded.video_prompt,
    prompt_optimizer: promptOptimizer !== false,
    duration,
    resolution: '768p',
  };
  if (imageToVideo && seedImageDataUrl) {
    input.first_frame_image = seedImageDataUrl;
  }
  return input;
}

/** Best-effort: Replicate does not return the seed as a field, but many models print it in the logs. */
function parseSeedFromLogs(logs) {
  const text = Array.isArray(logs) ? logs.join('\n') : String(logs || '');
  const m = text.match(/seed\D{0,12}(\d{1,10})/i);
  return m ? Number(m[1]) : null;
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
  let lower = String(ip).toLowerCase();
  // IPv4-mapped IPv6 (::ffff:127.0.0.1) — unwrap to the v4 form before checking
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) lower = mapped[1];
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower === '::' || lower === '0:0:0:0:0:0:0:0') return true;
  const parts = lower.split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

// Resolves DNS once, validates the IP, then hands back that SAME address for
// the actual connection (caller must pin to it) — resolving again at connect
// time would reopen a DNS-rebinding gap (attacker flips the record between
// the check and the request).
function checkSsrf(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) return reject(new Error('DNS lookup failed'));
      if (isPrivateIp(address)) return reject(new Error('URL resolves to a private or internal address'));
      resolve(address);
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

    checkSsrf(parsed.hostname).then((resolvedAddress) => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const req = mod.request({
        // Connect to the address we just validated, not the hostname again —
        // re-resolving here is exactly the DNS-rebinding gap this guard exists
        // to close. Host header + TLS servername keep it looking like the URL.
        hostname: resolvedAddress,
        servername: parsed.protocol === 'https:' ? parsed.hostname : undefined,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; VaultVideo/1.0)', Accept: 'image/*,*/*', Host: parsed.hostname },
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
          contentType: res.headers['content-type'] || 'image/jpeg',
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

const SRT_TRANSCRIBE_INSTRUCTION = `Transcribe the spoken audio in full. Return ONLY a valid SRT-formatted subtitle file — sequential cue numbers, "HH:MM:SS,mmm --> HH:MM:SS,mmm" timestamp lines, then the spoken text for that cue, separated by blank lines. Break into short cues (roughly one sentence or 5-8 seconds each). No markdown fences, no commentary, no extra text before or after the SRT content.`;

/**
 * Hosted transcription (Railway has no whisper-cli binary): send the
 * extracted audio track to Gemini and ask for SRT-formatted output directly.
 * Reuses the same GoogleGenerativeAI client setup as `describeImageWithGemini`.
 */
async function transcribeAudioWithGemini(userId, audioBase64, mimeType = 'audio/mp3') {
  const { gemini: modelId } = await getModelsForUser(userId);
  if (!modelId) throw new Error('No Gemini model configured — add one in Settings to use hosted auto-transcribe');
  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured — required for hosted auto-transcribe');

  const genai = new GoogleGenerativeAI(key);
  const gModel = genai.getGenerativeModel({
    model: modelId,
    generationConfig: { maxOutputTokens: 8192 },
  });

  const result = await gModel.generateContent([
    { text: SRT_TRANSCRIBE_INSTRUCTION },
    { inlineData: { mimeType, data: audioBase64 } },
  ]);

  let text = '';
  try {
    text = result.response.text().trim();
  } catch {
    const parts = result.response.candidates?.[0]?.content?.parts || [];
    text = parts.map((p) => p.text || '').join('').trim();
  }
  if (!text) throw new Error('Gemini returned an empty transcript');

  logUsage({
    userId,
    model: modelId,
    inputTokens: 0,
    outputTokens: 0,
    feature: 'videos',
  });
  return text;
}

async function isGeminiTranscribeAvailable(userId) {
  try {
    if (!process.env.GEMINI_API_KEY) return false;
    const { gemini: modelId } = await getModelsForUser(userId);
    return Boolean(modelId);
  } catch {
    return false;
  }
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

/**
 * Describe an uploaded reference video from a few evenly spaced frames (one Gemini call,
 * all frames together so it can read motion/pacing across them). Returns plain-prose notes.
 */
async function describeReferenceVideoFrames(userId, frameDataUrls, { duration } = {}) {
  const { gemini: modelId } = await getModelsForUser(userId);
  if (!modelId) throw new Error('No Gemini model configured — add one in Settings to analyse reference videos');
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not configured — required to analyse reference videos');

  const parts = [{
    text: `These are ${frameDataUrls.length} frames in order from one video${duration ? ` (${Math.round(duration)}s long)` : ''}. Describe, for a new video brief: subject and setting, camera movement and framing, pacing/motion between frames, lighting, colour grade and overall mood. Max 90 words. Plain prose only.`,
  }];
  for (const url of frameDataUrls) {
    const match = String(url).match(/^data:(image\/[^;]+);base64,(.+)$/i);
    if (match) parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
  }

  const { GoogleGenerativeAI } = require('@google/generative-ai');
  const gModel = new GoogleGenerativeAI(key).getGenerativeModel({
    model: modelId,
    generationConfig: { maxOutputTokens: 512 },
  });
  const result = await gModel.generateContent(parts);
  let text = '';
  try {
    text = result.response.text().trim();
  } catch {
    const cand = result.response.candidates?.[0]?.content?.parts || [];
    text = cand.map((p) => p.text || '').join('').trim();
  }
  if (!text) throw new Error('Vision model returned an empty description');
  logUsage({ userId, model: modelId, inputTokens: 0, outputTokens: 0, feature: 'videos' });
  return text;
}

async function expandVideoPrompt(userId, { brief, style, aspect, imageDescription, youtubeRef, videoReferenceNotes }) {
  const { light: modelId } = await getModelsForUser(userId);

  const refParts = [];
  if (videoReferenceNotes) {
    refParts.push(`Reference video (uploaded by the user) notes: ${videoReferenceNotes}`);
    refParts.push('Match its pacing, camera feel and mood where appropriate, but do not copy branding or identifiable people.');
  }
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
    : videoReferenceNotes
      ? 'Short clip in the style of the reference video'
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
    promptUsage: {
      model: result.model,
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
    },
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
  const MAX_BYTES = 50 * 1024 * 1024;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download generated video (${res.status})`);
  // Check the declared size first so an oversized file is never pulled into memory.
  if (Number(res.headers.get('content-length')) > MAX_BYTES) {
    throw new Error('Generated video exceeds 50MB — use the provider URL directly');
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error('Generated video exceeds 50MB — use the provider URL directly');
  }
  return { buffer: buf, contentType: res.headers.get('content-type') || 'video/mp4' };
}

const PLAYBACK_HOST_SUFFIXES = ['replicate.delivery', 'fal.media', 'fal.ai'];

function isAllowedPlaybackUrl(url) {
  try {
    const parsed = new URL(String(url));
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return PLAYBACK_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

async function fetchPlaybackVideo(url) {
  if (!isAllowedPlaybackUrl(url)) throw new Error('Video URL is not from an allowed provider');
  return downloadVideoBuffer(url);
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
    videoReferenceNotes = '',
    endImage,
  } = options;

  let seedImageDataUrl = seedImage ? await toImageDataUrl(seedImage) : null;
  const endImageDataUrl = endImage ? await toImageDataUrl(endImage) : null;
  let effectiveSeedMode = seedImageMode === 'suggest' ? 'suggest' : 'animate';
  let youtubeRef = null;

  if (youtubeUrl?.trim()) {
    youtubeRef = await buildYoutubeContext(userId, youtubeUrl.trim(), { describeThumbnail: true });
    if (useYoutubeThumbnailAsSeed && !seedImageDataUrl) {
      seedImageDataUrl = await toImageDataUrl(youtubeRef.thumbnailUrl);
      effectiveSeedMode = 'animate';
    }
  }

  if (!brief?.trim() && !youtubeRef && !seedImageDataUrl && !videoReferenceNotes) {
    throw new Error('Add a brief, reference image, reference video, or YouTube example');
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
    videoReferenceNotes,
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
    endImageDataUrl,
    expanded,
    dims,
    durationSec: replicateDuration(durationSec || body.duration),
    promptUsage: expanded.promptUsage,
    references: {
      seedImageMode: seedImageDataUrl ? effectiveSeedMode : null,
      endFrame: Boolean(endImageDataUrl),
      youtube: youtubeRef ? {
        title: youtubeRef.title,
        url: youtubeRef.url,
        thumbnailUrl: youtubeRef.thumbnailUrl,
        usedThumbnailAsSeed: Boolean(useYoutubeThumbnailAsSeed && effectiveSeedMode === 'animate' && seedImageDataUrl),
      } : null,
      imageDescription,
      videoReferenceNotes: videoReferenceNotes || null,
      youtubeVisualNotes: youtubeRef?.visualNotes || null,
    },
  };
}

async function startVideoGeneration(userId, options) {
  const provider = resolveVideoProvider(options.provider);
  assertModelOptions(provider, options);
  const prepared = await buildGenerationPayload(userId, options);
  return submitPrepared(provider, prepared, options);
}

// Batch runs bill one provider job per take, so the cap is deliberately low.
const MAX_BATCH_TAKES = 4;

/**
 * Several takes of the same clip: references and prompt expansion are done (and paid for) once, then the
 * same request is submitted `count` times. Takes differ because the provider picks a fresh random seed
 * each time. Returns the takes that started; throws only if none did.
 */
async function startVideoGenerationBatch(userId, options, count) {
  const takes = Math.min(MAX_BATCH_TAKES, Math.max(1, Math.floor(Number(count)) || 1));
  const provider = resolveVideoProvider(options.provider);
  assertModelOptions(provider, options);
  const prepared = await buildGenerationPayload(userId, options);
  const settled = await Promise.allSettled(
    Array.from({ length: takes }, () => submitPrepared(provider, prepared, options)),
  );
  const items = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
  const errors = settled.filter((s) => s.status === 'rejected').map((s) => String(s.reason?.message || s.reason));
  if (!items.length) {
    const first = settled.find((s) => s.status === 'rejected');
    throw first.reason instanceof Error ? first.reason : new Error(errors[0] || 'Video generation failed');
  }
  return { items, errors, requested: takes };
}

async function submitPrepared(provider, prepared, options) {
  const modelKey = provider === 'replicate' ? resolveModelKey(options.model) : 'hailuo';
  const seed = modelKey === 'seedance' ? parseSeed(options.seed) : null;
  const shared = {
    provider,
    modelKey,
    seed,
    mode: prepared.imageToVideo ? 'image-to-video' : 'text-to-video',
    video_prompt: prepared.expanded.video_prompt,
    negative_prompt: prepared.expanded.negative_prompt,
    aspect: options.aspect,
    width: prepared.dims.width,
    height: prepared.dims.height,
    durationSec: modelKey === 'seedance' ? seedanceDuration(options.durationSec) : prepared.durationSec,
    references: prepared.references,
    promptUsage: prepared.promptUsage,
    status: 'IN_QUEUE',
  };

  if (provider === 'replicate') {
    const model = modelKey === 'seedance' ? DEFAULT_SEEDANCE_MODEL : resolveReplicateModel(prepared.imageToVideo);
    const input = buildReplicateInput({
      modelKey,
      expanded: prepared.expanded,
      imageToVideo: prepared.imageToVideo,
      seedImageDataUrl: prepared.seedImageDataUrl,
      endImageDataUrl: prepared.endImageDataUrl,
      durationSec: modelKey === 'seedance' ? options.durationSec : prepared.durationSec,
      aspect: options.aspect,
      seed,
      cameraFixed: Boolean(options.cameraFixed),
      promptOptimizer: options.promptOptimizer,
    });
    const pred = await submitReplicateVideoRequest(model, input);
    return {
      ...shared,
      model,
      estimatedVideoCostUsd: calculateVideoCost(model),
      requestId: pred.id,
      pollUrl: pred.urls?.get || null,
      queuePosition: null,
    };
  }

  const queue = await submitFalVideoRequest(prepared.endpoint, prepared.body);
  return {
    ...shared,
    model: prepared.endpoint,
    estimatedVideoCostUsd: calculateVideoCost(prepared.endpoint),
    endpoint: prepared.endpoint,
    requestId: queue.request_id,
    statusUrl: queue.status_url,
    responseUrl: queue.response_url,
    pollUrl: null,
    queuePosition: queue.queue_position ?? null,
  };
}

function buildGenerationUsage(preparedMeta) {
  const promptUsage = preparedMeta.promptUsage || {};
  const promptInputTokens = promptUsage.inputTokens || 0;
  const promptOutputTokens = promptUsage.outputTokens || 0;
  const promptCostUsd = promptUsage.model
    ? calculateCost(promptUsage.model, promptInputTokens, promptOutputTokens)
    : 0;
  const videoCostUsd = calculateVideoCost(preparedMeta.model);
  return {
    // False when we have no real price for the model: the figure is then only a placeholder.
    videoCostKnown: hasVideoPricing(preparedMeta.model),
    promptModel: promptUsage.model || null,
    promptInputTokens,
    promptOutputTokens,
    promptTokens: promptInputTokens + promptOutputTokens,
    promptCostUsd,
    videoCostUsd,
    totalEstimatedCostUsd: promptCostUsd + videoCostUsd,
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
    usage: buildGenerationUsage(preparedMeta),
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
    const seedUsed = pred.input?.seed ?? parseSeedFromLogs(pred.logs) ?? meta.seed ?? null;
    return finalizeVideoResult({ ...meta, seedUsed }, { video: { url: videoUrl } });
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
        model: started.model,
        endpoint: started.endpoint,
        mode: started.mode,
        video_prompt: started.video_prompt,
        negative_prompt: started.negative_prompt,
        aspect: started.aspect,
        width: started.width,
        height: started.height,
        durationSec: started.durationSec,
        references: started.references,
        promptUsage: started.promptUsage,
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
  startVideoGenerationBatch,
  MAX_BATCH_TAKES,
  VIDEO_MODELS,
  resolveModelKey,
  assertModelOptions,
  buildReplicateInput,
  parseSeed,
  parseSeedFromLogs,
  seedanceDuration,
  pollVideoGeneration,
  getVideoGenerateConfig,
  resolveVideoProvider,
  fetchPlaybackVideo,
  isAllowedPlaybackUrl,
  expandVideoPrompt,
  buildYoutubeContext,
  describeReferenceVideoFrames,
  toImageDataUrl,
  transcribeAudioWithGemini,
  isGeminiTranscribeAvailable,
  DEFAULT_VIDEO_MODEL,
  DEFAULT_VIDEO_I2V_MODEL,
  DEFAULT_REPLICATE_VIDEO_MODEL,
  DEFAULT_REPLICATE_VIDEO_I2V_MODEL,
};
