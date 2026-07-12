'use strict';

/**
 * Parse Amazon/Rainforest delivery signals from a search result item.
 * @param {object} item
 */
function parseDeliveryInfo(item) {
  const deliveryRaw = item?.delivery;
  const deliveryObj = Array.isArray(deliveryRaw) ? deliveryRaw[0] : (deliveryRaw || {});

  const parts = [
    deliveryObj?.price?.raw,
    deliveryObj?.date?.raw,
    deliveryObj?.type,
    deliveryObj?.message,
    item?.availability?.raw,
    typeof deliveryRaw === 'string' ? deliveryRaw : null,
  ].filter(Boolean);

  const text = parts.join(' ').toLowerCase();
  const isPrime = Boolean(item?.is_prime);

  const freeDelivery = deliveryObj?.price?.is_free === true
    || /\bfree delivery\b/.test(text)
    || /\bfree shipping\b/.test(text)
    || /\bdelivery free\b/.test(text)
    || (isPrime && (/\bfree\b/.test(text) || !text));

  const within2Days = inferWithin2Days(text, deliveryObj);

  const display = parts[0]
    || (isPrime ? 'Prime eligible' : null)
    || (freeDelivery ? 'Free delivery' : null)
    || '—';

  return {
    free_delivery: freeDelivery,
    within_2_days: within2Days,
    delivery_display: display,
    is_prime: isPrime,
  };
}

function inferWithin2Days(text, deliveryObj) {
  if (!text && !deliveryObj?.date?.raw) return false;

  const combined = `${text} ${deliveryObj?.date?.raw || ''}`.toLowerCase();

  if (/\b(today|tomorrow)\b/.test(combined)) return true;
  if (/\b(overnight|same day|same-day)\b/.test(combined)) return true;
  if (/\bwithin\s+(1|2)\s+day/.test(combined)) return true;
  if (/\b(1|2)\s+day(s)?\b/.test(combined) && !/\b(3|4|5|6|7|8|9|\d{2,})\s+day/.test(combined)) return true;
  if (/\bget it by\b/.test(combined) || /\barrives?\b/.test(combined)) {
    if (/\b(tomorrow|today|mon|tue|wed|thu|fri|sat|sun)\b/.test(combined)) return true;
  }
  if (/\b1[-–]2\s+day/.test(combined)) return true;

  if (/\b(3|4|5|6|7|8|9|\d{2,})\s+day/.test(combined)) return false;
  if (/\bweek(s)?\b/.test(combined)) return false;

  return false;
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

module.exports = { parseDeliveryInfo, applyDeliveryFilters, inferWithin2Days };
