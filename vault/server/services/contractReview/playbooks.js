'use strict';

// Default risk-scoring positions, keyed by contractType, with optional
// per-role overrides — realizes the spec's `${contractType}:${role}` key
// space (docs/contract-review-spec.md) without hand-writing every
// contractType x role combination. Resolution order (getPlaybook below):
// exact type + role -> that type's default -> 'other' type's default.
//
// Content here is a starting default set, not legal advice and not
// exhaustive — Stage 1's job is the mechanism (structure, versioning,
// hashing, enum sync), not complete positions for every clause/contract
// type. No playbook editing UI in v1 (spec).

const { CONTRACT_TYPE_KEYS, PARTY_ROLE_KEYS } = require('../../db');
const crypto = require('crypto');

const PLAYBOOK_VERSION = 'v1';

// Every type/role combination below is a starting default, not legal
// advice — the point is coverage of the clause types a real services
// agreement actually contains (a "simple" contract still has most of
// these), so risk scoring has real guidance to assess against instead of
// falling back to "no playbook position, answer unclear" for anything that
// isn't indemnity/liability/IP/payment/auto-renewal/non-compete.
const GENERIC_DEFAULT = {
  indemnity: 'Mutual indemnity preferred; one-sided indemnity in favour of the other party is risky.',
  limitation_of_liability: 'A liability cap of at least 12 months\' fees is standard; uncapped liability is risky.',
  ip_assignment: 'IP assignment should be scoped to deliverables only; broad assignment beyond deliverables is risky.',
  payment_terms: 'Net-30 payment terms, with any price increases capped or tied to a defined index (e.g. CPI) and requiring advance notice, are standard; materially shorter or unclear terms, or unrestricted/discretionary price increases with no notice, are risky.',
  auto_renewal: 'Auto-renewal with a reasonable opt-out notice window is standard; auto-renewal with no notice window, or a very long one, is risky.',
  non_compete: 'A non-compete narrowly scoped in time/geography/field is standard; broad or indefinite scope is risky.',
  non_solicitation: 'A non-solicitation clause narrowly scoped in time (roughly 12-24 months) and to people/clients genuinely worked with during the engagement is standard; a broad, indefinite, or blanket non-solicitation covering any client or employee regardless of actual contact is risky.',
  termination: 'A defined notice period (e.g. 30-60 days) available to both parties, plus a cure period before termination for breach, is standard; a termination right that\'s one-sided, immediate with no cure period, or entirely undefined, is risky.',
  confidentiality: 'Mutual confidentiality obligations with a reasonable post-termination survival period (roughly 1-5 years, or indefinite specifically for trade secrets) are standard; one-sided obligations, or no survival period at all, are risky.',
  governing_law: 'A clearly stated governing law and jurisdiction is standard; no governing law stated at all, or a jurisdiction with no real connection to either party, is risky.',
};

// Vendor/customer perspective differences for the clause types a services
// agreement (SOW/consulting/MSA) actually contains — the SAME clause can be
// risky for one side and perfectly fine for the other (riskScoringPrompt
// already instructs the model to apply only the outcome matching the
// confirmed role; these positions are what it has to work with).
const SERVICES_BY_ROLE = {
  vendor: {
    indemnity: 'As the vendor, avoid open-ended indemnity for the customer\'s use of deliverables beyond your own negligence or IP infringement.',
    limitation_of_liability: 'As the vendor, a liability cap at or above 12 months\' fees, with carve-outs limited to your own IP infringement, confidentiality breach, or gross negligence, is standard; uncapped liability, or carve-outs broad enough to swallow the cap entirely, is risky.',
    ip_assignment: 'As the vendor, IP assignment scoped to the specific paid deliverables (with your own pre-existing tools/methodologies/background IP excluded) is standard; assignment of your background IP, or of anything beyond the paid deliverables, is risky.',
    payment_terms: 'As the vendor, a right to suspend services or charge interest on materially overdue invoices is standard; payment terms giving you no recourse at all for late payment are risky.',
    auto_renewal: 'As the vendor, auto-renewal is generally favourable to you (revenue continuity) — flag it as risky only if the customer alone holds an unusually easy or no-notice exit right that undermines that continuity.',
    termination: 'As the vendor, a termination-for-convenience right held ONLY by the customer, with no matching right or minimum notice/fee for you, is risky; a mutual right, or one with a reasonable minimum term or notice period, is standard.',
    confidentiality: 'As the vendor, obligations that also protect your own methodologies, pricing, and business information (not just the customer\'s data) are standard; a one-sided clause protecting only the customer\'s information is risky for you.',
    non_solicitation: 'As the vendor, a mutual non-solicitation of each other\'s staff is standard; a one-sided clause restricting only your ability to hire the customer\'s people, with no reverse restriction, is risky for you.',
    governing_law: 'As the vendor, your own home jurisdiction is standard; a jurisdiction that requires you to litigate on the customer\'s home turf with no reciprocal reason is risky.',
  },
  customer: {
    indemnity: 'As the customer, an indemnity from the vendor covering IP infringement and data breach arising from the vendor\'s services is standard; no indemnity at all for the vendor\'s own IP infringement is risky.',
    limitation_of_liability: 'As the customer, a liability cap with carve-outs for the vendor\'s IP infringement, confidentiality breach, and gross negligence or wilful misconduct is standard; a cap with no carve-outs at all, capping even the vendor\'s own misconduct, is risky.',
    ip_assignment: 'As the customer, full assignment (or at minimum a broad, perpetual licence) of the deliverables you\'re paying for is standard; the vendor retaining ownership of what you\'ve paid for, or granting only a narrow or revocable licence, is risky.',
    payment_terms: 'As the customer, price increases capped or tied to a defined index with advance notice are standard; unrestricted, discretionary, or no-notice price increases are risky.',
    auto_renewal: 'As the customer, a reasonable opt-out notice window (e.g. 30-60 days) before auto-renewal is standard; auto-renewal with no notice window, a very long one, or one that\'s easy to miss, is risky.',
    termination: 'As the customer, a termination-for-convenience right (even if it carries a fee) is standard; being locked in with no exit right short of the vendor\'s own material breach is risky.',
    confidentiality: 'As the customer, the vendor\'s confidentiality obligations covering your data and business information, surviving termination, are standard; a short or absent survival period is risky given the vendor may have handled sensitive information throughout the engagement.',
    non_solicitation: 'As the customer, a mutual non-solicitation of each other\'s staff is standard; a one-sided clause preventing you from hiring the vendor\'s people, with no reverse restriction, is risky for you.',
    governing_law: 'As the customer, your own home jurisdiction is standard; being required to litigate in the vendor\'s jurisdiction with no reciprocal reason is risky.',
  },
};

