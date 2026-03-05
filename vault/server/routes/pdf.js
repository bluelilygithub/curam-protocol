const express = require('express');
const router = express.Router();
const Anthropic = require('@anthropic-ai/sdk');
const db = require('../db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// POST /api/pdf/chat
router.post('/chat', async (req, res) => {
  const { fileId, messages } = req.body;
  if (!fileId || !messages) return res.status(400).json({ error: 'fileId and messages required' });

  const file = db.prepare('SELECT * FROM files WHERE id=?').get(fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const systemPrompt = file.extractedText
    ? `You are analyzing the document "${file.name}".\n\nDocument content:\n${file.extractedText.substring(0, 10000)}\n\nAnswer questions based on this document.`
    : `You are analyzing the file "${file.name}". The file content could not be extracted. Please note this limitation in your responses.`;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: systemPrompt,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ delta: chunk.delta.text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('PDF chat error:', err);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
