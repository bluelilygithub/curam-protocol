'use strict';

// What each tool needs from a model, for the Code Map Models check (docs/code-map.md "Models"). Keys are Code Map tool ids.
// Which tiers and setting keys a tool uses is NOT declared here: the check reads that from the tool's own code. Only needs are declared:
//
//   vision      sends images to the model, so the model must take images
//   minContext  smallest context window (input tokens) the tool's biggest prompt needs; 0 = no special need
//   json        parses a structured/JSON reply, so the model must return reliable JSON
//   mode        'interactive' (someone waits for it) or 'background' (cron/batch: a cheaper tier may do)
//   features    the usage_logs.feature values the tool logs under; a trailing * matches a prefix
//   ownsKeys    model setting keys only this tool uses. Normally keys are read from the code; claim one here when another tool's code reaches
//               the resolver only in passing (Tasks requires Contract Review's service to sync obligations) so it is not listed there too.
//
// Test: node server/services/codeMap/models/inventory.test.js fails when a tool that calls a model has no entry, an entry names a tool that
// does not exist, or a feature logged in code maps to no tool. Correct a need here when it is wrong; the needs are a judgement, not measured.

const N = (features, o = {}) => ({ vision: false, minContext: 0, json: false, mode: 'interactive', ...o, features });

const MODEL_NEEDS = {
  notes: N(['notes', 'notes_ai_*', 'notes_guide']),
  tasks: N(['tasks', 'calendar_nlp'], { json: true }),
  chat: N(['chat', 'student_cards', 'files', 'pinned_urls'], { vision: true, minContext: 100000 }),
  plans: N(['plans_*']),
  talk: N(['talk_summary']),
  memory: N(['memory_guide']),
  gmailIntel: N(['gmail'], { json: true }),
  expenseReview: N(['vendor'], { json: true }),
  clients: N(['clients', 'clients_email_summary', 'crm_guide']),
  tickets: N(['tickets_*']),
  finance: N(['finance', 'finance_compliance_report'], { json: true }),
  shares: N(['shares', 'shares_*'], { json: true, mode: 'background' }), // the daily news and observation runs are crons
  pcHealth: N(['pc_health_guide']),
  changelog: N(['changelog_ask']),
  codeMap: N(['code_map_*']),
  skillScan: N(['skill_scan_*'], { json: true }),
  documentRedaction: N(['document_redaction_*'], { vision: true, json: true }),
  contractReview: N(['contract_review_*'], { json: true, minContext: 100000, ownsKeys: ['contract_review_model'] }),
  docCompare: N(['doc_compare_*'], { json: true, minContext: 100000 }),
  pdf: N(['pdf', 'pdf_voice'], { vision: true }),
  fonts: N(['fonts_guide']),
  restyle: N(['restyle_guide']),
  graphics: N(['graphics', 'graphics_*'], { vision: true, json: true }),
  videos: N(['videos'], { vision: true, json: true }),
  presentations: N(['presentations_*'], { vision: true, json: true }),
  drawings: N(['drawings_guide', 'drawing_diagram'], { json: true }),
  sketchbook: N(['sketchbook_guide'], { vision: true }),
  music: N(['music']),
  routeTracer: N(['route_guide']),
  cellarPlanner: N(['cellar_guide', 'cellar_lite_guide', 'shelf_extract'], { vision: true, json: true }),
  seo: N(['seo_keywords'], { json: true }),
  serpTracker: N(['serp_tracker_guide']),
  googleAds: N(['seo_ads', 'seo_negatives'], { json: true }),
  domains: N(['domains_*'], { json: true }),
  bip: N(['bip_*'], { json: true }),
  devicePreview: N(['device_preview_guide']),
  html: N(['page_speed_guide']),
  aiVisibility: N(['ai_visibility_*'], { json: true }),
  webExtractor: N(['web_extractor_guide']),
  translate: N(['translate_*'], { json: true }),
  guitar: N(['guitar_*']),
  recipes: N(['recipes', 'recipes_*'], { json: true }),
  measurements: N(['measurements_guide']),
  fitness: N(['fitness'], { json: true }),
  burnerMail: N(['burner_mail_guide']),
  dnsLookup: N(['dns_lookup_guide']),
  emailFollowUp: N(['email_follow_up_*'], { json: true }),
  passwordVault: N(['password_vault_guide']),
  topicResearch: N(['topic_research_*'], { json: true, minContext: 50000 }),
  youtube: N(['youtube', 'youtube_guide']),
  productScout: N(['product_scout'], { json: true }),
  mood: N(['mood']),
  wellbeing: N(['wellbeing_*'], { json: true }),
  newsDigest: N(['news_digest'], { json: true, mode: 'background' }),
  liveTv: N(['live_tv_guide']),
  propertyScenario: N(['property_scenario_*'], { json: true }),
  goals: N(['goals']),
  student: N(['student_quiz'], { json: true }),
  usage: N(['usage_guide']),
};

// Logged features that belong to no single tool (the Settings guide, a test tutor). Kept apart so the mapping test passes on purpose.
const SHARED_FEATURES = ['settings_guide', 'test_tutor', 'unknown'];

/** The tool a usage_logs.feature belongs to, or null. Exact names win over prefixes; the longest prefix wins. */
function toolForFeature(feature) {
  const f = String(feature || '');
  let best = null;
  let bestLen = -1;
  for (const [tool, needs] of Object.entries(MODEL_NEEDS)) {
    for (const p of needs.features) {
      if (p === f) return tool;
      if (p.endsWith('*') && f.startsWith(p.slice(0, -1)) && p.length > bestLen) { best = tool; bestLen = p.length; }
    }
  }
  return best;
}

module.exports = { MODEL_NEEDS, SHARED_FEATURES, toolForFeature };
