export const MODELS = [
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Haiku 4.5',
    label: 'Economy',
    emoji: '⚡',
    tagline: 'Fast & affordable',
    desc: 'Best for quick tasks, drafts, and simple Q&A',
    color: '#059669',
    provider: 'anthropic',
    // execution intentionally omitted — admin must confirm local|hosted; never inferred from provider
  },
  {
    id: 'claude-sonnet-4-6',
    name: 'Sonnet 4.6',
    label: 'Standard',
    emoji: '⚖️',
    tagline: 'Smart & balanced',
    desc: 'Best for most work — code, writing, analysis',
    color: '#2563eb',
    provider: 'anthropic',
  },
  {
    id: 'claude-opus-4-6',
    name: 'Opus 4.6',
    label: 'Premium',
    emoji: '🧠',
    tagline: 'Most capable',
    desc: 'Best for complex reasoning and deep analysis',
    color: '#7c3aed',
    provider: 'anthropic',
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    label: 'Google Fast',
    emoji: '🔷',
    tagline: 'Google · Fast',
    desc: 'Fast multimodal model from Google',
    color: '#1a73e8',
    provider: 'gemini',
  },
  {
    id: 'gemini-2.5-pro-preview-05-06',
    name: 'Gemini 2.5 Pro',
    label: 'Google Pro',
    emoji: '🔮',
    tagline: 'Google · Most capable',
    desc: 'Google\'s most capable model with deep reasoning',
    color: '#9334e6',
    provider: 'gemini',
  },
  {
    id: 'deepseek-chat',
    name: 'DeepSeek V3',
    label: 'DeepSeek',
    emoji: '🐋',
    tagline: 'DeepSeek · Fast',
    desc: 'Fast and capable general-purpose model from DeepSeek',
    color: '#0ea5e9',
    provider: 'deepseek',
  },
  {
    id: 'deepseek-reasoner',
    name: 'DeepSeek R1',
    label: 'DeepSeek Reasoning',
    emoji: '🧩',
    tagline: 'DeepSeek · Reasoning',
    desc: 'Deep reasoning model — best for complex logic and analysis',
    color: '#7c3aed',
    provider: 'deepseek',
  },
  {
    id: 'google-shopping',
    name: 'Shopping search',
    label: 'Recipes · Grocery',
    emoji: '🛒',
    tagline: 'Grocery prices',
    desc: 'Google Shopping for Recipes Get prices — Coles & Woolworths. Set SERPER_SEARCH_API_KEY on Railway.',
    color: '#059669',
    provider: 'serper',
  },
];

/** Admin-confirmed execution boundary for vault_models entries. */
export const MODEL_EXECUTION_OPTIONS = [
  { value: 'local', label: 'Local' },
  { value: 'hosted', label: 'Hosted' },
];

/** Icons used in admin model <option> labels (native selects cannot render React icons). */
export function modelExecutionIcon(execution) {
  if (execution === 'local') return '💻';
  if (execution === 'hosted') return '☁️';
  return '❔';
}

export function modelExecutionLabel(execution) {
  if (execution === 'local') return 'Local';
  if (execution === 'hosted') return 'Hosted';
  return 'Unconfirmed';
}

/** Consistent option text for every admin model dropdown. */
export function formatModelSelectLabel(m, { includeId = true } = {}) {
  if (!m) return '';
  const execIcon = modelExecutionIcon(m.execution);
  const emoji = m.emoji || '🤖';
  const name = m.name || m.id || 'model';
  if (!includeId) return `${execIcon} ${emoji} ${name}`;
  return `${execIcon} ${emoji} ${name} — ${m.id}`;
}

export function isValidModelExecution(value) {
  return value === 'local' || value === 'hosted';
}

