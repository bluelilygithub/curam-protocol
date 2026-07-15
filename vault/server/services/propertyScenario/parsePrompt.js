'use strict';

const { EVENT_TYPES, DEPENDENCY_KINDS, AU_STATES, RATE_TYPES } = require('./constants');
const { formatSpansForPrompt } = require('./extractSpans');

const PARSE_SYSTEM = `You are a property/mortgage scenario analyst for Australian users.
Structure a Scenario JSON from free text PLUS a deterministic list of pre-extracted literal spans
(currency, percentages, durations, dates). Return ONLY valid JSON — no markdown fences, no prose.

Your primary numeric/date task is ASSIGNMENT, not discovery:
- Assign pre-extracted span values to the correct scenario fields/events when the text supports it.
- Do NOT invent currency amounts, rates, durations, or calendar dates that are absent from the span list.
- If a span exists but you are unsure which field it belongs to, prefer an unresolved_assumption over guessing.
- Flag (via unresolved_assumptions) anything important in the text that the span list did not capture
  as a fillable number/date — especially qualitative context.

Still NEVER invent missing qualitative facts needed for later financial calculations:
- Australian state/territory (drives stamp duty)
- was_ever_investment_property / PPOR vs investment (drives CGT)
- is_first_home_buyer
Fill these ONLY when the user's text explicitly supports them; otherwise omit and ask.

Do invent stable string ids (prop_*, ev_*, dep_*, ass_*) so the graph connects.
Prefer sequence 1, 2, 3… in chronological order.
Currency is always AUD. States must be AU codes: ${AU_STATES.join(', ')}.
Event types: ${EVENT_TYPES.join(', ')}.
Dependency kinds: ${DEPENDENCY_KINDS.join(', ')}.
Loan fixed_or_variable: ${RATE_TYPES.join(', ')}.

starting_properties = what they already own BEFORE any new events.
A sell/refinance/switch_lender/early_payout requires that property to exist in starting_properties or an earlier buy.
Explicit dependencies only — e.g. sale proceeds funding a deposit → kind "funds_deposit".
Timeline gaps/overlaps only when the text implies timing; if sell+buy timing is unclear, add an assumption (do not invent days).`;

/** Few-shots demonstrating omit + ask for state / PPOR when absent. */
const FEW_SHOTS = `
Example A — sparse sell/buy (CORRECT: omit state & PPOR, ask):
User: "I'm selling and buying. Selling our place and buying a new one."
(No currency/rate/date spans.)
JSON excerpt:
{
  "scenario": {
    "id": "sc_ex_a",
    "title": "Sell and buy",
    "currency": "AUD",
    "starting_properties": [{ "id": "prop_1", "label": "Current home" }],
    "events": [
      { "id": "ev_1", "type": "sell", "sequence": 1, "fields": { "property_id": "prop_1" } },
      { "id": "ev_2", "type": "buy", "sequence": 2, "fields": { "property_id": "prop_2" } }
    ],
    "dependencies": [{
      "id": "dep_1", "from_event_id": "ev_1", "to_event_id": "ev_2",
      "kind": "funds_deposit",
      "note": "Unconfirmed whether sale proceeds fund the deposit"
    }],
    "timeline": {
      "gaps": [{
        "after_event_id": "ev_1", "before_event_id": "ev_2", "assumed_days": null,
        "note": "Settlement timing unknown"
      }],
      "overlaps": []
    },
    "unresolved_assumptions": [
      {
        "id": "ass_state",
        "field_path": "starting_properties[0].state",
        "message": "Which Australian state or territory is your current property in?",
        "severity": "required"
      },
      {
        "id": "ass_ppor",
        "field_path": "events[0].fields.was_ever_investment_property",
        "message": "Has your current place ever been an investment/rental, or always your primary residence (PPOR)?",
        "severity": "required"
      },
      {
        "id": "ass_timing",
        "field_path": "timeline.gaps[0]",
        "message": "Will sale and purchase settle on the same day, or is there a gap (bridging)?",
        "severity": "required"
      }
    ]
  },
  "clarifying_questions": [
    "Which Australian state or territory is your current property in?",
    "Has your current place ever been an investment/rental, or always your primary residence (PPOR)?",
    "Will sale and purchase settle on the same day, or is there a gap (bridging)?"
  ]
}
WRONG for Example A: inventing "state": "NSW" or "was_ever_investment_property": false — the text never said that.
WRONG: inventing a sale price or rate that was not in the pre-extracted span list.

Example B — state & PPOR explicitly stated (CORRECT: fill them):
User: "I'm selling my Marrickville NSW home — never an investment property — and buying in Victoria."
JSON excerpt fields may include state "NSW" on the sell property and was_ever_investment_property false,
and state "VIC" on the buy — because those facts are in the text.

Example C — numbers via spans (CORRECT: assign spans; do not invent extras):
User text includes "$820,000" and "5.4%" which appear in the span list as [S1] currency and [S2] percent.
Assign those to the matching fields. Do not also invent e.g. a $900,000 valuation that was never spanned.
`;

