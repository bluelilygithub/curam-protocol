'use strict';

// node server/services/pdfTools.test.js   (npm run test:pdf-tools)
// Extract Images: builds small PDFs with pictures stored in the ways real PDFs store them and checks what comes back.

const assert = require('assert');
const zlib = require('zlib');
const { PDFDocument, PDFHexString } = require('pdf-lib');
const sharp = require('sharp');
const JSZip = require('jszip');
const { extractImages, zipImages, imagePreview } = require('./pdfTools');

const flate = (buf) => zlib.deflateSync(buf);

// Adds one picture XObject to the document's objects (it does not have to be drawn on a page to be found).
function addImage(doc, bytes, dict) {
  return doc.context.register(doc.context.stream(bytes, { Type: 'XObject', Subtype: 'Image', ...dict }));
}
const save = async (doc) => { doc.addPage([200, 200]); return Buffer.from(await doc.save()); };
const rawPixels = async (png) => { const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true }); return { data, info }; };

(async () => {
  // ---- a JPEG photo is copied byte for byte ----
  {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#3366cc' } }).jpeg({ quality: 80 }).toBuffer();
    const doc = await PDFDocument.create();
    await doc.embedJpg(jpeg);
    const { images, skipped } = await extractImages(await save(doc));
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].ext, 'jpg');
    assert.ok(images[0].bytes.equals(jpeg), 'the original JPEG bytes, untouched');
    assert.strictEqual(skipped, 0);
  }

  // ---- PNG pictures (Flate + PNG predictors) come back as PNG, pixels intact ----
  {
    const raw = Buffer.alloc(30 * 20 * 3);
    for (let i = 0; i < 30 * 20; i += 1) { raw[i * 3] = (i * 7) % 256; raw[i * 3 + 1] = (i * 3) % 256; raw[i * 3 + 2] = 200; }
    const png = await sharp(raw, { raw: { width: 30, height: 20, channels: 3 } }).png().toBuffer();
    const doc = await PDFDocument.create();
    await doc.embedPng(png);
    const { images } = await extractImages(await save(doc));
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].ext, 'png');
    const { data, info } = await rawPixels(images[0].bytes);
    assert.deepStrictEqual([info.width, info.height], [30, 20]);
    assert.ok(data.equals(raw), 'every pixel is the same');
  }

  // ---- a PNG with see-through parts keeps its transparency (the PDF stores it as a separate soft mask) ----
  {
    const rgba = Buffer.alloc(24 * 24 * 4);
    for (let i = 0; i < 24 * 24; i += 1) { rgba[i * 4] = 200; rgba[i * 4 + 1] = 30; rgba[i * 4 + 2] = 30; rgba[i * 4 + 3] = i % 24 < 12 ? 255 : 0; }
    const png = await sharp(rgba, { raw: { width: 24, height: 24, channels: 4 } }).png().toBuffer();
    const doc = await PDFDocument.create();
    await doc.embedPng(png);
    const { images } = await extractImages(await save(doc));
    assert.strictEqual(images.length, 1, 'the mask is not listed as a separate picture');
    const { data, info } = await rawPixels(images[0].bytes);
    assert.strictEqual(info.channels, 4);
    assert.strictEqual(data[3], 255, 'left half opaque');
    assert.strictEqual(data[(0 * 24 + 20) * 4 + 3], 0, 'right half transparent');
  }

  // ---- greyscale, inverted greyscale, 4-bit indexed, CMYK ----
  {
    const doc = await PDFDocument.create();
    const gray = Buffer.alloc(16 * 16); for (let i = 0; i < gray.length; i += 1) gray[i] = i % 256;
    addImage(doc, flate(gray), { Width: 16, Height: 16, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' });
    addImage(doc, flate(Buffer.alloc(16 * 16, 10)), { Width: 16, Height: 16, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode', Decode: [1, 0] });
    // 4-bit indexed: palette red, green, blue; a row of 16 pixels cycling 0,1,2
    const idxRows = []; for (let y = 0; y < 16; y += 1) { const row = Buffer.alloc(8); for (let x = 0; x < 16; x += 1) { const v = x % 3; row[x >> 1] |= x % 2 === 0 ? v << 4 : v; } idxRows.push(row); }
    addImage(doc, flate(Buffer.concat(idxRows)), {
      Width: 16, Height: 16, BitsPerComponent: 4, Filter: 'FlateDecode',
      ColorSpace: ['Indexed', 'DeviceRGB', 2, PDFHexString.of('FF000000FF000000FF')],
    });
    // CMYK, pure cyan
    const cmyk = Buffer.alloc(16 * 16 * 4); for (let i = 0; i < 256; i += 1) { cmyk[i * 4] = 255; }
    addImage(doc, flate(cmyk), { Width: 16, Height: 16, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8, Filter: 'FlateDecode' });
    const { images, skipped } = await extractImages(await save(doc));
    assert.strictEqual(images.length, 4);
    assert.strictEqual(skipped, 0);
    const px = await Promise.all(images.map((i) => rawPixels(i.bytes)));
    // objects come back in the order they were added: grey, inverted grey, indexed, CMYK (sharp reads grey PNGs back as 3 equal channels)
    const at = (p, n) => [...p.data.subarray(n * p.info.channels, n * p.info.channels + 3)];
    assert.deepStrictEqual(at(px[0], 200), [200, 200, 200], 'plain grey kept');
    assert.deepStrictEqual(at(px[1], 0), [245, 245, 245], 'inverted grey flipped (255 - 10)');
    assert.deepStrictEqual([at(px[2], 0), at(px[2], 1), at(px[2], 2), at(px[2], 3)], [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 0, 0]], 'indexed colours come out as red, green, blue, red');
    assert.deepStrictEqual(at(px[3], 0), [0, 255, 255], 'pure cyan CMYK becomes RGB cyan');
  }

  // ---- JPEG 2000 is copied unchanged as .jp2; fax/JBIG2, stencil masks and tiny pictures are handled honestly ----
  {
    const doc = await PDFDocument.create();
    const jpx = Buffer.from('not-really-jpeg2000-but-bytes-are-bytes');
    addImage(doc, jpx, { Width: 20, Height: 20, ColorSpace: 'DeviceRGB', BitsPerComponent: 8, Filter: 'JPXDecode' });
    addImage(doc, Buffer.alloc(40), { Width: 64, Height: 64, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'CCITTFaxDecode' });
    addImage(doc, flate(Buffer.alloc(8 * 16)), { Width: 64, Height: 16, ImageMask: true, BitsPerComponent: 1, Filter: 'FlateDecode' });
    addImage(doc, flate(Buffer.alloc(16)), { Width: 4, Height: 4, ColorSpace: 'DeviceGray', BitsPerComponent: 8, Filter: 'FlateDecode' });
    addImage(doc, flate(Buffer.alloc(16 * 16 * 3)), { Width: 16, Height: 16, ColorSpace: ['Separation', 'Spot', 'DeviceRGB', 'Func'], BitsPerComponent: 8, Filter: 'FlateDecode' });
    const { images, skipped, skippedReasons } = await extractImages(await save(doc));
    assert.strictEqual(images.length, 1);
    assert.strictEqual(images[0].ext, 'jp2');
    assert.ok(images[0].bytes.equals(jpx));
    assert.strictEqual(skippedReasons.bitonal, 1, 'fax/JBIG2 is named');
    assert.strictEqual(skippedReasons.mask, 1);
    assert.strictEqual(skippedReasons.tiny, 1);
    assert.strictEqual(skippedReasons.colourSpace, 1, 'an unsupported colour space is named');
    assert.strictEqual(skipped, 2, 'only real pictures we could not copy count as skipped (not masks or specks)');
    assert.strictEqual(await imagePreview(images[0]), null, 'JPEG 2000 has no on-screen preview');
  }

  // ---- the zip names files by their real type ----
  {
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000' } }).png().toBuffer();
    const zip = await JSZip.loadAsync(await zipImages([{ bytes: jpeg, ext: 'jpg' }, { bytes: png, ext: 'png' }, { bytes: Buffer.from('x'), ext: 'jp2' }]));
    assert.deepStrictEqual(Object.keys(zip.files).sort(), ['image-001.jpg', 'image-002.png', 'image-003.jp2']);
    const preview = await imagePreview({ bytes: png, format: 'png' });
    assert.ok(preview.startsWith('data:image/jpeg;base64,'), 'previews are small JPEGs');
  }

  console.log('pdfTools tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
