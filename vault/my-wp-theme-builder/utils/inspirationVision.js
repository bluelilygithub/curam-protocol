'use strict';

const path = require('path');

const DEFAULT_ANTHROPIC_VISION = process.env.INSPIRATION_VISION_ANTHROPIC || 'claude-sonnet-4-6';
const DEFAULT_GEMINI_VISION = process.env.INSPIRATION_VISION_GEMINI || 'gemini-2.0-flash';

function loadAnthropicSdk() {
  try {
    return require('@anthropic-ai/sdk');
  } catch {
    return require(path.join(__dirname, '..', '..', 'node_modules', '@anthropic-ai/sdk'));
  }
}

function loadGoogleGenerativeAi() {
  try {
    return require('@google/generative-ai');
  } catch {
    return require(path.join(__dirname, '..', '..', 'node_modules', '@google', 'generative-ai'));
  }
}

function formatNavHint(navLinks = []) {
  if (!navLinks.length) return '';
  const labels = navLinks.map((l) => l.text).filter(Boolean).join(', ');
  return `Nav links detected in rendered DOM: ${labels}`;
}

function buildVisionPrompt(url, extracted = {}) {
  const styleHints = [];
  if (extracted.styles?.body?.fontFamily) {
    styleHints.push(`Body font: ${extracted.styles.body.fontFamily}`);
  }
  if (extracted.styles?.h1?.fontFamily) {
    styleHints.push(`H1 font: ${extracted.styles.h1.fontFamily}`);
  }
  if (extracted.colors?.length) {
    styleHints.push(`Computed colours: ${extracted.colors.join(', ')}`);
  }

  return `You are a senior web designer analyzing a reference website for a bespoke HTML/CSS theme builder.

URL: ${url}
${formatNavHint(extracted.navLinks)}
${styleHints.length ? styleHints.join('\n') : ''}

This is a FULL-PAGE screenshot (top to bottom). Study the whole page and respond with concise bullet points only (max 16 bullets):
- Section-by-section rhythm down the page (hero → … → footer): what each major section does and how they alternate
- Navigation pattern (placement, style, density)
- Typography character (families feel, scale, weight contrast)
- Colour palette with approximate hex values
- Spacing and layout density
- Recurring layout patterns (grids, asymmetry, full-bleed bands, alternating backgrounds)
- Distinctive motifs worth homaging (not copying assets)
- Mood and brand feel

Be specific and actionable for an HTML/CSS designer. No preamble.`;
}

function withTimeout(promise, ms, label = 'Vision analysis') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    }),
  ]);
}

async function analyzeWithAnthropic({ screenshotBase64, url, extracted }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const visionModel = process.env.INSPIRATION_VISION_MODEL?.startsWith('claude-')
    ? process.env.INSPIRATION_VISION_MODEL
    : DEFAULT_ANTHROPIC_VISION;

  const Anthropic = loadAnthropicSdk();
  const client = new Anthropic.Anthropic({ apiKey });
  const prompt = buildVisionPrompt(url, extracted);
  const visionTimeoutMs = Number(process.env.INSPIRATION_VISION_TIMEOUT_MS) || 90_000;

  const response = await withTimeout(
    client.messages.create({
      model: visionModel,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: screenshotBase64,
            },
          },
          { type: 'text', text: prompt },
        ],
      }],
    }),
    visionTimeoutMs,
    'Anthropic vision analysis'
  );

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
    .trim();

  return { ok: true, designBrief: text, model: visionModel, provider: 'anthropic' };
}

async function analyzeWithGemini({ screenshotBase64, url, extracted }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const visionModel = process.env.INSPIRATION_VISION_MODEL?.startsWith('gemini-')
    ? process.env.INSPIRATION_VISION_MODEL
    : DEFAULT_GEMINI_VISION;

  const { GoogleGenerativeAI } = loadGoogleGenerativeAi();
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: visionModel });
  const prompt = buildVisionPrompt(url, extracted);
  const visionTimeoutMs = Number(process.env.INSPIRATION_VISION_TIMEOUT_MS) || 90_000;

  const result = await withTimeout(
    model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: 'image/jpeg', data: screenshotBase64 } },
    ]),
    visionTimeoutMs,
    'Gemini vision analysis'
  );

  return {
    ok: true,
    designBrief: result.response.text().trim(),
    model: visionModel,
    provider: 'gemini',
  };
}

async function analyzeScreenshot({ screenshotBase64, url, extracted = {} }) {
  if (!screenshotBase64) {
    return { ok: false, skipped: true, reason: 'no_screenshot' };
  }

  const providers = [];
  if (process.env.ANTHROPIC_API_KEY) providers.push('anthropic');
  if (process.env.GEMINI_API_KEY) providers.push('gemini');

  if (!providers.length) {
    return { ok: false, skipped: true, reason: 'no_vision_api_key' };
  }

  const errors = [];

  for (const provider of providers) {
    try {
      const result = provider === 'anthropic'
        ? await analyzeWithAnthropic({ screenshotBase64, url, extracted })
        : await analyzeWithGemini({ screenshotBase64, url, extracted });
      if (result?.ok) return result;
    } catch (err) {
      errors.push(`${provider}: ${err.message || 'failed'}`);
    }
  }

  return {
    ok: false,
    error: errors.join('; ') || 'Vision analysis failed',
  };
}

module.exports = {
  analyzeScreenshot,
};
