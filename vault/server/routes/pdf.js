const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');
const { getModelsForUser } = require('../services/modelResolver');
const { logUsage } = require('../utils/logUsage');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const sharp = require('sharp');
const path = require('path');
const { google } = require('googleapis');
const { encrypt, decrypt } = require('../utils/encryption');
const { libreConvert } = require('../services/officeConvert');

// ── Shared: Google OAuth client (mirrors gmail.js / calendar.js pattern) ────
function _googleOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}
async function _googleAuthClient(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_tokens WHERE "userId"=$1', [userId]);
  if (!rows[0]) throw new Error('Google account not connected. Connect via Settings → Gmail / Drive.');
  const row = rows[0];
  const client = _googleOAuth2Client();
  client.setCredentials({
    access_token: decrypt(row.accessToken),
    refresh_token: decrypt(row.refreshToken),
    token_type: row.tokenType || 'Bearer',
    expiry_date: row.expiryDate ? Number(row.expiryDate) : undefined,
    scope: row.scope || undefined,
  });
  client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      pool.query(
        `UPDATE gmail_tokens SET "accessToken"=$1, "expiryDate"=$2, "updatedAt"=NOW() WHERE "userId"=$3`,
        [encrypt(tokens.access_token), tokens.expiry_date || null, userId]
      ).catch(() => {});
    }
  });
  return client;
}

// ── Shared: Office file metadata ─────────────────────────────────────────────
const OFFICE_ALLOWED_EXTS = new Set([
  '.docx', '.doc', '.odt', '.rtf',
  '.xlsx', '.xls', '.ods', '.csv',
  '.pptx', '.ppt', '.odp',
  '.txt',
]);

// Maps file extension → source MIME type (for uploading to Drive)
function officeMimeType(ext) {
  return {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.doc':  'application/msword',
    '.odt':  'application/vnd.oasis.opendocument.text',
    '.rtf':  'application/rtf',
    '.txt':  'text/plain',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls':  'application/vnd.ms-excel',
    '.ods':  'application/vnd.oasis.opendocument.spreadsheet',
    '.csv':  'text/csv',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.ppt':  'application/vnd.ms-powerpoint',
    '.odp':  'application/vnd.oasis.opendocument.presentation',
  }[ext] || 'application/octet-stream';
}

// Maps file extension → Google Workspace target MIME (Drive converts on upload)
function googleWorkspaceMime(ext) {
  if (['.docx','.doc','.odt','.rtf','.txt'].includes(ext))
    return 'application/vnd.google-apps.document';
  if (['.xlsx','.xls','.ods','.csv'].includes(ext))
    return 'application/vnd.google-apps.spreadsheet';
  if (['.pptx','.ppt','.odp'].includes(ext))
    return 'application/vnd.google-apps.presentation';
  return null;
}

// ── Shared: LibreOffice headless conversion — see server/services/officeConvert.js

