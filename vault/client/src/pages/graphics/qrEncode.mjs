// QR code encoder for the Graphics "QR Code" tool. Pure JavaScript, no package, runs in the browser (and in Node for
// the test). Byte mode only (UTF-8), versions 1-40, error correction L/M/Q/H, automatic mask choice.
// Follows the QR Code Model 2 standard (ISO/IEC 18004) the same way as Project Nayuki's reference
// generator (MIT licence), which this is modelled on. Checked module-for-module against the Python `segno`
// library by qrEncode.test.mjs's reference fixtures.
//
//   encodeQr(text, { ecc: 'M', minVersion: 1, mask: -1 }) -> { size, version, ecc, mask, modules: boolean[][] }
//   modules[y][x] is true for a dark module. No quiet zone is included (the drawing code adds the margin).

const ECC_CODEWORDS_PER_BLOCK = {
  L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const NUM_ERROR_CORRECTION_BLOCKS = {
  L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
export const ECC_LEVELS = ['L', 'M', 'Q', 'H'];

function numRawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function numDataCodewords(ver, ecc) {
  return Math.floor(numRawDataModules(ver) / 8) - ECC_CODEWORDS_PER_BLOCK[ecc][ver] * NUM_ERROR_CORRECTION_BLOCKS[ecc][ver];
}

/** How many bytes of text fit at this version and level (byte mode). */
export function byteCapacity(ver, ecc) {
  const countBits = ver <= 9 ? 8 : 16;
  return Math.floor((numDataCodewords(ver, ecc) * 8 - 4 - countBits) / 8);
}

// Reed-Solomon over GF(2^8) with the QR polynomial 0x11D.
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

function utf8Bytes(text) {
  return Array.from(new TextEncoder().encode(String(text)));
}

function alignmentPositions(ver, size) {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
  const result = [6];
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
  return result;
}

const getBit = (x, i) => ((x >>> i) & 1) !== 0;

export function encodeQr(text, { ecc = 'M', minVersion = 1, mask = -1 } = {}) {
  const level = ECC_LEVELS.includes(ecc) ? ecc : 'M';
  const bytes = utf8Bytes(text);
  if (!bytes.length) throw new Error('Type something to put in the QR code');

  // Smallest version the text fits in.
  let ver = Math.max(1, Math.min(40, Math.floor(minVersion) || 1));
  for (; ; ver++) {
    if (bytes.length <= byteCapacity(ver, level)) break;
    if (ver >= 40) throw new Error(`That is too much text for a QR code at this error correction level (${bytes.length} bytes; the most is ${byteCapacity(40, level)}). Shorten it or choose a lower level.`);
  }

  // Data bits: mode, count, bytes, terminator, padding.
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(0x4, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => push(b, 8));
  const capacityBits = numDataCodewords(ver, level) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) push(pad, 8);
  const dataCodewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    dataCodewords.push(v);
  }

  // Error correction blocks, interleaved.
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[level][ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[level][ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);
  const divisor = rsDivisor(blockEccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = dataCodewords.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
    k += dat.length;
    const eccBytes = rsRemainder(dat, divisor);
    if (i < numShortBlocks) dat.push(0);
    blocks.push(dat.concat(eccBytes));
  }
  const allCodewords = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) allCodewords.push(block[i]);
    });
  }

  // Draw.
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  const setFn = (x, y, dark) => { modules[y][x] = dark; isFunction[y][x] = true; };

  for (let i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }
  const finder = (x, y) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < size && yy >= 0 && yy < size) setFn(xx, yy, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  const align = alignmentPositions(ver, size);
  const last = align.length - 1;
  align.forEach((ay, i) => {
    align.forEach((ax, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });

  const drawFormat = (m) => {
    const data = (FORMAT_BITS[level] << 3) | m;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const fb = ((data << 10) | rem) ^ 0x5412;
    for (let i = 0; i <= 5; i++) setFn(8, i, getBit(fb, i));
    setFn(8, 7, getBit(fb, 6));
    setFn(8, 8, getBit(fb, 7));
    setFn(7, 8, getBit(fb, 8));
    for (let i = 9; i < 15; i++) setFn(14 - i, 8, getBit(fb, i));
    for (let i = 0; i < 8; i++) setFn(size - 1 - i, 8, getBit(fb, i));
    for (let i = 8; i < 15; i++) setFn(8, size - 15 + i, getBit(fb, i));
    setFn(8, size - 8, true);
  };
  drawFormat(0); // reserve the area; redrawn with the real mask below

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const vb = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = getBit(vb, i);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(a, b, bit);
      setFn(b, a, bit);
    }
  }

  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunction[y][x] && i < allCodewords.length * 8) {
          modules[y][x] = getBit(allCodewords[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }

  const applyMask = (m) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let invert;
        switch (m) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (!isFunction[y][x] && invert) modules[y][x] = !modules[y][x];
      }
    }
  };

  let chosen = Number.isInteger(mask) && mask >= 0 && mask <= 7 ? mask : -1;
  if (chosen < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m++) {
      applyMask(m);
      drawFormat(m);
      const p = penalty(modules, size);
      if (p < best) { best = p; chosen = m; }
      applyMask(m); // XOR again undoes it
    }
  }
  applyMask(chosen);
  drawFormat(chosen);
  return { size, version: ver, ecc: level, mask: chosen, modules };
}

