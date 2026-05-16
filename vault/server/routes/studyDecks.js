'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const multer = require('multer');
const router = express.Router();
const { pool } = require('../db');
const sendEmail = require('../utils/sendEmail');
const { FEATURE_ACCESS_DEFAULTS } = require('../config/featureAccess');
const { buildStudyDeckPdfBuffer } = require('../services/studyDeckPdf');
const { extractStudyUploadFromPath, isCodeFile } = require('../services/studyUploadExtract');

async function canAccessStudentWorkspaceFeature(user) {
  if (user?.isAdmin) return true;
  const { rows } = await pool.query(
    "SELECT value FROM workspace_settings WHERE key = 'feature_student' LIMIT 1"
  );
  const raw = String(rows[0]?.value ?? FEATURE_ACCESS_DEFAULTS.student).trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

router.use(async (req, res, next) => {
  if (!(await canAccessStudentWorkspaceFeature(req.user))) {
    return res.status(403).json({ error: 'Student feature is disabled for this workspace.' });
  }
  next();
});

const studyTmpDir = path.join(os.tmpdir(), 'vault-student-study-tmp');
const studyUploadMulter = multer({
  dest: studyTmpDir,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nameLower = file.originalname.toLowerCase();
    if (ext === '.env' || nameLower === '.env' || nameLower.endsWith('/.env')) {
      return cb(new Error('File type not accepted'));
    }
    if (isCodeFile(file.originalname)) return cb(null, true);
    const okExt = ['.pdf', '.txt', '.md', '.json', '.csv', '.xlsx', '.xls', '.docx', '.doc', '.ods', '.odt'].includes(ext);
    if (okExt) return cb(null, true);
    return cb(new Error('File type not accepted'));
  },
});

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDeckEmailHtml(title, payload) {
  const p = payload && typeof payload === 'object' ? payload : {};
  const flashcards = Array.isArray(p.flashcards) ? p.flashcards : [];
  const slides = Array.isArray(p.slides) ? p.slides : [];
  const quiz = Array.isArray(p.quiz) ? p.quiz : [];
  const parts = [];

  if (flashcards.length) {
    parts.push('<h2 style="font-size:15px;margin:20px 0 8px;">Flashcards</h2>');
    flashcards.forEach((c, i) => {
      parts.push(`<div style="margin-bottom:14px;padding:12px;border:1px solid #E0E0E0;border-radius:8px;background:#FAFAF8;">
        <div style="font-size:11px;color:#888;">Card ${i + 1}</div>
        <p style="margin:6px 0 4px;font-size:14px;"><strong>Q</strong> ${escapeHtml(c.front ?? c.q ?? '')}</p>
        <p style="margin:0;font-size:14px;"><strong>A</strong> ${escapeHtml(c.back ?? c.a ?? '')}</p>
      </div>`);
    });
  }
  if (slides.length) {
    parts.push('<h2 style="font-size:15px;margin:20px 0 8px;">Slides</h2>');
    slides.forEach((s, i) => {
      const bullets = (Array.isArray(s.bullets) ? s.bullets : []).map((b) => `<li>${escapeHtml(b)}</li>`).join('');
      parts.push(`<div style="margin-bottom:14px;padding:12px;border:1px solid #E0E0E0;border-radius:8px;">
        <div style="font-weight:600;font-size:14px;">${escapeHtml(s.title || `Slide ${i + 1}`)}</div>
        <ul style="margin:8px 0 0 18px;padding:0;">${bullets}</ul>
      </div>`);
    });
  }
  if (quiz.length) {
    parts.push('<h2 style="font-size:15px;margin:20px 0 8px;">Quiz</h2>');
    quiz.forEach((q, i) => {
      const choices = (Array.isArray(q.choices) ? q.choices : []).map((ch) => {
        const ok = ch.id === q.correctId ? ' (correct)' : '';
        return `<li>${escapeHtml(ch.label || ch.id || '')}${ok}</li>`;
      }).join('');
      parts.push(`<div style="margin-bottom:14px;padding:12px;border:1px solid #E0E0E0;border-radius:8px;">
        <p style="margin:0 0 6px;font-size:14px;"><strong>Q${i + 1}</strong> ${escapeHtml(q.question || '')}</p>
        <ul style="margin:0 0 0 18px;padding:0;">${choices}</ul>
      </div>`);
    });
  }
  if (!parts.length) {
    parts.push('<p style="color:#888;">(Empty deck)</p>');
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;background:#F5F5F0;margin:0;padding:20px;">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:12px;padding:24px 28px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
    <h1 style="margin:0 0 8px;font-size:20px;color:#1A1A1A;">${escapeHtml(title || 'Study deck')}</h1>
    <p style="margin:0 0 16px;font-size:12px;color:#888;">Curam Vault — study deck</p>
    ${parts.join('')}
    <p style="margin-top:24px;font-size:11px;color:#aaa;text-align:center;">Sent ${new Date().toLocaleString()}</p>
  </div>
</body></html>`;
}

router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, kind, "sessionId", "createdAt", "updatedAt", "listOrder"
       FROM study_decks WHERE "userId"=$1
       ORDER BY "listOrder" ASC, "updatedAt" DESC
       LIMIT 200`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/extract-file', (req, res, next) => {
  try {
    fs.mkdirSync(studyTmpDir, { recursive: true });
  } catch { /* ignore */ }
  studyUploadMulter.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fp = req.file.path;
  try {
    const { extractedText, name } = await extractStudyUploadFromPath(
      fp,
      req.file.originalname,
      req.file.mimetype
    );
    res.json({ name, extractedText });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Extraction failed' });
  } finally {
    try {
      fs.unlinkSync(fp);
    } catch { /* ignore */ }
  }
});

