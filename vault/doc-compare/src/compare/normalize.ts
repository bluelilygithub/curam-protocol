import type { TrivialRules } from '../settings';

export const ALL_RULES: TrivialRules = { whitespace: true, quotes: true, unicode: true, lineEndings: true };

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

/** Applies the "ignore trivial changes" rules that are on. */
export function normalize(s: string, rules: TrivialRules): string {
  if (rules.unicode) s = s.normalize('NFC').replace(ZERO_WIDTH, '');
  if (rules.quotes) s = mapQuotes(s);
  if (rules.lineEndings) s = s.replace(/\r\n?/g, '\n');
  if (rules.whitespace) s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** One character in, one out, so it can also be used per character when comparing formatting by position. */
export function mapQuotes(s: string): string {
  return s
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[‐‑‒–—―−]/g, '-')
    .replace(/[   ]/g, ' ');
}