// ── Shared: convert Office file to PDF via Google Drive API ──────────────────
// Uses drive.file scope — uploads a temp file, exports as PDF, then deletes it.
async function officeToGooglePdf(inputBuf, ext, filename, userId) {
  const { Readable } = require('stream');
  const gMime = googleWorkspaceMime(ext);
  if (!gMime) throw new Error(`Cannot convert ${ext} files.`);
  const auth = await _googleAuthClient(userId);
  const drive = google.drive({ version: 'v3', auth });
  const uploaded = await drive.files.create({
    requestBody: { name: filename || `upload${ext}`, mimeType: gMime },
    media: { mimeType: officeMimeType(ext), body: Readable.from(inputBuf) },
    fields: 'id',
  });
  const fileId = uploaded.data.id;
  try {
    const exported = await drive.files.export(
      { fileId, mimeType: 'application/pdf' },
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(exported.data);
  } finally {
    drive.files.delete({ fileId }).catch(() => {});
  }
}

// ── Shared: extract Google Drive file ID from URL ───────────────────────────
function googleFileId(urlOrId = '') {
  const patterns = [
    /\/document\/d\/([a-zA-Z0-9_-]+)/,
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
    /\/presentation\/d\/([a-zA-Z0-9_-]+)/,
    /\/file\/d\/([a-zA-Z0-9_-]+)/,
    /[?&]id=([a-zA-Z0-9_-]+)/,
  ];
  for (const p of patterns) { const m = urlOrId.match(p); if (m) return m[1]; }
  if (/^[a-zA-Z0-9_-]{25,}$/.test(urlOrId.trim())) return urlOrId.trim();
  return null;
}

function pdfBufFromDataUrl(dataUrl) {
  if (!dataUrl || !dataUrl.includes(',')) return null;
  try { return Buffer.from(dataUrl.split(',')[1], 'base64'); } catch { return null; }
}

// Parse a page-range string like "1-3,5,7-9" into 0-based indices.
function parsePageList(str, maxPage) {
  const out = new Set();
  for (const part of String(str).split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (t.includes('-')) {
      const [a, b] = t.split('-').map(s => parseInt(s.trim(), 10));
      for (let i = Math.max(1, a); i <= Math.min(maxPage, b || a); i++) out.add(i - 1);
    } else {
      const n = parseInt(t, 10);
      if (n >= 1 && n <= maxPage) out.add(n - 1);
    }
  }
  return [...out].sort((a, b) => a - b);
}

function pdfDataUrl(bytes) {
  return `data:application/pdf;base64,${Buffer.from(bytes).toString('base64')}`;
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/pdf/chat
router.post('/chat', async (req, res) => {
  const { fileId, messages } = req.body;
  if (!fileId || !messages) return res.status(400).json({ error: 'fileId and messages required' });

  const { rows: fileRows } = await pool.query('SELECT * FROM files WHERE id=$1', [fileId]);
  const file = fileRows[0];
  if (!file) return res.status(404).json({ error: 'File not found' });

  const systemPrompt = file.extractedText
    ? `You are analyzing the document "${file.name}".\n\nDocument content:\n${file.extractedText.substring(0, 10000)}\n\nAnswer questions based on this document.`
    : `You are analyzing the file "${file.name}". The file content could not be extracted. Please note this limitation in your responses.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const { standard: standardModel } = await getModelsForUser(req.user?.id);

  try {
    const stream = anthropic.messages.stream({
      model: standardModel,
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ delta: chunk.delta.text })}\n\n`);
      }
    }

    const finalMessage = await stream.finalMessage();
    logUsage({
      userId: req.user?.id,
      model: standardModel,
      inputTokens: finalMessage?.usage?.input_tokens,
      outputTokens: finalMessage?.usage?.output_tokens,
      feature: 'pdf',
    });

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('PDF chat error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ── Merge ─────────────────────────────────────────────────────────────────────
router.post('/merge', async (req, res) => {
  try {
    const pdfs = req.body?.pdfs;
    if (!Array.isArray(pdfs) || pdfs.length < 2)
      return res.status(400).json({ error: 'At least 2 PDFs required' });
    const merged = await PDFDocument.create();
    for (const pdf of pdfs) {
      const buf = pdfBufFromDataUrl(pdf.dataUrl);
      if (!buf) continue;
      const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pages = await merged.copyPages(doc, doc.getPageIndices());
      pages.forEach(p => merged.addPage(p));
    }
    const bytes = await merged.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: merged.getPageCount() });
  } catch (err) {
    console.error('PDF merge:', err);
    res.status(500).json({ error: err.message || 'Merge failed' });
  }
});

// ── Split ──────────────────────────────────────────────────────────────────────
router.post('/split', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = src.getPageCount();
    const indices = parsePageList(req.body?.pages || '', total);
    if (!indices.length)
      return res.status(400).json({ error: `No valid pages. PDF has ${total} pages. Use format: 1-3,5,7` });
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indices);
    copied.forEach(p => out.addPage(p));
    const bytes = await out.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: out.getPageCount(), totalSource: total });
  } catch (err) {
    console.error('PDF split:', err);
    res.status(500).json({ error: err.message || 'Split failed' });
  }
});

