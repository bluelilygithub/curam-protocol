'use strict';

const express = require('express');
const router = express.Router();
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const { pool } = require('../db');

// GET /api/export/chat/:sessionId — JSON download
router.get('/chat/:sessionId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" ASC',
      [req.params.sessionId]
    );
    res.setHeader('Content-Disposition', `attachment; filename="chat-${req.params.sessionId}.json"`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/export/chat/pdf — PDF export
router.post('/chat/pdf', async (req, res) => {
  const { sessionId, title } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  try {
    const { rows: messages } = await pool.query(
      'SELECT * FROM messages WHERE "sessionId"=$1 ORDER BY "createdAt" ASC',
      [sessionId]
    );
    if (messages.length === 0) return res.status(404).json({ error: 'No messages found' });

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const addText = (text, options = {}) => {
      const { size = 11, bold = false, color = rgb(0.1, 0.1, 0.1), lineGap = 6 } = options;
      const usedFont = bold ? boldFont : font;
      const words = text.split(' ');
      let line = '';
      const lines = [];

      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const lineWidth = usedFont.widthOfTextAtSize(testLine, size);
        if (lineWidth > contentWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = testLine;
        }
      }
      if (line) lines.push(line);

      for (const l of lines) {
        if (y < margin + 30) {
          page = pdfDoc.addPage([pageWidth, pageHeight]);
          y = pageHeight - margin;
        }
        page.drawText(l, { x: margin, y, size, font: usedFont, color });
        y -= size + lineGap;
      }
      y -= lineGap;
    };

    // Title page
    addText(title || `Chat Export – ${sessionId}`, { size: 18, bold: true });
    addText(`Exported: ${new Date().toLocaleDateString()}`, { size: 10, color: rgb(0.5, 0.5, 0.5) });
    y -= 20;

    for (const msg of messages) {
      const roleColor = msg.role === 'user' ? rgb(0.8, 0.47, 0.36) : rgb(0.3, 0.3, 0.3);
      addText(msg.role.toUpperCase(), { size: 9, bold: true, color: roleColor });
      addText(msg.content, { size: 10, lineGap: 4 });
      y -= 10;
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="chat-${sessionId}.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/project/:id
router.get('/project/:id', async (req, res) => {
  try {
    const { rows: projects } = await pool.query('SELECT * FROM projects WHERE id=$1', [req.params.id]);
    if (!projects[0]) return res.status(404).json({ error: 'Not found' });

    const { rows: files } = await pool.query(
      'SELECT id, name, size, mimetype, "aiSummary", "uploadedAt" FROM files WHERE "projectId"=$1',
      [req.params.id]
    );
    const { rows: messages } = await pool.query(
      'SELECT * FROM messages WHERE "projectId"=$1 ORDER BY "createdAt" ASC',
      [req.params.id]
    );

    res.setHeader('Content-Disposition', `attachment; filename="project-${req.params.id}.json"`);
    res.json({ project: projects[0], files, messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/export/projects
router.get('/projects', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM projects ORDER BY "updatedAt" DESC');
    res.setHeader('Content-Disposition', 'attachment; filename="all-projects.json"');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
