const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');
const { getModelsForUser } = require('../services/modelResolver');
const { logUsage } = require('../utils/logUsage');
const { PDFDocument, StandardFonts, rgb, degrees } = require('pdf-lib');
const sharp = require('sharp');

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

    // Ensure field names are unique within this batch + any existing fields.
    const existingNames = new Set(form.getFields().map(f => f.getName()));
    const usedInBatch = new Set();
    const uniqueName = (base) => {
      let n = (base || 'field').replace(/[^\w.]/g, '_') || 'field';
      let candidate = n;
      let i = 1;
      while (existingNames.has(candidate) || usedInBatch.has(candidate)) {
        candidate = `${n}_${i++}`;
      }
      usedInBatch.add(candidate);
      return candidate;
    };

    let added = 0;
    for (const def of fieldDefs) {
      const pageIdx = Math.max(0, (Number(def.page) || 1) - 1);
      if (pageIdx >= pages.length) continue;
      const page = pages[pageIdx];
      const name = uniqueName(def.name);
      const opts = {
        x: Number(def.x) || 0,
        y: Number(def.y) || 0,
        width: Math.max(5, Number(def.width) || 100),
        height: Math.max(5, Number(def.height) || 20),
        borderColor: rgb(0.3, 0.3, 0.8),
        borderWidth: 1,
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
            const opts2 = Array.isArray(def.options) ? def.options.map(String).filter(Boolean) : [];
            if (opts2.length) f.setOptions(opts2);
            f.addToPage(page, opts);
            if (def.required) f.enableRequired();
            break;
          }
          case 'text':
          default: {
            const f = form.createTextField(name);
            f.addToPage(page, opts);
            if (def.multiline) f.enableMultiline();
            if (def.required) f.enableRequired();
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

module.exports = router;
