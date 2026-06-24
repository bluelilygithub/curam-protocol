/**
 * Curated Google Fonts for intake heading/body pickers.
 */
const GOOGLE_FONTS = [
  'Cormorant Garamond',
  'Crimson Text',
  'DM Sans',
  'Fraunces',
  'Inter',
  'Josefin Sans',
  'Libre Baskerville',
  'Lora',
  'Merriweather',
  'Montserrat',
  'Nunito',
  'Open Sans',
  'Oswald',
  'Playfair Display',
  'Poppins',
  'Raleway',
  'Roboto',
  'Source Sans 3',
  'Work Sans',
];

function googleFontsCssUrl(families) {
  const params = families
    .filter(Boolean)
    .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;600;700`)
    .join('&');
  return params ? `https://fonts.googleapis.com/css2?${params}&display=swap` : null;
}

function ensureGoogleFontsPreviewLink() {
  let link = document.getElementById('google-fonts-preview');
  if (!link) {
    link = document.createElement('link');
    link.id = 'google-fonts-preview';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
  }
  return link;
}

function updateFontSelectPreview(headingFont, bodyFont) {
  const href = googleFontsCssUrl([headingFont, bodyFont].filter((f, i, arr) => f && arr.indexOf(f) === i));
  const link = ensureGoogleFontsPreviewLink();
  if (href) link.href = href;
}

function populateFontSelect(select, { placeholder = 'Select a Google Font…' } = {}) {
  if (!select) return;

  select.innerHTML = [
    `<option value="">${placeholder}</option>`,
    ...GOOGLE_FONTS.map((font) => `<option value="${font}">${font}</option>`),
  ].join('');
}

function initGoogleFontPickers({ headingId = 'heading-font-select', bodyId = 'body-font-select' } = {}) {
  const headingSelect = document.getElementById(headingId);
  const bodySelect = document.getElementById(bodyId);

  populateFontSelect(headingSelect);
  populateFontSelect(bodySelect);

  function onFontChange() {
    const heading = headingSelect?.value || '';
    const body = bodySelect?.value || '';
    if (headingSelect) headingSelect.style.fontFamily = heading ? `"${heading}", serif` : '';
    if (bodySelect) bodySelect.style.fontFamily = body ? `"${body}", sans-serif` : '';
    updateFontSelectPreview(heading, body);
  }

  headingSelect?.addEventListener('change', onFontChange);
  bodySelect?.addEventListener('change', onFontChange);
}

window.googleFonts = {
  GOOGLE_FONTS,
  populateFontSelect,
  initGoogleFontPickers,
  googleFontsCssUrl,
};
