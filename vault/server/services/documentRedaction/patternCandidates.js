'use strict';

/**
 * Deterministic regex / pattern backstop for well-known PII shapes.
 * Source tag: deterministic (architecture) ≈ pattern-match.
 */

const { locateInParagraph } = require('./docxParse');
const crypto = require('crypto');

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
    // AU / intl-ish phones
    regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}\b/g,
    replacement: (i) => `555-01${String(100 + i).slice(-2)}`,
    rationale: 'Matched phone-number-like pattern',
    validate: (s) => {
      const digits = String(s).replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) return false;
      // Avoid TFN/SSN-like ###-###-### colliding with phone
      if (/^\d{3}[-\s]?\d{3}[-\s]?\d{3}$/.test(String(s).trim()) && digits.length === 9) return false;
      return true;
    },
  },
  {
    categoryLabel: 'national_id',
    confidence: 0.9,
    // US SSN-like or AU TFN-ish 8–9 digit with separators
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
];

function newId() {
  return crypto.randomUUID();
}

/**
 * @param {object} ir — from parseDocxBuffer
 * @returns {object[]} raw candidate stubs (pre-merge)
 */
function extractPatternCandidates(ir, jobId) {
  const out = [];
  let replIndex = 0;

  for (const rule of PATTERNS) {
    for (const paragraph of ir.paragraphs || []) {
      const text = paragraph.text || '';
      rule.regex.lastIndex = 0;
      let m;
      while ((m = rule.regex.exec(text)) !== null) {
        const quote = rule.group != null ? (m[rule.group] || m[0]) : m[0];
        if (!quote || (rule.validate && !rule.validate(quote))) continue;
        // Skip tiny digit runs that look like years alone for phone rule
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
        const suggestedReplacement = rule.replacement(replIndex++);
        out.push({
          id: newId(),
          jobId,
          source: 'deterministic',
          sourceLabel: 'pattern-match',
          categoryLabel: rule.categoryLabel,
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
