'use strict';

const { callModel } = require('./callModel');
const { getModelsForUser } = require('./modelResolver');
const { logUsage } = require('../utils/logUsage');
const { parseModelJson } = require('../utils/parseModelJson');

const DEFAULT_VIDEO_MODEL = process.env.VIDEO_GENERATE_MODEL || 'fal-ai/minimax/video-01-live';

const PROMPT_SYSTEM = `You write concise prompts for AI text-to-video models.
Return ONLY valid JSON. No markdown fences.`;

const ASPECT_MAP = {
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '1:1': { width: 720, height: 720 },
};

async function expandVideoPrompt(userId, { brief, style, aspect }) {
  const { light: modelId } = await getModelsForUser(userId);
  const prompt = `User brief: ${brief}
Style: ${style || 'product b-roll'}
Aspect: ${aspect || '16:9'}

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
    video_prompt: parsed?.video_prompt || brief,
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

async function generateVideo(userId, { brief, style, aspect, durationSec }) {
  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) throw new Error('FAL_API_KEY is not configured — required for AI video generation');

  const expanded = await expandVideoPrompt(userId, { brief, style, aspect });
  const dims = ASPECT_MAP[aspect] || ASPECT_MAP['16:9'];
  const endpoint = String(DEFAULT_VIDEO_MODEL).replace(/^https:\/\/fal\.run\//, '').replace(/^\/+/, '');

  const body = {
    prompt: expanded.video_prompt,
    aspect_ratio: aspect === '9:16' ? '9:16' : aspect === '1:1' ? '1:1' : '16:9',
    prompt_optimizer: true,
  };
  if (durationSec) body.duration = Math.min(10, Math.max(3, Number(durationSec) || 5));

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
    videoUrl,
    video_prompt: expanded.video_prompt,
    negative_prompt: expanded.negative_prompt,
    aspect,
    width: dims.width,
    height: dims.height,
    durationSec: body.duration || durationSec || null,
    inline,
  };
}

module.exports = {
  generateVideo,
  expandVideoPrompt,
  DEFAULT_VIDEO_MODEL,
};
