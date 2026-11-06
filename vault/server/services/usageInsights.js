'use strict';

// Usage & Cost -> Advice tab: reads what each AI feature has spent on each model and says where a different model, or a different way of
// calling it, would cost less or work better. Plain rules over the usage log, no AI call, so it is free and the same numbers always give
// the same advice. Test: node server/services/usageInsights.test.js
//
// The advice names the owner's own models: the "light" and "standard" slots from Settings (getModelsForUser), never a hard-coded id.

const { calculateCost, hasPricing } = require('./costCalculator');

// Features that are small, well-defined jobs (sort a task, tag an email, summarise a feed, answer a how-to question): a light model does them well.
const LIGHT_JOB_RE = /^(tasks|goals|mood|calendar_nlp|talk_summary|pinned_urls|gmail_intel|news_digest|shares_news|shelf_extract|student_quiz|seo_negatives|seo_keywords|property_scenario_parse|notes_ai_.*|.*_guide|recipes_.*|translate_(chunk|one|glossary)|topic_research_(relevance|suggest|brief))$/;
// Features where the answer is a judgement the owner acts on (money, shares, writing that is sent on): worth a stronger model.
const JUDGEMENT_RE = /^(shares_observation.*|property_scenario_insight|translate_review|topic_research_(draft|review)|contract_review.*|finance.*|invoice.*)$/;

const MIN_SAVING = 0.0001; // dollars; below this a "saving" is noise
const TINY_CALL_TOKENS = 400;
const LONG_OUTPUT_RATIO = 3;

/** premium (Opus), standard (Sonnet, Gemini Pro), light (Haiku, Flash, DeepSeek), or unknown. */
function tierOf(modelId) {
  const id = String(modelId || '').toLowerCase();
  if (id.includes('opus')) return 'premium';
  if (id.includes('sonnet') || /(^|[-/])pro(\b|-)/.test(id)) return 'standard';
  if (id.includes('haiku') || id.includes('flash') || id.includes('deepseek') || id.includes('mini')) return 'light';
  return 'unknown';
}

function jobOf(feature) {
  const f = String(feature || '');
  if (JUDGEMENT_RE.test(f)) return 'judgement';
  if (LIGHT_JOB_RE.test(f)) return 'light';
  return 'general';
}

const money = (n) => (n < 0.01 ? '$' + n.toFixed(4) : '$' + n.toFixed(2));

/**
 * @param {object[]} rows one row per feature and model: { feature, model_id, calls, input_tokens, output_tokens, cost, cache_read, cache_creation }
 * @param {{light?: string|null, standard?: string|null}} models the owner's own light and standard models
 * @returns {{ observations: object[], calls: number, cost: number }}
 */
