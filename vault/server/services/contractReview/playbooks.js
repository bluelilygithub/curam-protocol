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

const GENERIC_DEFAULT = {
  indemnity: 'Mutual indemnity preferred; one-sided indemnity in favour of the other party is risky.',
  limitation_of_liability: 'A liability cap of at least 12 months\' fees is standard; uncapped liability is risky.',
  ip_assignment: 'IP assignment should be scoped to deliverables only; broad assignment beyond deliverables is risky.',
  payment_terms: 'Net-30 payment terms are standard; materially shorter or unclear terms are risky.',
  auto_renewal: 'Auto-renewal with a reasonable opt-out notice window is standard; auto-renewal with no notice window, or a very long one, is risky.',
  non_compete: 'A non-compete narrowly scoped in time/geography/field is standard; broad or indefinite scope is risky.',
};

const PLAYBOOKS = {
  nda: {
    default: {
      confidentiality: 'Mutual confidentiality obligations preferred; one-sided obligations favouring the other party are risky.',
      termination: 'A defined term (1-3 years) is standard; an indefinite or unusually long confidentiality term is risky.',
    },
  },
  msa: {
    default: { ...GENERIC_DEFAULT },
    byRole: {
      vendor: { indemnity: 'As the vendor, avoid open-ended indemnity for the customer\'s use of deliverables beyond your own negligence.' },
      customer: { indemnity: 'As the customer, an indemnity from the vendor covering IP infringement and data breach is standard.' },
    },
  },
  sow: {
    default: { ...GENERIC_DEFAULT },
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
