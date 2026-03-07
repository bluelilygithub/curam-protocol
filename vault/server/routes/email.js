const express = require('express');
const router = express.Router();
const db = require('../db');
const sendEmail = require('../utils/sendEmail');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtmlEmail(messages, subject) {
  const rows = messages.map((m) => `
    <tr>
      <td style="padding:12px 16px;vertical-align:top;width:80px;font-size:11px;font-weight:600;color:${m.role === 'user' ? '#CC785C' : '#555'};text-transform:uppercase;letter-spacing:0.05em;">
        ${escapeHtml(m.role)}
      </td>
      <td style="padding:12px 16px;font-size:14px;color:#1A1A1A;line-height:1.6;border-left:2px solid #E0E0E0;">
        ${escapeHtml(m.content).replace(/\n/g, '<br>')}
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'DM Sans',sans-serif;background:#F5F5F0;margin:0;padding:20px;">
  <div style="max-width:700px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#CC785C;padding:24px 32px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">${escapeHtml(subject)}</h1>
      <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Exported from Project Vault</p>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      ${rows}
    </table>
    <div style="padding:16px 32px;background:#F5F5F0;font-size:11px;color:#888;text-align:center;">
      Exported on ${new Date().toLocaleDateString()}
    </div>
  </div>
</body>
</html>`;
}

// POST /api/email
router.post('/', async (req, res) => {
  const { sessionId, to, subject } = req.body;
  if (!sessionId || !to) return res.status(400).json({ error: 'sessionId and to are required' });

  const messages = db.prepare('SELECT * FROM messages WHERE sessionId=? ORDER BY createdAt ASC').all(sessionId);
  if (messages.length === 0) return res.status(404).json({ error: 'No messages found' });

  const emailSubject = subject || `Chat export – ${new Date().toLocaleDateString()}`;
  const html = buildHtmlEmail(messages, emailSubject);

  try {
    await sendEmail({ to, subject: emailSubject, html });
    res.json({ ok: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
