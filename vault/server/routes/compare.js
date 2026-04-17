const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool } = require('../db');
const { getModelsForUser } = require('../services/modelResolver');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isGemini(modelId) { return typeof modelId === 'string' && modelId.startsWith('gemini-'); }
function isDeepSeek(modelId) { return typeof modelId === 'string' && modelId.startsWith('deepseek-'); }

const MODE_PROMPTS = {
  diff: 'You will be given two documents. Provide a detailed comparison. Use clear headings to organise additions, removals, modifications, and unchanged sections. Be thorough and precise.',
  summarise: 'You will be given two documents. Summarise the key differences between them in a clear, structured way. Focus on what has changed, what was added, and what was removed.',
  reconcile: 'You will be given two documents. Reconcile them into a single unified version that incorporates the best elements of both. Where there are conflicts, choose the better option and briefly explain your choice.',
  conflicts: 'You will be given two documents. Identify only the conflicts, contradictions, and incompatibilities between them. Ignore similarities — focus only on where they disagree.',
};

const MODE_VERB = {
  diff: 'compare',
  summarise: 'summarise the differences between',
  reconcile: 'reconcile',
  conflicts: 'identify the conflicts between',
};

async function resolveDocument(fileId, fileBuffer, fileName, fileMime) {
  if (fileId) {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [parseInt(fileId, 10)]);
    const file = rows[0];
    if (!file) throw new Error(`File ID ${fileId} not found`);
    if (file.mimetype?.startsWith('image/')) {
      const data = fs.readFileSync(file.path).toString('base64');
      return { type: 'image', name: file.name, mediaType: file.mimetype, data };
    }
    const content = file.extractedText || `[File: ${file.name} — no text content available]`;
    return { type: 'text', name: file.name, content };
  }
  if (fileBuffer) {
    if (fileMime?.startsWith('image/')) {
      return { type: 'image', name: fileName, mediaType: fileMime, data: fileBuffer.toString('base64') };
    }
    return { type: 'text', name: fileName, content: fileBuffer.toString('utf8') };
  }
  throw new Error('No document provided');
}

// POST /api/compare
router.post(
  '/',
  upload.fields([{ name: 'fileA', maxCount: 1 }, { name: 'fileB', maxCount: 1 }]),
  async (req, res) => {
    const { standard: standardModel } = await getModelsForUser(req.user?.id);
    const { fileAId, fileBId, mode = 'diff', model = standardModel } = req.body;
    const uploadA = req.files?.fileA?.[0];
    const uploadB = req.files?.fileB?.[0];

    if (!fileAId && !uploadA) return res.status(400).json({ error: 'Document A is required' });
    if (!fileBId && !uploadB) return res.status(400).json({ error: 'Document B is required' });

    let docA, docB;
    try {
      docA = await resolveDocument(fileAId, uploadA?.buffer, uploadA?.originalname, uploadA?.mimetype);
      docB = await resolveDocument(fileBId, uploadB?.buffer, uploadB?.originalname, uploadB?.mimetype);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const systemPrompt = MODE_PROMPTS[mode] || MODE_PROMPTS.diff;
    const verb = MODE_VERB[mode] || 'compare';

    // Build message content blocks
    const contentBlocks = [];

    if (docA.type === 'image') {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: docA.mediaType, data: docA.data } });
      contentBlocks.push({ type: 'text', text: `The above is Document A: "${docA.name}"` });
    } else {
      contentBlocks.push({ type: 'text', text: `Document A: "${docA.name}"\n\n${docA.content}` });
    }

    if (docB.type === 'image') {
      contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: docB.mediaType, data: docB.data } });
      contentBlocks.push({ type: 'text', text: `The above is Document B: "${docB.name}"` });
    } else {
      contentBlocks.push({ type: 'text', text: `Document B: "${docB.name}"\n\n${docB.content}` });
    }

    contentBlocks.push({ type: 'text', text: `Please ${verb} these two documents.` });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      if (isGemini(model)) {
        const geminiApiKey = process.env.GEMINI_API_KEY;
        if (!geminiApiKey) throw new Error('GEMINI_API_KEY is not configured');

        const genai = new GoogleGenerativeAI(geminiApiKey);
        const gModel = genai.getGenerativeModel({
          model,
          systemInstruction: systemPrompt,
          generationConfig: { maxOutputTokens: 8192 },
        });

        // Convert Anthropic-style blocks to Gemini parts
        const parts = contentBlocks.map(b => {
          if (b.type === 'image') {
            return { inlineData: { mimeType: b.source.media_type, data: b.source.data } };
          }
          return { text: b.text };
        });

        const streamResult = await gModel.generateContentStream(parts);
        for await (const chunk of streamResult.stream) {
          const text = chunk.text();
          if (text) res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
        }
      } else if (isDeepSeek(model)) {
        const dsKey = process.env.DEEPSEEK_API_KEY;
        if (!dsKey) throw new Error('DEEPSEEK_API_KEY is not configured');
        const dsMessages = [];
        if (systemPrompt?.trim()) dsMessages.push({ role: 'system', content: systemPrompt });
        const userText = contentBlocks.filter(b => b.type === 'text').map(b => b.text).join('\n');
        dsMessages.push({ role: 'user', content: userText });
        const dsResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dsKey}` },
          body: JSON.stringify({ model, messages: dsMessages, stream: true, max_tokens: 8096 }),
        });
        if (!dsResponse.ok) {
          const errText = await dsResponse.text();
          throw new Error(`DeepSeek API error ${dsResponse.status}: ${errText}`);
        }
        const reader = dsResponse.body.getReader();
        const decoder = new TextDecoder();
        let dsBuf = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          dsBuf += decoder.decode(value, { stream: true });
          const lines = dsBuf.split('\n');
          dsBuf = lines.pop();
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            const raw = line.slice(6).trim();
            if (raw === '[DONE]') continue;
            try {
              const parsed = JSON.parse(raw);
              const text = parsed.choices?.[0]?.delta?.content;
              if (text) res.write(`data: ${JSON.stringify({ delta: text })}\n\n`);
            } catch {}
          }
        }
      } else {
        const stream = anthropic.messages.stream({
          model,
          max_tokens: 8096,
          system: systemPrompt,
          messages: [{ role: 'user', content: contentBlocks }],
        });
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ delta: chunk.delta.text })}\n\n`);
          }
        }
      }

      res.write(`data: [DONE]\n\n`);
      res.end();
    } catch (err) {
      console.error('Compare stream error:', err);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
);

// POST /api/compare/save
router.post('/save', async (req, res) => {
  const { projectId, docAName, docBName, mode, model, result } = req.body;
  if (!result) return res.status(400).json({ error: 'result required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO comparisons ("projectId", "docAName", "docBName", mode, model, result) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [projectId || null, docAName || '', docBName || '', mode || 'diff', model || '', result]
    );
    res.json({ id: rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
