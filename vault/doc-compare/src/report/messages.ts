import type { Change } from './model';

/**
 * Every plain-language message about a change, in one place (addendum §2), so the wording can be tuned here. Australian English.
 * Rules: say what happened, why it matters and what to do, in everyday words. Never say a document is "safe", "correct" or "verified":
 * DocCompare checks what changed, not whether it is true.
 */

export interface Message { summary: string; whyItMatters: string; action: string }

const quote = (s: string | undefined, n = 80) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `"${t.slice(0, n - 1)}…"` : `"${t}"`;
};
/** "Section 4, para 2" -> "Section 4"; "Page 3 · …" kept short. Used to say where, in a sentence. */
const where = (c: Change) => {
  const loc = c.location.replace(/ \(edited\)$/, '');
  const m = /^(?:Page \d+ · )?(.+?), para \d+$/.exec(loc);
  return m ? `"${m[1]}"` : loc;
};

const WHY = {
  removed: 'Removing supporting evidence, a caveat or a condition can weaken or change your argument.',
  removedSection: 'A missing section can drop evidence, or a part the submission is required to have.',
  removedRow: 'Table rows often hold the figures your argument relies on.',
  removedHeading: 'Readers and assessors use headings to find what they need, and some headings may be required.',
  removedImage: 'A missing figure or chart can leave text referring to something that is no longer there.',
  added: 'Added text can bring in claims, figures or sources you did not write.',
  moved: 'Changing the order can change how your argument reads.',
  number: 'A changed statistic, date or amount can make the submission wrong and damage your credibility.',
  dropped: 'Cut words can include caveats, conditions or evidence.',
  wording: 'Rewording can shift meaning, tone or emphasis.',
  typo: 'Usually a fix, but a spelling change can also alter a name or a defined term.',
  structure: 'Headings, lists and numbering help readers find their way, and assessors may expect a set structure.',
  inline: 'Formatting such as bold or italics often marks the key points.',
  layout: 'Layout changes can move content to another page or push it out of view.',
  wordDrop: 'A big drop in words often means content was skipped.',
  fileDetail: 'File details can show a document was recreated rather than edited, or that something large was removed.',
  trivial: 'This does not change the meaning.',
};

/** The plain-language message for a change. */
export function describe(c: Change): Message {
  switch (c.category) {
    case 'removed': {
      if (c.group === 'section') return { summary: `The LLM removed the whole section ${quote(c.original, 60)} (${c.children?.length ?? 0} parts).`, whyItMatters: WHY.removedSection, action: `Restore the missing section ${quote(c.original, 60)} and everything under it, or accept the removal if you meant to cut it.` };
      if (c.group === 'tableRow') return { summary: `The LLM removed a row from ${c.location.replace(/, row \d+.*$/, '').replace(/^Page \d+ · /, '')}.`, whyItMatters: WHY.removedRow, action: 'Restore the missing table row, or accept the removal if you meant to cut it.' };
      if (c.detail === 'Image removed') return { summary: `The LLM removed an image (${c.location}).`, whyItMatters: WHY.removedImage, action: 'Restore the missing image, or accept the removal if you meant to cut it.' };
      if (c.detail === 'Heading removed') return { summary: `The LLM removed the heading ${quote(c.original, 60)}.`, whyItMatters: WHY.removedHeading, action: `Restore the missing heading ${quote(c.original, 60)}, or accept the removal if you meant to merge the section.` };
      return { summary: `The LLM removed a paragraph from ${where(c)}.`, whyItMatters: WHY.removed, action: 'Restore this text, or accept the removal if you meant to cut it.' };
    }
    case 'added': {
      if (c.group === 'section') return { summary: `The LLM added a new section ${quote(c.edited, 60)}.`, whyItMatters: WHY.added, action: `Confirm the new section ${quote(c.edited, 60)} is wanted, and check any figure, quote or source in it; remove it if not.` };
      if (c.detail === 'Image added') return { summary: `The LLM added an image (${c.location}).`, whyItMatters: WHY.added, action: 'Confirm the added image is wanted; remove it if not.' };
      return { summary: `The LLM added text that isn't in your original (${where(c)}).`, whyItMatters: WHY.added, action: 'Confirm this added text is wanted, and check any figure, quote or source in it; remove it if not.' };
    }
    case 'moved':
      return { summary: `The LLM moved a paragraph (${c.location}).`, whyItMatters: WHY.moved, action: `Confirm this text should move (${c.location}); otherwise put it back where it was.` };
    case 'number': {
      const many = /;/.test(c.detail ?? '');
      return { summary: `The LLM changed ${many ? 'figures' : 'a figure'} in ${where(c)}: ${c.detail ?? ''}.`, whyItMatters: WHY.number, action: `Check the changed figure${many ? 's' : ''}: ${c.detail ?? ''}. Restore the original value unless the change was intended.` };
    }
    case 'wording':
      if (c.trivial) return { summary: 'Only spacing, quotes or invisible characters differ.', whyItMatters: WHY.trivial, action: 'No action: only spacing, quotes or invisible characters differ.' };
      if (c.severity === 'high') return { summary: `The LLM cut words from a paragraph in ${where(c)}.`, whyItMatters: WHY.dropped, action: 'Restore the words dropped from this paragraph (struck through below), or confirm they should go.' };
      return { summary: `The LLM reworded a paragraph in ${where(c)}.`, whyItMatters: WHY.wording, action: 'Review the rewording: keep it, or restore the original wording.' };
    case 'typo':
      return { summary: `The LLM changed a spelling: ${c.detail ?? ''}.`, whyItMatters: WHY.typo, action: `Check the spelling change ${c.detail ?? ''}: keep it if it fixes a mistake, otherwise restore the original.` };
    case 'formatting': {
      const structural = c.severity !== 'low';
      return { summary: `The LLM changed the ${structural ? 'structure' : 'formatting'}: ${c.detail ?? ''}.`, whyItMatters: structural ? WHY.structure : WHY.inline, action: `Restore the original formatting unless the change was intended: ${c.detail ?? 'formatting changed'}.` };
    }
    case 'layout': {
      const page = c.location.replace(/ \(edited\)$/, '');
      return { summary: `${page} of the edited PDF looks different: ${c.detail ?? 'its layout changed'}.`, whyItMatters: WHY.layout, action: `Check ${page} of the edited PDF: ${c.detail ?? 'its layout changed'}.` };
    }
    case 'metadata': {
      const d = c.detail ?? 'a file detail changed';
      if (/^Word count dropped/.test(d)) return { summary: `The edited version is shorter: ${d.replace(/^Word count dropped by/, 'its word count dropped by')}.`, whyItMatters: WHY.wordDrop, action: 'Check what was cut (see the removed and reworded items), and restore anything you need.' };
      if (/^Section .* lost/.test(d)) return { summary: `${d}.`, whyItMatters: WHY.wordDrop, action: 'Read that section in both versions and restore anything the LLM cut that you need.' };
      return { summary: `A file detail changed: ${d}.`, whyItMatters: WHY.fileDetail, action: `Check: ${d}.` };
    }
    default:
      return { summary: c.detail ?? 'Something changed.', whyItMatters: 'Check this change before you submit.', action: 'Review this change.' };
  }
}

/** The one instruction for a change (the review for the author uses it). */
export const actionFor = (c: Change) => describe(c).action;

export const originOf = (c: Change): Change['origin'] => (c.category === 'removed' ? 'removed' : c.category === 'added' ? 'added' : 'changed');
