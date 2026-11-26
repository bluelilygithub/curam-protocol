import React, { useEffect, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { CARD, FIELD_CLASS, FIELD_STYLE, SecondaryButton, Badge, formatDate } from './shared';

// What changed in one round, in reading order, against the starting point or the round before. Worked out by code on the server
// (results.diff); nothing here decides whether an edit was done. Changes that look like content changing by itself (cookie banners,
// dates, counters, rotating panels) are grouped under the real ones, closed, and never hidden for good.
const TYPE = {
  added: { label: 'Added', bg: '#dcfce7', fg: '#166534' },
  removed: { label: 'Removed', bg: '#fff1f2', fg: '#991b1b' },
  changed: { label: 'Changed', bg: 'var(--color-bg)', fg: 'var(--color-text)' },
  moved: { label: 'Moved', bg: 'var(--color-bg)', fg: 'var(--color-muted)' },
};
const BLOCK = { heading: 'Heading', paragraph: 'Paragraph', listItem: 'List item', tableCell: 'Table cell', image: 'Picture' };
export const VOLATILE = {
  cookie: 'Cookie or consent banner',
  date: 'A date or time that may update itself',
  counter: 'A number that counts something',
  rotating: 'Wording that came back from an earlier round: may be a rotating panel',
};
const DEL = { background: '#fff1f2', color: '#991b1b', textDecoration: 'line-through' };
const INS = { background: '#dcfce7', color: '#166534', textDecoration: 'underline' };

function Picture({ side }) {
  return (
    <span className="block text-sm">
      {side.text ? `"${side.text}"` : 'A picture with no description'}
      {side.src && <a href={side.src} target="_blank" rel="noopener noreferrer" className="block text-xs break-all underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{side.src}</a>}
    </span>
  );
}

function ChangeCard({ c }) {
  const t = TYPE[c.type];
  const side = c.after || c.before;
  return (
    <li className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} data-change={c.id}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: t.bg, color: t.fg, border: '1px solid var(--color-border)' }}>{t.label}</span>
        <span style={{ color: 'var(--color-muted)' }}>{BLOCK[side.type] || side.type}{side.section?.length ? ` · ${side.section.join(' › ')}` : ''}</span>
        {c.volatile && <Badge>{VOLATILE[c.volatile] || c.volatile}</Badge>}
      </div>
      {c.type === 'changed' && side.type !== 'image' && (
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>
          {c.words.map((w, i) => {
            const prev = c.words[i - 1];
            const gap = w.op === '+' && prev?.op === '-' && !/\s$/.test(prev.text) && !/^\s/.test(w.text); // "Exhibitions Past exhibitions", not run together
            return <React.Fragment key={i}>{gap ? ' ' : ''}<span style={w.op === '-' ? DEL : w.op === '+' ? INS : undefined}>{w.text}</span></React.Fragment>;
          })}
        </p>
      )}
      {c.type === 'changed' && side.type === 'image' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div><span className="text-xs" style={{ color: '#991b1b' }}>Before</span><Picture side={c.before} /></div>
          <div><span className="text-xs" style={{ color: '#166534' }}>After</span><Picture side={c.after} /></div>
        </div>
      )}
      {(c.type === 'added' || c.type === 'removed' || c.type === 'moved') && (side.type === 'image'
        ? <Picture side={side} />
        : <p className="text-sm leading-relaxed whitespace-pre-wrap" style={c.type === 'added' ? INS : c.type === 'removed' ? DEL : { color: 'var(--color-text)' }}>{side.text}</p>)}
      {c.type === 'moved' && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>The same text, now in a different place{c.before.section?.length ? ` (was under ${c.before.section.join(' › ')})` : ''}.</p>}
      {c.kindChanged && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Was a {(BLOCK[c.before.type] || c.before.type).toLowerCase()}{c.before.level ? ` (level ${c.before.level})` : ''}, now a {(BLOCK[c.after.type] || c.after.type).toLowerCase()}{c.after.level ? ` (level ${c.after.level})` : ''}.</p>}
      {c.links && <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>Link: {c.links.before.join(', ') || 'none'} → {c.links.after.join(', ') || 'none'}</p>}
    </li>
  );
}

