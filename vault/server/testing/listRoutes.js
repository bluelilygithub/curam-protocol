'use strict';
/**
 * Every route the real app serves, as { method, path }. Walks Express 4's router stack; a mounted
 * router's prefix is recovered from the layer's regexp. Used by the cross-user test and its manifest.
 */

// Express 4 stores a mount like /api/foo as /^\/api\/foo\/?(?=\/|$)/i and a param as (?:([^\/]+?)).
function mountPrefix(layer) {
  if (layer.regexp && layer.regexp.fast_slash) return '';
  const src = layer.regexp ? layer.regexp.source : '';
  const keys = (layer.keys || []).map((k) => k.name);
  let i = 0;
  return src
    .replace('^', '')
    .replace('\\/?(?=\\/|$)', '')
    .replace(/\(\?:\(\[\^\\\/\]\+\?\)\)/g, () => `:${keys[i++] || 'param'}`)
    .replace(/\\\//g, '/')
    .replace(/\$$/, '');
}

function walk(stack, prefix, out) {
  for (const layer of stack) {
    if (layer.route) {
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        for (const m of Object.keys(layer.route.methods)) {
          if (layer.route.methods[m]) out.push({ method: m.toUpperCase(), path: (prefix + (p === '/' ? '' : p)) || '/' });
        }
      }
    } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
      walk(layer.handle.stack, prefix + mountPrefix(layer), out);
    } else if (layer.name === 'mounted_app' && layer.handle && layer.handle._router) {
      walk(layer.handle._router.stack, prefix + mountPrefix(layer), out); // a sub-app such as /tb
    }
  }
}

function listRoutes(app) {
  const out = [];
  walk(app._router.stack, '', out);
  const seen = new Set();
  return out
    .filter((r) => { const k = `${r.method} ${r.path}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

module.exports = { listRoutes };
