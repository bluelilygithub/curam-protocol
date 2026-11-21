import { SECTION_STATUS_LABEL, stillCheck } from '../compare/sections';
import type { Change, SectionGroup, WordCounts } from '../report/model';
import { ACCURACY_NOTE } from '../review/verdict';

/** Nobody edited anything here: say what differs, not what the LLM did. */
const differs = (c: Change) => {
  const where = c.location.replace(/, para \d+$/, '');
  return c.category === 'quote' ? `A direct quote differs in "${where}".` : `A figure differs in "${where}": ${c.detail ?? ''}.`;
};

const ORDER: SectionGroup['status'][] = ['reworded', 'onlyA', 'onlyB', 'both'];
const HINT: Record<SectionGroup['status'], string> = {
  reworded: 'In both versions, with different wording.',
  onlyA: 'In version A and not in version B.',
  onlyB: 'In version B and not in version A.',
  both: 'The same in both versions (spacing and quote marks aside).',
};

/**
 * Intentionally different versions (addendum §0.2): no verdict and nothing to decide. The sections are grouped (worded differently, only in
 * A, only in B, in both), and numbers and quotes that differ are still listed, since a statistic or a quote should match across versions.
 */
export function VersionsView({ sections, changes, words, onShowAll, onShowIn }: {
  sections: SectionGroup[];
  changes: Change[];
  words?: WordCounts;
  onShowAll: () => void;
  onShowIn: (c: Change) => void;
}) {
  const still = stillCheck(changes);
  const count = (s: SectionGroup['status']) => sections.filter((g) => g.status === s).length;
  return (
    <section className="review" aria-label="Version comparison">
      <div className="verdict verdict-none" role="status" data-guide="version-summary">
        <span className="verdict-icon" aria-hidden="true">⇄</span>
        <div>
          <h2>Version comparison</h2>
          <p className="verdict-sentence">
            {sections.length} section{sections.length === 1 ? '' : 's'}: {count('both')} in both versions, {count('reworded')} worded differently, {count('onlyA')} only in A, {count('onlyB')} only in B.
            {' '}These versions are meant to differ, so there is no verdict and nothing to decide.
          </p>
        </div>
      </div>
      <p className="accuracy-note">{ACCURACY_NOTE}</p>
      {words && <p className="words-line"><strong>Words:</strong> {words.original.toLocaleString('en-AU')} in A, {words.edited.toLocaleString('en-AU')} in B</p>}

      <div className="review-bar">
        <strong>{still.length ? `Still check: ${still.length} number or quote change${still.length === 1 ? '' : 's'}` : 'No numbers or quotes differ'}</strong>
        <button className="btn" onClick={onShowAll} title="Every difference, in a table you can filter, search and sort.">Show all changes</button>
      </div>
      {still.length > 0 && (
        <ol className="cards" data-guide="still-check">
          {still.map((c) => (
            <li key={c.id} className="card card-red">
              <div className="card-head"><span className="badge tier-red">Check</span><span className="muted small">{c.location}</span></div>
              <p className="card-summary">{differs(c)}</p>
              <p className="card-why"><strong>Why it matters:</strong> A statistic or a quote should be the same in every version, whoever it is written for.</p>
              {c.diffHtml && <div className="diff" dangerouslySetInnerHTML={{ __html: c.diffHtml }} />}
              <div className="row"><button className="link" onClick={() => onShowIn(c)} title="Find this change in the full table of changes.">Show in all changes</button></div>
            </li>
          ))}
        </ol>
      )}

      <div data-guide="sections">
        {ORDER.filter((s) => count(s) > 0).map((s) => (
          <details key={s} className="meta" open={s !== 'both'}>
            <summary>{SECTION_STATUS_LABEL[s]} ({count(s)})</summary>
            <p className="muted small">{HINT[s]}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th scope="col">Section</th><th scope="col">Words in A</th><th scope="col">Words in B</th>{s === 'reworded' && <th scope="col">How alike</th>}</tr></thead>
                <tbody>
                  {sections.filter((g) => g.status === s).map((g) => (
                    <tr key={`${g.title}|${g.titleB ?? ''}`}>
                      <th scope="row">{g.title}{g.titleB && <span className="muted small"> (in B: {g.titleB})</span>}</th>
                      <td>{g.wordsA || '—'}</td><td>{g.wordsB || '—'}</td>{s === 'reworded' && <td>{g.similarity}%</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
