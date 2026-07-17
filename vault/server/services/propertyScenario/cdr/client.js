'use strict';

/**
 * Low-level CDR HTTP client with x-v version negotiation.
 * Banks differ: list may accept v4/v5 while detail wants v6/v7 (CommBank).
 */

const DEFAULT_VERSIONS = [7, 6, 5, 4, 3];
const DEFAULT_TIMEOUT_MS = 20000;

function parseSupportedVersions(res, bodyText) {
  const fromHeader = res.headers.get('x-v');
  if (fromHeader && /^\d+$/.test(String(fromHeader).trim())) {
    return [Number(fromHeader)];
  }
  try {
    const body = JSON.parse(bodyText || '{}');
    const detail = body?.errors?.[0]?.detail || '';
    const minMax = detail.match(/min\s*=\s*(\d+).*max\s*=\s*(\d+)/i);
    if (minMax) {
      const min = Number(minMax[1]);
      const max = Number(minMax[2]);
      const out = [];
      for (let v = max; v >= min; v -= 1) out.push(v);
      return out;
    }
    const single = detail.match(/version[s]?\s*[:=]?\s*(\d+)/i);
    if (single) return [Number(single[1])];
  } catch {
    /* ignore */
  }
  return [];
}

/**
 * @param {string} url
 * @param {{ versions?: number[], timeoutMs?: number, query?: Record<string,string|number> }} [opts]
 * @returns {Promise<{ ok: boolean, status: number, version: number|null, json: object|null, error?: string }>}
 */
async function cdrFetch(url, opts = {}) {
  const versions = [...(opts.versions || DEFAULT_VERSIONS)];
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const tried = new Set();
  let lastError = 'No version succeeded';

  while (versions.length) {
    const v = versions.shift();
    if (tried.has(v)) continue;
    tried.add(v);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const u = new URL(url);
      if (opts.query) {
        Object.entries(opts.query).forEach(([k, val]) => {
          if (val != null) u.searchParams.set(k, String(val));
        });
      }
      const res = await fetch(u.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-v': String(v),
          'x-min-v': '1',
        },
        signal: controller.signal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (res.ok) {
        return { ok: true, status: res.status, version: v, json };
      }

      if (res.status === 406) {
        const supported = parseSupportedVersions(res, text);
        supported.forEach((sv) => {
          if (!tried.has(sv)) versions.unshift(sv);
        });
        lastError = `HTTP 406 unsupported x-v=${v}`
          + (supported.length ? ` (hint: ${supported.join(',')})` : '');
        continue;
      }

      lastError = `HTTP ${res.status}`
        + (json?.errors?.[0]?.detail ? `: ${json.errors[0].detail}` : '');
      // Non-406 errors: don't keep retrying all versions unless it's clearly version-related
      if (res.status !== 400) {
        return { ok: false, status: res.status, version: v, json, error: lastError };
      }
    } catch (err) {
      lastError = err.name === 'AbortError' ? `Timeout after ${timeoutMs}ms` : (err.message || String(err));
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, status: 0, version: null, json: null, error: lastError };
}

/**
 * Paginate Get Products until pages exhausted or maxPages reached.
 */
async function fetchAllProducts(baseUrl, opts = {}) {
  const category = opts.category || 'RESIDENTIAL_MORTGAGES';
  const pageSize = opts.pageSize || 25;
  const maxPages = opts.maxPages || 6;
  const versions = opts.versions;
  // Some banks (Westpac) ignore product-category and return 0 results when filtered.
  // For those, fetch all products unfiltered then filter client-side.
  const skipCategoryFilter = Boolean(opts.skipCategoryFilter);
  const products = [];
  let page = 1;
  let versionUsed = null;

  while (page <= maxPages) {
    const query = { 'page-size': pageSize };
    if (!skipCategoryFilter) query['product-category'] = category;
    // CDR standards treat page as 1-based, but some banks (notably Westpac) reject
    // `page=1` with 422 and only accept the first page when `page` is omitted.
    if (page > 1) query.page = page;

    const result = await cdrFetch(`${baseUrl.replace(/\/$/, '')}/banking/products`, {
      versions: versionUsed ? [versionUsed, ...(versions || DEFAULT_VERSIONS)] : versions,
      query,
      timeoutMs: opts.timeoutMs,
    });
    if (!result.ok) {
      return {
        ok: products.length > 0,
        products,
        error: result.error,
        version: versionUsed,
        pages: Math.max(0, page - 1),
      };
    }
    versionUsed = result.version;
    let batch = result.json?.data?.products || [];
    // Client-side category filter for banks that don't support server-side filtering
    if (skipCategoryFilter) {
      batch = batch.filter((p) => p.productCategory === category);
    }
    products.push(...batch);
    const totalPages = Number(result.json?.meta?.totalPages) || page;
    if (page >= totalPages || (result.json?.data?.products || []).length === 0) break;
    page += 1;
  }

  return { ok: true, products, version: versionUsed, pages: page, error: null };
}

async function fetchProductDetail(baseUrl, productId, opts = {}) {
  const result = await cdrFetch(
    `${baseUrl.replace(/\/$/, '')}/banking/products/${encodeURIComponent(productId)}`,
    { versions: opts.versions, timeoutMs: opts.timeoutMs }
  );
  if (!result.ok) {
    return { ok: false, product: null, version: result.version, error: result.error };
  }
  return {
    ok: true,
    product: result.json?.data || null,
    version: result.version,
    error: null,
  };
}

module.exports = {
  DEFAULT_VERSIONS,
  cdrFetch,
  fetchAllProducts,
  fetchProductDetail,
  parseSupportedVersions,
};
