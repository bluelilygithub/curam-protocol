import { useEffect, useMemo, useRef, useState } from 'react';
import type { Change, WordCounts } from '../report/model';
import { ACCURACY_NOTE, VERDICT_TEXT, isOpen, progress, reviewItems, summarySentence, verdictOf, type Decision, type Decisions, type ReviewItem } from '../review/verdict';

/** The text Restore copies: the original wording (a removed section's parts one after another). */
export function restoreText(c: Change): string | undefined {
  if (c.category === 'metadata') return undefined; // a count, not text: the cut content is on the other cards
  if (c.group === 'section' && c.children?.length) return c.children.map((k) => k.original ?? '').filter(Boolean).join('\n\n');
  return c.original;
}

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy');
    t.remove();
    return ok;
  } catch { return false; }
}

const DECISION_LABEL: Record<Decision, string> = { restore: 'To restore', accept: 'Accepted', later: 'Fix later' };

export function ReviewView({ changes, words, decisions, persistent, onDecide, onDismissSimilar, onShowAll, onShowIn, say }: {
  changes: Change[];
  words?: WordCounts;
  decisions: Decisions;
  persistent: boolean;
  onDecide: (key: string, decision: Decision | null) => void;
  onDismissSimilar: (keys: string[]) => void;
  onShowAll: () => void;
  onShowIn: (c: Change) => void;
  say: (text: string) => void;
}) {
  const items = useMemo(() => reviewItems(changes, decisions), [changes, decisions]);
  const verdict = verdictOf(items);
  const p = progress(items);
  const [focus, setFocus] = useState(0);
  const cards = useRef<(HTMLElement | null)[]>([]);
  const [showDecided, setShowDecided] = useState(true);

  useEffect(() => { if (focus >= items.length) setFocus(Math.max(0, items.length - 1)); }, [items.length, focus]);

  const decide = async (i: ReviewItem, d: Decision) => {
    if (d === 'restore') {
      const text = restoreText(i.change);
      if (text) say((await copy(text)) ? 'Copied the original text. Paste it back into your document.' : 'Could not copy automatically: select the original text on the card and copy it.');
      else if (i.change.category === 'metadata') say('Recorded. Restore the cut content using the other cards (or All changes).');
      else say('Recorded. Remove the added text from your document.');
    }
    onDecide(i.key, d);
  };
  const similar = (i: ReviewItem) => items.filter((x) => x.tier === 'amber' && x.change.category === i.change.category && isOpen(x));

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('button, input, a') && !['ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const i = items[focus];
    const move = (to: number) => { const n = Math.min(items.length - 1, Math.max(0, to)); setFocus(n); cards.current[n]?.focus(); };
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(focus + 1); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(focus - 1); return; }
    if (!i) return;
    const k = e.key.toLowerCase();
    if (k === 'a') { e.preventDefault(); void decide(i, 'accept'); move(focus + 1); }
    else if (k === 'r' && i.tier === 'red') { e.preventDefault(); void decide(i, 'restore'); move(focus + 1); }
    else if (k === 'l' && i.tier === 'red') { e.preventDefault(); void decide(i, 'later'); move(focus + 1); }
  };

  const shown = showDecided ? items : items.filter(isOpen);
  return (
    <section className="review" aria-label="Verdict and review">
      <div className={`verdict verdict-${verdict}`} role="status" data-guide="verdict">
        <span className="verdict-icon" aria-hidden="true">{VERDICT_TEXT[verdict].icon}</span>
        <div>
          <h2>{VERDICT_TEXT[verdict].title}</h2>
          <p className="verdict-sentence">{summarySentence(changes)}</p>
        </div>
      </div>
      <p className="accuracy-note">{ACCURACY_NOTE}</p>
      {words && (
        <p className="words-line" data-guide="word-total" title="Total words, the reference list left out unless Settings says otherwise. The table by section is under File details.">
          <strong>Words:</strong> {words.original.toLocaleString('en-AU')} in the original, {words.edited.toLocaleString('en-AU')} in the edited version
          {words.limit ? <> · limit {words.limit.toLocaleString('en-AU')}{words.edited > words.limit ? <span className="text-removed"> (over by {(words.edited - words.limit).toLocaleString('en-AU')})</span> : ' (within the limit)'}</> : null}
        </p>
      )}

      <div className="review-bar">
        <strong>{p.decided} of {p.total} decided</strong>
        {p.openRed > 0 && <span className="text-removed">{p.openRed} red item{p.openRed === 1 ? '' : 's'} still open</span>}
        <label className="inline" title="Hide the cards you have already decided."><input type="checkbox" checked={!showDecided} onChange={(e) => setShowDecided(!e.target.checked)} /> Hide decided</label>
        <span className="muted small" title="Keyboard: R restore, A accept, L fix later, arrow keys to move between cards.">Keys: R restore · A accept · L later · ↑↓ move</span>
        <button className="btn" onClick={onShowAll} title="Every change, including the minor ones, in a table you can filter, search and sort.">Show all changes</button>
      </div>
      {!persistent && <p className="muted small">This browser is not keeping data for this page, so decisions last until you leave it.</p>}

      {items.length === 0 && <div className="empty-view"><h2>Nothing needs a decision</h2><p className="muted">Only minor changes were found. They are listed under Show all changes.</p></div>}

      <ol className="cards" onKeyDown={onKey} data-guide="review-queue">
        {shown.map((i) => {
          const idx = items.indexOf(i);
          const c = i.change;
          return (
            <li key={i.key} ref={(el) => { cards.current[idx] = el; }} tabIndex={0} onFocus={() => setFocus(idx)}
              className={`card card-${i.tier}${i.decision ? ` decided decided-${i.decision.decision}` : ''}${idx === focus ? ' focused' : ''}`}
              aria-label={`${i.tier === 'red' ? 'Must decide' : 'Review'}: ${c.summary ?? ''}${i.decision ? ` Decision: ${DECISION_LABEL[i.decision.decision]}.` : ''}`}>
              <div className="card-head">
                <span className={`badge tier-${i.tier}`}>{i.tier === 'red' ? '● Must decide' : '▲ Review'}</span>
                <span className="muted small">{c.location}</span>
                {i.decision && <span className={`badge decision-${i.decision.decision}`}>{DECISION_LABEL[i.decision.decision]}</span>}
              </div>
              <p className="card-summary">{c.summary}</p>
              <p className="card-why"><strong>Why it matters:</strong> {c.whyItMatters}</p>
              {c.diffHtml && !c.trivial && c.category !== 'formatting'
                // diffHtml is escaped text with only <del>/<ins> added (compare/content.ts)
                ? <div className="diff" dangerouslySetInnerHTML={{ __html: c.diffHtml }} />
                : (
                  <div className="detail-cols">
                    {(c.original || c.group === 'section') && <div><h4>Original</h4><p className="text-removed">{(restoreText(c) ?? c.original ?? '').slice(0, 1200)}</p></div>}
                    {c.edited && <div><h4>Edited</h4><p className="text-added">{c.edited.slice(0, 1200)}</p></div>}
                  </div>
                )}
              <p className="card-action"><strong>What to do:</strong> {c.action}</p>
              <div className="row">
                {i.tier === 'red' ? (
                  <>
                    <button className="btn primary" onClick={() => void decide(i, 'restore')} title="Copy the original text to the clipboard so you can paste it back, and record that you will restore it. Key: R">Restore</button>
                    <button className="btn" onClick={() => void decide(i, 'accept')} title="Record that this change was intended. Key: A">Accept</button>
                    <button className="btn" onClick={() => void decide(i, 'later')} title="Leave it open for now. The verdict stays red until it is decided. Key: L">Fix later</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" onClick={() => void decide(i, 'accept')} title="Record that this change is fine. Key: A">Accept</button>
                    {similar(i).length > 1 && <button className="btn" onClick={() => onDismissSimilar(similar(i).map((x) => x.key))} title={`Accept all ${similar(i).length} open changes of this kind at once.`}>Dismiss all similar ({similar(i).length})</button>}
                  </>
                )}
                {i.decision && <button className="btn ghost" onClick={() => onDecide(i.key, null)} title="Take back this decision.">Undo</button>}
                <button className="link" onClick={() => onShowIn(c)} title="Find this change in the full table of changes.">Show in all changes</button>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