/**
 * @param {string} text
 * @param {{ spanPack?: { spans: object[], as_of: string } }} [opts]
 */
function buildParsePrompt(text, opts = {}) {
  const spanBlock = opts.spanPack
    ? formatSpansForPrompt(opts.spanPack)
    : 'Pre-extracted spans: (not supplied). Do not invent numbers/dates.';

  return `Structure this situation into JSON with this exact top-level shape:

{
  "scenario": {
    "id": "sc_...",
    "title": "short label",
    "currency": "AUD",
    "starting_properties": [ { "id": "prop_...", "label": "optional", "state": "NSW only if stated", ... } ],
    "events": [ { "id": "ev_...", "type": "sell|buy|refinance|switch_lender|early_payout", "sequence": 1, "fields": {} } ],
    "dependencies": [ { "id": "dep_...", "from_event_id": "ev_...", "to_event_id": "ev_...", "kind": "funds_deposit|clears_loan|releases_security|other", "note": "optional" } ],
    "timeline": {
      "gaps": [{ "after_event_id": "ev_...", "before_event_id": "ev_...", "assumed_days": null, "note": "optional" }],
      "overlaps": []
    },
    "unresolved_assumptions": [
      { "id": "ass_...", "field_path": "...", "message": "Specific clarifying question?", "severity": "required|optional" }
    ]
  },
  "clarifying_questions": ["User-facing questions matching unresolved_assumptions"]
}

Type-specific fields:
- sell: property_id, property_value, purchase_price, purchase_date, was_ever_investment_property, state, settlement_date?
- buy: property_id (new id), property_value, state, is_first_home_buyer, deposit_source?, deposit_amount?, loan?, settlement_date?
- refinance / switch_lender: property_id, current_loan, target_loan
- early_payout: property_id, current_loan, payout_date, fixed_period_remaining_months?

Loan objects:
- term_remaining_months = months left on the overall loan (amortisation) — NOT the fixed period
- fixed_period_remaining_months = months left on the fixed-rate *period only* (AU typically 12–60). Required when fixed_or_variable is "fixed". Never copy term_remaining_months into this field.
- For variable loans, omit fixed_period_remaining_months

Omit numeric/date fields that are not justified by the pre-extracted spans — never invent prices, balances, rates, or dates.
Never invent Australian state/territory if not stated.
Never invent was_ever_investment_property / is_first_home_buyer if not stated — use an unresolved_assumption instead.
Prefer severity "required" for calculation blockers
(loan balance, rates, sale/purchase price, settlement timing for compound moves, PPOR vs investment,
whether sale proceeds fund the deposit) and "optional" for nice-to-haves (agent fees, exact street).

Do not put 0 as a placeholder for unknown numbers — omit the field entirely.

${FEW_SHOTS}

${spanBlock}

User text:
"""
${text.trim()}
"""`;
}

module.exports = { PARSE_SYSTEM, buildParsePrompt, FEW_SHOTS };
