// Pricing per 1M tokens (USD) — update as providers change rates
const PRICING = {
  // Anthropic
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00  },
  'claude-haiku-4-5':           { input: 0.80,  output: 4.00  },
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5':          { input: 3.00,  output: 15.00 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00 },
  'claude-opus-4-5':            { input: 15.00, output: 75.00 },
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
  if (id.includes('opus'))   return { input: 15.00, output: 75.00 };
  if (id.includes('sonnet')) return { input: 3.00,  output: 15.00 };
  if (id.includes('haiku'))  return { input: 0.80,  output: 4.00  };
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

module.exports = { calculateCost, calculateVideoCost };