function penalty(modules, size) {
  const N1 = 3; const N2 = 3; const N3 = 40; const N4 = 10;
  let result = 0;
  const addHistory = (len, h) => { if (h[0] === 0) len += size; h.pop(); h.unshift(len); };
  const countPatterns = (h) => {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  };
  const terminate = (color, len, h) => {
    if (color) { addHistory(len, h); len = 0; }
    len += size;
    addHistory(len, h);
    return countPatterns(h);
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let runColor = false;
      let run = 0;
      const h = [0, 0, 0, 0, 0, 0, 0];
      for (let b = 0; b < size; b++) {
        const c = pass === 0 ? modules[a][b] : modules[b][a];
        if (c === runColor) {
          run++;
          if (run === 5) result += N1;
          else if (run > 5) result++;
        } else {
          addHistory(run, h);
          if (!runColor) result += countPatterns(h) * N3;
          runColor = c;
          run = 1;
        }
      }
      result += terminate(runColor, run, h) * N3;
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const c = modules[y][x];
      if (c) dark++;
      if (y < size - 1 && x < size - 1 && c === modules[y][x + 1] && c === modules[y + 1][x] && c === modules[y + 1][x + 1]) result += N2;
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * N4;
  return result;
}

// ── What goes in the code ─────────────────────────────────────────────────────────────────────────

// Wi-Fi, vCard and MECARD-style fields escape \ ; , : and " with a backslash.
const esc = (s) => String(s || '').replace(/([\\;,:"])/g, '\\$1');

/**
 * The text to encode for each kind of QR code. Returns '' when the required field is empty.
 *  link  { url }                      a web address (https:// added when no scheme is given)
 *  text  { text }
 *  wifi  { ssid, password, security: 'WPA'|'WEP'|'nopass', hidden }
 *  email { to, subject, body }
 *  phone { number }
 *  sms   { number, message }
 *  contact { name, org, phone, email, url }   a vCard 3.0
 */
export function buildQrPayload(kind, f = {}) {
  const t = (v) => String(v || '').trim();
  switch (kind) {
    case 'link': {
      const u = t(f.url);
      if (!u) return '';
      return /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : `https://${u}`;
    }
    case 'text': return String(f.text || '');
    case 'wifi': {
      if (!t(f.ssid)) return '';
      const sec = ['WPA', 'WEP', 'nopass'].includes(f.security) ? f.security : 'WPA';
      const pass = sec === 'nopass' ? '' : `P:${esc(f.password)};`;
      return `WIFI:T:${sec};S:${esc(f.ssid)};${pass}${f.hidden ? 'H:true;' : ''};`;
    }
    case 'email': {
      if (!t(f.to)) return '';
      const q = [];
      if (t(f.subject)) q.push(`subject=${encodeURIComponent(t(f.subject))}`);
      if (t(f.body)) q.push(`body=${encodeURIComponent(String(f.body))}`);
      return `mailto:${t(f.to)}${q.length ? `?${q.join('&')}` : ''}`;
    }
    case 'phone': {
      const n = t(f.number).replace(/[^\d+]/g, '');
      return n ? `tel:${n}` : '';
    }
    case 'sms': {
      const n = t(f.number).replace(/[^\d+]/g, '');
      if (!n) return '';
      return t(f.message) ? `SMSTO:${n}:${t(f.message)}` : `SMSTO:${n}`;
    }
    case 'contact': {
      if (!t(f.name)) return '';
      const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${esc(f.name)};;;;`, `FN:${esc(f.name)}`];
      if (t(f.org)) lines.push(`ORG:${esc(f.org)}`);
      if (t(f.phone)) lines.push(`TEL:${t(f.phone)}`);
      if (t(f.email)) lines.push(`EMAIL:${t(f.email)}`);
      if (t(f.url)) lines.push(`URL:${t(f.url)}`);
      lines.push('END:VCARD');
      return lines.join('\r\n');
    }
    default: return '';
  }
}

/** The code as an SVG string: one path, a quiet-zone margin of `margin` modules, solid colours. */
export function qrToSvg(qr, { margin = 4, dark = '#000000', light = '#ffffff', transparent = false } = {}) {
  const dim = qr.size + margin * 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) d += `M${x + margin},${y + margin}h1v1h-1z`;
  }
  const bg = transparent ? '' : `<rect width="${dim}" height="${dim}" fill="${light}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges">${bg}<path d="${d}" fill="${dark}"/></svg>`;
}

/** Contrast ratio (WCAG formula) between two hex colours; scanners want a big gap, dark on light. */
export function contrastRatio(hexA, hexB) {
  const lum = (hex) => {
    const m = String(hex || '').replace('#', '').match(/^([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const a = lum(hexA);
  const b = lum(hexB);
  if (a == null || b == null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Is the dark colour actually darker than the light one? Most scanners cannot read a light-on-dark code. */
export function isInverted(darkHex, lightHex) {
  const r = contrastRatio(darkHex, '#000000');
  const s = contrastRatio(lightHex, '#000000');
  return r != null && s != null && r > s;
}
