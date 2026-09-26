'use strict';

// Contract Review — all Stage 3/4 pipeline prompts, treated as ONE versioned
// set (docs/contract-review-spec.md decision, made explicit in the build
// instruction for this stage): a single PROMPT_VERSION string here, bumped
// whenever ANY prompt in this file changes, stored on contract_reviews.
// promptVersion. Per-stage model IDs are still recorded separately per call
// (contract_review_raw_outputs.modelId) — this version is about the PROMPT
// TEXT, not which model ran it.
//
// Every prompt that asks the model to identify text FROM the document
// (definitions, obligations, summary points) asks for an exact quote, never
// for the model to restate/paraphrase it and never for character offsets —
// grounding.js locates the quote and derives spans itself (spec guardrail:
// "every flag, summary point, definition, and obligation carries a source
// span, and the pipeline programmatically verifies the quoted text exists
// in the source").

const PROMPT_VERSION = 'v1';

const JSON_ONLY = 'Respond with ONLY valid JSON — no markdown fences, no commentary before or after.';

function typeDetectionPrompt(extractedText, contractTypeKeys) {
  return `You are analyzing a contract to identify its type. Read the following contract text and classify it.

Allowed contract types: ${contractTypeKeys.join(', ')}.

If the contract doesn't clearly match one of the specific types, use "other".

Respond as JSON: {"contractType": "<one of the allowed types, or \\"other\\">", "contractTypeRaw": "<your own unconstrained label for what this contract actually is, e.g. \\"Equipment Lease\\">"}
${JSON_ONLY}

Contract text:
${extractedText}`;
}

function partiesKeyTermsPrompt(extractedText, partyRoleKeys) {
  return `Read the following contract text and extract:
1. Every named party to the agreement, with their role.
2. Key commercial terms.

Allowed party roles: ${partyRoleKeys.join(', ')}. If a party's role (e.g. "Discloser", "Recipient") doesn't map cleanly to one of these, use "other" and put the original label in roleRaw.

Respond as JSON:
{
  "parties": [{"name": "<full legal name as written>", "role": "<one of the allowed roles>", "roleRaw": "<the document's own label for this party's role, or null>"}],
  "keyTerms": {
    "effectiveDate": "<YYYY-MM-DD or null>",
    "termLengthMonths": <integer months or null>,
    "governingLawCountry": "<ISO 3166-1 alpha-2 or null>",
    "governingLawRegion": "<state/province/territory name or null>",
    "contractValue": <number or null>,
    "contractValueCurrency": "<ISO 4217 code or null>"
  }
}
${JSON_ONLY} Use null for anything not stated in the text — never guess or invent a value.

Contract text:
${extractedText}`;
}

function definitionsPrompt(extractedText) {
  return `Read the following contract text and extract every defined term — a capitalized term the contract explicitly defines, whether via a formal "X means Y" sentence or a short-form parenthetical quotation like ("Term").

For each one, return the term itself, a plain-English restatement of what it means, and quotedText: the EXACT text from the document (verbatim, including punctuation) that establishes the definition — this will be located programmatically in the source, so it must be copied exactly, never paraphrased or shortened in a way that changes the wording.

Respond as JSON: {"definitions": [{"term": "<term>", "definition": "<plain-English meaning>", "quotedText": "<exact verbatim source text>"}]}
${JSON_ONLY} If there are no defined terms, return {"definitions": []}.

Contract text:
${extractedText}`;
}

function clauseClassificationPrompt(clauses, taxonomyKeys) {
  const list = clauses.map((c) => `Clause ${c.id} (${c.numberLabel || 'unlabeled'}): ${c.text.slice(0, 1200)}`).join('\n\n---\n\n');
  return `Classify each of the following contract clauses into one of these types, if it clearly matches one: ${taxonomyKeys.join(', ')}.

A clause may not match any type at all — that's expected and fine; use null in that case rather than forcing a weak match.

Respond as JSON: {"classifications": [{"clauseId": <id>, "clauseType": "<one of the types above, or null>"}]}
${JSON_ONLY}

Clauses:
${list}`;
}

