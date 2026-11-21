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
  newClaim: 'LLMs sometimes invent statistics, quotes and sources. An invented figure in a submission can damage your credibility.',
  quote: 'Quotes must match their source exactly, even where the original has a typo.',
  quoteRemoved: 'A quote from legislation, a report or a stakeholder is often the evidence a point rests on.',
  limit: 'Submissions over the limit can be rejected or cut off before the reader gets to the end.',
  required: 'Assessors look for the sections they asked for; a missing one can mean the submission is marked down or not considered.',
  requiredOrder: 'Following the required order makes it easy for assessors to find each part.',
  version: 'Readers and reviewers rely on the version number to know which draft they have.',
  versionBack: 'An older version number suggests an older draft, or that the wrong file was used.',
  refRemoved: 'Removing a source leaves the claims that relied on it unsupported, and citations to it may now point to nothing.',
  refChanged: 'A changed author, year, title or link can make a source impossible to find, or point readers to a different one.',
  refRenumbered: 'Citations in the text have to follow the new numbers, or they point to the wrong source.',
  citeBroken: 'A citation without its source leaves the claim unsupported, and assessors notice.',
  citeWrong: 'The claim is now attributed to a source that may not say it.',
  citeDetached: 'The claim in this text no longer shows where it comes from.',
  numbering: 'Gaps, repeats and out-of-order numbers look like missing content, and cross-references to them break.',
  renumbered: 'Cross-references, and other documents that cite paragraph or figure numbers, may now point to the wrong place.',
  spelling: 'A submission should use one spelling standard throughout; these words no longer match the spelling your original uses.',
  terms: 'Defined terms and acronyms have to be used consistently, or the document can read as if it means something different.',
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
    case 'newClaim': {
      const [kind, ...rest] = (c.detail ?? 'Claim: ').split(': ');
      const what = rest.join(': ');
      const noun = { Statistic: 'a statistic', Quote: 'a quote', Citation: 'a citation', Link: 'a link', Source: 'a source' }[kind] ?? 'a claim';
      return {
        summary: `The LLM added ${noun} that isn't in your original: ${what.length > 90 ? `${what.slice(0, 89)}…` : what}`,
        whyItMatters: WHY.newClaim,
        action: kind === 'Quote' ? 'Check who said this and that these are their exact words, or remove it.' : kind === 'Link' ? 'Open the link, check it exists and says what the text claims, or remove it.' : 'Check the source exists and says this, or remove it.',
      };
    }
    case 'quote':
      if (c.detail === 'Quote removed') return { summary: `The LLM removed a direct quote from ${where(c)}.`, whyItMatters: WHY.quoteRemoved, action: 'Restore the quote exactly as it was, or accept the removal if you meant to cut it.' };
      return { summary: `The LLM changed the wording of a direct quote in ${where(c)}.`, whyItMatters: WHY.quote, action: 'Restore the quote exactly as it was in your original.' };
    case 'wordLimit':
      return /pages?,/.test(c.detail ?? '')
        ? { summary: `The edited version is over the page limit: ${c.detail}.`, whyItMatters: WHY.limit, action: 'Shorten the document, or check the page limit in Settings.' }
        : { summary: `The edited version is over the word limit: ${c.detail}.`, whyItMatters: WHY.limit, action: 'Cut words to get under the limit (the section table under File details shows where the words are), or check the limit you set.' };
    case 'requiredHeading':
      if (/^Out of order/.test(c.detail ?? '')) return { summary: `A required heading is out of order: ${c.detail?.replace(/^Out of order: /, '')}.`, whyItMatters: WHY.requiredOrder, action: 'Move the section back into the required order, or check the list of required headings in Settings.' };
      return { summary: `A required heading is missing: ${quote(c.original, 80)}.`, whyItMatters: WHY.required, action: `Add the section ${quote(c.original, 80)} back, or check the list of required headings in Settings.` };
    case 'versionNumber':
      if (/went backwards/.test(c.detail ?? '')) return { summary: `${c.detail ?? 'The version went backwards'}.`, whyItMatters: WHY.versionBack, action: 'Set the version number to the next one after the original, or check you picked the right files.' };
      if (/history table/.test(c.detail ?? '')) return { summary: 'The version history table was not updated.', whyItMatters: WHY.version, action: 'Add a row for this version to the version history table.' };
      return { summary: `${c.detail ?? 'The version number needs checking'}.`, whyItMatters: WHY.version, action: 'Update the version number so readers know which version they have.' };
    case 'reference': {
      const d = c.detail ?? '';
      if (/^Reference list renumbered/.test(d)) return { summary: `The LLM renumbered the reference list (${d.replace(/^Reference list renumbered: /, '')}).`, whyItMatters: WHY.refRenumbered, action: 'Check each citation in the text still points to the right source (any that do not are listed separately), or restore the original numbering.' };
      const m = /^(Reference|Footnote|Endnote|Link) (removed|added|changed)(?: \(([^)]+)\))?: (.+)$/.exec(d);
      const kind = (m?.[1] ?? 'Reference').toLowerCase(), name = m?.[4] ?? '';
      const label = kind === 'reference' ? `reference ${name}` : name.toLowerCase();
      if (m?.[2] === 'added') return { summary: `The LLM added ${label} that isn't in your original.`, whyItMatters: WHY.newClaim, action: 'Check this source exists and says what the text claims, or remove it.' };
      if (m?.[2] === 'changed') return { summary: `The LLM changed the ${m[3] ?? 'wording'} of ${label}.`, whyItMatters: WHY.refChanged, action: `Restore ${label} as it was, unless you meant to fix it.` };
      return { summary: `The LLM removed ${label}${kind === 'reference' ? ' from the reference list' : ''}.`, whyItMatters: WHY.refRemoved, action: `Restore ${label}, or accept the removal if nothing in the text relies on it.` };
    }
    case 'citation': {
      const d = c.detail ?? '';
      const what = d.replace(/^[^:]+: /, '');
      if (/^Citation points to nothing/.test(d)) return { summary: `A citation in the edited version points to nothing: ${what}.`, whyItMatters: WHY.citeBroken, action: 'Restore the missing source, or fix or remove the citation.' };
      if (/different source/.test(d)) return { summary: `A citation now points to a different source than in your original: ${what}.`, whyItMatters: WHY.citeWrong, action: 'Change the citation back so it points to the source your original used.' };
      if (/removed from this text/.test(d)) return { summary: `The LLM took a citation off the text in ${where(c)}: ${what}.`, whyItMatters: WHY.citeDetached, action: 'Put the citation back on this text.' };
      return { summary: `The LLM moved a citation onto different text (${where(c)}): ${what}.`, whyItMatters: WHY.citeWrong, action: 'Check the source supports this text, or move the citation back where it was.' };
    }
    case 'numbering': {
      const d = c.detail ?? '';
      if (/^Renumbered: \d+ paragraph/.test(d)) { const n = Number(/(\d+) paragraph/.exec(d)?.[1] ?? 0); return { summary: `The LLM renumbered ${n === 1 ? 'a paragraph' : `${n} paragraphs`}: ${d.replace(/^Renumbered: \d+ paragraphs? \((.*)\)$/, '$1')}.`, whyItMatters: WHY.renumbered, action: 'Check any cross-references to these numbers, or restore the original numbering.' }; }
      if (/^Renumbered: /.test(d)) return { summary: `The LLM changed a number: ${d.replace(/^Renumbered: /, '')}.`, whyItMatters: WHY.renumbered, action: 'Check any cross-references to this number, or restore the original number.' };
      return { summary: `${d} (${where(c)}).`, whyItMatters: WHY.numbering, action: 'Fix the numbering, or restore the item that is missing.' };
    }
    case 'spelling': {
      if (c.children) return { summary: `The LLM switched the spelling ${(c.detail ?? '').replace(/^Spelling switched /, '').replace(/: (\d+) places?, (\d+) words? \(.*$/, (_, p, w) => ` in ${p} place${p === '1' ? '' : 's'} (${w} word${w === '1' ? '' : 's'})`)}.`, whyItMatters: WHY.spelling, action: 'Change these words back to the spelling your original uses, or accept them all if you want the new spelling.' };
      return { summary: `The LLM changed "${c.original}" to "${c.edited}"${/\(\d+×\)/.test(c.detail ?? '') ? ` ${/\((\d+)×\)/.exec(c.detail ?? '')?.[1]} times` : ''}.`, whyItMatters: WHY.spelling, action: `Change "${c.edited}" back to "${c.original}", or accept it.` };
    }
    case 'terminology': {
      const d = c.detail ?? '';
      const acr = /^Acronym (\S+)/.exec(d)?.[1] ?? '';
      if (/never spelled out/.test(d)) return { summary: `The LLM introduced the acronym ${acr} without saying what it stands for.`, whyItMatters: WHY.terms, action: `Spell out ${acr} the first time it is used, or replace it with the words it stands for.` };
      if (/without its expansion/.test(d)) return { summary: `${d}.`, whyItMatters: WHY.terms, action: `Add the expansion back the first time ${acr} is used.` };
      return { summary: `${d || 'A defined term or acronym is used differently'}.`, whyItMatters: WHY.terms, action: 'Use the term again where the LLM replaced it, or accept the change if you meant it.' };
    }
    default:
      return { summary: c.detail ?? 'Something changed.', whyItMatters: 'Check this change before you submit.', action: 'Review this change.' };
  }
}

/** The one instruction for a change (the review for the author uses it). */
export const actionFor = (c: Change) => describe(c).action;

export const originOf = (c: Change): Change['origin'] => (c.category === 'removed' ? 'removed' : c.category === 'added' ? 'added' : 'changed');
