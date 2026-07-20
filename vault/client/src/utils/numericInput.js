/**
 * Thousand-separator helpers for money / numeric text inputs.
 * Store the formatted display string in React state; parse with parseFormattedNumber
 * before sending to APIs.
 */

/**
 * @param {string|number|null|undefined} value
 * @param {{ allowDecimals?: boolean, maxDecimals?: number }} [opts]
 * @returns {string}
 */
export function formatThousands(value, opts = {}) {
  const allowDecimals = opts.allowDecimals !== false;
  const maxDecimals = opts.maxDecimals ?? 2;
  if (value == null || value === '') return '';

  let str = String(value).replace(/,/g, '');
  if (!allowDecimals) {
    str = str.replace(/[^\d]/g, '');
  } else {
    str = str.replace(/[^\d.]/g, '');
    const firstDot = str.indexOf('.');
    if (firstDot !== -1) {
      str = str.slice(0, firstDot + 1) + str.slice(firstDot + 1).replace(/\./g, '');
    }
  }

  if (str === '' || str === '.') return str === '.' ? '0.' : '';

  const endsWithDot = allowDecimals && str.endsWith('.');
  const [intRaw, decRaw] = str.split('.');
  const intPart = intRaw === '' ? '0' : intRaw.replace(/^0+(?=\d)/, '') || '0';
  const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  if (endsWithDot) return `${formattedInt}.`;
  if (decRaw !== undefined && allowDecimals) {
    return `${formattedInt}.${decRaw.slice(0, maxDecimals)}`;
  }
  return formattedInt;
}

/** Strip commas and parse; empty → NaN. */
export function parseFormattedNumber(value) {
  if (value == null || value === '') return NaN;
  const cleaned = String(value).replace(/,/g, '').trim();
  if (!cleaned || cleaned === '.') return NaN;
  return Number(cleaned);
}

/** Like parseFormattedNumber but empty → 0. */
export function parseFormattedNumberOrZero(value) {
  const n = parseFormattedNumber(value);
  return Number.isFinite(n) ? n : 0;
}

/** Format a known numeric for initial state / prefill. */
export function formatNumberForInput(n, opts = {}) {
  if (n == null || n === '' || !Number.isFinite(Number(n))) return '';
  return formatThousands(String(n), opts);
}
