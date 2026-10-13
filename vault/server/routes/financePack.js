'use strict';

// Financial-year pack for the accountant: every report they need in one PDF and one Excel workbook, and
// optionally a zip with both plus the supporting documents. Mounted by finance.js at /api/finance/pack.
// Figures come from the Reports router itself (see services/financePack/collect.js), so they agree with
// the Reports tab. Heavy, so one pack per user at a time.

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const archiver = require('archiver');
const { pool } = require('../db');
const { collectPack } = require('../services/financePack/collect');
const { renderPackPdf } = require('../services/financePack/pdf');
const { renderPackXlsx } = require('../services/financePack/xlsx');
const { finYearForDate } = require('../utils/finYear');

const DOC_DIR = path.join(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'), 'finance-docs');
const busy = new Set();

module.exports = function createFinancePackRouter({ runReport }) {
  const router = express.Router();

  const parseFy = (req, res) => {
    const fy = req.query.fy || finYearForDate(new Date().toISOString().slice(0, 10));
    const m = /^(\d{4})-(\d{2})$/.exec(fy);
    if (!m || (parseInt(m[1], 10) + 1) % 100 !== parseInt(m[2], 10)) { res.status(400).json({ error: 'fy must look like 2025-26' }); return null; }
    return fy;
  };
  // one build at a time per person
  const guarded = (fn) => async (req, res) => {
    const fy = parseFy(req, res); if (!fy) return;
    const userId = req.user.id;
    if (busy.has(userId)) return res.status(429).json({ error: 'A pack is already being built — wait for it to finish.' });
    busy.add(userId);
    try { await fn(req, res, fy, userId); }
    catch (err) { if (!res.headersSent) res.status(500).json({ error: err.message }); else res.end(); }
    finally { busy.delete(userId); }
  };
  const stem = (pack) => `Vault-FY${pack.fy}-${(pack.cover.business && !pack.cover.business.startsWith('(') ? pack.cover.business : 'finance').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}`;

  // What the pack will contain and what needs attention first, without rendering the files.
  router.get('/preview', guarded(async (req, res, fy, userId) => {
    const pack = await collectPack(userId, fy, runReport);
    const { rows: [d] } = await pool.query(`SELECT COUNT(*)::int AS n, COALESCE(SUM("sizeBytes"),0)::float AS bytes FROM fin_documents WHERE "userId"=$1 AND fy=$2`, [userId, fy]);
    res.json({
      fy, period: pack.cover.period, business: pack.cover.business,
      itemsToCheck: pack.cover.itemsToCheck,
      reports: pack.reports.map(r => ({ key: r.key, group: r.group, title: r.title, error: r.error || null })),
      documents: { count: d.n, bytes: d.bytes },
    });
  }));

  router.get('/pdf', guarded(async (req, res, fy, userId) => {
    const pack = await collectPack(userId, fy, runReport);
    const buf = await renderPackPdf(pack);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${stem(pack)}.pdf"`);
    res.send(buf);
  }));

  router.get('/xlsx', guarded(async (req, res, fy, userId) => {
    const pack = await collectPack(userId, fy, runReport);
    const buf = await renderPackXlsx(pack, userId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${stem(pack)}.xlsx"`);
    res.send(buf);
  }));

  // Both files, plus (when documents=1) the supporting documents for the year.
  router.get('/zip', guarded(async (req, res, fy, userId) => {
    const pack = await collectPack(userId, fy, runReport);
    const [pdf, xlsx] = await Promise.all([renderPackPdf(pack), renderPackXlsx(pack, userId)]);
    const withDocs = req.query.documents === '1';
    const docs = withDocs
      ? (await pool.query(`SELECT id, title, "docDate"::text AS "docDate", "originalName", "storedName" FROM fin_documents WHERE "userId"=$1 AND fy=$2 ORDER BY COALESCE("docDate","createdAt"::date), id`, [userId, fy])).rows
      : [];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${stem(pack)}.zip"`);
    const zip = archiver('zip', { zlib: { level: 6 } });
    zip.on('error', (e) => { try { res.destroy(e); } catch { /* socket gone */ } });
    zip.pipe(res);
    zip.append(pdf, { name: `${stem(pack)}.pdf` });
    zip.append(xlsx, { name: `${stem(pack)}.xlsx` });
    const missing = [];
    const names = [];
    for (const d of docs) {
      const file = path.resolve(DOC_DIR, String(userId), d.storedName);
      if (!file.startsWith(path.resolve(DOC_DIR, String(userId)) + path.sep) || !fs.existsSync(file)) { missing.push(d.title); continue; }
      const ext = path.extname(d.originalName).toLowerCase();
      const slug = d.title.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'document';
      const name = `documents/${d.docDate || fy}_${slug}_${d.id}${ext}`;
      zip.file(file, { name });
      names.push(`${name}  <-  ${d.originalName}`);
    }
    if (withDocs) {
      zip.append(`Supporting documents for FY ${fy}\r\n\r\n${names.join('\r\n') || '(none uploaded)'}\r\n${missing.length ? `\r\nFiles missing from storage: ${missing.join(', ')}\r\n` : ''}`, { name: 'documents/README.txt' });
    }
    await zip.finalize();
  }));

  return router;
};
