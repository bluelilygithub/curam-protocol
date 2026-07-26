'use strict';

/**
 * Deterministic regex / pattern backstop for well-known PII / figure shapes.
 * Source tag: deterministic (architecture) ≈ pattern-match.
 *
 * Always runs alongside the LLM in proposeCandidates — never LLM-gated.
 */

const { locateInParagraph } = require('./docxParse');
const { normalizeCategoryLabel } = require('./categories');
const { extractBankNameCandidates } = require('./bankLexicon');
const crypto = require('crypto');

function currencyReplacement(i, quote) {
  const digits = String(quote).replace(/[^\d.]/g, '');
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) {
    return `$${(1200 + i * 37).toLocaleString('en-US')}`;
  }
  const factor = 0.91 + ((i % 19) / 100);
  const v = Math.max(1, Math.round(n * factor));
  const hasCents = /\.\d{1,2}$/.test(digits);
  if (hasCents) {
    const cents = Math.round(n * factor * 100) / 100;
    return `$${cents.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `$${v.toLocaleString('en-US')}`;
}

function percentReplacement(i, quote) {
  const n = Number(String(quote).replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n)) return `${((i % 9) + 1)}.${i % 10}%`;
  const v = Math.max(0.01, Math.round(n * (0.88 + (i % 12) / 100) * 100) / 100);
  return `${v}%`;
}

const PATTERNS = [
  {
    categoryLabel: 'email',
    confidence: 0.95,
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: (i) => `person${i + 1}@example.com`,
    rationale: 'Matched email address pattern',
  },
  {
    categoryLabel: 'phone',
    confidence: 0.85,
    regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g,
    replacement: (i) => `555-01${String(100 + i).slice(-2)}`,
    rationale: 'Matched phone-number-like pattern',
    validate: (s) => {
      const digits = String(s).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) return false;
      if (/^\d{3}[-\s]?\d{3}[-\s]?\d{3}$/.test(String(s).trim()) && digits.length === 9) return false;
      return true;
    },
  },
  {
    categoryLabel: 'national_id',
    confidence: 0.9,
    regex: /\b(?:\d{3}[-\s]?\d{2}[-\s]?\d{4}|\d{3}[-\s]?\d{3}[-\s]?\d{3})\b/g,
    replacement: (i) => `***-**-${String(1000 + i).slice(-4)}`,
    rationale: 'Matched national-ID / SSN-like numeric pattern',
    validate: (s) => {
      const digits = String(s).replace(/\D/g, '');
      return digits.length === 8 || digits.length === 9;
    },
  },
  {
    categoryLabel: 'date_of_birth',
    confidence: 0.7,
    regex: /\b(?:DOB|D\.O\.B\.|date of birth)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/gi,
    group: 1,
    replacement: (i) => `01/01/${1970 + (i % 30)}`,
    rationale: 'Matched date-of-birth label + date',
  },
  {
    categoryLabel: 'date',
    confidence: 0.55,
    regex: /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/g,
    replacement: (i) => `15/06/${2000 + (i % 20)}`,
    rationale: 'Matched date-like pattern (lower confidence — may be non-DOB)',
  },
  {
    categoryLabel: 'address',
    confidence: 0.65,
    regex: /\b\d{1,5}\s+[A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*){0,3}\s+(?:Street|St|Road|Rd|Avenue|Ave|Boulevard|Blvd|Drive|Dr|Lane|Ln|Court|Ct|Place|Pl|Way|Terrace|Tce)\b/gi,
    replacement: (i) => `${100 + i} Example Street`,
    rationale: 'Matched street-address-like pattern',
  },
  {
    // $1,173,624 / $12,400.50 / $500 (comma-grouped or plain, optional cents)
    categoryLabel: 'financial_figure',
    confidence: 0.88,
    regex: /\$\s?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\b/g,
    replacement: currencyReplacement,
    rationale: 'Matched currency amount pattern',
    validate: (s) => {
      const digits = String(s).replace(/[^\d.]/g, '');
      const n = Number(digits);
      return Number.isFinite(n) && n > 0;
    },
  },
  {
    // 5.29% / 12% / 0.5%
    categoryLabel: 'interest_rate',
    confidence: 0.86,
    regex: /\b\d{1,3}(?:\.\d{1,4})?\s*%/g,
    replacement: percentReplacement,
    rationale: 'Matched percentage / rate pattern',
    validate: (s) => {
      const n = Number(String(s).replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n >= 0 && n <= 1000;
    },
  },
];

function newId() {
  return crypto.randomUUID();
}

/**
 * @param {object} ir — from parseDocxBuffer
 * @returns {object[]} raw candidate stubs (pre-merge)
 */
function extractPatternCandidates(ir, jobId) {
  const out = extractBankNameCandidates(ir, jobId, {
    newId,
    locateInParagraph,
    normalizeCategoryLabel,
  });
  let replIndex = out.length;

  for (const rule of PATTERNS) {
    for (const paragraph of ir.paragraphs || []) {
      const text = paragraph.text || '';
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(text)) !== null) {
        const quote = rule.group != null ? (m[rule.group] || m[0]) : m[0];
        if (!quote || (rule.validate && !rule.validate(quote))) continue;
        if (rule.categoryLabel === 'phone' && /^\d{4}$/.test(quote.replace(/\D/g, ''))) continue;

        let startOffset = m.index;
        let endOffset = m.index + m[0].length;
        if (rule.group != null && m[rule.group]) {
          const rel = m[0].indexOf(m[rule.group]);
          if (rel >= 0) {
            startOffset = m.index + rel;
            endOffset = startOffset + m[rule.group].length;
          }
        }

        const location = locateInParagraph(paragraph, startOffset, endOffset, quote);
        const suggestedReplacement = typeof rule.replacement === 'function'
          ? rule.replacement(replIndex++, quote)
          : rule.replacement;
        out.push({
          id: newId(),
          jobId,
          source: 'deterministic',
          sourceLabel: 'pattern-match',
          categoryLabel: normalizeCategoryLabel(rule.categoryLabel),
          entityKey: null,
          surfaceForms: [quote],
          locations: [location],
          confidence: rule.confidence,
          score: rule.confidence,
          scoreBreakdown: { pattern: rule.confidence },
          suggestedReplacement,
          decision: 'pending',
          decidedBy: null,
          rationale: rule.rationale,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  return out;
}

module.exports = {
  extractPatternCandidates,
  PATTERNS,
};