// ── Rotate ─────────────────────────────────────────────────────────────────────
router.post('/rotate', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const angle = Number(req.body?.angle) || 90;
    const pagesStr = String(req.body?.pages || 'all').trim().toLowerCase();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const total = doc.getPageCount();
    const indices = pagesStr === 'all' ? [...Array(total).keys()] : parsePageList(pagesStr, total);
    for (const i of indices) {
      const page = doc.getPage(i);
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + angle) % 360));
    }
    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: total, rotated: indices.length });
  } catch (err) {
    console.error('PDF rotate:', err);
    res.status(500).json({ error: err.message || 'Rotate failed' });
  }
});

// ── Images → PDF ───────────────────────────────────────────────────────────────
router.post('/img2pdf', async (req, res) => {
  try {
    const images = req.body?.images;
    if (!Array.isArray(images) || !images.length)
      return res.status(400).json({ error: 'At least 1 image is required' });
    const pageSize = String(req.body?.pageSize || 'A4');
    const margin = Math.max(0, Math.min(100, Number(req.body?.margin) || 0));
    const PAGE_SIZES = { A4: [595.28, 841.89], A3: [841.89, 1190.55], Letter: [612, 792], Legal: [612, 1008] };
    const doc = await PDFDocument.create();
    for (const img of images) {
      const buf = pdfBufFromDataUrl(img.dataUrl);
      if (!buf) continue;
      const mime = (img.dataUrl.split(';')[0].split(':')[1] || '').toLowerCase();
      let pdfImage;
      if (mime === 'image/jpeg' || mime === 'image/jpg') {
        pdfImage = await doc.embedJpg(buf);
      } else {
        const pngBuf = await sharp(buf).png().toBuffer();
        pdfImage = await doc.embedPng(pngBuf);
      }
      const [w, h] = pageSize === 'fit'
        ? [pdfImage.width + margin * 2, pdfImage.height + margin * 2]
        : (PAGE_SIZES[pageSize] || PAGE_SIZES.A4);
      const page = doc.addPage([w, h]);
      const availW = w - margin * 2;
      const availH = h - margin * 2;
      const scale = Math.min(availW / pdfImage.width, availH / pdfImage.height, 1);
      const iW = pdfImage.width * scale;
      const iH = pdfImage.height * scale;
      page.drawImage(pdfImage, { x: margin + (availW - iW) / 2, y: margin + (availH - iH) / 2, width: iW, height: iH });
    }
    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: doc.getPageCount() });
  } catch (err) {
    console.error('PDF img2pdf:', err);
    res.status(500).json({ error: err.message || 'Image to PDF failed' });
  }
});

// ── Watermark ──────────────────────────────────────────────────────────────────
router.post('/watermark', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const text = String(req.body?.text || 'CONFIDENTIAL').trim();
    if (!text) return res.status(400).json({ error: 'Watermark text is required' });
    const fontSize = Math.min(200, Math.max(8, Number(req.body?.fontSize) || 60));
    const opacity = Math.min(1, Math.max(0.01, Number(req.body?.opacity) || 0.2));
    const hex = String(req.body?.color || '#000000').replace('#', '');
    const angle = Number(req.body?.angle) || 45;
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    for (const page of doc.getPages()) {
      const { width, height } = page.getSize();
      page.drawText(text, {
        x: width / 2, y: height / 2,
        size: fontSize, font, color: rgb(r, g, b), opacity,
        rotate: degrees(angle),
      });
    }
    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: doc.getPageCount() });
  } catch (err) {
    console.error('PDF watermark:', err);
    res.status(500).json({ error: err.message || 'Watermark failed' });
  }
});