const PLAYBOOKS = {
  nda: {
    default: {
      confidentiality: 'Mutual confidentiality obligations preferred; one-sided obligations favouring the other party are risky.',
      termination: 'Assess TOTAL confidentiality exposure — the stated term PLUS any post-termination survival period added on top, not the term alone. A total of 1-3 years is standard; an indefinite exposure, or a total exceeding roughly 3 years once the survival period is added, is risky.',
    },
  },
  msa: {
    default: { ...GENERIC_DEFAULT },
    byRole: {
      vendor: { ...SERVICES_BY_ROLE.vendor, indemnity: 'As the vendor, avoid open-ended indemnity for the customer\'s use of deliverables beyond your own negligence.' },
      customer: { ...SERVICES_BY_ROLE.customer, indemnity: 'As the customer, an indemnity from the vendor covering IP infringement and data breach is standard.' },
    },
  },
  sow: {
    default: { ...GENERIC_DEFAULT },
    byRole: SERVICES_BY_ROLE,
  },
  lease: {
    default: {
      payment_terms: 'Rent increases tied to a defined index (e.g. CPI) are standard; uncapped or discretionary increases are risky.',
      termination: 'A defined notice period for termination is standard; no notice period, or one favouring only the landlord, is risky.',
    },
    byRole: {
      landlord: {},
      tenant: { termination: 'As the tenant, confirm your own early-exit rights are not more restrictive than the landlord\'s.' },
    },
  },
  employment: {
    default: {
      non_compete: 'A non-compete narrowly scoped (role-relevant, <=12 months, reasonable geography) is standard; broad or indefinite scope is risky.',
      termination: 'Notice periods and severance consistent with local employment law are standard; below-minimum terms are risky.',
    },
  },
  consulting: {
    default: { ...GENERIC_DEFAULT },
    byRole: SERVICES_BY_ROLE,
  },
  license: {
    default: {
      ip_assignment: 'A license grant scoped to specific use cases is standard; an unlimited, irrevocable, sublicensable grant is risky.',
    },
  },
  purchase: {
    default: { ...GENERIC_DEFAULT },
  },
  partnership: {
    default: {
      indemnity: 'Indemnity proportional to each partner\'s share/fault is standard; joint-and-several liability for one partner\'s sole conduct is risky.',
    },
  },
  loan: {
    default: {
      payment_terms: 'A clear repayment schedule and interest rate is standard; variable/undefined rates or acceleration clauses with no cure period are risky.',
      indemnity: 'A guarantee capped to a defined amount, or conditioned on a cure period/formal default process before demand, is standard for the guarantor; an unconditional, uncapped personal guarantee triggered on any default with no conditions is risky for the guarantor. The same guarantee is standard (favourable, not risky) for the lender receiving it.',
    },
  },
  other: {
    default: { ...GENERIC_DEFAULT },
  },
};

// Sanity check at module load — every PLAYBOOKS key must be a real contractType,
// and every byRole key must be a real party role, so a typo here can't silently
// create an unreachable playbook.
for (const type of Object.keys(PLAYBOOKS)) {
  if (!CONTRACT_TYPE_KEYS.includes(type)) {
    throw new Error(`[playbooks] "${type}" is not in CONTRACT_TYPE_KEYS (server/db.js)`);
  }
  const byRole = PLAYBOOKS[type].byRole || {};
  for (const role of Object.keys(byRole)) {
    if (!PARTY_ROLE_KEYS.includes(role)) {
      throw new Error(`[playbooks] "${type}.byRole.${role}" is not in PARTY_ROLE_KEYS (server/db.js)`);
    }
  }
}

function getPlaybookKeys() {
  return { contractTypes: Object.keys(PLAYBOOKS), version: PLAYBOOK_VERSION };
}

/** Resolves positions for (contractType, role): exact type+role override
 * merged onto that type's default, falling back to 'other' if the type
 * itself isn't in PLAYBOOKS. */
function getPlaybook(contractType, role) {
  const entry = PLAYBOOKS[contractType] || PLAYBOOKS.other;
  const positions = { ...entry.default, ...(entry.byRole?.[role] || {}) };
  return { key: contractType in PLAYBOOKS ? contractType : 'other', version: PLAYBOOK_VERSION, positions };
}

const PLAYBOOK_HASH = crypto
  .createHash('sha256')
  .update(JSON.stringify(PLAYBOOKS) + PLAYBOOK_VERSION)
  .digest('hex');

module.exports = { PLAYBOOKS, PLAYBOOK_VERSION, PLAYBOOK_HASH, getPlaybook, getPlaybookKeys };
