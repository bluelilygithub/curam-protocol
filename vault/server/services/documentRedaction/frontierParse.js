'use strict';

function parseFrontierJson(raw) {
  let jsonText = String(raw || '').trim();
  const fence = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
  const parsed = JSON.parse(jsonText);
  return {
    analysis: String(parsed.analysis || parsed.answer || '').trim(),
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
  };
}

module.exports = { parseFrontierJson };
