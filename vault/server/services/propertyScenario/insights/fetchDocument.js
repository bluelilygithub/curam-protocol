'use strict';

/**
 * Fetch + extract text from lender T&Cs / PDS (PDF or HTML).
 * Self-contained SSRF guard — does not import scenario/calc/orchestrator.
 */

const dns = require('dns');
const http = require('http');
const https = require('https');
const { getCachedDocument, setCachedDocument } = require('./documentCache');

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const MAX_TEXT_CHARS = 120_000;
const FETCH_TIMEOUT_MS = 20000;

function isPrivateIp(ip) {
  if (ip === '::1') return true;
  const lower = String(ip).toLowerCase();
  if (lower.startsWith('fe80')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false;
  const [a, b] = parts;
  if (a === 127 || a === 10 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

function checkSsrf(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address) => {
      if (err) return reject(new Error('DNS lookup failed'));
      if (isPrivateIp(address)) {
        return reject(new Error('URL resolves to a private or internal address'));
      }
      resolve(address);
    });
  });
}

function fetchBuffer(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    if (redirectsLeft === 0) return reject(new Error('Too many redirects'));
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return reject(new Error('Invalid URL'));
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return reject(new Error('Only http/https URLs are allowed'));
    }

    checkSsrf(parsed.hostname).then(() => {
      const mod = parsed.protocol === 'https:' ? https : http;
      const opts = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; CuramVaultInsights/1.0)',
          Accept: 'application/pdf,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-AU,en;q=0.9',
        },
        timeout: FETCH_TIMEOUT_MS,
      };

      const req = mod.request(opts, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchBuffer(next, redirectsLeft - 1));
        }
        const chunks = [];
        let bytes = 0;
        res.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_BYTES) {
            req.destroy();
            return reject(new Error('Response too large'));
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          resolve({
            buffer: Buffer.concat(chunks),
            statusCode: res.statusCode,
            contentType: String(res.headers['content-type'] || ''),
            finalUrl: url,
          });
        });
        res.on('error', reject);
      });
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Document fetch timed out'));
      });
      req.on('error', reject);
      req.end();
    }).catch(reject);
  });
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|br|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function extractPdfText(buffer) {
  // pdfjs-dist v4+ ships ESM-only builds (`pdf.mjs`); use dynamic import from CJS.
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const getDocument = pdfjsLib.getDocument || pdfjsLib.default?.getDocument;
  if (!getDocument) {
    throw new Error('pdfjs-dist getDocument unavailable');
  }
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((item) => item.str).join(' ').trim();
    if (line) pages.push({ page: i, text: line });
  }
  const text = pages.map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n').trim();
  return { text, pages: pages.length, format: 'pdf' };
}