function buildInsights(rows, rawModels = {}) {
  // the "light" slot in Settings is only the first model of a provider; advice that says "use your light model" must point at one that is light
  const models = {
    light: tierOf(rawModels.light) === 'light' ? rawModels.light : null,
    standard: ['standard', 'premium'].includes(tierOf(rawModels.standard)) ? rawModels.standard : null,
  };
  const list = (rows || []).map((r) => ({
    feature: r.feature || 'other', model: r.model_id, calls: Number(r.calls) || 0,
    inTok: Number(r.input_tokens) || 0, outTok: Number(r.output_tokens) || 0, cost: Number(r.cost) || 0,
    cacheRead: Number(r.cache_read) || 0, cacheMake: Number(r.cache_creation) || 0,
  }));
  const totalCost = list.reduce((n, r) => n + r.cost, 0);
  const totalCalls = list.reduce((n, r) => n + r.calls, 0);
  const out = [];

  // by feature
  const byFeature = new Map();
  for (const r of list) {
    if (!byFeature.has(r.feature)) byFeature.set(r.feature, []);
    byFeature.get(r.feature).push(r);
  }

  for (const [feature, rs] of byFeature) {
    const calls = rs.reduce((n, r) => n + r.calls, 0);
    const inTok = rs.reduce((n, r) => n + r.inTok, 0);
    const outTok = rs.reduce((n, r) => n + r.outTok, 0);
    const cost = rs.reduce((n, r) => n + r.cost, 0);
    const job = jobOf(feature);

    // 1. a small job running on a stronger, dearer model than it needs
    if (job === 'light' && models.light) {
      for (const r of rs) {
        const tier = tierOf(r.model);
        if ((tier === 'premium' || tier === 'standard') && r.model !== models.light) {
          const would = calculateCost(models.light, r.inTok, r.outTok);
          const saving = r.cost - would;
          if (saving >= MIN_SAVING && would < r.cost * 0.7) {
            out.push({
              id: 'save:' + feature + ':' + r.model, kind: 'save', feature, model: r.model, calls: r.calls, cost: r.cost, saving,
              title: 'Use a lighter model for ' + feature,
              detail: r.calls + ' call' + (r.calls === 1 ? '' : 's') + ' ran on ' + r.model + ' (' + money(r.cost) + '). This is a small, well-defined job; your light model ' + models.light + ' would do it for about ' + money(would) + '.',
              action: 'In Settings, point this feature at the light model.',
            });
          }
        }
      }
    }

    // 2. a judgement job running on a light model: worth checking the quality
    if (job === 'judgement' && models.standard) {
      for (const r of rs) {
        if (tierOf(r.model) === 'light' && r.model !== models.standard && r.calls > 0) {
          const would = calculateCost(models.standard, r.inTok, r.outTok);
          out.push({
            id: 'quality:' + feature + ':' + r.model, kind: 'quality', feature, model: r.model, calls: r.calls, cost: r.cost, saving: -(would - r.cost),
            title: 'Check the quality of ' + feature,
            detail: 'You act on this result, and it ran on ' + r.model + ', a light model. If the answers have been shallow or wrong, your standard model ' + models.standard + ' would cost about ' + money(would) + ' for the same work (' + money(would - r.cost) + ' more).',
            action: 'Compare a few results. If they are good enough, leave it; if not, move this feature to the standard model.',
          });
        }
      }
    }

    // 3. the same feature running on several models
    const distinct = [...new Set(rs.filter((r) => r.calls > 0).map((r) => r.model))];
    if (distinct.length >= 2 && calls >= 4) {
      out.push({
        id: 'mixed:' + feature, kind: 'tune', feature, calls, cost, saving: null,
        title: feature + ' runs on ' + distinct.length + ' different models',
        detail: distinct.join(', ') + '. The same job on different models gives uneven results and makes the cost hard to predict.',
        action: 'Pick one model for this feature, unless the split is deliberate (for example a fallback).',
      });
    }

    // 4. many tiny calls
    if (calls >= 8 && (inTok + outTok) / calls < TINY_CALL_TOKENS) {
      out.push({
        id: 'tiny:' + feature, kind: 'tune', feature, calls, cost, saving: null,
        title: feature + ' makes many tiny calls',
        detail: calls + ' calls averaging ' + Math.round((inTok + outTok) / calls) + ' tokens each. Every call repeats the instructions; several small requests can often be sent as one.',
        action: 'Batch these into one call where the results are not needed one at a time.',
      });
    }

    // 5. long answers on an output-priced model
    if (calls >= 3 && inTok > 0 && outTok > inTok * LONG_OUTPUT_RATIO && cost >= 0.001) {
      out.push({
        id: 'long:' + feature, kind: 'tune', feature, calls, cost, saving: null,
        title: feature + ' writes far more than it reads',
        detail: 'It wrote ' + outTok.toLocaleString() + ' tokens from ' + inTok.toLocaleString() + ' read. Output costs several times more than input.',
        action: 'Ask for a shorter answer, or cap the length.',
      });
    }

    // 6. chat with long prompts that are not being cached
    if (feature === 'chat') {
      const claude = rs.filter((r) => String(r.model).toLowerCase().includes('claude'));
      const cInput = claude.reduce((n, r) => n + r.inTok, 0);
      const cCalls = claude.reduce((n, r) => n + r.calls, 0);
      const cRead = claude.reduce((n, r) => n + r.cacheRead, 0);
      if (cCalls >= 5 && cInput / cCalls >= 1500 && cRead === 0) {
        out.push({
          id: 'cache:chat', kind: 'tune', feature, calls: cCalls, cost: claude.reduce((n, r) => n + r.cost, 0), saving: null,
          title: 'Chat is not reusing its prompt',
          detail: cCalls + ' Claude chat calls averaged ' + Math.round(cInput / cCalls).toLocaleString() + ' input tokens and none were read from the prompt cache. Cached input costs a tenth as much.',
          action: 'Check that the persona, project and memory blocks are marked for caching and not changing between messages.',
        });
      }
    }
  }

  // 7. one feature takes most of the spend
  if (totalCost > 0 && totalCalls >= 10) {
    const top = [...byFeature.entries()].map(([feature, rs]) => ({ feature, cost: rs.reduce((n, r) => n + r.cost, 0) })).sort((a, b) => b.cost - a.cost)[0];
    if (top.cost / totalCost >= 0.5) {
      out.push({
        id: 'top:' + top.feature, kind: 'note', feature: top.feature, calls: null, cost: top.cost, saving: null,
        title: top.feature + ' is ' + Math.round((top.cost / totalCost) * 100) + '% of the spend',
        detail: money(top.cost) + ' of ' + money(totalCost) + '. Any saving worth chasing is here first.',
        action: null,
      });
    }
  }

  // 8. models whose price is not on file, so their cost is a guess
  const unpriced = [...new Set(list.filter((r) => r.calls > 0 && !hasPricing(r.model)).map((r) => r.model))];
  if (unpriced.length) {
    const cost = list.filter((r) => unpriced.includes(r.model)).reduce((n, r) => n + r.cost, 0);
    out.push({
      id: 'unpriced', kind: 'note', feature: null, calls: null, cost, saving: null,
      title: 'Cost for ' + unpriced.join(', ') + ' is a guess',
      detail: 'No price is on file for ' + (unpriced.length === 1 ? 'this model' : 'these models') + ', so the page uses a generic rate by name. The real bill may differ.',
      action: 'Add the price to server/services/costCalculator.js so these figures (and the advice above) are exact.',
    });
  }

  const order = { save: 0, quality: 1, tune: 2, note: 3 };
  out.sort((a, b) => order[a.kind] - order[b.kind] || (b.saving || 0) - (a.saving || 0) || b.cost - a.cost);
  return { observations: out, calls: totalCalls, cost: totalCost };
}

module.exports = { buildInsights, tierOf, jobOf };
