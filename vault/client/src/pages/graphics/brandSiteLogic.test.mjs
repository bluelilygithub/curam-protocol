// node client/src/pages/graphics/brandSiteLogic.test.mjs
import assert from 'node:assert/strict';
import { defaultUse, useIsEmpty, applyBody, summaryOfChanged, roleList, logoLabel, radiusCss, fontSummary, mergeManualKit, fontChoices, effectiveFontSource, stepFontChoices, kitIsDirty } from './brandSiteLogic.mjs';

const file = { bytes: 48676, renderFamily: 'BrandFont17ff0821' };
const brand = {
  colours: { primary: '#d4af37', background: '#0a1628', text: '#ffffff', accent: null, surface: '#192d49', mutedText: null, border: 'junk' },
  radius: { px: 8, label: 'rounded' },
  fonts: {
    heading: { family: 'Montserrat', weight: 600, system: false, source: 'page', file },
    body: { family: 'Montserrat', weight: 400, system: false, source: 'page', file },
  },
  logos: [{ kind: 'img' }, { kind: 'apple-touch-icon' }], logoIndex: 0,
};

// first ticks
let u = defaultUse(brand);
assert.deepEqual(u, { colours: true, radius: true, heading: true, body: false, logo: 0 }, 'body is not ticked when it is the heading font family');
assert.deepEqual(defaultUse({ ...brand, fonts: { heading: { ...brand.fonts.heading, file: null }, body: { family: 'Inter', weight: 400, file } } }), { colours: true, radius: true, heading: false, body: true, logo: 0 });
assert.deepEqual(defaultUse({ colours: {}, radius: { px: null }, fonts: {}, logos: [], logoIndex: null }), { colours: false, radius: false, heading: false, body: false, logo: null });
assert.equal(defaultUse({ ...brand, logoIndex: 5 }).logo, null, 'a logo index with nothing behind it is not ticked');

// empty and the request body
assert.equal(useIsEmpty({ colours: false, radius: false, heading: false, body: false, logo: null }), true);
assert.equal(useIsEmpty({ colours: false, radius: false, heading: false, body: false, logo: 0 }), false, 'logo 0 counts');
assert.deepEqual(applyBody(u), { use: { colours: true, radius: true, logoIndex: 0, fonts: { heading: true, body: false } } });
assert.deepEqual(applyBody({ colours: false, radius: false, heading: false, body: true, logo: null }).use.logoIndex, null);

// wording
assert.equal(summaryOfChanged(['colours', 'logo']), 'Brand Kit updated: colours, logo.');
assert.equal(summaryOfChanged([]), 'Nothing was changed.');
assert.deepEqual(roleList(brand.colours).map((r) => r.key), ['primary', 'background', 'surface', 'text'], 'null and junk colours are left out, in a fixed order');
assert.equal(logoLabel('og-image'), 'Share picture');
assert.equal(logoLabel('weird'), 'Picture');
assert.equal(radiusCss({ px: 8 }), '8px');
assert.equal(radiusCss({ px: 999 }), '9999px');
assert.equal(radiusCss({ px: null }), '0px');
assert.match(fontSummary(brand.fonts.heading), /^Montserrat 600 · file ready \(48 KB, from the page\)$/);
assert.match(fontSummary({ family: 'X', weight: 400, source: 'google-fonts', file }), /from Google Fonts/);
assert.match(fontSummary({ family: 'Arial', weight: 400, system: true, file: null }), /every computer has/);
assert.match(fontSummary({ family: 'sohne-var', weight: 300, system: false, file: null }), /name only/);
assert.equal(fontSummary(null), 'No font found');

