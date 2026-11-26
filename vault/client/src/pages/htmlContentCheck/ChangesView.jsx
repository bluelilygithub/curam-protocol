import React, { useEffect, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import EmptyState from '../../components/EmptyState';
import { CARD, FIELD_CLASS, FIELD_STYLE, SecondaryButton, Badge, formatDate } from './shared';
import RequestPanel from './RequestPanel';

// What changed in one round, in reading order, against the starting point or the round before. Worked out by code on the server
// (results.diff); nothing here decides whether an edit was done. Changes that look like content changing by itself (cookie banners,
// dates, counters, rotating panels) are grouped under the real ones, closed, and never hidden for good; one a request line links to is
// moved into the main list and marked as asked for. On a change-request job the request sits beside the changes (RequestPanel).
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
const WARN = { borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' };
const VIA = { browser: 'a real browser', upload: 'a saved copy', plain: 'a plain fetch' };

function Picture({ side }) {
  return (
    <span className="block text-sm">
      {side.text ? `"${side.text}"` : 'A picture with no description'}
      {side.src && <a href={side.src} target="_blank" rel="noopener noreferrer" className="block text-xs break-all underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-primary)' }}>{side.src}</a>}
    </span>
  );
}

function ChangeCard({ c, askedBy = [], highlight, linkRef, onToggleLink }) {
  const t = TYPE[c.type];
  const side = c.after || c.before;
  const linked = linkRef && askedBy.includes(linkRef);
  return (
    <li className="rounded-xl p-4 space-y-2" data-change={c.id}
      style={{ border: highlight ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: t.bg, color: t.fg, border: '1px solid var(--color-border)' }}>{t.label}</span>
        <span style={{ color: 'var(--color-muted)' }}>{BLOCK[side.type] || side.type}{side.section?.length ? ` · ${side.section.join(' › ')}` : ''}</span>
        {askedBy.length > 0 && <span className="px-2 py-0.5 rounded-full font-medium" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary)' }}>Asked for: {askedBy.join(', ')}</span>}
        {c.volatile && <Badge>{VOLATILE[c.volatile] || c.volatile}</Badge>}
        {linkRef && (
          <span className="ml-auto">
            <SecondaryButton tip={linked ? `This change no longer answers ${linkRef}.` : `This change answers ${linkRef}.`} onClick={() => onToggleLink(c.id, !linked)}>
              {linked ? `Unlink from ${linkRef}` : `Link to ${linkRef}`}
            </SecondaryButton>
          </span>
        )}
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

export default function ChangesView({ job, getIcon, fetchRound, roundNumber, setRoundNumber, onAllRounds, matchRound, linkChanges, busy }) {
  const comparable = job.rounds.filter((r) => r.status === 'ready').slice(1); // every round read after the starting point
  const request = job.kind === 'request';
  const [basis, setBasis] = useState(request ? 'baseline' : 'previous'); // the request is matched against the starting point
  const [round, setRound] = useState(null);
  const [error, setError] = useState('');
  const [showVolatile, setShowVolatile] = useState(false);
  const [selected, setSelected] = useState(null); // a request line's ref
  const [editing, setEditing] = useState(false);
  const [filter, setFilter] = useState('all'); // all | asked | unasked
  const number = comparable.some((r) => r.number === roundNumber) ? roundNumber : comparable[comparable.length - 1]?.number;

  useEffect(() => {
    if (number == null) return undefined;
    let live = true;
    setRound(null); setError('');
    fetchRound(number).then((r) => { if (live) setRound(r); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [job.id, number, job.rounds.length, job.items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!selected) setEditing(false); }, [selected]);

  if (!comparable.length) {
    return <EmptyState icon="history" title="Nothing to compare yet" body="Round 0 is the page before the edits. Once the developer says they are done, press Check again on Rounds; the changes show here." />;
  }
  const diff = round?.results?.diff;
  const sameBasis = diff && diff.previousNumber === diff.baselineNumber;
  const onBaseline = basis === 'baseline' || sameBasis; // links are to the changes since the starting point
  const d = diff ? (onBaseline ? diff.vsBaseline : diff.vsPrevious) : null;
  const matches = round?.results?.matches || null;
  const askedBy = new Map(); // change id -> refs that link it
  if (onBaseline && matches) for (const it of job.items) for (const id of matches.items?.[it.ref]?.changeIds || []) askedBy.set(id, [...(askedBy.get(id) || []), it.ref]);
  const unasked = new Set(onBaseline ? matches?.unrequestedChanges || [] : []);
  const all = d?.changes || [];
  // a self-changing change that a line links to is a requested edit: it joins the main list
  const real = all.filter((c) => !c.volatile || askedBy.has(c.id)).filter((c) => filter === 'all' || (filter === 'asked' ? askedBy.has(c.id) : unasked.has(c.id)));
  const self = all.filter((c) => c.volatile && !askedBy.has(c.id));
  const fromRound = diff ? (onBaseline ? diff.baselineNumber : diff.previousNumber) : null;
  const viaOf = (n) => job.rounds.find((r) => r.number === n)?.fetchedVia;
  const readDifferently = diff && round && viaOf(fromRound) && viaOf(fromRound) !== round.fetchedVia;
  const lessText = round?.results?.fetch?.lessText;
  const realCount = all.filter((c) => !c.volatile || askedBy.has(c.id)).length;
  const highlightOf = (id) => Boolean(selected && askedBy.get(id)?.includes(selected));

  const setRoundMatches = (m) => setRound((r) => ({ ...r, results: { ...r.results, matches: m } }));
  const runMatch = async () => { const m = await matchRound(number); if (m) { setRoundMatches(m); setBasis('baseline'); } };
  const toggleLink = async (id, on) => {
    const current = matches?.items?.[selected]?.changeIds || [];
    const m = await linkChanges(number, selected, on ? [...current, id] : current.filter((x) => x !== id));
    if (m) setRoundMatches(m);
  };
  const card = (c) => <ChangeCard key={c.id} c={c} askedBy={askedBy.get(c.id)} highlight={highlightOf(c.id)} linkRef={editing && onBaseline ? selected : null} onToggleLink={toggleLink} />;

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
            {[['baseline', 'Since the starting point', 'Everything that differs from round 0, the page before the edits. The request is matched against these.'], ['previous', 'Since last round', 'What changed since the round before this one.']].map(([k, label, tip]) => (
              <Tooltip key={k} text={sameBasis ? 'This is the first round after the starting point, so both are the same.' : tip}>
                <button type="button" role="radio" aria-checked={basis === k} disabled={sameBasis && k === 'previous'} onClick={() => setBasis(k)}
                  className="px-3 py-1.5 rounded-lg border text-sm transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                  style={onBaseline === (k === 'baseline') ? { background: 'var(--color-primary)', color: 'var(--color-on-primary)', borderColor: 'var(--color-primary)' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
                  {label}
                </button>
              </Tooltip>
            ))}
          </div>
          {request && matches?.at && onBaseline && (
            <Tooltip text="Show every change, only the ones linked to the request, or only the ones nobody asked for.">
              <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Which changes" className={`${FIELD_CLASS} w-auto`} style={FIELD_STYLE}>
                <option value="all">All changes</option>
                <option value="asked">Asked for</option>
                <option value="unasked">Nobody asked for ({unasked.size})</option>
              </select>
            </Tooltip>
          )}
        </div>
        {error && <p role="alert" className="text-sm" style={{ color: '#991b1b' }}>{error}</p>}
        {!round && !error && <Skeleton lines={6} />}
        {d && (
          <>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              Round {round.number} against round {fromRound}{fromRound === diff.baselineNumber ? ' (the starting point)' : ''}: {realCount} change{realCount === 1 ? '' : 's'}
              {self.length ? `, and ${self.length} that may have changed by itself` : ''}. Worked out by comparing the text; whether each edit is right is for you to judge.
            </p>
            {lessText && (
              <p role="alert" className="text-sm rounded-xl border p-3" style={WARN}>
                This round has far less text than the starting point ({lessText.got.toLocaleString('en-AU')} words against {lessText.expected.toLocaleString('en-AU')}){round.results.fetch.retriedInBrowser ? ', even after trying a real browser' : ''}. The site may have been rebuilt or be blocking the check, so the removals below may not be real. Open the page in your browser before trusting them, or upload a saved copy on Rounds.
              </p>
            )}
            {readDifferently && (
              <p className="text-sm rounded-xl border p-3" style={WARN}>
                These two rounds were read differently ({VIA[viaOf(fromRound)]} against {VIA[round.fetchedVia]}). Some differences, such as share buttons, sign-in links or picture addresses, may come from that rather than from edits.
              </p>
            )}
            {d.stats.rough && (
              <p className="text-sm rounded-xl border p-3" style={WARN}>So much of the page changed that the changes were lined up roughly, in order, to keep the check quick. Moved text may show as removed and added.</p>
            )}
            {!onBaseline && request && matches?.at && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Links to the request are shown on "Since the starting point".</p>}
            {all.length === 0 && <EmptyState icon="check" title="No changes" body={`The page reads the same as round ${fromRound}. If edits were expected, they have not appeared on the page yet.`} />}
            {all.length > 0 && real.length === 0 && filter !== 'all' && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No change fits that filter.</p>}
            <ol className="space-y-2">{real.map(card)}</ol>
            {self.length > 0 && filter === 'all' && (
              <div className="space-y-2">
                <Tooltip text="Cookie banners, dates and times, counters and rotating panels can change without anyone editing the page. They are kept here, not thrown away, in case one of them is a real edit; one that a request line is linked to moves up into the main list.">
                  <button type="button" onClick={() => setShowVolatile((v) => !v)} aria-expanded={showVolatile}
                    className="flex items-center gap-1.5 text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }}>
                    {getIcon(showVolatile ? 'chevron-up' : 'chevron-down', { size: 14 })} May have changed by itself ({self.length})
                  </button>
                </Tooltip>
                {showVolatile && <ol className="space-y-2">{self.map(card)}</ol>}
              </div>
            )}
          </>
        )}
      </section>

      <div className="space-y-4">
        {request ? (
          <RequestPanel job={job} matches={matches} selected={selected} setSelected={setSelected} editing={editing} setEditing={setEditing}
            onMatch={runMatch} canMatch={Boolean(diff)} busy={busy} linkedCount={askedBy.size} unasked={unasked.size} />
        ) : (
          <section className="rounded-2xl border p-6 space-y-3" style={CARD}>
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>About this comparison</h2>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>A page comparison has no request: it shows what changed between the times the page was read. Press Check again on Rounds to add a round.</p>
          </section>
        )}
        <section className="rounded-2xl border p-4 space-y-2" style={CARD}>
          {round && <p className="text-xs break-all" style={{ color: 'var(--color-muted)' }}>Round {round.number} was read {formatDate(round.fetchedAt)} by {VIA[round.fetchedVia]}{round.finalUrl ? ` from ${round.finalUrl}` : ''}.</p>}
          <SecondaryButton tip="See every round, when each was read and how." onClick={onAllRounds}>All rounds</SecondaryButton>
        </section>
      </div>
    </div>
  );
}
