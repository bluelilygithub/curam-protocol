'use strict';

// Shares-flavoured view of the shared Compliance Advisory prompt. See docs/shares-compliance.md.

const p = require('../complianceAdvisory/instances').parts('shares').prompt;

module.exports = {
  SYSTEM_PROMPT: p.SYSTEM_PROMPT,
  defangExcerpt: p.defangExcerpt,
  buildPrompt: p.buildPrompt,
  parseModelJson: p.parseModelJson,
};
