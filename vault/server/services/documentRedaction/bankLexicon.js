'use strict';

/**
 * AU / common lender names for deterministic bank-name candidates.
 * Longer aliases match first. Short codes (ANZ, NAB, …) use word boundaries.
 */

const BANK_FAMILIES = [
  {
    id: 'cba',
    canonical: 'Commonwealth Bank',
    aliases: ['Commonwealth Bank of Australia', 'Commonwealth Bank', 'CommBank', 'CBA'],
    replacement: 'Pacific Retail Bank',
  },
  {
    id: 'westpac',
    canonical: 'Westpac',
    aliases: ['Westpac Banking Corporation', 'Westpac', 'St.George Bank', 'St.George', 'St George', 'Bank of Melbourne', 'BankSA'],
    replacement: 'Southern Mutual Bank',
  },
  {
    id: 'anz',
    canonical: 'ANZ',
    aliases: ['Australia and New Zealand Banking Group', 'ANZ Bank', 'ANZ Plus', 'ANZ'],
    replacement: 'Horizon Bank',
  },
  {
    id: 'nab',
    canonical: 'NAB',
    aliases: ['National Australia Bank', 'NAB'],
    replacement: 'Northern Trust Bank',
  },
  {
    id: 'macquarie',
    canonical: 'Macquarie Bank',
    aliases: ['Macquarie Bank', 'Macquarie'],
    replacement: 'Harbour Capital',
  },
  {
    id: 'boq',
    canonical: 'Bank of Queensland',
    aliases: ['Bank of Queensland', 'BOQ'],
    replacement: 'Coastal State Bank',
  },
  {
    id: 'ing',
    canonical: 'ING',
    aliases: ['ING Bank', 'ING Direct', 'ING'],
    replacement: 'Atlas Online Bank',
  },
  {
    id: 'ubank',
    canonical: 'UBank',
    aliases: ['UBank'],
    replacement: 'Clearline Bank',
  },
  {
    id: 'up',
    canonical: 'Up Bank',
    aliases: ['Up Bank'],
    replacement: 'Pulse Bank',
  },
  {
    id: 'bendigo',
    canonical: 'Bendigo Bank',
    aliases: ['Bendigo and Adelaide Bank', 'Bendigo Bank', 'Bendigo'],
    replacement: 'Riverland Bank',
  },
  {
    id: 'suncorp',
    canonical: 'Suncorp Bank',
    aliases: ['Suncorp Bank', 'Suncorp'],
    replacement: 'Sunridge Bank',
  },
  {
    id: 'hsbc',
    canonical: 'HSBC',
    aliases: ['HSBC Bank', 'HSBC'],
    replacement: 'Global Commerce Bank',
  },
  {
    id: 'amp',
    canonical: 'AMP Bank',
    aliases: ['AMP Bank', 'AMP'],
    replacement: 'Summit Mutual Bank',
  },
  {
    id: 'me',
    canonical: 'ME Bank',
    aliases: ['Members Equity Bank', 'ME Bank'],
    replacement: 'Members First Bank',
  },
  {
    id: 'great_southern',
    canonical: 'Great Southern Bank',
    aliases: ['Great Southern Bank', 'Credit Union Australia', 'CUA'],
    replacement: 'Southern Credit Bank',
  },
];

/** Precompute alias → family, longest first for matching */
const ALIAS_ROWS = [];
for (const family of BANK_FAMILIES) {
  const aliases = [...family.aliases].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    ALIAS_ROWS.push({
      alias,
      aliasLower: alias.toLowerCase(),
      family,
    });
  }
}
ALIAS_ROWS.sort((a, b) => b.alias.length - a.alias.length);

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} surface
 * @returns {{ id: string, canonical: string, replacement: string, aliases: string[] } | null}
 */
function findBankFamily(surface) {
  const t = String(surface || '').trim().toLowerCase();
  if (!t) return null;
  for (const row of ALIAS_ROWS) {
    if (t === row.aliasLower) {
      return {
        id: row.family.id,
        canonical: row.family.canonical,
        replacement: row.family.replacement,
        aliases: row.family.aliases,
      };
    }
  }
  return null;
}

/** Stable entity key so Macquarie / Macquarie Bank collapse. */
function bankEntityKey(surface) {
  const fam = findBankFamily(surface);
  return fam ? `bank:${fam.id}` : null;
}

/**
 * Scan document IR text for known bank names.
 * @returns {object[]} raw pattern candidates (pre-merge)
 */
function extractBankNameCandidates(ir, jobId, { newId, locateInParagraph, normalizeCategoryLabel }) {
  const out = [];
  const paragraphs = ir.paragraphs || [];

  for (const family of BANK_FAMILIES) {
    const aliases = [...family.aliases].sort((a, b) => b.length - a.length);
    const foundForms = new Set();
    const locations = [];

    for (const alias of aliases) {
      const re = new RegExp(`\\b${escapeRegExp(alias)}\\b`, 'gi');
      for (const paragraph of paragraphs) {
        const text = paragraph.text || '';
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text)) !== null) {
          const quote = m[0];
          foundForms.add(quote);
          locations.push(locateInParagraph(paragraph, m.index, m.index + quote.length, quote));
        }
      }
    }

    if (!foundForms.size) continue;

    const surfaceForms = [...foundForms].sort((a, b) => b.length - a.length);
    out.push({
      id: newId(),
      jobId,
      source: 'deterministic',
      sourceLabel: 'pattern-match',
      categoryLabel: normalizeCategoryLabel('bank_name'),
      entityKey: `bank:${family.id}`,
      surfaceForms,
      locations,
      confidence: 0.93,
      score: 0.93,
      scoreBreakdown: { pattern: 0.93, bankLexicon: 1 },
      suggestedReplacement: family.replacement,
      decision: 'pending',
      decidedBy: null,
      rationale: `Matched known lender name (${family.canonical})`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return out;
}

/**
 * Lightweight brief → intent bullets (no LLM).
 * @param {string} brief
 */
function summarizeBriefIntents(brief) {
  const text = String(brief || '').trim();
  const intents = [];
  const rules = [
    [/bank|lender|institution|nab|anz|westpac|commbank|macquarie/i, 'Bank / lender names'],
    [/amount|figure|dollar|\$|financial|income|capacity|surplus|repayment|loan|deposit|lvr|dti/i, 'Financial figures & ratios'],
    [/rate|%|interest|apra/i, 'Interest rates / percentages'],
    [/name|person|client|borrower|applicant|customer/i, 'Person names'],
    [/email|phone|address|dob|ssn|tfn|abn/i, 'Contact / ID details'],
    [/account|bsb|card limit|bnpl/i, 'Account / card details'],
    [/employer|employment|payg|salary/i, 'Employment details'],
    [/address|property|suburb|postcode/i, 'Property / location'],
  ];
  for (const [re, label] of rules) {
    if (re.test(text) && !intents.includes(label)) intents.push(label);
  }
  const summary = intents.length
    ? `Redact: ${intents.join(' · ')}`
    : (text.slice(0, 140) + (text.length > 140 ? '…' : ''));
  return { summary, intents, rawText: text };
}

module.exports = {
  BANK_FAMILIES,
  findBankFamily,
  bankEntityKey,
  extractBankNameCandidates,
  summarizeBriefIntents,
};
