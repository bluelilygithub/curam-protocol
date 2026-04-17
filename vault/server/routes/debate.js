'use strict';

const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');
const { getModelsForUser } = require('../services/modelResolver');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const DEBATE_SYSTEM =
  'You are participating in a structured debate. Give your honest, well-reasoned response. Be concise but thorough.';

async function getGeminiKey() {
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key='GEMINI_API_KEY'");
    if (rows[0]?.value) return rows[0].value;
  } catch (_) {}
  return process.env.GEMINI_API_KEY || null;
}

function buildSystemWithContext(base, sharedContextFiles) {
  if (!sharedContextFiles?.length) return base;
  const textFiles = sharedContextFiles.filter((f) => !f.isImage && f.extractedText);
  if (!textFiles.length) return base;
  const context = textFiles.map((f) => `[Shared context file: ${f.name}]\n${f.extractedText}`).join('\n\n');
  return `${base}\n\nShared context files for this debate:\n\n${context}`;
}

function buildAnthropicContent(text, sharedContextFiles) {
  const blocks = [];
  if (sharedContextFiles?.length) {
    for (const f of sharedContextFiles) {
      if (f.isImage && f.base64 && f.mediaType) {
        blocks.push({ type: 'image', source: { type: 'base64', media_type: f.mediaType, data: f.base64 } });
      }
    }
  }
  blocks.push({ type: 'text', text });
  return blocks;
}

function buildGeminiParts(text, sharedContextFiles) {
  const parts = [];
  if (sharedContextFiles?.length) {
    for (const f of sharedContextFiles) {
      if (f.isImage && f.base64 && f.mediaType) {
        parts.push({ inlineData: { mimeType: f.mediaType, data: f.base64 } });
      }
    }
  }
  parts.push({ text });
  return parts;
}