export function modelsNeedingExecutionConfirm(models) {
  if (!Array.isArray(models)) return [];
  return models.filter((m) => m && !isValidModelExecution(m.execution));
}
export const PROJECT_TYPES = [
  {
    id: 'development',
    emoji: '💻',
    label: 'Development',
    desc: 'Code, APIs, architecture',
    model: 'claude-sonnet-4-6',
    reason: 'Sonnet excels at code generation and technical reasoning',
  },
  {
    id: 'research',
    emoji: '🔬',
    label: 'Research',
    desc: 'Analysis, reports, deep dives',
    model: 'claude-opus-4-6',
    reason: 'Opus gives the most thorough and nuanced analysis',
  },
  {
    id: 'writing',
    emoji: '✍️',
    label: 'Writing',
    desc: 'Content, copy, storytelling',
    model: 'claude-sonnet-4-6',
    reason: 'Sonnet balances creativity with quality',
  },
  {
    id: 'visual',
    emoji: '🖼️',
    label: 'Visual & Images',
    desc: 'Image analysis, visual tasks',
    model: 'claude-sonnet-4-6',
    reason: 'Sonnet has built-in vision for image understanding',
  },
  {
    id: 'quick',
    emoji: '⚡',
    label: 'Quick Tasks',
    desc: 'Drafts, Q&A, simple tasks',
    model: 'claude-haiku-4-5-20251001',
    reason: 'Haiku is the fastest and most cost-effective',
  },
];

/**
 * Type-specific behaviour fields.
 * Each field renders as a row of pill buttons (type:'select') or a toggle (type:'toggle').
 * `key` must match what server/typePrompts.js expects.
 */
