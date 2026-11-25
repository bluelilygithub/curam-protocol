// Pure helpers for Device preview's Countries view (CountriesView.jsx, docs/geo-check.md). Test: node client/src/pages/devicePreview/countriesModel.test.mjs

export const DEFAULT_SCREEN_IDS = ['iphone-15', 'laptop-1366'];
export const MAX_COUNTRY_SCREENS = 4;
export const MAX_COUNTRIES = 12;

/** A spoken address ("example dot com slash shop") as typed text; null when nothing is left. (The Screens view has the same rule inline.) */
export function parseSpokenAddress(t) {
  const words = { dot: '.', slash: '/', colon: ':', dash: '-', hyphen: '-', underscore: '_' };
  const joined = String(t || '').replace(/\b(dot|slash|colon|dash|hyphen|underscore)\b/gi, (w) => words[w.toLowerCase()]).replace(/\s+/g, '').replace(/\.+$/, '');
  return joined ? joined.toLowerCase() : null;
}

/** "12.3 MB" (one decimal under 10 MB, whole numbers above). */
export function formatMb(bytes) {
  const mb = Number(bytes || 0) / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "about A$0.04" from bytes and the A$ price per GB, or '' when no price is set. */
export function formatCost(bytes, costPerGb) {
  if (!costPerGb) return '';
  const aud = (Number(bytes || 0) / 1e9) * costPerGb;
  return `about A$${aud < 0.01 ? '0.01' : aud.toFixed(2)}`;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The live line under the set-up: "6 countries x 2 screens = 12 pictures, about 24 MB, about A$0.04". */
export function estimateLine({ countries, screens, bytesPerCountry, costPerGb }) {
  const pictures = countries * screens;
  const bytes = countries * (bytesPerCountry || 0);
  const cost = formatCost(bytes, costPerGb);
  return `${plural(countries, 'country', 'countries')} x ${plural(screens, 'screen', 'screens')} = ${plural(pictures, 'picture', 'pictures')}, about ${formatMb(bytes)}${cost ? `, ${cost}` : ''}`;
}

/** What a capture's badge says, and its tone: ok (green), warn (amber) or bad (red). */
export function captureLabel(c) {
  if (!c) return { text: 'Not captured', tone: 'bad' };
  if (c.status === 'failed') return { text: 'Failed', tone: 'bad' };
  if (c.verified) return { text: 'Verified', tone: 'ok' };
  if (c.exitCountry) return { text: `Unverified: exited from ${c.exitCountry}`, tone: 'warn' };
  return { text: 'Unverified: exit not confirmed', tone: 'warn' };
}

/** The run as a grid: rows = countries in the order asked, columns = screens; each cell is that capture or null (not done yet). */
export function gridOf(run) {
  const settings = (run && run.settings) || {};
  const screens = settings.screens || [];
  const captures = (run && run.captures) || [];
  return {
    screens,
    rows: (settings.countries || []).map((country) => ({
      country,
      cells: screens.map((s) => captures.find((c) => c.country === country && c.deviceId === s.id) || null),
    })),
  };
}

/** The screens a run asks for, from catalogue devices: phones are sent as phones, everything else as a desktop browser. */
export function screensForRun(devices) {
  return devices.map((d) => ({ id: d.id, label: d.label, width: d.width, height: d.height, mobile: d.kind === 'phone' }));
}

/** Adds or removes an id, refusing (refused: true) a fifth screen. */
export function toggleId(list, id, max = MAX_COUNTRY_SCREENS) {
  if (list.includes(id)) return { list: list.filter((x) => x !== id), refused: false };
  if (list.length >= max) return { list, refused: true };
  return { list: [...list, id], refused: false };
}
