'use strict';

/**
 * Collect delivery-related text from a Rainforest search result item.
 * Rainforest uses delivery.tagline + delivery.price (see API docs); AU often splits
 * "Today" in tagline and "FREE delivery available…" in price.raw.
 */
function collectDeliveryTexts(item) {
  const texts = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s) texts.push(s);
  };

  const raw = item?.delivery;
  if (Array.isArray(raw)) {
    for (const d of raw) {
      if (d?.refinement_display_name) continue;
      add(d?.tagline);
      add(d?.price?.raw);
      add(d?.date?.raw);
      add(d?.message);
      add(d?.type);
    }
  } else if (raw && typeof raw === 'object') {
    add(raw.tagline);
    add(raw.price?.raw);
    add(raw.date?.raw);
    add(raw.message);
    add(raw.type);
  } else if (typeof raw === 'string') {
    add(raw);
  }

  add(item?.availability?.raw);
  add(item?.availability?.type);

  const fastest = item?.fastest_delivery;
  if (fastest && typeof fastest === 'object') {
    add(fastest.tagline);
    add(fastest.date?.raw);
    add(fastest.message);
    add(fastest.price?.raw);
  }

  return texts;
}

function deliveryOptionsFromItem(item) {
  const raw = item?.delivery;
  const options = [];

  if (Array.isArray(raw)) {
    for (const d of raw) {
      if (d?.refinement_display_name) continue;
      options.push(d);
    }
  } else if (raw && typeof raw === 'object' && !raw.refinement_display_name) {
    options.push(raw);
  }

  if (!options.length && item?.availability?.raw) {
    options.push({ message: item.availability.raw });
  }

  return options;
}

function inferFreeDelivery(text, deliveryObj, isPrime) {
  if (deliveryObj?.price?.is_free === true) return true;

  const lower = text.toLowerCase();
  if (/\bfree delivery\b/.test(lower)) return true;
  if (/\bfree shipping\b/.test(lower)) return true;
  if (/\bdelivery free\b/.test(lower)) return true;
  if (/\bfree\b/.test(lower) && /\bdelivery\b/.test(lower)) return true;
  if (/\bprime\b/.test(lower) && /\bfree\b/.test(lower)) return true;

  // Paid shipping fee explicitly shown (e.g. "$5.99 delivery") — not free
  if (deliveryObj?.price?.value > 0 && deliveryObj?.price?.is_free !== true) {
    if (!/\bfree delivery\b/.test(lower) && !/\bfree shipping\b/.test(lower)) {
      return false;
    }
  }

  if (isPrime && (/\bfree\b/.test(lower) || !text.trim())) return true;

  return false;
}

function inferWithin2Days(text, deliveryObj) {
  if (!text && !deliveryObj?.date?.raw && !deliveryObj?.tagline) return false;

  const combined = [
    text,
    deliveryObj?.date?.raw,
    deliveryObj?.tagline,
    deliveryObj?.message,
    deliveryObj?.price?.raw,
  ].filter(Boolean).join(' ').toLowerCase();

  if (/\b(today|tomorrow)\b/.test(combined)) return true;
  if (/\b(overnight|same day|same-day)\b/.test(combined)) return true;
  if (/\bwithin\s+(1|2)\s+(day|hr|hour)/.test(combined)) return true;
  if (/\bget it (by|as soon as)\b/.test(combined)) {
    if (/\b(today|tomorrow)\b/.test(combined)) return true;
  }
  if (/\b(1|2)\s+day(s)?\b/.test(combined) && !/\b(3|4|5|6|7|8|9|\d{2,})\s+day/.test(combined)) return true;
  if (/\b1[-–]2\s+day/.test(combined)) return true;
  if (/\bavailable today\b/.test(combined)) return true;
  if (/\bdelivery available today\b/.test(combined)) return true;

  if (/\b(3|4|5|6|7|8|9|\d{2,})\s+day/.test(combined)) return false;
  if (/\bweek(s)?\b/.test(combined)) return false;

  return false;
}

function isBarePriceSnippet(raw) {
  const s = String(raw || '').trim();
  return /^\$[\d,.]+$/.test(s) && !/\bdelivery\b/i.test(s) && !/\bfree\b/i.test(s);
}

function deliveryDisplayParts(option) {
  const parts = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && !isBarePriceSnippet(s)) parts.push(s);
  };
  add(option?.tagline);
  add(option?.price?.raw);
  add(option?.date?.raw);
  add(option?.message);
  add(option?.type);
  return parts;
}

function optionSignals(option, isPrime) {
  const parts = deliveryDisplayParts(option);
  const text = parts.join(' ');
  return {
    text,
    delivery_display: parts.join(' · ') || null,
    free_delivery: inferFreeDelivery(text, option, isPrime),
    within_2_days: inferWithin2Days(text, option),
  };
}

/**
 * Parse Amazon/Rainforest delivery signals from a search result item.
 * @param {object} item
 */
function parseDeliveryInfo(item) {
  const isPrime = Boolean(item?.is_prime);
  const options = deliveryOptionsFromItem(item);

  const signals = options.length
    ? options.map((o) => optionSignals(o, isPrime))
    : [optionSignals({ message: collectDeliveryTexts(item).join(' ') }, isPrime)];

  const combinedText = collectDeliveryTexts(item).join(' ').toLowerCase();
  const anyOption = options[0] || {};

  const free_delivery = signals.some((s) => s.free_delivery)
    || inferFreeDelivery(combinedText, anyOption, isPrime);
  const within_2_days = signals.some((s) => s.within_2_days)
    || inferWithin2Days(combinedText, anyOption);

  const bestSignal = signals.find((s) => s.free_delivery && s.within_2_days && s.delivery_display)
    || signals.find((s) => s.delivery_display);

  const display = bestSignal?.delivery_display
    || collectDeliveryTexts(item).join(' · ')
    || (isPrime ? 'Prime eligible' : null)
    || (free_delivery ? 'Free delivery' : null)
    || '—';

  return {
    free_delivery,
    within_2_days,
    delivery_display: display,
    is_prime: isPrime,
  };
}

/**
 * @param {object[]} candidates
 * @param {{ freeDelivery?: boolean, within2Days?: boolean }} filters
 */
function applyDeliveryFilters(candidates, filters = {}) {
  const { freeDelivery = false, within2Days = false } = filters;
  if (!freeDelivery && !within2Days) return candidates;

  return candidates.filter((c) => {
    const info = c.delivery_info || parseDeliveryInfo(c);
    if (freeDelivery && !info.free_delivery) return false;
    if (within2Days && !info.within_2_days) return false;
    return true;
  });
}

module.exports = {
  parseDeliveryInfo,
  applyDeliveryFilters,
  inferWithin2Days,
  inferFreeDelivery,
  collectDeliveryTexts,
};
