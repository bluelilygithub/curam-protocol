'use strict';

// Finance-flavoured view of the shared Compliance Advisory prompt. See docs/finance-compliance.md.

const p = require('../complianceAdvisory/instances').parts('finance').prompt;

module.exports = {
  SYSTEM_PROMPT: p.SYSTEM_PROMPT,
  defangExcerpt: p.defangExcerpt,
  buildPrompt: p.buildPrompt,
  parseModelJson: p.parseModelJson,
};
