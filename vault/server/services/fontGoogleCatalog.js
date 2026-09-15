'use strict';

/**
 * Server-side cache of the OFL-filtered Google Fonts catalog for the
 * /fonts picker's search/autocomplete (server/services/fonts/cli_catalog.py).
 * Built once (on first request, or eagerly on boot — see warmCatalog()),
 * refreshed on a TTL since the catalog "changes infrequently" (new fonts
 * land in google/fonts occasionally, not per-minute).
 *
 * This cache is a SEARCH CONVENIENCE ONLY — selecting a family still goes
 * through the real, live fetch/freeze/license-check in
 * fontExportPipeline.js's runFontExport() (which calls cli_export.py's
 * own fetch_and_freeze(), independent of this cache) exactly as manual
 * family-name entry does. If the live repo disagrees with this cache
 * (the Merriweather-went-variable case from Phase 1), that real check is
 * what actually runs and what the designer gets — this cache never skips it.
 */

const fs = require('fs');
const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { runPythonModuleWithFallback } = require('./fontExportPipeline');

const CACHE_TTL_MS = Number(process.env.FONTS_CATALOG_TTL_MS || 24 * 60 * 60 * 1000); // 24h default
const BUILD_TIMEOUT_MS = Number(process.env.FONTS_CATALOG_BUILD_TIMEOUT_MS || 120_000);

let cache = null; // { families, cachedAt, count }
let buildingPromise = null; // in-flight build, so concurrent requests share one subprocess run

async function buildCatalog() {
  const id = crypto.randomUUID();
  const tmpDir = path.join(os.tmpdir(), `vault_fonts_catalog_${id}`);
  await fsp.mkdir(tmpDir, { recursive: true });

  try {
    const { result, triedErrors } = await runPythonModuleWithFallback(
      ['-m', 'fonts.cli_catalog', '--output-dir', tmpDir],
      { timeout: BUILD_TIMEOUT_MS },
    );

    if (!result) {
      const err = new Error(triedErrors.join(' | ') || 'Python font catalog builder is not available on this server.');
      err.code = 'ENOENT';
      throw err;
    }
    if (!result.ok) {
      const err = new Error(result.error || 'Catalog build failed.');
      err.pythonErrorType = result.error_type;
      err.code = 'FONT_CATALOG_BUILD_FAILED';
      throw err;
    }

    const families = JSON.parse(await fsp.readFile(path.join(tmpDir, 'catalog.json'), 'utf8'));
    return { families, cachedAt: new Date().toISOString(), count: families.length };
  } finally {
    fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

function isStale() {
  return !cache || (Date.now() - new Date(cache.cachedAt).getTime()) > CACHE_TTL_MS;
}

/** Returns the cached catalog, building it first if missing/stale. Concurrent callers share one build. */
async function getCatalog({ forceRefresh = false } = {}) {
  if (!forceRefresh && cache && !isStale()) return cache;

  if (!buildingPromise) {
    buildingPromise = buildCatalog()
      .then((result) => {
        cache = result;
        return result;
      })
      .finally(() => {
        buildingPromise = null;
      });
  }
  return buildingPromise;
}

/** Fire-and-forget warm-up — call at server boot so the first real request isn't the one paying the build cost. */
function warmCatalog() {
  getCatalog().catch((err) => {
    console.error('Font catalog warm-up failed (will retry on first request):', err.message);
  });
}

module.exports = { getCatalog, warmCatalog };
