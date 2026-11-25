'use strict';

// The residential proxy for Geo-check, from environment variables only (docs/geo-check.md, docs/env-vars.md). Provider-agnostic: any
// provider with one gateway address and the country in the username or password fits (DataImpulse, IPRoyal, Decodo, Oxylabs, ...).
// The username and password never leave this module except into Playwright's proxy option: never logged, stored or sent to a browser.
// Test: node server/services/geoCheck/proxy.test.js

const DEFAULT_CHECK_URL = 'https://ipinfo.io/json';

const env = (name, source) => String(source[name] || '').trim();

function fill(template, code) {
  return template.replace(/\{country\}/g, code.toLowerCase()).replace(/\{COUNTRY\}/g, code.toUpperCase());
}

/** True when the three required variables are set. */
function isConfigured(source = process.env) {
  return !!(env('GEO_PROXY_SERVER', source) && env('GEO_PROXY_USERNAME_TEMPLATE', source) && env('GEO_PROXY_PASSWORD', source));
}

/** Playwright's proxy option for one country, or null when the proxy is not set up. */
function proxyFor(code, source = process.env) {
  if (!isConfigured(source) || !/^[A-Za-z]{2}$/.test(String(code || ''))) return null;
  return {
    server: env('GEO_PROXY_SERVER', source),
    username: fill(env('GEO_PROXY_USERNAME_TEMPLATE', source), code),
    password: fill(env('GEO_PROXY_PASSWORD', source), code),
  };
}

/** The address that answers "which country does this request come from" (asked through the proxy). */
function checkUrl(source = process.env) {
  return env('GEO_PROXY_CHECK_URL', source) || DEFAULT_CHECK_URL;
}

/** A$ per GB for the estimate, or null when not set. */
function costPerGb(source = process.env) {
  const n = Number(env('GEO_PROXY_COST_PER_GB', source));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Safe to log or show an admin: the provider label and the gateway host, never the username or password. */
function describe(source = process.env) {
  if (!isConfigured(source)) return { configured: false };
  let gateway = null;
  try { gateway = new URL(env('GEO_PROXY_SERVER', source)).host; } catch { gateway = 'invalid address'; }
  return { configured: true, label: env('GEO_PROXY_LABEL', source) || null, gateway };
}

module.exports = { isConfigured, proxyFor, checkUrl, costPerGb, describe, DEFAULT_CHECK_URL };
