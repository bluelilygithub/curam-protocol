'use strict';

// Contract Review — Pipeline stage 11 (Coverage report) config: which of the
// 14 v1 contract_clause_types a given contractType is expected to contain at
// all. Separate from playbooks.js (which is about risk POSITIONS once a
// clause of a given type is found) — this is about whether that type of
// clause exists in the document in the first place. Kept as a plain object,
// not versioned/hashed like playbooks.js, since it isn't recorded on a row
// anywhere (contract_reviews.taxonomyVersion already covers the underlying
// clause-type key set) — this file just needs to stay a valid subset of that
// set, checked at module load below.

const EXPECTED_CLAUSE_TYPES = {
  nda: ['confidentiality', 'termination', 'governing_law'],
  msa: ['indemnity', 'limitation_of_liability', 'payment_terms', 'termination', 'governing_law'],
  sow: ['payment_terms'],
  lease: ['payment_terms', 'termination'],
  employment: ['non_compete', 'termination'],
  consulting: ['payment_terms', 'limitation_of_liability'],
  license: ['ip_assignment', 'termination'],
  purchase: ['payment_terms', 'warranties'],
  partnership: ['indemnity'],
  loan: ['payment_terms', 'governing_law'],
  other: [],
};

const ALL_TAXONOMY_KEYS = [
  'indemnity', 'limitation_of_liability', 'termination', 'auto_renewal',
  'payment_terms', 'ip_assignment', 'non_compete', 'confidentiality',
  'governing_law', 'dispute_resolution', 'warranties', 'assignment',
  'force_majeure', 'data_protection',
];

for (const [type, keys] of Object.entries(EXPECTED_CLAUSE_TYPES)) {
  for (const key of keys) {
    if (!ALL_TAXONOMY_KEYS.includes(key)) {
      throw new Error(`[coverageExpectations] "${type}" references unknown clause type "${key}"`);
    }
  }
}

function getExpectedClauseTypes(contractType) {
  return EXPECTED_CLAUSE_TYPES[contractType] || EXPECTED_CLAUSE_TYPES.other;
}

module.exports = { EXPECTED_CLAUSE_TYPES, getExpectedClauseTypes };