function riskScoringPrompt(clause, playbookPositions, relevantDefinitions, fullText) {
  const positionsText = Object.entries(playbookPositions || {})
    .map(([type, position]) => `- ${type}: ${position}`).join('\n') || '(no specific playbook positions for this contract type/role)';
  const defsText = (relevantDefinitions || []).map((d) => `- ${d.term}: ${d.definition}`).join('\n') || '(none)';
  return `You are reviewing one clause of a contract on behalf of a specific party. Assess whether THIS CLAUSE is risky FOR THAT PARTY, using the playbook positions below as your primary guide — do not flag something as risky that the playbook explicitly treats as standard, and do not ignore something the playbook explicitly flags. If the playbook has no relevant position and the clause is genuinely ambiguous, answer "unclear" rather than forcing a verdict.

Some playbook positions depend on something being present or absent ELSEWHERE in the document — e.g. "a clear repayment schedule and interest rate is standard; undefined rates are risky" requires checking whether an interest rate is stated anywhere in the contract, not just in this one clause. The full contract text is included below for exactly that kind of check. Your verdict is still about the one clause quoted at the end, not the document as a whole.

Playbook positions for this contract type and party role:
${positionsText}

Relevant defined terms:
${defsText}

Full contract text (for checking whether something is defined/stated elsewhere — assess only the clause below):
${fullText}

Clause being assessed:
${clause.text}

Respond as JSON:
{
  "riskLevel": "standard" | "risky" | "unclear",
  "whyItMatters": "<one or two sentences explaining the assessment to a non-lawyer>",
  "playbookPositionKey": "<the playbook position key this was assessed against, or null>",
  "suggestedRedline": "<advisory copy-paste replacement/addition text if risky, else null — never legal advice, just a starting point>"
}
${JSON_ONLY}`;
}

function obligationsPrompt(extractedText, partyNames) {
  return `Read the following contract text and extract every concrete obligation — a specific duty one party owes (a payment, a notice, a delivery, a report, a renewal action), with a real deadline or recurrence.

Do not invent a date. If timing is a fixed calendar date, use absoluteDate. If timing is relative to an event (e.g. "90 days before renewal", "30 days after invoice"), use anchorEvent (one of: effective_date, renewal_date, invoice_date, termination, custom) + offsetDays (signed integer; negative = before the anchor). If timing recurs (e.g. monthly), use an RFC 5545 RRULE string. Use exactly ONE of absoluteDate / (anchorEvent+offsetDays) / rrule per obligation — never invent an absolute date just because the others don't fit; prefer anchorEvent+offsetDays over guessing a date.

Known parties: ${partyNames.join(', ') || '(none identified yet)'}. Set obligorName to the exact party name from that list who owes the obligation, or null if it can't be confidently attributed — never guess.

For each obligation, quotedText should be the EXACT source sentence (or the shortest exact substring that supports it) that this obligation is based on — copied verbatim, never paraphrased. If the obligation is genuinely synthesized from multiple scattered sentences with no single quotable source, use null for quotedText.

Respond as JSON: {"obligations": [{
  "description": "<plain-English description>",
  "type": "payment" | "notice" | "renewal" | "delivery" | "reporting" | "other",
  "obligorName": "<exact party name, or null>",
  "absoluteDate": "<YYYY-MM-DD or null>",
  "anchorEvent": "<effective_date|renewal_date|invoice_date|termination|custom, or null>",
  "anchorCustomLabel": "<label if anchorEvent is custom, else null>",
  "offsetDays": <signed integer or null>,
  "rrule": "<RFC 5545 RRULE string or null>",
  "amount": <number or null>,
  "currency": "<ISO 4217 code or null>",
  "quotedText": "<exact verbatim source text, or null>"
}]}
${JSON_ONLY} If there are no concrete obligations, return {"obligations": []}.

Contract text:
${extractedText}`;
}

function summaryPrompt(extractedText, clauses) {
  const clauseList = clauses.map((c) => `Clause ${c.id} (${c.numberLabel || 'unlabeled'})`).join(', ');
  return `Write a short plain-English summary of this contract as a list of key points a non-lawyer should know. Each point must be grounded: quotedText is the EXACT source text (verbatim) that supports the point, and clauseIds lists which of the following clause IDs the point relates to: ${clauseList}.

Respond as JSON: {"summaryPoints": [{"text": "<plain-English point>", "clauseIds": [<clause id>, ...], "quotedText": "<exact verbatim source text>"}]}
${JSON_ONLY} Aim for 4-8 points covering the most important terms, risks, and obligations.

Contract text:
${extractedText}`;
}

module.exports = {
  PROMPT_VERSION,
  typeDetectionPrompt,
  partiesKeyTermsPrompt,
  definitionsPrompt,
  clauseClassificationPrompt,
  riskScoringPrompt,
  obligationsPrompt,
  summaryPrompt,
};
