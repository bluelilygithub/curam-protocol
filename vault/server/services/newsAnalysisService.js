'use strict';

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getModelsForUser } = require('./modelResolver');
const { callModel } = require('./callModel');

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
 * @param {string} template   - 'perspectives' (default, 4 sections) or 'digest' (2 sections)
 */
function buildPrompt(topicTitle, articles, context, template = 'perspectives') {
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

  const intro = `You are a senior analyst writing a daily intelligence briefing. These ${numbered.length} articles about "${topicTitle}" were published in the last 48 hours. Your job is to report what specifically happened or changed TODAY — not a general overview of the topic.${contextBlock}

Critical rules:
• Focus on the SPECIFIC DEVELOPMENT these articles report — a decision, statement, event, escalation, or shift
• Do NOT write broad background about the topic — assume the reader already knows the context
• Every claim must reference something actually in the articles
• If the prior-week context shows this is a continuation or escalation, say so explicitly
• Summaries must be specific enough that they could not apply to any other day's news on this topic`;

  const unbiasedSchema = `  "unbiased": {
    "summary": "3-4 sentences describing the specific development reported today — what happened, who did what, and what it means. Must be specific to these articles, not generic background.",
    "timeline": ["[date from article] specific event — only include if dates appear in the articles"],
    "keyFacts": ["specific concrete fact from today's reporting — names, numbers, decisions, statements"],
    "mechanisms": ["How [specific thing in these articles] works — only include if supply chains, funding, or processes are described"],
    "actorMotivations": ["[Named actor]: [what they did/said today] — [why, based on article content]"],
    "uncertainties": ["What today's articles leave unresolved, contested, or contradict each other on"],
    "sourceCredibility": "Flag state media (PressTV=Iran, RT=Russia, Xinhua=China, Sputnik=Russia) or outlets party to the conflict. Note contradictions. Omit if not applicable.",
    "sourceIndices": [1, 2, 3]
  }`;

  if (template === 'digest') {
    return `${intro}

Return ONLY valid JSON (no markdown fences, no explanation):

{
${unbiasedSchema},
  "keyStorylines": {
    "keyPoints": ["A specific storyline that is new or changed since the prior 7-day context — what happened, who, and why it matters. One entry per distinct storyline, 2-5 total. Not a re-summary of the unbiased section above — this is a scan of everything moving in this space today, even secondary items."],
    "sourceIndices": [1, 2, 3]
  }
}

Omit timeline, mechanisms, actorMotivations, and uncertainties arrays entirely if the articles don't support them — do not generate placeholder content. sourceIndices are 1-based; include 2-5 per section.

Articles:
${articleList}`;
  }

  return `${intro}

Return ONLY valid JSON (no markdown fences, no explanation):

{
${unbiasedSchema},
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
 * Resolve 1-based sourceIndices arrays into {title, url, source} objects using the original
 * articles array (avoiding any hallucinated URLs) — generic over whichever top-level sections
 * the response actually has (unbiased/left/right for "perspectives", unbiased/keyStorylines for
 * "digest"), rather than hardcoding one template's section names.
 */
function resolveSourceIndices(analysis, articles) {
  const resolve = (indices) => {
    if (!Array.isArray(indices)) return [];
    return indices
      .map(i => articles[i - 1])
      .filter(Boolean)
      .map(a => ({ title: a.title, url: a.link, source: a.source }));
  };
  const result = { ...analysis };
  for (const key of Object.keys(analysis || {})) {
    const section = analysis[key];
    if (section && typeof section === 'object' && Array.isArray(section.sourceIndices)) {
      result[key] = { ...section, sources: resolve(section.sourceIndices) };
    }
  }
  return result;
}

/**
 * Parse JSON from AI response — strips markdown fences if present.
 */
function parseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  return JSON.parse(cleaned);
}

function emptyAnalysis(template) {
  const base = {
    unbiased: { summary: 'No articles found for this topic.', keyFacts: [], sources: [] },
  };
  if (template === 'digest') {
    return { ...base, keyStorylines: { keyPoints: [], sources: [] } };
  }
  return {
    ...base,
    left:         { summary: 'No articles found for this topic.', keyPoints: [], emphasis: '', sources: [] },
    right:        { summary: 'No articles found for this topic.', keyPoints: [], emphasis: '', sources: [] },
    commonGround: { agreedFacts: [], coreDisagreement: '' },
  };
}

/**
 * Analyse articles for a topic using Gemini if available, otherwise Claude/DeepSeek fallback.
 * @param {string} topicTitle
 * @param {Array}  articles
 * @param {Array}  [context]  - optional [{date, unbiasedSummary, commentary}]
 * @param {number} userId
 * @param {string} [template] - 'perspectives' (default) or 'digest'
 * @returns {Promise<Object>} analysis object with sources resolved
 */
async function analyseTopicArticles(topicTitle, articles, context, userId, template = 'perspectives') {
  if (!articles || articles.length === 0) {
    return {
      analysis: emptyAnalysis(template),
      usage: { inputTokens: 0, outputTokens: 0, model: null },
    };
  }

  const prompt = buildPrompt(topicTitle, articles, context, template);
  const { gemini: geminiModelId, standard: standardModelId } = await getModelsForUser(userId);
  let raw;
  let usage = { inputTokens: 0, outputTokens: 0, model: null };

  // Try Gemini first (cheaper for bulk digest runs)
  const gemini = getGemini();
  if (gemini) {
    try {
      const model = gemini.getGenerativeModel({ model: geminiModelId });
      const result = await model.generateContent(prompt);
      raw = parseJSON(result.response.text());
      const meta = result.response.usageMetadata;
      usage = {
        inputTokens:  meta?.promptTokenCount     || 0,
        outputTokens: meta?.candidatesTokenCount || 0,
        model: geminiModelId,
      };
    } catch (err) {
      console.warn(`[news] Gemini analysis failed (${geminiModelId}), falling back to ${standardModelId}: ${err.message}`);
    }
  }

  if (!raw) {
    // "digest" only asks for 2 sections (~half the JSON fields of "perspectives"), so it gets a
    // smaller budget — both are sized well above the old flat 3000, which was cutting a full
    // "perspectives" response off mid-string on the fallback model (confirmed: recurring
    // "Unterminated string in JSON" failures in the suggestions log whenever Gemini's free-tier
    // quota forced a fallback) and silently failing that topic for the day.
    const maxTokens = template === 'digest' ? 3000 : 6000;
    const result = await callModel(standardModelId, prompt, { maxTokens, returnUsage: true });
    raw = parseJSON(result.text || '{}');
    usage = {
      inputTokens: result.inputTokens || 0,
      outputTokens: result.outputTokens || 0,
      model: standardModelId,
    };
  }

  // Resolve 1-based indices → real article objects (no hallucinated URLs)
  return { analysis: resolveSourceIndices(raw, articles), usage };
}

module.exports = { analyseTopicArticles };
