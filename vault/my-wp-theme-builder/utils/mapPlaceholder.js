/**
 * Shared map placeholder asset — SVG data URI used for <img> and CSS background.
 */

const MAP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">'
  + '<rect width="800" height="400" fill="#dce4ec"/>'
  + '<path d="M0 230c140-90 260-50 400-10s260 50 400 10v170H0z" fill="#b8c9d9"/>'
  + '<rect x="90" y="70" width="150" height="110" rx="6" fill="#c5d0db"/>'
  + '<rect x="310" y="150" width="190" height="95" rx="6" fill="#c5d0db"/>'
  + '<rect x="520" y="55" width="170" height="85" rx="6" fill="#c5d0db"/>'
  + '<path d="M100 210h600" stroke="#94a3b8" stroke-width="7" fill="none"/>'
  + '<path d="M220 45v310M520 95v250" stroke="#94a3b8" stroke-width="5" fill="none"/>'
  + '<circle cx="430" cy="215" r="13" fill="#e53935"/>'
  + '<circle cx="430" cy="215" r="22" fill="none" stroke="#e53935" stroke-width="3" opacity="0.45"/>'
  + '</svg>';

const MAP_PLACEHOLDER_IMG = `data:image/svg+xml,${encodeURIComponent(MAP_SVG)}`;

const MAP_CONTAINER_SELECTOR = '.map-ph, .tb-map, .map-placeholder, .contact-map, .map-embed, .google-map, [class*="map-ph"], [class*="map-embed"]';

const MAP_PLACEHOLDER_CSS = `
${MAP_CONTAINER_SELECTOR} {
  position: relative;
  min-height: 280px !important;
  border: 1px solid #94a3b8 !important;
  border-radius: 8px;
  overflow: hidden;
  width: 100%;
  background: #dce4ec url("${MAP_PLACEHOLDER_IMG}") center/cover no-repeat !important;
}
.tb-map-img {
  display: block !important;
  width: 100% !important;
  min-height: 280px !important;
  object-fit: cover !important;
}
.map-ph > span,
.tb-map > span,
.map-ph > p,
.tb-map > p {
  display: none !important;
}
`.trim();

const MAP_IMG_TAG = `<img class="tb-map-img" src="${MAP_PLACEHOLDER_IMG}" alt="Map placeholder with streets and a location pin" width="800" height="400" loading="lazy">`;

const MAP_CONTAINER_CLASS_RE = /(?:map-ph|tb-map|map-placeholder|contact-map|map-embed|google-map)/i;

function isMapContainer(classAttr = '') {
  return MAP_CONTAINER_CLASS_RE.test(classAttr);
}

function upgradeMapPlaceholders(html) {
  if (!html) return html;

  return html.replace(
    /<div\s+([^>]*class=(["'])([^"']+)\2[^>]*)>([\s\S]*?)<\/div>/gi,
    (full, attrs, _q, classes, inner) => {
      if (!isMapContainer(classes)) return full;
      if (/tb-map-img/i.test(inner)) return full;

      const classList = /\btb-map\b/i.test(classes) ? classes : `${classes} tb-map`;
      const otherAttrs = attrs.replace(/\sclass=(["'])[^"']+\1/i, '').trim();
      const attrStr = otherAttrs ? ` ${otherAttrs}` : '';

      return `<div class="${classList}"${attrStr} aria-label="Google Map placeholder">
  ${MAP_IMG_TAG}
</div>`;
    }
  );
}

module.exports = {
  MAP_PLACEHOLDER_IMG,
  MAP_PLACEHOLDER_CSS,
  MAP_IMG_TAG,
  MAP_CONTAINER_CLASS_RE,
  isMapContainer,
  upgradeMapPlaceholders,
};
