'use strict';

// The countries Geo-check can show a page from (docs/geo-check.md). One line each: code, name, the browser language, time zone and a
// point in the main city (sent as the browser's location when a site asks). Adding a country is one line.
// Test: node server/services/geoCheck/countries.test.js

const COUNTRIES = [
  ['AU', 'Australia', 'en-AU', 'Australia/Sydney', -33.8688, 151.2093],
  ['NZ', 'New Zealand', 'en-NZ', 'Pacific/Auckland', -36.8485, 174.7633],
  ['US', 'United States', 'en-US', 'America/New_York', 40.7128, -74.0060],
  ['GB', 'United Kingdom', 'en-GB', 'Europe/London', 51.5074, -0.1278],
  ['DE', 'Germany', 'de-DE', 'Europe/Berlin', 52.5200, 13.4050],
  ['JP', 'Japan', 'ja-JP', 'Asia/Tokyo', 35.6762, 139.6503],
  ['CA', 'Canada', 'en-CA', 'America/Toronto', 43.6532, -79.3832],
  ['IE', 'Ireland', 'en-IE', 'Europe/Dublin', 53.3498, -6.2603],
  ['FR', 'France', 'fr-FR', 'Europe/Paris', 48.8566, 2.3522],
  ['ES', 'Spain', 'es-ES', 'Europe/Madrid', 40.4168, -3.7038],
  ['IT', 'Italy', 'it-IT', 'Europe/Rome', 41.9028, 12.4964],
  ['NL', 'Netherlands', 'nl-NL', 'Europe/Amsterdam', 52.3676, 4.9041],
  ['BE', 'Belgium', 'nl-BE', 'Europe/Brussels', 50.8503, 4.3517],
  ['CH', 'Switzerland', 'de-CH', 'Europe/Zurich', 47.3769, 8.5417],
  ['AT', 'Austria', 'de-AT', 'Europe/Vienna', 48.2082, 16.3738],
  ['SE', 'Sweden', 'sv-SE', 'Europe/Stockholm', 59.3293, 18.0686],
  ['NO', 'Norway', 'nb-NO', 'Europe/Oslo', 59.9139, 10.7522],
  ['DK', 'Denmark', 'da-DK', 'Europe/Copenhagen', 55.6761, 12.5683],
  ['FI', 'Finland', 'fi-FI', 'Europe/Helsinki', 60.1699, 24.9384],
  ['PL', 'Poland', 'pl-PL', 'Europe/Warsaw', 52.2297, 21.0122],
  ['PT', 'Portugal', 'pt-PT', 'Europe/Lisbon', 38.7223, -9.1393],
  ['SG', 'Singapore', 'en-SG', 'Asia/Singapore', 1.3521, 103.8198],
  ['HK', 'Hong Kong', 'zh-HK', 'Asia/Hong_Kong', 22.3193, 114.1694],
  ['KR', 'South Korea', 'ko-KR', 'Asia/Seoul', 37.5665, 126.9780],
  ['IN', 'India', 'en-IN', 'Asia/Kolkata', 19.0760, 72.8777],
  ['ID', 'Indonesia', 'id-ID', 'Asia/Jakarta', -6.2088, 106.8456],
  ['MY', 'Malaysia', 'ms-MY', 'Asia/Kuala_Lumpur', 3.1390, 101.6869],
  ['PH', 'Philippines', 'en-PH', 'Asia/Manila', 14.5995, 120.9842],
  ['TH', 'Thailand', 'th-TH', 'Asia/Bangkok', 13.7563, 100.5018],
  ['AE', 'United Arab Emirates', 'en-AE', 'Asia/Dubai', 25.2048, 55.2708],
  ['ZA', 'South Africa', 'en-ZA', 'Africa/Johannesburg', -26.2041, 28.0473],
  ['BR', 'Brazil', 'pt-BR', 'America/Sao_Paulo', -23.5505, -46.6333],
  ['MX', 'Mexico', 'es-MX', 'America/Mexico_City', 19.4326, -99.1332],
].map(([code, name, locale, timezoneId, latitude, longitude]) => ({ code, name, locale, timezoneId, latitude, longitude }));

const DEFAULT_COUNTRIES = ['AU', 'NZ', 'US', 'GB', 'DE', 'JP'];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

/** The country for a two-letter code (any case), or null when it is not in the list. */
function countryOf(code) {
  return BY_CODE.get(String(code || '').trim().toUpperCase()) || null;
}

module.exports = { COUNTRIES, DEFAULT_COUNTRIES, countryOf };
