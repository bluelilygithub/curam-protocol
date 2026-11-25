'use strict';

// Which country the proxy really sent us out of, and the label each picture carries. Never a silent label: a mismatch says where it
// exited, no answer says so. Test: node server/services/geoCheck/exitCheck.test.js

/** The two-letter country in a "what is my IP" answer (ipinfo.io and the usual provider shapes), or null. */
function readExitCountry(json) {
  if (!json || typeof json !== 'object') return null;
  const raw = json.country_code || json.countryCode || json.country
    || (json.location && (json.location.country_code || json.location.countryCode || json.location.country));
  const code = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** { exitCountry, verified, label } for the country asked for and the one seen (null = no answer). */
function exitVerdict(asked, seen) {
  const want = String(asked || '').toUpperCase();
  if (!seen) return { exitCountry: null, verified: false, label: 'Unverified: exit not confirmed' };
  if (seen === want) return { exitCountry: seen, verified: true, label: 'Verified' };
  return { exitCountry: seen, verified: false, label: `Unverified: exited from ${seen}` };
}

module.exports = { readExitCountry, exitVerdict };
