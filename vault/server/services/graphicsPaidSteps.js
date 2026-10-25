'use strict';

// Recipe steps that call a paid AI service: removing a background and upscaling. Pure helpers: what they cost, how many pictures a
// single call may carry, and which ones are present. The prices themselves come from the same estimators the single tools use
// (estimateBackgroundCost, upscaleCostForSize), passed in, so a recipe and the tool can never quote different prices.

const PAID_OPS = ['removebg', 'upscale'];
const MAX_UPSCALE_OUTPUT_MP = Number(process.env.GRAPHICS_MAX_UPSCALE_MP) || 64;

// A call stays open while every picture is processed one after another, and the gateway closes a request left open for about five
// minutes. So a call carrying AI steps takes fewer pictures; the browser sends the rest in further calls.
const MAX_PICTURES_PER_CALL = { removebg: 8, upscale: 4 };

const isPaidOp = (op) => PAID_OPS.includes(op);
const paidSteps = (steps) => (Array.isArray(steps) ? steps.filter((s) => isPaidOp(s?.op)) : []);

/** The scale an upscale step uses: 2 or 4 (anything else becomes 2). */
const upscaleScaleOf = (step) => (Number(step?.scale) >= 4 ? 4 : 2);

/** How many pictures one call may carry for these steps (Infinity when there is no AI step). */
function maxPicturesPerCall(steps) {
  const ops = paidSteps(steps).map((s) => s.op);
  if (!ops.length) return Infinity;
  return Math.min(...ops.map((op) => MAX_PICTURES_PER_CALL[op]));
}

/**
 * Walks the steps for one picture of the given size and returns { usd, usdKnown, outputMp }.
 * Size changes by crop/resize are not followed (the cost is quoted for the picture as chosen), but each upscale multiplies the size
 * for the next one. \`backgroundUsd\` is the price of one removal; \`upscaleUsd({width,height,scale})\` the price of one upscale.
 */
function priceOneRun(steps, size, { backgroundUsd, upscaleUsd }) {
  let w = Number(size?.width) || 0;
  let h = Number(size?.height) || 0;
  let usd = 0;
  let known = true;
  for (const step of paidSteps(steps)) {
    if (step.op === 'removebg') {
      usd += backgroundUsd || 0;
    } else {
      const scale = upscaleScaleOf(step);
      const price = upscaleUsd({ width: w, height: h, scale });
      if (price == null) known = false; else usd += price;
      w *= scale; h *= scale;
    }
  }
  return { usd: Number(usd.toFixed(4)), usdKnown: known, outputMp: w && h ? (w * h) / 1e6 : null };
}

/** Total for a list of pictures (each { width, height }). */
function priceJob(steps, sizes, prices) {
  let usd = 0;
  let known = true;
  for (const size of sizes) {
    const one = priceOneRun(steps, size, prices);
    usd += one.usd;
    if (!one.usdKnown) known = false;
  }
  return { usd: Number(usd.toFixed(4)), usdKnown: known };
}

/** A recipe's upscale steps must not grow a picture past the output limit: returns an error message or null. */
function upscaleTooBig(steps, size) {
  let w = Number(size?.width) || 0;
  let h = Number(size?.height) || 0;
  for (const step of paidSteps(steps)) {
    if (step.op !== 'upscale') continue;
    const scale = upscaleScaleOf(step);
    w *= scale; h *= scale;
    const mp = (w * h) / 1e6;
    if (mp > MAX_UPSCALE_OUTPUT_MP) return `The upscaled picture would be about ${Math.round(mp)} megapixels; the limit is ${MAX_UPSCALE_OUTPUT_MP}. Use a smaller scale, or shrink the picture first.`;
  }
  return null;
}

/** "removebg,upscale:4" (the cost note's compact form) -> steps. */
function parsePaidList(text) {
  return String(text || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 12).map((t) => {
    const [op, scale] = t.split(':');
    return isPaidOp(op) ? { op, ...(scale ? { scale: Number(scale) } : {}) } : null;
  }).filter(Boolean);
}

/** The two price functions priceOneRun needs, from the single tools' own estimators. */
function makePrices({ isLocal, backgroundCost, upscaleCost }) {
  return {
    backgroundUsd: backgroundCost({ isLocal }).usd,
    upscaleUsd: (args) => upscaleCost(args).usd,
  };
}

module.exports = { makePrices, PAID_OPS, MAX_PICTURES_PER_CALL, isPaidOp, paidSteps, upscaleScaleOf, maxPicturesPerCall, priceOneRun, priceJob, upscaleTooBig, parsePaidList };