router.post('/reorder', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  const numeric = ids.map((x) => Number(x)).filter((x) => Number.isFinite(x) && x > 0);
  if (numeric.length !== ids.length) return res.status(400).json({ error: 'invalid ids' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: cnt } = await client.query(
      `SELECT COUNT(*)::int AS n FROM study_decks WHERE "userId"=$1 AND id = ANY($2::int[])`,
      [req.user.id, numeric]
    );
    if (Number(cnt[0]?.n) !== numeric.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Invalid deck id' });
    }
    await client.query(
      `UPDATE study_decks d
       SET "listOrder" = u.ord - 1, "updatedAt" = NOW()
       FROM unnest($2::int[]) WITH ORDINALITY AS u(id, ord)
       WHERE d.id = u.id AND d."userId" = $1`,
      [req.user.id, numeric]
    );
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch { /* ignore */ }
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

router.post('/', async (req, res) => {
  try {
    const { title, kind, payload, sessionId } = req.body;
    if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'payload object required' });
    const k = kind && String(kind).trim() ? String(kind).trim().slice(0, 40) : 'mixed';
    const t = title != null ? String(title).slice(0, 500) : '';
    const sid = sessionId && String(sessionId).trim() ? String(sessionId).trim().slice(0, 200) : null;
    const { rows: mx } = await pool.query(
      `SELECT COALESCE(MAX("listOrder"), -1) + 1 AS n FROM study_decks WHERE "userId"=$1`,
      [req.user.id]
    );
    const listOrder = Number(mx[0]?.n) || 0;
    const { rows } = await pool.query(
      `INSERT INTO study_decks ("userId", title, kind, payload, "sessionId", "listOrder")
       VALUES ($1,$2,$3,$4::jsonb,$5,$6) RETURNING *`,
      [req.user.id, t, k, JSON.stringify(payload), sid, listOrder]
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pdf', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      'SELECT title, payload FROM study_decks WHERE id=$1 AND "userId"=$2',
      [id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const buf = await buildStudyDeckPdfBuffer({ title: rows[0].title, payload: rows[0].payload });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="study-deck-${id}.pdf"`);
    res.send(buf);
  } catch (err) {
    console.error('[study-decks pdf]', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/email', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  const { to, subject } = req.body;
  if (!to || !String(to).trim()) return res.status(400).json({ error: 'to required' });
  try {
    const { rows } = await pool.query(
      'SELECT title, payload FROM study_decks WHERE id=$1 AND "userId"=$2',
      [id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const emailSubject = subject && String(subject).trim()
      ? String(subject).trim().slice(0, 200)
      : `${rows[0].title || 'Study deck'} — Curam Vault`;
    const html = buildDeckEmailHtml(rows[0].title, rows[0].payload);
    await sendEmail({ to: String(to).trim(), subject: emailSubject, html });
    res.json({ ok: true });
  } catch (err) {
    console.error('[study-decks email]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rows } = await pool.query(
      'SELECT * FROM study_decks WHERE id=$1 AND "userId"=$2',
      [id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { title, kind, payload, sessionId } = req.body;
    const fields = [];
    const vals = [];
    let n = 1;
    if (title !== undefined) {
      fields.push(`title=$${n++}`);
      vals.push(String(title).slice(0, 500));
    }
    if (kind !== undefined) {
      fields.push(`kind=$${n++}`);
      vals.push(String(kind).slice(0, 40));
    }
    if (payload !== undefined) {
      if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'payload must be object' });
      fields.push(`payload=$${n++}::jsonb`);
      vals.push(JSON.stringify(payload));
    }
    if (sessionId !== undefined) {
      fields.push(`"sessionId"=$${n++}`);
      vals.push(sessionId ? String(sessionId).slice(0, 200) : null);
    }
    if (!fields.length) return res.status(400).json({ error: 'No updates' });
    fields.push('"updatedAt"=NOW()');
    const idParam = n++;
    const userParam = n;
    vals.push(id, req.user.id);
    const q = `UPDATE study_decks SET ${fields.join(', ')} WHERE id=$${idParam} AND "userId"=$${userParam} RETURNING *`;
    const { rows } = await pool.query(q, vals);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM study_decks WHERE id=$1 AND "userId"=$2',
      [id, req.user.id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
