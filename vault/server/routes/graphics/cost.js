'use strict';

// GET /api/graphics/cost-preview — what a paid tool will cost, and how much of today's limit is left,
// BEFORE the person presses the button. Nothing is spent or logged here. Not behind the paid-job guard
// (it only covers POST), so it still answers when the limit has been reached.
//
//   ?tool=generate|augment|inpaint|upscale|background|icons|describe
//   &runs=N            how many runs the job will make (default 1; a batch passes its size)
//   &width=&height=&scale=   upscale only: the source picture's pixels and the scale

const express = require('express');
const router = express.Router();
const {
  pool,
  runtimeConfig,
  resolveGraphicsModel,
  resolveGraphicsProvider,
  estimateGenerateCost,
  upscaleCostForSize,
  estimateBackgroundCost,
} = require('./shared');
const { spentLast24h, dailyCapUsd } = require('../../middleware/graphicsLimits');
const { buildCostPreview } = require('../../services/graphicsCostPreview');

const TOOLS = ['generate', 'augment', 'inpaint', 'upscale', 'background', 'icons', 'describe'];

async function priceOfOneRun(tool, userId, q) {
  if (tool === 'generate' || tool === 'augment') {
    const model = await resolveGraphicsModel(userId);
    const provider = await resolveGraphicsProvider(userId, model);
    return estimateGenerateCost({ provider });
  }
  if (tool === 'inpaint') return estimateGenerateCost({ provider: 'fal' }); // inpainting is hosted only
  if (tool === 'upscale') {
    if (runtimeConfig.isLocal) return { usd: 0, local: true };
    const scale = Math.min(8, Math.max(1, Number(q.scale) || 2));
    return upscaleCostForSize({ width: Number(q.width) || 0, height: Number(q.height) || 0, scale });
  }
  if (tool === 'background') return estimateBackgroundCost({ isLocal: runtimeConfig.isLocal });
  return { usd: null }; // icons and alt text are billed by the words the AI uses, so there is no price until it has run
}

router.get('/cost-preview', async (req, res) => {
  try {
    const tool = String(req.query.tool || '');
    if (!TOOLS.includes(tool)) return res.status(400).json({ error: `tool must be one of ${TOOLS.join(', ')}` });
    const runs = Math.min(100, Math.max(1, Math.floor(Number(req.query.runs) || 1)));
    const cost = await priceOfOneRun(tool, req.user.id, req.query);
    let spentUsd = 0;
    try {
      spentUsd = await spentLast24h(pool, req.user.id);
    } catch (err) {
      console.error('[graphics] cost preview spend read failed:', err.message); // the note still shows the price
    }
    res.json({
      tool,
      ...buildCostPreview({ perRunUsd: cost.usd, runs, spentUsd, capUsd: dailyCapUsd(), estimate: cost.estimate }),
      megapixels: cost.megapixels ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