// ── Page Numbers ───────────────────────────────────────────────────────────────
router.post('/pagenumbers', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const format = String(req.body?.format || '{n}');
    const position = String(req.body?.position || 'bottom-center');
    const fontSize = Math.min(36, Math.max(6, Number(req.body?.fontSize) || 10));
    const startAt = Math.max(1, Number(req.body?.startAt) || 1);
    const margin = Math.max(10, Number(req.body?.margin) || 30);
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    const total = pages.length;
    pages.forEach((page, i) => {
      const { width, height } = page.getSize();
      const label = format.replace('{n}', i + startAt).replace('{total}', total);
      const tw = font.widthOfTextAtSize(label, fontSize);
      let x, y;
      if (position === 'bottom-center') { x = (width - tw) / 2; y = margin; }
      else if (position === 'bottom-right') { x = width - tw - margin; y = margin; }
      else if (position === 'bottom-left') { x = margin; y = margin; }
      else if (position === 'top-center') { x = (width - tw) / 2; y = height - margin - fontSize; }
      else if (position === 'top-right') { x = width - tw - margin; y = height - margin - fontSize; }
      else { x = margin; y = height - margin - fontSize; }
      page.drawText(label, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
    });
    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: total });
  } catch (err) {
    console.error('PDF pagenumbers:', err);
    res.status(500).json({ error: err.message || 'Add page numbers failed' });
  }
});

// ── Inspect Form Fields ────────────────────────────────────────────────────────
router.post('/inspect', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const form = doc.getForm();
    const fields = form.getFields().map(f => {
      const type = f.constructor.name.replace('PDF', '');
      let value = '';
      try {
        if (type === 'TextField') value = f.getText() || '';
        else if (type === 'CheckBox') value = f.isChecked() ? 'true' : 'false';
        else if (type === 'Dropdown') value = (f.getSelected() || []).join(', ');
        else if (type === 'RadioGroup') value = f.getSelected() || '';
        else if (type === 'OptionList') value = (f.getSelected() || []).join(', ');
      } catch {}
      return {
        name: f.getName(),
        type,
        value,
        required: f.isRequired?.() ?? false,
        readOnly: f.isReadOnly?.() ?? false,
      };
    });
    res.json({ fields, hasForm: fields.length > 0, pageCount: doc.getPageCount() });
  } catch (err) {
    console.error('PDF inspect:', err);
    res.status(500).json({ error: err.message || 'Inspect failed' });
  }
});

// ── Fill Form Fields ───────────────────────────────────────────────────────────
router.post('/fill', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const fieldsData = req.body?.fields || {};
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const form = doc.getForm();
    let filled = 0;
    for (const [name, value] of Object.entries(fieldsData)) {
      try {
        const field = form.getField(name);
        const type = field.constructor.name.replace('PDF', '');
        if (type === 'TextField') { field.setText(String(value)); filled++; }
        else if (type === 'CheckBox') { (String(value) === 'true' || value === true) ? field.check() : field.uncheck(); filled++; }
        else if (type === 'Dropdown') { field.select(String(value)); filled++; }
        else if (type === 'RadioGroup') { field.select(String(value)); filled++; }
      } catch {}
    }
    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), filled, pageCount: doc.getPageCount() });
  } catch (err) {
    console.error('PDF fill:', err);
    res.status(500).json({ error: err.message || 'Fill failed' });
  }
});

// ── Flatten ────────────────────────────────────────────────────────────────────
router.post('/flatten', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    doc.getForm().flatten();
    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: doc.getPageCount() });
  } catch (err) {
    console.error('PDF flatten:', err);
    res.status(500).json({ error: err.message || 'Flatten failed' });
  }
});

// ── Add Form Fields ────────────────────────────────────────────────────────────
// Receives field definitions with PDF-point coordinates (bottom-left origin)
// and embeds them as interactive AcroForm fields using pdf-lib.
// In-memory font cache: family name → Buffer of TTF bytes
const _fontCache = new Map();