async function callModel(modelId, userText, sharedContextFiles = []) {
  if (modelId.startsWith('gemini-')) {
    const geminiKey = await getGeminiKey();
    if (!geminiKey) throw new Error('Gemini API key not configured. Add GEMINI_API_KEY in Settings.');
    let GoogleGenerativeAI;
    try {
      ({ GoogleGenerativeAI } = require('@google/generative-ai'));
    } catch {
      throw new Error('@google/generative-ai package not installed. Run: npm install @google/generative-ai in vault/');
    }
    const genAI = new GoogleGenerativeAI(geminiKey);
    const sysInstruction = buildSystemWithContext(DEBATE_SYSTEM, sharedContextFiles);
    const model = genAI.getGenerativeModel({ model: modelId, systemInstruction: sysInstruction });
    const parts = buildGeminiParts(userText, sharedContextFiles);
    const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
    return result.response.text();
  }

  if (modelId.startsWith('deepseek-')) {
    const dsKey = process.env.DEEPSEEK_API_KEY;
    if (!dsKey) throw new Error('DeepSeek API key not configured. Add DEEPSEEK_API_KEY to your environment.');
    const systemPrompt = buildSystemWithContext(DEBATE_SYSTEM, sharedContextFiles);
    const messages = [];
    if (systemPrompt?.trim()) messages.push({ role: 'system', content: systemPrompt });
    const contextText = sharedContextFiles.filter(f => !f.isImage && f.extractedText).map(f => `[${f.name}]\n${f.extractedText}`).join('\n\n');
    messages.push({ role: 'user', content: contextText ? `${contextText}\n\n${userText}` : userText });
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${dsKey}` },
      body: JSON.stringify({ model: modelId, messages, max_tokens: 1024 }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `DeepSeek error ${res.status}`);
    return data.choices?.[0]?.message?.content || '';
  }

  // Anthropic
  const systemPrompt = buildSystemWithContext(DEBATE_SYSTEM, sharedContextFiles);
  const content = buildAnthropicContent(userText, sharedContextFiles);
  const response = await anthropic.messages.create({
    model: modelId,
    max_tokens: 1024,
    system: systemPrompt,
    messages: [{ role: 'user', content }],
  });
  return response.content[0]?.text || '';
}

// POST /api/debate/extract
router.post('/extract', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { originalname, mimetype, buffer } = req.file;

  try {
    if (mimetype.startsWith('image/')) {
      return res.json({ name: originalname, isImage: true, base64: buffer.toString('base64'), mediaType: mimetype, extractedText: null });
    }

    let extractedText = '';
    if (mimetype === 'application/pdf') {
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
      const pdfDoc = await loadingTask.promise;
      const pages = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(' '));
      }
      extractedText = pages.join('\n');
    } else {
      extractedText = buffer.toString('utf8');
    }

    res.json({ name: originalname, isImage: false, extractedText, base64: null, mediaType: mimetype });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/debate/start
router.post('/start', async (req, res) => {
  const { topic, modelA, modelB, save, projectId, sharedContextFiles } = req.body;
  if (!topic || !modelA || !modelB) {
    return res.status(400).json({ error: 'topic, modelA, modelB required' });
  }

  const ctx = sharedContextFiles || [];
  const prompt = `Topic: ${topic}\n\nGive your initial position on this topic.`;

  try {
    const [resultA, resultB] = await Promise.allSettled([
      callModel(modelA, prompt, ctx),
      callModel(modelB, prompt, ctx),
    ]);

    const responseA = resultA.status === 'fulfilled' ? resultA.value : `[Error: ${resultA.reason?.message || 'Model A failed'}]`;
    const responseB = resultB.status === 'fulfilled' ? resultB.value : `[Error: ${resultB.reason?.message || 'Model B failed'}]`;

    let debateId = null;
    if (save) {
      debateId = randomUUID();
      await pool.query(
        'INSERT INTO debates ("debateId", topic, "modelA", "modelB", rounds, "projectId") VALUES ($1, $2, $3, $4, $5, $6)',
        [debateId, topic, modelA, modelB, JSON.stringify([{ round: 1, responseA, responseB }]), projectId || null]
      );
    }

    res.json({ responseA, responseB, debateId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/debate/round
router.post('/round', async (req, res) => {
  const { debateId, topic, modelA, modelB, roundNumber, responseA: prevA, responseB: prevB, userComment, sharedContextFiles } = req.body;
  if (!topic || !modelA || !modelB || !prevA || !prevB) {
    return res.status(400).json({ error: 'topic, modelA, modelB, responseA, responseB required' });
  }

  const ctx = sharedContextFiles || [];
  const commentPart = userComment ? `\n\nUser's comment for this round: ${userComment}` : '';

  const buildPrompt = (myPrev, otherPrev) =>
    `Topic: ${topic}\n\nYour previous response:\n${myPrev}\n\nThe other model's response:\n${otherPrev}${commentPart}\n\nRefine your position if you think it can be improved based on the other model's arguments${userComment ? ' and the user comment' : ''}. If your current response is already optimal and you have nothing meaningful to add or change, reply with exactly: NO_CHANGE`;

  try {
    const [resultA, resultB] = await Promise.allSettled([
      callModel(modelA, buildPrompt(prevA, prevB), ctx),
      callModel(modelB, buildPrompt(prevB, prevA), ctx),
    ]);

    const textA = resultA.status === 'fulfilled' ? resultA.value.trim() : `[Error: ${resultA.reason?.message || 'Model A failed'}]`;
    const textB = resultB.status === 'fulfilled' ? resultB.value.trim() : `[Error: ${resultB.reason?.message || 'Model B failed'}]`;

    const noChangeA = textA === 'NO_CHANGE';
    const noChangeB = textB === 'NO_CHANGE';
    const newResponseA = noChangeA ? prevA : textA;
    const newResponseB = noChangeB ? prevB : textB;

    if (debateId) {
      const { rows: debates } = await pool.query(
        'SELECT rounds FROM debates WHERE "debateId"=$1', [debateId]
      );
      if (debates[0]) {
        const rounds = JSON.parse(debates[0].rounds || '[]');
        rounds.push({ round: roundNumber, responseA: newResponseA, responseB: newResponseB, noChangeA, noChangeB, userComment: userComment || null });
        await pool.query('UPDATE debates SET rounds=$1 WHERE "debateId"=$2', [JSON.stringify(rounds), debateId]);
      }
    }

    res.json({ responseA: newResponseA, noChangeA, responseB: newResponseB, noChangeB });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/debate/summary
router.post('/summary', async (req, res) => {
  const { topic, finalResponseA, modelA, finalResponseB, modelB } = req.body;
  if (!topic || !finalResponseA || !finalResponseB) {
    return res.status(400).json({ error: 'topic, finalResponseA, finalResponseB required' });
  }

  try {
    const response = await anthropic.messages.create({
      model: (await getModelsForUser(req.user?.id)).light,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `Two AI models debated the topic: "${topic}"\n\n${modelA}'s final position:\n${finalResponseA}\n\n${modelB}'s final position:\n${finalResponseB}\n\nSynthesise these into a structured summary covering:\n1. What both models agreed on\n2. Where they still differ\n3. A recommended conclusion or synthesis\n\nBe concise and clear.`,
      }],
    });
    res.json({ summary: response.content[0]?.text || '' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
