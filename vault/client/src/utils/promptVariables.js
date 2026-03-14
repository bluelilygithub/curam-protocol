const VAR_RE = /\{\{([a-zA-Z0-9_]+)\}\}/g;

/** Returns an array of unique variable names found in the template text. */
export function extractVariables(text) {
  const names = [];
  const seen = new Set();
  let m;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); names.push(m[1]); }
  }
  return names;
}

/** Replaces every {{name}} with the corresponding value from the values map. */
export function fillVariables(text, values) {
  return text.replace(VAR_RE, (_, name) => (values[name] !== undefined ? values[name] : `{{${name}}}`));
}

/** Capitalises and replaces underscores — "first_name" → "First Name". */
export function labelFor(name) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