function looksLikePdf(buffer, contentType, url) {
  if (buffer && buffer.length >= 4 && buffer.slice(0, 4).toString('utf8') === '%PDF') return true;
  if (/pdf/i.test(contentType || '') && !/html/i.test(contentType || '')) return true;
  // URL hint only when bytes aren't clearly HTML
  if (/\.pdf(\?|#|$)/i.test(url || '') && !looksLikeHtml(buffer, contentType)) return true;
  return false;
}

function looksLikeHtml(buffer, contentType) {
  if (/html/i.test(contentType || '')) return true;
  const head = buffer ? buffer.slice(0, 256).toString('utf8').trim().toLowerCase() : '';
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<head');
}

function truncateText(text, max = MAX_TEXT_CHARS) {
  const s = String(text || '');
  if (s.length <= max) return { text: s, truncated: false };
  return {
    text: `${s.slice(0, max)}\n\n[… document truncated for analysis — ${s.length} chars total …]`,
    truncated: true,
  };
}

/**
 * Fetch a single document URL and extract plain text.
 * @param {string} url
 * @param {{ forceRefresh?: boolean, label?: string }} [opts]
 * @returns {Promise<object>}
 */
async function fetchDocument(url, opts = {}) {
  const href = String(url || '').trim();
  if (!href) {
    return {
      ok: false,
      url: null,
      error: 'no_url',
      message: 'No document URL provided',
    };
  }

  if (!opts.forceRefresh) {
    const cached = getCachedDocument(href);
    if (cached) return cached;
  }

  try {
    const res = await fetchBuffer(href);
    if (res.statusCode >= 400) {
      const fail = {
        ok: false,
        url: href,
        error: 'http_error',
        message: `Couldn't retrieve this document (HTTP ${res.statusCode})`,
        status_code: res.statusCode,
      };
      // Don't cache hard failures long-term — skip set
      return fail;
    }

    let extracted;
    if (looksLikePdf(res.buffer, res.contentType, href)) {
      try {
        extracted = await extractPdfText(res.buffer);
      } catch (err) {
        return {
          ok: false,
          url: href,
          error: 'pdf_extract_failed',
          message: `Couldn't extract text from this PDF: ${err.message || err}`,
        };
      }
    } else if (/html|text\/plain|xml/i.test(res.contentType) || res.buffer.slice(0, 200).toString('utf8').includes('<')) {
      const raw = htmlToText(res.buffer.toString('utf8'));
      extracted = { text: raw, pages: null, format: /html/i.test(res.contentType) ? 'html' : 'text' };
    } else {
      // Try PDF first, then HTML
      try {
        extracted = await extractPdfText(res.buffer);
      } catch {
        const raw = htmlToText(res.buffer.toString('utf8'));
        if (!raw || raw.length < 40) {
          return {
            ok: false,
            url: href,
            error: 'unsupported_format',
            message: `Couldn't retrieve usable text from this document (content-type: ${res.contentType || 'unknown'})`,
            content_type: res.contentType || null,
          };
        }
        extracted = { text: raw, pages: null, format: 'html' };
      }
    }

    if (!extracted.text || extracted.text.length < 40) {
      return {
        ok: false,
        url: href,
        error: 'empty_document',
        message: "Couldn't retrieve usable text from this document (empty or non-standard format)",
      };
    }

    const clipped = truncateText(extracted.text);
    const payload = {
      ok: true,
      url: href,
      label: opts.label || null,
      format: extracted.format,
      pages: extracted.pages,
      char_count: extracted.text.length,
      truncated: clipped.truncated,
      text: clipped.text,
      retrieved_at: new Date().toISOString(),
      cache_hit: false,
    };
    setCachedDocument(href, payload);
    return payload;
  } catch (err) {
    return {
      ok: false,
      url: href,
      error: 'fetch_failed',
      message: `Couldn't retrieve this document: ${err.message || err}`,
    };
  }
}

/**
 * Collect document URLs from a CDR-normalized lender product row.
 * @param {object} product
 * @returns {{ kind: string, url: string }[]}
 */
function documentUrlsFromProduct(product) {
  const links = product?.links || {};
  const out = [];
  const push = (kind, url) => {
    if (!url || typeof url !== 'string') return;
    const href = url.trim();
    if (!href) return;
    if (out.some((d) => d.url === href)) return;
    out.push({ kind, url: href });
  };
  push('terms', links.terms);
  push('fees', links.fees);
  push('eligibility', links.eligibility);
  push('overview', links.overview);
  push('rate_info', links.rate_info);
  return out;
}

/**
 * Fetch all linked docs for a product (cached per URL).
 * @param {object} product — CDR-normalized lender row
 * @param {{ forceRefresh?: boolean }} [opts]
 */
async function fetchProductDocuments(product, opts = {}) {
  const urls = documentUrlsFromProduct(product);
  if (!urls.length) {
    return {
      ok: false,
      product_id: product?.id || product?.product_id || null,
      documents: [],
      error: 'no_document_links',
      message: "Couldn't retrieve this document — no T&Cs/PDS/fees links on this product",
    };
  }

  const documents = [];
  for (const entry of urls) {
    // Prefer terms first; still try others if terms fail
    // eslint-disable-next-line no-await-in-loop
    const doc = await fetchDocument(entry.url, { ...opts, label: entry.kind });
    documents.push({ ...doc, kind: entry.kind });
  }

  const okDocs = documents.filter((d) => d.ok);
  return {
    ok: okDocs.length > 0,
    product_id: product?.id || product?.product_id || null,
    product_name: product?.name || product?.product || null,
    lender: product?.lender || null,
    documents,
    ok_count: okDocs.length,
    fail_count: documents.length - okDocs.length,
    message: okDocs.length
      ? null
      : (documents[0]?.message || "Couldn't retrieve any linked documents for this product"),
  };
}

/**
 * Build a single corpus string for the LLM from successful document fetches.
 */
function corpusFromDocuments(pack) {
  const parts = [];
  (pack.documents || []).filter((d) => d.ok).forEach((d) => {
    parts.push(
      `=== DOCUMENT kind=${d.kind || 'unknown'} url=${d.url} format=${d.format || '?'} ===\n${d.text}`
    );
  });
  return parts.join('\n\n');
}

module.exports = {
  fetchDocument,
  fetchProductDocuments,
  documentUrlsFromProduct,
  corpusFromDocuments,
  htmlToText,
  MAX_TEXT_CHARS,
  MAX_BYTES,
};
