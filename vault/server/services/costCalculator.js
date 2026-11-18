// Pricing per 1M tokens (USD) — update as providers change rates.
// Anthropic list prices checked 2026-11-18. Thinking tokens bill as output. Cache and batch discounts are not modelled.
const PRICING = {
  // Anthropic — Fable (most capable, most expensive)
  'claude-fable-5-2':           { input: 8.00,  output: 40.00 },
  'claude-fable-5-1':           { input: 10.00, output: 50.00 },
  'claude-fable-5':             { input: 10.00, output: 50.00 },
  // Anthropic — Opus
  'claude-opus-5-5':            { input: 4.00,  output: 20.00 },
  'claude-opus-5':              { input: 5.00,  output: 25.00 },
  'claude-opus-4-8':            { input: 5.00,  output: 25.00 },
  'claude-opus-4-7':            { input: 5.00,  output: 25.00 },
  'claude-opus-4-6':            { input: 5.00,  output: 25.00 },
  'claude-opus-4-5':            { input: 5.00,  output: 25.00 },
  'claude-opus-4-5-20251101':   { input: 5.00,  output: 25.00 },
  // Anthropic — Sonnet
  'claude-sonnet-5-5':          { input: 2.00,  output: 10.00 },
  'claude-sonnet-5':            { input: 2.00,  output: 10.00 },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':          { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00,  output: 15.00 },
  // Anthropic — Haiku. Haiku 5.5 costs $0.50 / $2.50 when one prompt is over 100K tokens; the lower rate is used here.
  'claude-haiku-5-5':           { input: 0.10,  output: 0.50  },
  'claude-haiku-4-5-20251001':  { input: 1.00,  output: 5.00  },
  'claude-haiku-4-5':           { input: 1.00,  output: 5.00  },
  'claude-3-5-sonnet-20241022': { input: 3.00,  output: 15.00 },
  'claude-3-5-haiku-20241022':  { input: 0.80,  output: 4.00  },
  // Google Gemini
  'gemini-2.0-flash':           { input: 0.10,  output: 0.40  },
  'gemini-2.0-flash-exp':       { input: 0.10,  output: 0.40  },
  'gemini-1.5-flash':           { input: 0.075, output: 0.30  },
  'gemini-1.5-pro':             { input: 1.25,  output: 5.00  },
  'gemini-2.5-pro':             { input: 1.25,  output: 10.00 },
  'gemini-2.5-flash':           { input: 0.15,  output: 0.60  },
};

// Fallback: substring match for unknown model IDs
function lookupBySubstring(modelId) {
  const id = modelId.toLowerCase();
  // Unknown versions get the higher price of their family, so a new id is not under-counted.
  if (id.includes('fable') || id.includes('mythos')) return { input: 10.00, output: 50.00 };
  if (id.includes('opus'))   return { input: 5.00,  output: 25.00 };
  if (id.includes('sonnet')) return { input: 3.00,  output: 15.00 };
  if (id.includes('haiku'))  return { input: 1.00,  output: 5.00  };
  if (id.includes('pro'))    return { input: 1.25,  output: 10.00 };
  if (id.includes('flash'))  return { input: 0.10,  output: 0.40  };
  return { input: 1.00, output: 5.00 }; // safe generic fallback
}

/**
 * Calculate estimated cost in USD for a given model and token counts.
 * @param {string} modelId
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number} cost in USD
 */
function calculateCost(modelId, inputTokens, outputTokens) {
  const rates = PRICING[modelId] || lookupBySubstring(modelId);
  const cost = (inputTokens / 1_000_000) * rates.input
             + (outputTokens / 1_000_000) * rates.output;
  return cost;
}

// Video generation is billed per-clip, not per-token — flat USD estimate per
// generation, keyed by the model id actually submitted to the provider.
// Update as Replicate/FAL rates change. Duration-insensitive approximation
// (Replicate hailuo-2.3 charges ~$0.017-$0.028/sec at 768p depending on
// duration; FAL minimax video-01-live is a flat per-clip rate).
const VIDEO_PRICING = {
  'minimax/hailuo-2.3': 0.20,   // Replicate, ~6-10s clip at 768p
  'fal-ai/minimax/video-01-live': 0.50,
  'fal-ai/minimax/video-01-live/image-to-video': 0.50,
};

/** True only when we hold a real price for this model; unknown models get a generic placeholder figure. */
function hasVideoPricing(modelId) {
  const id = String(modelId || '').toLowerCase();
  return VIDEO_PRICING[modelId] != null || id.includes('hailuo') || id.includes('minimax');
}

function lookupVideoBySubstring(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('hailuo')) return 0.20;
  if (id.includes('minimax')) return 0.50;
  return 0.30; // safe generic fallback
}

/**
 * Estimated flat USD cost for one video generation.
 * @param {string} modelId
 * @returns {number} cost in USD
 */
function calculateVideoCost(modelId) {
  if (VIDEO_PRICING[modelId] != null) return VIDEO_PRICING[modelId];
  return lookupVideoBySubstring(modelId);
}

/** True only when this exact model has a price on file; others are priced by a generic rate matched on the name. */
function hasPricing(modelId) {
  return PRICING[modelId] != null;
}

module.exports = { hasPricing, calculateCost, calculateVideoCost, hasVideoPricing };
