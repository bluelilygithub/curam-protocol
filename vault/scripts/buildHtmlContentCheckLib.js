#!/usr/bin/env node
'use strict';

/**
 * Bundles DocCompare's HTML reader and the `diff` package into one CommonJS file for HTML Content Check's server code:
 * dist/html-content-check-lib/index.cjs (entry server/services/htmlContentCheck/lib/entry.mjs). Uses the esbuild that DocCompare's own
 * node_modules already has (installed in the base image), so Vault's package.json is not changed. Under a second.
 *
 * Run by scripts/buildDocCompare.js during `npm run build`, by hand (`node scripts/buildHtmlContentCheckLib.js`), and by the server itself
 * outside production when the bundle is missing or older than its sources (server/services/htmlContentCheck/lib/index.js).
 * A failed build does not stop Vault's deploy: the server checks the bundle on boot and files a Suggestions-inbox alert, and the tool's
 * fetch routes answer with a plain message. See docs/html-content-check.md ("The bundled reader").
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY = path.join(ROOT, 'server', 'services', 'htmlContentCheck', 'lib', 'entry.mjs');
const OUT = path.join(ROOT, 'dist', 'html-content-check-lib', 'index.cjs');
const DOC_COMPARE_MODULES = path.join(ROOT, 'doc-compare', 'node_modules');
// The files the bundle is made from: a newer one means the bundle is stale (used by the dev check).
const SOURCES = [ENTRY, path.join(ROOT, 'server', 'services', 'htmlContentCheck', 'lib', 'noReadability.mjs'), ...['readers/html.ts', 'readers/finalize.ts', 'readers/types.ts'].map((f) => path.join(ROOT, 'doc-compare', 'src', f))];

// Full mode never uses Readability (DocCompare's main-content guess), so the bundle carries a stand-in that refuses to run instead of the
// package. That keeps the bundle independent of whether doc-compare/node_modules has it (the base image of 2026-11-26 did not).
const NO_READABILITY = path.join(ROOT, 'server', 'services', 'htmlContentCheck', 'lib', 'noReadability.mjs');

function build() {
  const esbuild = require(path.join(DOC_COMPARE_MODULES, 'esbuild'));
  esbuild.buildSync({
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    nodePaths: [DOC_COMPARE_MODULES],
    logLevel: 'error',
    legalComments: 'none',
    alias: { '@mozilla/readability': NO_READABILITY },
  });
  return OUT;
}

function isStale() {
  if (!fs.existsSync(OUT)) return true;
  const built = fs.statSync(OUT).mtimeMs;
  return SOURCES.some((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs > built);
}

module.exports = { build, isStale, OUT };

if (require.main === module) {
  try {
    build();
    console.log(`[html-content-check] reader bundled into ${path.relative(ROOT, OUT)}`);
  } catch (err) {
    console.error(`[html-content-check] FAILED to bundle the reader: ${err.message}`);
    process.exit(1);
  }
}
