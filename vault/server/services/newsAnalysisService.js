'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function getGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  return new GoogleGenerativeAI(key);
}

/**
 * Build the analysis prompt for a topic + articles + optional prior-day context.
 * @param {string} topicTitle
 * @param {Array}  articles   - up to 15 articles; numbered 1-based in prompt
 * @param {Array}  context    - optional [{date, unbiasedSummary, commentary}]
 */
function buildPrompt(topicTitle, articles, context) {
  const numbered = articles.slice(0, 15);
  const articleList = numbered
    .map((a, i) => {
      const date = a.pubDate ? ` | ${a.pubDate.slice(0, 16)}` : '';
      return `[${i + 1}] ${a.title} (${a.source}${date})\n    ${(a.summary || '').slice(0, 600)}`;
    })
    .join('\n\n');

  let contextBlock = '';
  if (context && context.length > 0) {
    contextBlock = '\n\nPREVIOUS 7 DAYS — use to identify trends, escalations, or shifts:\n' +
      context.map(c =>
        `${c.date}: ${c.unbiasedSummary || '(no summary)'}${c.commentary ? `\n  User note: ${c.commentary}` : ''}`
      ).join('\n') + '\n';
  }

  return `You are a senior analyst writing a daily intelligence briefing. These ${numbered.length} articles about "${topicTitle}" were published in the last 48 hours. Your job is to report what specifically happened or changed TODAY — not a general overview of the topic.${contextBlock}

Critical rules:
• Focus on the SPECIFIC DEVELOPMENT these articles report — a decision, statement, event, escalation, or shift
• Do NOT write broad background about the topic — assume the reader already knows the context
• Every claim must reference something actually in the articles
• If the prior-week context shows this is a continuation or escalation, say so explicitly
• Summaries must be specific enough that they could not apply to any other day's news on this topic

Return ONLY valid JSON (no markdown fences, no explanation):

{
  "unbiased": {
    "summary": "3-4 sentences describing the specific development reported today — what happened, who did what, and what it means. Must be specific to these articles, not generic background.",
    "timeline": ["[date from article] specific event — only include if dates appear in the articles"],
    "keyFacts": ["specific concrete fact from today's reporting — names, numbers, decisions, statements"],
    "mechanisms": ["How [specific thing in these articles] works — only include if supply chains, funding, or processes are described"],
    "actorMotivations": ["[Named actor]: [what they did/said today] — [why, based on article content]"],
    "uncertainties": ["What today's articles leave unresolved, contested, or contradict each other on"],
    "sourceCredibility": "Flag state media (PressTV=Iran, RT=Russia, Xinhua=China, Sputnik=Russia) or outlets party to the conflict. Note contradictions. Omit if not applicable.",
    "sourceIndices": [1, 2, 3]
  },
  "left": {
    "summary": "2-3 sentences: how would a progressive commentator frame TODAY'S specific development — not the topic generally",
    "keyPoints": ["argument specific to what happened today", "..."],
    "emphasis": "The specific value or concern this framing prioritises in today's story",
    "sourceIndices": [1, 3]
  },
  "right": {
    "summary": "2-3 sentences: how would a conservative commentator frame TODAY'S specific development — not the topic generally",
    "keyPoints": ["argument specific to what happened today", "..."],
    "emphasis": "The specific value or concern this framing prioritises in today's story",
    "sourceIndices": [2, 4]
  },
  "commonGround": {
    "agreedFacts": ["specific verifiable fact from today's reporting that both sides accept"],
    "coreDisagreement": "The specific point of contention in today's story — not a generic ideological divide"
  }
}

Omit timeline, mechanisms, actorMotivations, and uncertainties arrays entirely if the articles don't support them — do not generate placeholder content. sourceIndices are 1-based; include 2-5 per section.

Articles:
${articleList}`;
}

/**
 * Resolve 1-based sourceIndices arrays into {title, url, source} objects
 * using the original articles array, avoiding any hallucinated URLs.
 */
function resolveSourceIndices(analysis, articles) {
  const resolve = (indices) => {
    if (!Array.isArray(indices)) return [];
    return indices
      .map(i => articles[i - 1])
      .filter(Boolean)
      .map(a => ({ title: a.title, url: a.link, source: a.source }));
  };
  return {
    ...analysis,
    left:    { ...analysis.left,    sources: resolve(analysis.left?.sourceIndices)    },
    right:   { ...analysis.right,   sources: resolve(analysis.right?.sourceIndices)   },
    unbiased:{ ...analysis.unbiased,sources: resolve(analysis.unbiased?.sourceIndices)},
  };
}

/**
 * Parse JSON from AI response — strips markdown fences if present.
 */
function parseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

/**
 * Analyse articles for a topic using Gemini if available, otherwise Claude Haiku.
 * @param {string} topicTitle
 * @param {Array}  articles
 * @param {Array}  [context]  - optional [{date, unbiasedSummary, commentary}]
 * @returns {Promise<Object>} analysis object with sources resolved
 */
async function analyseTopicArticles(topicTitle, articles, context) {
  if (!articles || articles.length === 0) {
    return {
      left:         { summary: 'No articles found for this topic.', keyPoints: [], emphasis: '', sources: [] },
      right:        { summary: 'No articles found for this topic.', keyPoints: [], emphasis: '', sources: [] },
      commonGround: { agreedFacts: [], coreDisagreement: '' },
      unbiased:     { summary: 'No articles found for this topic.', keyFacts: [], sources: [] },
    };
  }

  const prompt = buildPrompt(topicTitle, articles, context);
  let raw;

  // Try Gemini first (cheaper for bulk digest runs)
  const gemini = getGemini();
  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({ model: 'gemini-2.5-pro-preview-05-06' });
      const result = await model.generateContent(prompt);
      raw = parseJSON(result.response.text());
    } catch (err) {
      console.warn(`[news] Gemini analysis failed, falling back to Claude: ${err.message}`);
    }
  }

  if (!raw) {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }],
    });
    raw = parseJSON(message.content[0]?.text || '{}');
  }

  // Resolve 1-based indices → real article objects (no hallucinated URLs)
  return resolveSourceIndices(raw, articles);
}

module.exports = { analyseTopicArticles };
