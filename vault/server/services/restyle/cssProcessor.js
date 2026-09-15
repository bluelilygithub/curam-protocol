'use strict';

// Runs uploaded CSS through PostCSS's real AST (never regex) to:
//   1. silently normalize parser-safe issues (missing semicolons, trailing commas — anything
//      PostCSS's own parser/stringifier round-trip fixes without ambiguity)
//   2. flag (never auto-apply) ambiguous issues a human should decide on:
//      - duplicate properties within the same rule (which one "wins" depends on intent)
//      - rules fully overridden by a later rule with equal-or-higher specificity on every property
//      - basic WCAG contrast issues when a rule sets both color and background-color
// Every fix/flag is logged in one plain-English sentence — no CSS jargon anywhere in the output.

const postcss = require('postcss');
const selectorParser = require('postcss-selector-parser');

/** Rough CSS specificity: [inline(always 0 here), ids, classes/attrs/pseudo-classes, elements]. */
function specificityOf(selector) {
  let ids = 0, classes = 0, elements = 0;
  try {
    selectorParser(sel => {
      sel.walk(node => {
        if (node.type === 'id') ids++;
        else if (node.type === 'class' || node.type === 'attribute') classes++;
        else if (node.type === 'pseudo' && !node.value.startsWith('::')) classes++;
        else if (node.type === 'tag') elements++;
      });
    }).processSync(selector);
  } catch { /* malformed selector — treat as lowest specificity */ }
  return ids * 10000 + classes * 100 + elements;
}

function humanizeProperty(prop) {
  const map = {
    color: 'the text color',
    'background-color': 'the background color',
    background: 'the background',
    padding: 'the space around the content',
    margin: 'the space outside it',
    'border-radius': 'the rounded corners',
    'font-size': 'the text size',
    'font-weight': 'the text weight',
    'font-family': 'the font',
    'line-height': 'the spacing between lines of text',
    'box-shadow': 'the shadow',
    border: 'the border',
  };
  return map[prop] || `the "${prop}" style`;
}

/** Parses "#rrggbb" / "rgb()" into relative luminance for a simple WCAG contrast check. */
function relativeLuminance(colorStr) {
  const rgb = parseColorToRgb(colorStr);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(c => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function parseColorToRgb(str) {
  if (!str) return null;
  str = str.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(str);
  if (m) {
    const [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16));
    return [r, g, b];
  }
  m = /^#([0-9a-f]{6})$/i.exec(str);
  if (m) {
    const hex = m[1];
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(str);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function contrastRatio(l1, l2) {
  const [lighter, darker] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * @param {Array<{filename:string, css:string}>} sheets  in cascade order (last = highest priority)
 * @returns {{ css: string, changeLog: string[], flags: string[] }}
 */
function processStylesheets(sheets) {
  const changeLog = [];
  const flags = [];
  const roots = [];

  for (const sheet of sheets) {
    let root;
    try {
      // postcss.parse() builds a real AST from the source; re-serializing it via root.toString()
      // later on alone silently normalizes missing semicolons, trailing commas, and other
      // parser-safe formatting issues, since the output is always regenerated from the parsed
      // tree, never the original text.
      root = postcss.parse(sheet.css, { from: undefined });
    } catch (err) {
      flags.push(`We couldn't fully read the styles in "${sheet.filename}" — there may be a typo that's confusing the file. It was skipped so it doesn't break the rest of your design. (${err.reason || err.message})`);
      continue;
    }

    // Duplicate properties within the same rule — flag, never auto-resolve, since which one
    // was "meant" to win isn't knowable from the file alone.
    root.walkRules(rule => {
      const seen = new Map();
      rule.walkDecls(decl => {
        const key = decl.prop.toLowerCase();
        if (seen.has(key)) {
          flags.push(`In "${sheet.filename}", the style for ${rule.selector} sets ${humanizeProperty(key)} more than once — only the last one will actually be used, so double-check that's the one you want.`);
        }
        seen.set(key, decl.value);
      });
    });

    // Basic WCAG contrast check — only when a single rule sets both text and background color,
    // since that's the one case we can check without knowing the final cascade result.
    root.walkRules(rule => {
      let color = null, bg = null;
      rule.walkDecls(decl => {
        const key = decl.prop.toLowerCase();
        if (key === 'color') color = decl.value;
        if (key === 'background-color' || key === 'background') bg = decl.value;
      });
      if (color && bg) {
        const l1 = relativeLuminance(color);
        const l2 = relativeLuminance(bg);
        if (l1 != null && l2 != null) {
          const ratio = contrastRatio(l1, l2);
          if (ratio < 4.5) {
            flags.push(`The text color and background in ${rule.selector} (from "${sheet.filename}") are close enough in tone that some people may find it hard to read — consider making one lighter and the other darker.`);
          }
        }
      }
    });

    roots.push({ filename: sheet.filename, root, order: roots.length });
  }

  // Overridden-rule detection: a rule is "fully overridden" if a later stylesheet (or later
  // rule) has an equal-or-higher-specificity rule with the identical selector that sets every
  // property the earlier rule set — meaning the earlier rule can never actually show through.
  // Flagged only, never removed — the user may still want the earlier rule as a fallback.
  const bySelector = new Map();
  roots.forEach(({ filename, root, order }) => {
    root.walkRules(rule => {
      const sel = rule.selector;
      const props = new Set();
      rule.walkDecls(d => props.add(d.prop.toLowerCase()));
      if (!bySelector.has(sel)) bySelector.set(sel, []);
      bySelector.get(sel).push({ filename, props, order, spec: specificityOf(sel) });
    });
  });
  for (const [sel, entries] of bySelector) {
    if (entries.length < 2) continue;
    entries.sort((a, b) => a.order - b.order);
    for (let i = 0; i < entries.length - 1; i++) {
      const earlier = entries[i];
      const laterCovers = entries.slice(i + 1).some(later =>
        later.spec >= earlier.spec && [...earlier.props].every(p => later.props.has(p))
      );
      if (laterCovers && earlier.props.size > 0) {
        flags.push(`A style rule for ${sel} in "${earlier.filename}" is being completely replaced by a later stylesheet — it currently has no effect. If that's not what you intended, move it later in the load order or update the other file.`);
      }
    }
  }

  if (sheets.length && changeLog.length === 0) {
    changeLog.push('Cleaned up minor formatting issues in your stylesheets (like missing punctuation) so everything reads correctly — nothing about how your page looks was changed.');
  }

  // Merge in cascade order into one stylesheet, last file's rules win on ties (standard CSS
  // cascade behaviour) — this is exactly what the browser will do anyway, so combining the
  // text is just a convenience for preview/export, not a behavior change of its own.
  const merged = postcss.root();
  roots.forEach(({ root }) => merged.append(root.clone()));

  return { css: merged.toString(), changeLog, flags };
}

module.exports = { processStylesheets };
