// Finding and naming the element a change is for. These work on a DOM (the preview's document); they are tested against jsdom in
// server/services/restyle/restyleEdits.test.js.

/** Escapes a class or id name for use in a selector (the browser's CSS.escape, with a copy for places that do not have it). */
export function cssEscape(value) {
  const s = String(value);
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_ -￿-]/g, (c) => `\\${c}`).replace(/^(\d)/, '\\3$1 ').replace(/^-(\d)/, '-\\3$1 ');
}

const usefulClasses = (el) => Array.from(el.classList || []).filter((c) => !/^restyle/i.test(c));

/** "h2.title.big": a short readable name for an element. */
export function labelFor(el) {
  return el.tagName.toLowerCase() + usefulClasses(el).map((c) => `.${c}`).join('');
}

function simpleSelector(el) {
  const id = el.getAttribute('id');
  if (id && !/\s/.test(id)) return `#${cssEscape(id)}`;
  return el.tagName.toLowerCase() + usefulClasses(el).slice(0, 2).map((c) => `.${cssEscape(c)}`).join('');
}

/**
 * A selector that matches exactly this element, as short as it can be: its id if it has one, else tag and classes, adding the
 * parent chain and position among same-tag siblings only until it points at nothing else.
 */
export function uniqueSelector(el) {
  const doc = el.ownerDocument;
  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement) {
    let part = simpleSelector(node);
    const isId = part.startsWith('#');
    const parent = node.parentElement;
    if (!isId && parent) {
      const sameKind = Array.from(parent.children).filter((c) => c.matches(part));
      if (sameKind.length > 1) {
        const sameTag = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
      }
    }
    parts.unshift(part);
    const candidate = parts.join(' > ');
    // Unique on THIS page is not enough: the CSS is pasted into a whole site, where "span:nth-of-type(2)" would hit every page. So a
    // selector is only used once it is anchored to an id or a class somewhere in it.
    try { if (/[#.]/.test(candidate) && doc.querySelector(candidate) === el && doc.querySelectorAll(candidate).length === 1) return candidate; } catch { /* keep climbing */ }
    if (isId) break;
    node = parent;
  }
  return parts.join(' > ') || 'body';
}

/**
 * The ways a change could reach beyond the one element: its own classes ("every .card"), and a class on an ancestor combined with this
 * element's tag ("every <a> inside .menu"), which is how a lot of real styling is written.
 * @returns {Array<{selector:string, label:string}>}
 */
export function scopeOptionsFor(el, max = 8) {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  const options = usefulClasses(el).map((c) => ({ selector: `.${cssEscape(c)}`, label: `Every element with class .${c}` }));
  const own = new Set(options.map((o) => o.selector));
  const seen = new Set();
  let ancestor = el.parentElement;
  while (ancestor && ancestor !== doc.body && options.length < max) {
    usefulClasses(ancestor).forEach((c) => {
      if (seen.has(c) || options.length >= max) return;
      seen.add(c);
      options.push({ selector: `.${cssEscape(c)} ${tag}`, label: `Every <${tag}> inside .${c}` });
    });
    ancestor = ancestor.parentElement;
  }
  // Every item of the same kind (every paragraph, every link), for things with no class to go on.
  if (!own.has(tag)) options.push({ selector: tag, label: `Every <${tag}> on the page` });
  // How many items each choice reaches, so the person can see "3 of them" before choosing.
  return options.map((o) => {
    let count = 0;
    try { count = doc.querySelectorAll(o.selector).length; } catch { /* a selector the browser rejects reaches nothing */ }
    return { ...o, count };
  });
}
