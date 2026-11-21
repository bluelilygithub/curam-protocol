import { classify, locate, type NewChange } from '../compare/content';
import type { PostCheck } from '../compare/postChecks';
import { SEVERITY } from '../report/severity';
import { closestQuote, docText, extractQuotes, normQuote } from './docText';

/**
 * Direct quotes (addendum §5.2) must match their source exactly, after trivial differences (spacing, curly or straight quotes). Any change,
 * even a "corrected" typo, is red. A quote in a paragraph that was removed altogether is already reported as removed content.
 */
export const changedQuotes: PostCheck = (a, b, ops) => {
  const edited = docText(b);
  const editedQuotes = extractQuotes(b);
  const removedBlocks = new Set(ops.filter((o) => o.kind === 'removed').map((o) => (o as { a: { id: string } }).a.id));
  const out: NewChange[] = [];
  for (const q of extractQuotes(a)) {
    if (edited.includes(normQuote(q.text)) || removedBlocks.has(q.block.id)) continue;
    const { quote: match, score } = closestQuote(q.text, editedQuotes);
    if (match && score >= 0.6) {
      out.push({ category: 'quote', severity: SEVERITY.quote, location: locate(q.block), original: q.text, edited: match.text, detail: 'Quote reworded', diffHtml: classify(normQuote(q.text), normQuote(match.text)).diffHtml });
    } else {
      out.push({ category: 'quote', severity: SEVERITY.quote, location: locate(q.block), original: q.text, detail: 'Quote removed' });
    }
  }
  return out;
};