export default function ChangesView({ job, getIcon, fetchRound, roundNumber, setRoundNumber, onAllRounds }) {
  const comparable = job.rounds.filter((r) => r.status === 'ready').slice(1); // every round read after the starting point
  const [basis, setBasis] = useState('previous');
  const [round, setRound] = useState(null);
  const [error, setError] = useState('');
  const [showVolatile, setShowVolatile] = useState(false);
  const number = comparable.some((r) => r.number === roundNumber) ? roundNumber : comparable[comparable.length - 1]?.number;

  useEffect(() => {
    if (number == null) return undefined;
    let live = true;
    setRound(null); setError('');
    fetchRound(number).then((r) => { if (live) setRound(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [job.id, number, job.rounds.length]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!comparable.length) {
    return <EmptyState icon="history" title="Nothing to compare yet" body="Round 0 is the page before the edits. Once the developer says they are done, press Check again on Rounds; the changes show here." />;
  }
  const diff = round?.results?.diff;
  const d = diff ? (basis === 'baseline' ? diff.vsBaseline : diff.vsPrevious) : null;
  const sameBasis = diff && diff.previousNumber === diff.baselineNumber;
  const real = d ? d.changes.filter((c) => !c.volatile) : [];
  const self = d ? d.changes.filter((c) => c.volatile) : [];
  const fromRound = diff ? (basis === 'baseline' ? diff.baselineNumber : diff.previousNumber) : null;
  const viaOf = (n) => job.rounds.find((r) => r.number === n)?.fetchedVia;
  const readDifferently = diff && round && viaOf(fromRound) && viaOf(fromRound) !== round.fetchedVia;

  return (
    <div className="flex flex-col xl:grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:items-start gap-4">
      <section className="rounded-2xl border p-6 space-y-4" style={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Which round to look at. Each round is one time the page was read.">
            <select value={number} onChange={(e) => setRoundNumber(Number(e.target.value))} aria-label="Round" className={`${FIELD_CLASS} w-auto`} style={FIELD_STYLE}>
              {[...comparable].reverse().map((r) => <option key={r.number} value={r.number}>Round {r.number} · {formatDate(r.fetchedAt)}</option>)}
            </select>
          </Tooltip>
          <div className="flex gap-1" role="radiogroup" aria-label="Compare with">
            {[['previous', 'Since last round', 'What changed since the round before this one.'], ['baseline', 'Since the starting point', 'Everything that differs from round 0, the page before the edits.']].map(([k, label, tip]) => (
              <Tooltip key={k} text={sameBasis ? 'This is the first round after the starting point, so both are the same.' : tip}>
                <button type="button" role="radio" aria-checked={basis === k} disabled={sameBasis && k === 'baseline'} onClick={() => setBasis(k)}
                  className="px-3 py-1.5 rounded-lg border text-sm transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={basis === k || (sameBasis && k === 'previous') ? { background: 'var(--color-primary)', color: 'var(--color-on-primary)', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
                  {label}
                </button>
              </Tooltip>
            ))}
          </div>
        </div>
        {error && <p role="alert" className="text-sm" style={{ color: '#991b1b' }}>{error}</p>}
        {!round && !error && <Skeleton lines={6} />}
        {d && (
          <>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Round {round.number} against round {fromRound}{fromRound === diff.baselineNumber ? ' (the starting point)' : ''}: {real.length} change{real.length === 1 ? '' : 's'}
              {self.length ? `, and ${self.length} that may have changed by itself` : ''}. Worked out by comparing the text; whether each edit is right is for you to judge.
            </p>
            {readDifferently && (
              <p className="text-sm rounded-xl border p-3" style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}>
                These two rounds were read differently ({viaOf(fromRound) === 'browser' ? 'a real browser' : viaOf(fromRound) === 'upload' ? 'a saved copy' : 'a plain fetch'} against {round.fetchedVia === 'browser' ? 'a real browser' : round.fetchedVia === 'upload' ? 'a saved copy' : 'a plain fetch'}). Some differences, such as share buttons, sign-in links or picture addresses, may come from that rather than from edits.
              </p>
            )}
            {d.changes.length === 0 && <EmptyState icon="check" title="No changes" body={`The page reads the same as round ${fromRound}. If edits were expected, they have not appeared on the page yet.`} />}
            <ol className="space-y-2">{real.map((c) => <ChangeCard key={c.id} c={c} />)}</ol>
            {self.length > 0 && (
              <div className="space-y-2">
                <Tooltip text="Cookie banners, dates and times, counters and rotating panels can change without anyone editing the page. They are kept here, not thrown away, in case one of them is a real edit.">
                  <button type="button" onClick={() => setShowVolatile((v) => !v)} aria-expanded={showVolatile}
                    className="flex items-center gap-1.5 text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }}>
                    {getIcon(showVolatile ? 'chevron-up' : 'chevron-down', { size: 14 })} May have changed by itself ({self.length})
                  </button>
                </Tooltip>
                {showVolatile && <ol className="space-y-2">{self.map((c) => <ChangeCard key={c.id} c={c} />)}</ol>}
              </div>
            )}
          </>
        )}
      </section>

      <section className="rounded-2xl border p-6 space-y-3" style={CARD}>
        {job.kind === 'request' ? (
          <>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>The request</h2>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Linking each line to the changes that answer it comes in the next update.</p>
            <ol className="space-y-1.5">
              {job.items.map((it) => (
                <li key={it.id} className="text-sm flex gap-2" style={{ color: 'var(--color-text)' }}>
                  <span className="text-xs font-semibold w-8 shrink-0 pt-0.5" style={{ color: 'var(--color-primary)' }}>{it.ref}</span>
                  <span>{it.lineText}</span>
                </li>
              ))}
            </ol>
          </>
        ) : (
          <>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>About this comparison</h2>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>A page comparison has no request: it shows what changed between the times the page was read. Press Check again on Rounds to add a round.</p>
          </>
        )}
        {round && <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>Round {round.number} was read {formatDate(round.fetchedAt)}{round.finalUrl ? ` from ${round.finalUrl}` : ''}.</p>}
        <SecondaryButton tip="See every round, when each was read and how." onClick={onAllRounds}>All rounds</SecondaryButton>
      </section>
    </div>
  );
}