// saving the kit by hand keeps what the window does not show
const old = { logoDataUrl: 'data:image/png;base64,A', colors: ['#111111'], fontFamily: 'Montserrat', roles: { primary: '#d4af37' }, radius: { px: 8 }, dark: { background: '#000000', text: '#ffffff' }, headingFont: { family: 'Montserrat', weight: 600, stored: true, renderFamily: 'BrandFont17ff0821' }, source: { url: 'https://x' } };
let m = mergeManualKit(old, { logoDataUrl: '', colors: ['#222222', '', '#333333', '#444444'], fontFamily: ' Montserrat ' });
assert.deepEqual(m.kit.colors, ['#222222', '#333333', '#444444']);
assert.equal(m.kit.logoDataUrl, '');
assert.deepEqual(m.kit.roles, { primary: '#d4af37' });
assert.deepEqual(m.kit.source, { url: 'https://x' });
assert.ok(m.kit.headingFont, 'same font name: the stored heading font stays');
assert.equal(m.dropHeadingFile, false);
m = mergeManualKit(old, { logoDataUrl: 'x', colors: [], fontFamily: 'Playfair Display' });
assert.equal(m.kit.fontFamily, 'Playfair Display');
assert.equal(m.kit.headingFont, undefined, 'a different font name: the old file no longer matches');
assert.equal(m.dropHeadingFile, true);
m = mergeManualKit({ headingFont: { family: 'A', weight: 400, stored: false } }, { logoDataUrl: '', colors: [], fontFamily: 'B' });
assert.equal(m.dropHeadingFile, false, 'nothing to remove when no file was stored');
assert.deepEqual(mergeManualKit(null, { logoDataUrl: '', colors: ['#111111'], fontFamily: '' }).kit, { logoDataUrl: '', colors: ['#111111'], fontFamily: '' }, 'an empty kit works as before');

// fonts a text tool can use
assert.deepEqual(fontChoices(null).map((c) => c.value), ['standard']);
assert.deepEqual(fontChoices({ headingFont: { family: 'Montserrat', stored: true }, bodyFont: { family: 'Inter', stored: false } }).map((c) => c.value), ['standard', 'brand-heading'], 'a font that is only a name is not offered');
assert.equal(fontChoices({ headingFont: { family: 'Montserrat', stored: true }, bodyFont: { family: 'Inter', stored: true } })[2].label, 'Brand body: Inter');
const k2 = { headingFont: { family: 'M', stored: true } };
assert.equal(effectiveFontSource(k2, 'brand-heading'), 'brand-heading');
assert.equal(effectiveFontSource(k2, 'brand-body'), 'standard', 'the kit no longer has it: back to the standard font');
assert.equal(effectiveFontSource(null, 'brand-heading'), 'standard');

// a saved step that names a font the kit does not have is shown as such
assert.deepEqual(stepFontChoices(null, 'brand-heading').map((c) => c.value), ['standard', 'brand-heading']);
assert.equal(stepFontChoices(null, 'brand-heading')[1].label, 'Brand heading (none saved)');
assert.deepEqual(stepFontChoices({ headingFont: { family: 'M', stored: true } }, 'brand-heading').map((c) => c.value), ['standard', 'brand-heading'], 'no duplicate when the kit has it');
assert.deepEqual(stepFontChoices(null, 'standard').map((c) => c.value), ['standard']);
assert.deepEqual(stepFontChoices(null, undefined).map((c) => c.value), ['standard']);

// has the by-hand form changed since the kit was saved?
const savedKit = { logoDataUrl: 'data:image/png;base64,A', colors: ['#111111', '#222222'], fontFamily: 'Montserrat', roles: { primary: '#111111' } };
assert.equal(kitIsDirty(savedKit, { logoDataUrl: 'data:image/png;base64,A', colors: ['#111111', '#222222', ''], fontFamily: 'Montserrat' }), false, 'same logo, colours and font: nothing to save');
assert.equal(kitIsDirty(savedKit, { logoDataUrl: 'data:image/png;base64,A', colors: ['#111111', '#222222', ''], fontFamily: ' Montserrat ' }), false, 'spaces around the name do not count');
assert.equal(kitIsDirty(savedKit, { logoDataUrl: '', colors: ['#111111', '#222222', ''], fontFamily: 'Montserrat' }), true, 'logo removed');
assert.equal(kitIsDirty(savedKit, { logoDataUrl: 'data:image/png;base64,A', colors: ['#111111', '#333333', ''], fontFamily: 'Montserrat' }), true, 'colour changed');
assert.equal(kitIsDirty(savedKit, { logoDataUrl: 'data:image/png;base64,A', colors: ['#111111', '#222222', ''], fontFamily: 'Inter' }), true, 'font name changed');
assert.equal(kitIsDirty(null, { logoDataUrl: '', colors: ['', '', ''], fontFamily: '' }), false, 'nothing saved and nothing typed');
assert.equal(kitIsDirty(null, { logoDataUrl: '', colors: ['#111111', '', ''], fontFamily: '' }), true, 'nothing saved and a colour picked');

console.log('brandSiteLogic tests: ok');
