'use strict';

/**
 * Patterns that look like LLM prompt injection attempts.
 * All anchored to the start of a trimmed line.
 * Deliberately avoids matching valid code constructs (eval, exec, require, etc.).
 */
const INJECTION_PATTERNS = [
  /^ignore\s+previous\s+instructions?/i,
  /^you\s+are\s+now\b/i,
  /^system:\s/i,
  /^###\s*instructions?\b/i,
  /^<\|?system\|?>/i,
  /^\[INST\]/i,
  /^disregard\s+(all\s+)?(previous|prior|above)\s+instructions?/i,
  /^new\s+instructions?:/i,
  /^forget\s+(all\s+)?(previous|prior)\s+instructions?/i,
  /^act\s+as\s+(if\s+you\s+are|a\s+new)/i,
];

/**
 * Sanitise code file content to remove LLM prompt injection attempts.
 *
 * Pure function — no side effects, no external dependencies.
 * Injection lines are replaced with a safe comment to preserve line numbers.
 * Valid code patterns (eval, exec, require, etc.) are never touched.
 *
 * @param {string} content  - Raw UTF-8 file content
 * @param {string} filename - Original filename (used only in the replacement comment)
 * @returns {{ sanitised: string, injectionFound: boolean, removedCount: number }}
 */
function sanitiseCodeFile(content, filename) {
  const lines = content.split('\n');
  const cleanLines = [];
  let injectionFound = false;
  let removedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    let isInjection = false;

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(trimmed)) {
        isInjection = true;
        break;
      }
    }

    if (isInjection) {
      injectionFound = true;
      removedCount++;
      // Replace with a comment — preserves line numbers for debugging
      cleanLines.push('// [REMOVED: potential prompt injection]');
    } else {
      cleanLines.push(line);
    }
  }

  return {
    sanitised: cleanLines.join('\n'),
    injectionFound,
    removedCount,
  };
}

module.exports = { sanitiseCodeFile };
