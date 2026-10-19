// Lists, the demo page and the "what does this page already use" scan for the CSS page (RestylePage.jsx). No CSS jargon in the labels.

export const FONT_OPTIONS = [
  { value: '', label: 'System default' },
  { value: "'Inter', sans-serif", label: 'Inter' },
  { value: "'Roboto', sans-serif", label: 'Roboto' },
  { value: "'Merriweather', serif", label: 'Merriweather' },
  { value: "'Poppins', sans-serif", label: 'Poppins' },
];

export const SHADOW_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: '0 1px 3px rgba(0,0,0,0.12)', label: 'Subtle' },
  { value: '0 4px 12px rgba(0,0,0,0.15)', label: 'Soft' },
  { value: '0 8px 24px rgba(0,0,0,0.2)', label: 'Strong' },
  { value: '0 0 0 3px rgba(59,130,246,0.5)', label: 'Outline glow' },
];

export const TEXT_TRANSFORM_OPTIONS = [
  { value: 'none', label: 'Normal' },
  { value: 'uppercase', label: 'ALL CAPS' },
  { value: 'lowercase', label: 'all lowercase' },
  { value: 'capitalize', label: 'Title Case' },
];

export const TEXT_ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
  { value: 'justify', label: 'Justify' },
];

// Outline styles for hover/selected states, injected as a SEPARATE <style> tag inside the preview, never merged into the person's own
// CSS or the generated changes, so nothing about their design is touched just to show selection.
export const OUTLINE_CSS = `
  [data-restyle-hover] { outline: 2px dashed #3b82f6 !important; outline-offset: 1px; cursor: pointer; }
  [data-restyle-selected] { outline: 2px solid #cc785c !important; outline-offset: 1px; }
  /* box-shadow, not outline, so this shows together with the selected/hover outlines instead of one silently overriding the other */
  [data-restyle-scope-preview] { box-shadow: 0 0 0 2px #f59e0b !important; }
`;

// Demo page: a header, a paragraph, a card and an image, loaded through the same clean-up as a real page.
export const DEMO_HTML = `<header class="site-header"><h1>Welcome to Acme Co.</h1><p class="tagline">Tools that just work.</p></header>
<main>
  <p class="intro">This is a short paragraph of body text you can click on and restyle. Try changing its color, size, or font using the panel on the left, or just describe what you want in plain English.</p>
  <div class="card">
    <h2>Feature card</h2>
    <p>Cards like this one are a common building block on real websites — click the card itself, its heading, or this paragraph to try editing each one separately.</p>
    <a class="button" href="#">Learn more</a>
  </div>
  <img class="demo-image" alt="A simple placeholder graphic" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='220'%3E%3Crect width='400' height='220' fill='%23cc785c'/%3E%3Ctext x='50%25' y='50%25' font-family='sans-serif' font-size='22' fill='white' text-anchor='middle' dominant-baseline='middle'%3EImage placeholder%3C/text%3E%3C/svg%3E" />
</main>`;

export const DEMO_CSS = `.site-header { background: #1a1a1a; color: #ffffff; padding: 32px; text-align: center; }
.site-header h1 { margin: 0 0 8px; font-size: 32px; }
.tagline { margin: 0; opacity: 0.8; }
main { max-width: 640px; margin: 0 auto; padding: 24px; font-family: system-ui, sans-serif; }
.intro { font-size: 16px; line-height: 1.6; color: #333333; }
.card { background: #f5f5f0; border: 1px solid #d8d8d0; border-radius: 8px; padding: 20px; margin: 20px 0; }
.card h2 { margin-top: 0; }
.button { display: inline-block; background: #cc785c; color: #ffffff; padding: 8px 16px; border-radius: 6px; text-decoration: none; }
.button:hover { background: #b3452c; }
.demo-image { display: block; max-width: 100%; border-radius: 8px; margin-top: 20px; }
@media (max-width: 480px) { .site-header h1 { font-size: 24px; } main { padding: 12px; } }`;

// Checks the curated list first, then any font stacks detected in the uploaded CSS/HTML, so the dropdown can show an element's real
// current font even when it is not one of the four curated choices.
export function matchFontOption(fontFamily, detectedFonts) {
  const known = ['Inter', 'Roboto', 'Merriweather', 'Poppins'];
  const found = known.find((f) => fontFamily.includes(f));
  if (found) return FONT_OPTIONS.find((o) => o.value.includes(found))?.value || '';
  const primary = fontFamily.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
  const detected = (detectedFonts || []).find((f) => f.label.toLowerCase() === primary || f.value.toLowerCase() === fontFamily.trim().toLowerCase());
  return detected ? detected.value : '';
}

export function normalizeWeight(w) {
  const n = parseInt(w, 10);
  if (Number.isNaN(n)) return '400';
  if (n >= 700) return '700';
  if (n >= 600) return '600';
  if (n <= 300) return '300';
  return '400';
}

export function parseLineHeight(lineHeight, fontSize) {
  if (lineHeight === 'normal') return 1.2;
  const lh = parseFloat(lineHeight);
  const fs = parseFloat(fontSize) || 16;
  if (String(lineHeight).endsWith('px')) return Math.round((lh / fs) * 10) / 10;
  return Math.round(lh * 10) / 10 || 1.2;
}

const GENERIC_FONT_KEYWORDS = new Set(['inherit', 'initial', 'unset', 'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui']);

// Pulls every distinct font stack, colour and size actually used in the page's CSS/HTML so they can be offered as quick picks, instead
// of only the fixed lists. It always scans the FULL text for distinct values first and applies the display cap only as a final slice:
// breaking out of the scan at the cap once hid every colour from a style file that came after a big embedded block.
export function scanCssAssets(cssText, htmlText) {
  const combined = `${cssText || ''}\n${htmlText || ''}`;

  const fonts = [];
  const fontSeen = new Set();
  for (const m of combined.matchAll(/font-family\s*:\s*([^;"'}]+(?:['"][^'"]*['"][^;}]*)?)/gi)) {
    const raw = m[1].replace(/!important/i, '').trim().replace(/;$/, '');
    const primary = raw.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
    if (!raw || GENERIC_FONT_KEYWORDS.has(primary)) continue;
    const key = raw.toLowerCase();
    if (fontSeen.has(key)) continue;
    fontSeen.add(key);
    fonts.push({ value: raw, label: raw.split(',')[0].replace(/['"]/g, '').trim() });
  }

  const colors = [];
  const colorSeen = new Set();
  for (const m of combined.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]+\)/g)) {
    const key = m[0].toLowerCase();
    if (colorSeen.has(key)) continue;
    colorSeen.add(key);
    colors.push(m[0]);
  }

  const extractSizes = (prop) => {
    const out = [];
    const seen = new Set();
    const re = new RegExp(`${prop}\\s*:\\s*([\\d.]+(?:px|rem|em|pt|%))`, 'gi');
    for (const m of combined.matchAll(re)) {
      if (seen.has(m[1])) continue;
      seen.add(m[1]);
      out.push(m[1]);
    }
    return out.sort((a, b) => parseFloat(a) - parseFloat(b));
  };

  return {
    fonts: fonts.slice(0, 40),
    colors: colors.slice(0, 60),
    sizes: extractSizes('font-size').slice(0, 20),
    paddings: extractSizes('padding(?:-top|-right|-bottom|-left)?').slice(0, 20),
    radii: extractSizes('border-radius').slice(0, 20),
  };
}