// Fetch a Google Font's TTF bytes. Uses an old User-Agent so Google Fonts
// returns a TTF URL instead of woff2 (which pdf-lib cannot parse).
async function fetchGoogleFontBytes(family) {
  if (_fontCache.has(family)) return _fontCache.get(family);
  const cssUrl = `https://fonts.googleapis.com/css?family=${encodeURIComponent(family)}:400`;
  const cssResp = await fetch(cssUrl, {
    headers: { 'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1)' },
  });
  if (!cssResp.ok) throw new Error(`Google Fonts CSS fetch failed: ${family} (${cssResp.status})`);
  const css = await cssResp.text();
  const urlMatch = css.match(/url\((https?:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
  if (!urlMatch) throw new Error(`No font URL in CSS response for: ${family}`);
  const fontResp = await fetch(urlMatch[1]);
  if (!fontResp.ok) throw new Error(`Font file fetch failed for: ${family}`);
  const bytes = Buffer.from(await fontResp.arrayBuffer());
  _fontCache.set(family, bytes);
  return bytes;
}

// Parse a #rrggbb hex colour to [r, g, b] in 0-1 range
function hexToRgb01(hex) {
  const h = (hex || '#000000').replace('#', '');
  if (h.length !== 6) return [0, 0, 0];
  return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
}

// Apply font size and text colour to a field's Default Appearance string
function applyFieldTypography(field, def) {
  const fontSize = Math.max(4, Number(def.fontSize) || 11);
  try { field.setFontSize(fontSize); } catch {}
  if (def.color && def.color !== '#000000') {
    try {
      const [r, g, b] = hexToRgb01(def.color);
      const colorStr = `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`;
      const da = field.acroField.getDefaultAppearance() ?? '';
      const newDa = /[\d.]+ [\d.]+ [\d.]+ rg/.test(da)
        ? da.replace(/[\d.]+ [\d.]+ [\d.]+ rg/, colorStr)
        : `${da} ${colorStr}`;
      field.acroField.setDefaultAppearance(newDa.trim());
    } catch {}
  }
}

router.post('/addfields', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const fieldDefs = req.body?.fields;
    if (!Array.isArray(fieldDefs) || !fieldDefs.length)
      return res.status(400).json({ error: 'At least one field definition is required' });

    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const form = doc.getForm();
    const pages = doc.getPages();

    // Pre-embed fonts that are needed (Google Fonts fetched on demand, Helvetica as fallback)
    const embeddedFonts = {};
    const neededFonts = new Set(fieldDefs.filter(d => d.type !== 'checkbox').map(d => d.fontFamily || 'Roboto'));
    for (const fname of neededFonts) {
      try {
        const fontBytes = await fetchGoogleFontBytes(fname);
        embeddedFonts[fname] = await doc.embedFont(fontBytes);
      } catch (err) {
        console.warn(`Google Font embed failed for "${fname}", falling back to Helvetica:`, err.message);
        try { embeddedFonts[fname] = await doc.embedFont(StandardFonts.Helvetica); } catch {}
      }
    }

    // Ensure field names are unique within this batch + any existing fields.
    const existingNames = new Set(form.getFields().map(f => f.getName()));
    const usedInBatch = new Set();
    const uniqueName = (base) => {
      let n = (base || 'field').replace(/[^\w.]/g, '_') || 'field';
      let candidate = n;
      let i = 1;
      while (existingNames.has(candidate) || usedInBatch.has(candidate)) candidate = `${n}_${i++}`;
      usedInBatch.add(candidate);
      return candidate;
    };

    let added = 0;
    for (const def of fieldDefs) {
      const pageIdx = Math.max(0, (Number(def.page) || 1) - 1);
      if (pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const name = uniqueName(def.name);
      const hasBorder = def.borderEnabled !== false;
      const [br, bg, bb] = hexToRgb01(def.borderColor || '#4d4dcf');
      const opts = {
        x: Number(def.x) || 0,
        y: Number(def.y) || 0,
        width: Math.max(5, Number(def.width) || 100),
        height: Math.max(5, Number(def.height) || 20),
        borderColor: hasBorder ? rgb(br, bg, bb) : rgb(0.9, 0.9, 0.9),
        borderWidth: hasBorder ? Math.max(0.5, Number(def.borderWidth) || 1) : 0,
        backgroundColor: rgb(1, 1, 1),
      };
      try {
        switch (def.type) {
          case 'checkbox': {
            const sz = Math.min(opts.width, opts.height);
            const f = form.createCheckBox(name);
            f.addToPage(page, { ...opts, width: sz, height: sz });
            if (def.required) f.enableRequired();
            break;
          }
          case 'dropdown': {
            const f = form.createDropdown(name);
            const choices = Array.isArray(def.options) ? def.options.map(String).filter(Boolean) : [];
            if (choices.length) f.setOptions(choices);
            f.addToPage(page, opts);
            if (def.required) f.enableRequired();
            // updateAppearances first (bakes font family into AP stream),
            // then applyFieldTypography to lock font size + colour in DA last.
            const fontD = embeddedFonts[def.fontFamily] || embeddedFonts['Roboto'];
            if (fontD) try { f.updateAppearances(fontD); } catch {}
            applyFieldTypography(f, def);
            break;
          }
          case 'text':
          default: {
            const f = form.createTextField(name);
            f.addToPage(page, opts);
            if (def.multiline) f.enableMultiline();
            if (def.required) f.enableRequired();
            const fontT = embeddedFonts[def.fontFamily] || embeddedFonts['Roboto'];
            if (fontT) try { f.updateAppearances(fontT); } catch {}
            applyFieldTypography(f, def);
            break;
          }
        }
        added++;
      } catch (fieldErr) {
        console.warn('addfields skip:', name, fieldErr.message);
      }
    }

    const bytes = await doc.save();
    res.json({ dataUrl: pdfDataUrl(bytes), pageCount: doc.getPageCount(), added });
  } catch (err) {
    console.error('PDF addfields:', err);
    res.status(500).json({ error: err.message || 'Add fields failed' });
  }
});

// ── Metadata read / write ──────────────────────────────────────────────────────
router.post('/metadata', async (req, res) => {
  try {
    const buf = pdfBufFromDataUrl(req.body?.dataUrl);
    if (!buf) return res.status(400).json({ error: 'A valid PDF is required' });
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    const current = {
      title:            doc.getTitle()            || '',
      author:           doc.getAuthor()           || '',
      subject:          doc.getSubject()          || '',
      keywords:         doc.getKeywords()         || '',
      creator:          doc.getCreator()          || '',
      producer:         doc.getProducer()         || '',
      creationDate:     doc.getCreationDate()?.toISOString()     || '',
      modificationDate: doc.getModificationDate()?.toISOString() || '',
    };
    const update = req.body?.update;
    if (update) {
      if (update.title   !== undefined) doc.setTitle(update.title);
      if (update.author  !== undefined) doc.setAuthor(update.author);
      if (update.subject !== undefined) doc.setSubject(update.subject);
      if (update.keywords !== undefined) doc.setKeywords([update.keywords]);
      if (update.creator !== undefined) doc.setCreator(update.creator);
      const bytes = await doc.save();
      return res.json({ current, dataUrl: pdfDataUrl(bytes), pageCount: doc.getPageCount() });
    }
    res.json({ current, pageCount: doc.getPageCount() });
  } catch (err) {
    console.error('PDF metadata:', err);
    res.status(500).json({ error: err.message || 'Metadata operation failed' });
  }
});

// ── Office → PDF ─────────────────────────────────────────────────────────────
// Uses LibreOffice headless (installed via Dockerfile).
router.post('/office-to-pdf', async (req, res) => {
  try {
    const { dataUrl, filename } = req.body || {};
    if (!dataUrl) return res.status(400).json({ error: 'No file data provided.' });
    const ext = path.extname(filename || '').toLowerCase() || '.docx';
    if (!OFFICE_ALLOWED_EXTS.has(ext))
      return res.status(400).json({ error: `Unsupported file type: ${ext}` });
    const inputBuf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const pdfBuf = await libreConvert(inputBuf, ext, 'pdf');
    res.json({ dataUrl: `data:application/pdf;base64,${pdfBuf.toString('base64')}` });
  } catch (err) {
    console.error('PDF office-to-pdf:', err);
    if (err.code === 'ENOENT')
      return res.status(500).json({ error: 'LibreOffice is not available. The server image may still be deploying — please try again in a few minutes.' });
    res.status(500).json({ error: err.message || 'Conversion failed.' });
  }
});

// ── PDF → Office (DOCX) ──────────────────────────────────────────────────────
// Requires LibreOffice. No Google Drive equivalent for PDF → DOCX direction.
router.post('/pdf-to-office', async (req, res) => {
  try {
    const { dataUrl, format = 'docx' } = req.body || {};
    if (!dataUrl) return res.status(400).json({ error: 'No PDF provided.' });
    const allowed = { docx: 'docx', odt: 'odt', txt: 'txt' };
    const fmt = allowed[format] || 'docx';
    const inputBuf = Buffer.from(dataUrl.split(',')[1], 'base64');
    const outBuf = await libreConvert(inputBuf, '.pdf', fmt);
    const mimes = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', odt: 'application/vnd.oasis.opendocument.text', txt: 'text/plain' };
    res.json({ dataUrl: `data:${mimes[fmt]};base64,${outBuf.toString('base64')}`, format: fmt });
  } catch (err) {
    console.error('PDF pdf-to-office:', err);
    if (err.code === 'ENOENT')
      return res.status(500).json({ error: 'PDF → Word conversion requires LibreOffice, which is not available on this server. This feature is coming soon.' });
    res.status(500).json({ error: err.message || 'Conversion failed.' });
  }
});

// ── Google Drive → PDF ────────────────────────────────────────────────────────
router.post('/google-to-pdf', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Provide a Google Drive or Docs/Sheets/Slides URL.' });
    const fileId = googleFileId(url);
    if (!fileId) return res.status(400).json({ error: 'Could not extract a file ID from that URL.' });

    const auth = await _googleAuthClient(req.user.id);

    // Check if the stored token has drive.readonly scope
    const storedScope = auth.credentials?.scope || '';
    if (!storedScope.includes('drive.readonly') && !storedScope.includes('drive"') && !storedScope.includes(' drive ')) {
      return res.status(403).json({
        error: 'Your Google account needs to be reconnected to grant Drive read access. Go to Settings → Gmail / Drive, disconnect, then reconnect.',
        needsReconnect: true,
      });
    }

    const drive = google.drive({ version: 'v3', auth });
    const meta = await drive.files.get({ fileId, fields: 'name,mimeType' });
    const mimeType = meta.data.mimeType || '';
    const fileName = meta.data.name || 'document';

    let pdfBuf;

    if (mimeType.startsWith('application/vnd.google-apps.')) {
      if (mimeType === 'application/vnd.google-apps.folder')
        return res.status(400).json({ error: 'That URL points to a folder, not a file.' });
      const resp = await drive.files.export(
        { fileId, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );
      pdfBuf = Buffer.from(resp.data);
    } else {
      // Binary Office file in Drive — download it, then re-upload via officeToGooglePdf
      const ext = path.extname(fileName).toLowerCase();
      if (!OFFICE_ALLOWED_EXTS.has(ext))
        return res.status(400).json({ error: `Cannot convert this file type (${mimeType}).` });
      const resp = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
      pdfBuf = await officeToGooglePdf(Buffer.from(resp.data), ext, fileName, req.user.id);
    }

    res.json({ dataUrl: `data:application/pdf;base64,${pdfBuf.toString('base64')}`, fileName: `${fileName}.pdf` });
  } catch (err) {
    console.error('PDF google-to-pdf:', err);
    const msg = err.message || 'Export failed.';
    const code = err.code || err.status;
    if (msg.includes('not connected'))
      return res.status(401).json({ error: 'Google account not connected. Go to Settings → Gmail / Drive to connect.', needsReconnect: true });
    if (code === 404 || msg.toLowerCase().includes('not found'))
      return res.status(404).json({ error: 'File not found or not accessible. This usually means Drive read permission is missing. Go to Settings → Gmail / Drive, disconnect, then reconnect.', needsReconnect: true });
    if (code === 403)
      return res.status(403).json({ error: 'Access denied. Go to Settings → Gmail / Drive, disconnect, then reconnect.', needsReconnect: true });
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
