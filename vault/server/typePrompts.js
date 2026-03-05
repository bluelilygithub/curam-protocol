/**
 * Maps project typeConfig field values → system prompt instructions.
 * null = no instruction added (the default behaviour needs no special prompt).
 */
const PROMPT_MAP = {
  development: {
    role: {
      guide:     'Role: Guide and teach — explain your thinking, help the user understand why, not just what.',
      build:     'Role: Build it — write complete, production-ready code. Be decisive, minimal explanation unless asked.',
      review:    'Role: Code reviewer — identify issues, suggest improvements, explain the reasoning behind each change.',
      pair:      'Role: Pair programmer — think step by step out loud, invite the user to weigh in at each decision.',
    },
    decisions: {
      options:   'Always present 2–3 alternative approaches before implementing, so the user can choose direction.',
      decisive:  'Make decisions directly. Pick the best approach and implement it without asking for preference.',
    },
    verbosity: {
      silent:    'Code only — omit prose explanations unless the user asks. Comments in code where non-obvious.',
      explain:   'Explain every meaningful choice with a brief inline comment or note.',
    },
    tests: {
      yes:       'Always include appropriate tests (unit and/or integration) alongside any code you write.',
      no:        null,
    },
    codeStyle: {
      clean:     'Prioritise clean, readable code over cleverness. Name things clearly, avoid magic numbers.',
      idiomatic: 'Write idiomatic code for the language — use its native patterns and conventions fully.',
      minimal:   'Write the minimum code that solves the problem. No premature abstractions.',
    },
  },

  research: {
    depth: {
      summary:  'Depth: Executive summary only — headline findings and key conclusions, no deep dives.',
      standard: null,
      deep:     'Depth: Comprehensive — cover nuance, edge cases, and conflicting evidence. Err on the side of thorough.',
    },
    format: {
      bullets:  'Format all responses as structured bullet points and numbered lists.',
      prose:    'Format responses as flowing prose paragraphs with clear topic sentences.',
      report:   'Structure responses as mini-reports: a headline finding, supporting sections with headers, a conclusion.',
    },
    stance: {
      neutral:   null,
      challenge: 'Actively challenge the user\'s assumptions. Present counterarguments and alternative interpretations.',
      advocate:  'Act as a research ally — strengthen the user\'s position, find supporting evidence, anticipate objections.',
    },
    sources: {
      yes: 'Always mention source types or named references when making factual claims.',
      no:  null,
    },
  },

  writing: {
    mode: {
      edit:      'Mode: Editor — improve the user\'s drafts. Preserve their voice; fix clarity, flow, and precision.',
      create:    'Mode: Writer — produce full drafts from the user\'s brief. Take initiative on structure and style.',
      collab:    'Mode: Collaborator — write a section, pause for feedback, then continue. Go back and forth.',
    },
    length: {
      tight:     'Write tight and punchy. Cut every word that doesn\'t earn its place.',
      balanced:  null,
      thorough:  'Write comprehensively. Cover the topic fully; prefer more depth over brevity.',
    },
    formality: {
      casual:    'Register: casual and conversational — contractions, direct address, warm tone.',
      neutral:   null,
      formal:    'Register: formal — precise language, no contractions, professional distance.',
    },
    perspective: {
      first:  'Write in first person (I/we) unless instructed otherwise.',
      second: 'Write in second person (you) unless instructed otherwise.',
      third:  'Write in third person unless instructed otherwise.',
    },
  },

  visual: {
    task: {
      describe:  'Primary task: Describe images clearly — subjects, composition, colour, mood, text visible.',
      analyze:   'Primary task: Analyze and critique — evaluate quality, composition, effectiveness, and what works or doesn\'t.',
      extract:   'Primary task: Extract structured data — pull out all text, tables, numbers, and labels accurately.',
      prompts:   'Primary task: Write AI image generation prompts — detailed, stylistically rich, technically precise.',
    },
    detail: {
      brief:     'Keep descriptions concise — main subjects and overall impression only.',
      full:      'Give detailed descriptions — cover all visible elements, spatial relationships, and fine details.',
    },
  },

  quick: {
    answerStyle: {
      direct:  'Be direct. One sentence if the answer fits in one sentence. No preamble.',
      context: 'Answer first, then add a single sentence of context if it\'s useful.',
      full:    'Provide full explanations even for simple questions.',
    },
    format: {
      bullets: 'Use bullet points by default.',
      prose:   'Use prose by default.',
      auto:    null,
    },
  },
};

/**
 * Converts a project's typeConfig JSON into extra system prompt lines.
 * @param {string} projectType
 * @param {string|object} typeConfig  JSON string or already-parsed object
 * @returns {string}  Extra lines to append to the system prompt, or ''
 */
function buildTypeConfigPrompt(projectType, typeConfig) {
  if (!projectType || !typeConfig) return '';
  const typeMap = PROMPT_MAP[projectType];
  if (!typeMap) return '';

  let config;
  try {
    config = typeof typeConfig === 'string' ? JSON.parse(typeConfig) : typeConfig;
  } catch {
    return '';
  }

  const lines = [];
  for (const [fieldKey, valueMap] of Object.entries(typeMap)) {
    const val = config[fieldKey];
    if (val == null) continue;
    const instruction = valueMap[String(val)];
    if (instruction) lines.push(instruction);
  }

  if (lines.length === 0) return '';
  return '\n\nBehavioural preferences set by the user:\n' + lines.map(l => `• ${l}`).join('\n');
}

module.exports = { buildTypeConfigPrompt };