export const TYPE_FIELDS = {
  development: [
    {
      key: 'role',
      label: 'How should I help?',
      type: 'select',
      options: [
        { value: 'guide',  label: '🧑‍🏫 Guide me',      desc: 'Explain your thinking, help me learn' },
        { value: 'build',  label: '⚡ Just build it',   desc: 'Write complete code, be decisive' },
        { value: 'review', label: '🔍 Review',           desc: 'Critique and improve my code' },
        { value: 'pair',   label: '🤝 Pair program',     desc: 'Think through it together' },
      ],
      default: 'guide',
    },
    {
      key: 'decisions',
      label: 'Decision style',
      type: 'select',
      options: [
        { value: 'options',   label: 'Give me options',  desc: 'Present alternatives, I\'ll choose' },
        { value: 'decisive',  label: 'Be decisive',      desc: 'Pick the best approach and go' },
      ],
      default: 'options',
    },
    {
      key: 'verbosity',
      label: 'Explanations',
      type: 'select',
      options: [
        { value: 'silent',  label: 'Code only',         desc: 'Minimal prose, let code speak' },
        { value: 'explain', label: 'Explain choices',   desc: 'Walk me through decisions' },
      ],
      default: 'explain',
    },
    {
      key: 'tests',
      label: 'Include tests?',
      type: 'select',
      options: [
        { value: 'yes', label: 'Yes, always',  desc: 'Unit / integration tests alongside code' },
        { value: 'no',  label: 'Not by default', desc: 'Only when I ask' },
      ],
      default: 'no',
    },
    {
      key: 'codeStyle',
      label: 'Code style priority',
      type: 'select',
      options: [
        { value: 'clean',     label: 'Clean & readable', desc: 'Clarity over cleverness' },
        { value: 'idiomatic', label: 'Idiomatic',         desc: 'Use the language\'s native patterns' },
        { value: 'minimal',   label: 'Minimal',           desc: 'Least code that solves the problem' },
      ],
      default: 'clean',
    },
  ],

  research: [
    {
      key: 'depth',
      label: 'Analysis depth',
      type: 'select',
      options: [
        { value: 'summary',  label: '📋 Summary',    desc: 'Key findings only' },
        { value: 'standard', label: '⚖️ Standard',   desc: 'Balanced depth' },
        { value: 'deep',     label: '🔬 Deep dive',  desc: 'Comprehensive and thorough' },
      ],
      default: 'standard',
    },
    {
      key: 'format',
      label: 'Output format',
      type: 'select',
      options: [
        { value: 'bullets', label: '• Bullets',   desc: 'Structured, scannable' },
        { value: 'prose',   label: '¶ Prose',     desc: 'Flowing paragraphs' },
        { value: 'report',  label: '📄 Report',   desc: 'Headers + sections' },
      ],
      default: 'report',
    },
    {
      key: 'stance',
      label: 'Approach',
      type: 'select',
      options: [
        { value: 'neutral',   label: '⚖️ Balanced',      desc: 'Present all sides' },
        { value: 'challenge', label: '🧐 Challenge me',  desc: 'Push back on my assumptions' },
        { value: 'advocate',  label: '🛡️ Build my case', desc: 'Strengthen my position' },
      ],
      default: 'neutral',
    },
    {
      key: 'sources',
      label: 'Cite sources?',
      type: 'select',
      options: [
        { value: 'yes', label: 'Always mention', desc: 'Reference source types / names' },
        { value: 'no',  label: 'Skip',           desc: 'Conclusions without citations' },
      ],
      default: 'yes',
    },
  ],

  writing: [
    {
      key: 'mode',
      label: 'Working style',
      type: 'select',
      options: [
        { value: 'edit',   label: '✏️ Edit my drafts',    desc: 'Improve what I write' },
        { value: 'create', label: '📝 Write from brief',  desc: 'Create from my instructions' },
        { value: 'collab', label: '🤝 Collaborate',       desc: 'Write → feedback → refine' },
      ],
      default: 'create',
    },
    {
      key: 'length',
      label: 'Length preference',
      type: 'select',
      options: [
        { value: 'tight',    label: 'Tight & punchy', desc: 'Cut every unnecessary word' },
        { value: 'balanced', label: 'Balanced',        desc: 'Right length for the task' },
        { value: 'thorough', label: 'Thorough',        desc: 'Full coverage, no skipping' },
      ],
      default: 'balanced',
    },
    {
      key: 'formality',
      label: 'Register',
      type: 'select',
      options: [
        { value: 'casual',  label: 'Casual',   desc: 'Conversational, warm' },
        { value: 'neutral', label: 'Neutral',  desc: 'Clear and professional' },
        { value: 'formal',  label: 'Formal',   desc: 'Precise, no contractions' },
      ],
      default: 'neutral',
    },
    {
      key: 'perspective',
      label: 'Default voice',
      type: 'select',
      options: [
        { value: 'first',  label: 'First person (I/we)' },
        { value: 'second', label: 'Second person (you)' },
        { value: 'third',  label: 'Third person' },
      ],
      default: 'first',
    },
  ],

  visual: [
    {
      key: 'task',
      label: 'Primary task',
      type: 'select',
      options: [
        { value: 'describe', label: '👁️ Describe',      desc: 'Tell me what you see' },
        { value: 'analyze',  label: '🎨 Analyze',        desc: 'Critique composition & quality' },
        { value: 'extract',  label: '📊 Extract data',   desc: 'Pull out text, tables, numbers' },
        { value: 'prompts',  label: '✨ Image prompts',  desc: 'Write AI generation prompts' },
      ],
      default: 'describe',
    },
    {
      key: 'detail',
      label: 'Description detail',
      type: 'select',
      options: [
        { value: 'brief', label: 'High level', desc: 'Main subjects and mood' },
        { value: 'full',  label: 'Detailed',   desc: 'Cover every visible element' },
      ],
      default: 'brief',
    },
  ],

  quick: [
    {
      key: 'answerStyle',
      label: 'Answer style',
      type: 'select',
      options: [
        { value: 'direct',  label: 'Direct',         desc: 'One line if possible' },
        { value: 'context', label: 'Answer + context', desc: 'Short explanation added' },
        { value: 'full',    label: 'Full explanation', desc: 'Thorough even if simple' },
      ],
      default: 'context',
    },
    {
      key: 'format',
      label: 'Default format',
      type: 'select',
      options: [
        { value: 'bullets', label: 'Bullets' },
        { value: 'prose',   label: 'Prose' },
        { value: 'auto',    label: 'Auto' },
      ],
      default: 'auto',
    },
  ],
};

export function getModelById(id) {
  if (!id) return null;
  return MODELS.find(m => m.id === id) || null;
}

/** Label for UI; ids from Settings but not in MODELS[] show verbatim (never a bogus default name). */
export function getModelShortName(id) {
  const m = getModelById(id);
  if (m) return `${m.emoji} ${m.name}`;
  return id ? String(id) : '—';
}

export function isGeminiModel(id) {
  return typeof id === 'string' && id.startsWith('gemini-');
}

export function isDeepSeekModel(id) {
  return typeof id === 'string' && id.startsWith('deepseek-');
}
