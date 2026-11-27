import React, { useEffect, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import Skeleton from '../../components/Skeleton';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { CARD, FIELD_CLASS, FIELD_STYLE, PrimaryButton, SecondaryButton, Badge, formatDate } from './shared';
import { ChangeCard, VOLATILE } from './ChangesView';
import { openQuestionsPrompt } from './reviewList.mjs';

// Review (rework brief R2, decisions 1-4): judge the edits, not the tool. The job strip on top (starting point, checks, Verify, saved
// copies) replaces Rounds. Then three parts, worked out on the server (services/htmlContentCheck/review.js):
//   Needs attention   changes nobody asked for that are not marked yet (first: the most important list), questioned ones, and request
//                     lines with no change found, questioned, or approved earlier but changed since
//   To approve        request lines whose changes look done, each with its before and after and Approve / Question
//   Approved          collapsed: approved lines, changes marked Mine, intentional or Expected (self-changing ones arrive Expected)
// Decisions belong to the job and carry over to later checks by the change's fingerprint. The AI's links work in the background: the
// reason shows on hover, and "Not this change" picks another by hand. Keys: J / K move, A approve (or Mine on a change), Q question,
// E expected, U clear.
const REASON = {
  unmarked: 'Not asked for',
  questioned: 'Questioned',
  noChange: 'No change found',
  notMatched: 'Not matched yet',
  changedSinceApproval: 'Was approved, now changed',
  keepChanged: 'Keep: text changed or removed',
  looksDone: 'Looks done',
  held: 'Held over: not checked',
  keepNotOnStartingPage: 'Keep: not found on the starting page',
  keepNotRead: 'Keep: page not read',
  kept: 'Keep: still there',
  approved: 'Approved',
  mine: 'Mine, intentional',
  expected: 'Expected',
};
const ON = { approved: '#166534', mine: '#166534', expected: '#475569', question: '#991b1b' };
const pill = (on, color) => (on ? { background: color, borderColor: 'transparent', color: '#fff' } : { borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' });
const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
const keyOf = (x) => (x.type === 'line' ? `line:${x.ref}` : `change:${x.pageId}:${x.fp}`);

function NewBadge() {
  return <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: '#dbeafe', color: '#1e3a8a' }}>New this check</span>;
}

/** The strip that replaces Rounds: when the starting point was read, how many checks, the last one, Verify, saved copies, failures. */
function JobStrip({ job, busy, checkAgain, uploadCopy }) {
  const fileRef = useRef(null);
  const [uploadFor, setUploadFor] = useState(null);
  const pages = job.pages || [];
  const multi = pages.length > 1;
  const numbers = [...new Set(job.rounds.map((r) => r.number))].sort((a, b) => a - b);
  const last = numbers[numbers.length - 1];
  const start = job.rounds.find((r) => r.number === 0);
  const lastRows = job.rounds.filter((r) => r.number === last);
  const failed = lastRows.filter((r) => r.status === 'failed');
  const name = (id) => { const i = pages.findIndex((p) => p.id === id); return i < 0 ? 'A removed page' : pages[i].label || `Page ${i + 1}`; };
  const pick = (pageId) => { setUploadFor(pageId); fileRef.current?.click(); };
  const checks = Math.max(numbers.length - 1, 0);
  return (
    <section className="rounded-2xl border p-4 space-y-2" style={CARD} data-guide="verify">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[240px] text-sm" style={{ color: 'var(--color-text)' }}>
          <span>Starting point {start ? formatDate(start.fetchedAt) : 'not read yet'}</span>
          <span style={{ color: 'var(--color-muted)' }}> · {checks} check{checks === 1 ? '' : 's'}{last > 0 ? ` · last ${formatDate(lastRows[0]?.fetchedAt)}` : ''}</span>
        </div>
        <Tooltip text={multi ? 'Upload a saved copy of one page (for a page that could not be read, or behind a login).' : 'For a page that cannot be fetched or is behind a login: save it from your browser (File > Save Page As, HTML only) and choose the file.'}>
          <span>
            {multi
              ? <select aria-label="Upload a saved copy for" value="" disabled={busy} onChange={(e) => e.target.value && pick(Number(e.target.value))} className={`${FIELD_CLASS.replace('w-full', 'w-auto')} py-1.5`} style={FIELD_STYLE}>
                  <option value="">Upload a saved copy…</option>
                  {pages.map((p) => <option key={p.id} value={p.id}>{name(p.id)}</option>)}
                </select>
              : <SecondaryButton disabled={busy} onClick={() => pick(pages[0]?.id)}>Upload a saved copy</SecondaryButton>}
          </span>
        </Tooltip>
        <PrimaryButton disabled={busy} onClick={checkAgain} tip="Read every page again now, compare it with the starting point and match the request. Press it after each round of edits.">Verify</PrimaryButton>
        <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden" aria-label="Saved copy of the page"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadCopy(f, uploadFor); }} />
      </div>
      {failed.map((r) => (
        <p key={r.pageId} className="text-sm rounded-xl border p-2.5" style={{ borderColor: '#fca5a5', background: '#fff1f2', color: '#991b1b' }}>
          {multi ? `${name(r.pageId)}: ` : ''}could not be read{last === 0 ? ' as its starting point' : ' in the last check'}: {r.error}{' '}
          <button type="button" className="underline transition-opacity duration-200 hover:opacity-60" onClick={() => pick(r.pageId)}>Upload a saved copy</button>
        </p>
      ))}
    </section>
  );
}

function Note({ value, onSave, label }) {
  const [text, setText] = useState(value || '');
  useEffect(() => { setText(value || ''); }, [value]);
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <VoiceInput value={text} onChange={setText} onBlur={() => { if ((text || null) !== (value || null)) onSave(text || null); }}
        label={label} placeholder="Note (optional): what is wrong, or why" className={FIELD_CLASS} style={FIELD_STYLE} />
    </div>
  );
}

export default function ReviewView({ job, busy, loadRound, checkAgain, uploadCopy, decideLine, decideChange, linkChanges, downloadReport, matchRound }) {
  const numbers = [...new Set(job.rounds.filter((r) => r.sincePrevious).map((r) => r.number))].sort((a, b) => a - b);
  const number = numbers[numbers.length - 1];
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null);
  const [showApproved, setShowApproved] = useState(false);
  const [picking, setPicking] = useState(null); // a line ref whose changes are being picked by hand
  const [notesOpen, setNotesOpen] = useState(() => new Set());
  const [copied, setCopied] = useState(false);
  const [unasked, setUnasked] = useState(false);
  const refs = useRef({});
  const pages = job.pages || [];
  const multi = pages.length > 1;
  const pageName = (id) => { const i = pages.findIndex((p) => p.id === id); return i < 0 ? 'Across the site' : pages[i].label || `Page ${i + 1}`; };

  useEffect(() => {
    if (number == null) { setView(null); return undefined; }
    let live = true;
    setError('');
    loadRound(number).then((v) => { if (live) setView(v); }).catch((e) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [job.id, number, job.rounds.length, job.items.length, job.pages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = view?.review;
  const rows = view?.pages || [];
  const changeOf = (pageId, id) => rows.find((r) => r.pageId === pageId)?.results?.diff?.vsBaseline?.changes?.find((c) => c.id === id);
  const itemOf = Object.fromEntries(job.items.map((it) => [it.ref, it]));
  const reasonOf = (pageId, ref) => rows.find((r) => r.pageId === pageId)?.results?.matches?.items?.[ref];
  const order = review ? [...review.attention, ...review.approve.filter((x) => x.blocking)].map(keyOf) : [];

  const apply = async (p) => { const v = await p; if (v) setView(v); };
  const setLine = (ref, status, note) => apply(decideLine(number, ref, status, note));
  const setChange = (x, status, note) => apply(decideChange(number, x.pageId, x.fp, status, note));
  const toggle = (x, status) => (x.type === 'line'
    ? setLine(x.ref, x.decision?.status === status ? null : status, x.decision?.note ?? null)
    : setChange(x, x.decision?.status === status && !x.decision?.auto ? null : status, x.decision?.note ?? null));

  const go = (k) => { if (!k) return; setCurrent(k); requestAnimationFrame(() => refs.current[k]?.scrollIntoView({ block: 'center', behavior: 'smooth' })); };
  useEffect(() => {
    const onKey = (e) => {
      if (!review || e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement) || busy) return;
      const k = e.key.toLowerCase();
      const i = order.indexOf(current);
      const x = [...review.attention, ...review.approve, ...review.approved].find((y) => keyOf(y) === current);
      if (k === 'j') go(order[Math.min(i + 1, order.length - 1)] ?? order[0]);
      else if (k === 'k') go(order[Math.max(i - 1, 0)] ?? order[0]);
      else if (x && k === 'a' && (x.type === 'change' || x.kind === 'request_line')) toggle(x, x.type === 'line' ? 'approved' : 'mine');
      else if (x && k === 'q' && (x.type === 'change' || x.kind === 'request_line')) toggle(x, 'question');
      else if (x && k === 'e' && x.type === 'change') toggle(x, 'expected');
      else if (x && k === 'u' && x.decision && !x.decision.auto) (x.type === 'line' ? setLine(x.ref, null, null) : setChange(x, null, null));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const strip = <JobStrip job={job} busy={busy} checkAgain={checkAgain} uploadCopy={uploadCopy} />;
  if (number == null) {
    return (
      <div className="space-y-4">
        {strip}
        <div className="rounded-2xl border p-5 space-y-1" style={{ ...CARD, borderColor: 'var(--color-primary)' }} data-guide="waiting">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Waiting for the edits</p>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            The {multi ? 'pages are' : 'page is'} saved as {multi ? 'they are' : 'it is'} now: that is the starting point. Make the edits on the site, then press Verify. Every change is then shown against the request, and every change nobody asked for is listed first.
          </p>
        </div>
      </div>
    );
  }
  if (error) return <div className="space-y-4">{strip}<p role="alert" className="text-sm" style={{ color: '#991b1b' }}>{error}</p></div>;
  if (!review) return <div className="space-y-4">{strip}<Skeleton lines={6} /></div>;

  const decisionButtons = (x) => {
    const opts = x.type === 'line'
      ? [['approved', 'Approve', 'A', 'The edit is right: it goes on the client checklist.'], ['question', 'Question', 'Q', 'Missing or wrong: it stays open until fixed. Add a note to say what.']]
      : [['mine', 'Mine, intentional', 'A', 'You made this change on purpose: it goes on the client checklist under "Also changed".'],
        ['question', 'Question', 'Q', 'Nobody asked for this: it needs fixing (put back). Add a note to say what.'],
        ['expected', 'Expected', 'E', 'It changes by itself (a date, a counter): nothing to do. It stays off the checklist.']];
    return (
      <span className="flex flex-wrap gap-1.5" data-guide={x.type === 'line' ? 'approve' : 'marks'}>
        {opts.map(([v, label, key, tip]) => {
          const on = x.decision?.status === v;
          return (
            <Tooltip key={v} text={on && !x.decision?.auto ? 'Press again to clear.' : `${tip} Key: ${key}.`}>
              <button type="button" disabled={busy} aria-pressed={on} onClick={(e) => { e.stopPropagation(); setCurrent(keyOf(x)); toggle(x, v); }}
                className="text-sm px-3 py-1.5 rounded-full border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={pill(on, ON[v])}>
                {on && v === 'approved' ? '✓ Approved' : label}{on && x.decision?.auto ? ' (automatic)' : ''}
              </button>
            </Tooltip>
          );
        })}
      </span>
    );
  };
  const noteFor = (x) => {
    const open = x.decision?.note || x.decision?.status === 'question' || notesOpen.has(keyOf(x));
    if (!open) {
      return <button type="button" className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }} onClick={(e) => { e.stopPropagation(); setNotesOpen(new Set([...notesOpen, keyOf(x)])); }}>Add a note</button>;
    }
    const save = (note) => (x.type === 'line' ? setLine(x.ref, x.decision?.status || 'question', note) : setChange(x, x.decision && !x.decision.auto ? x.decision.status : 'question', note));
    return <Note value={x.decision?.note} onSave={save} label={`Note on ${x.type === 'line' ? x.ref : 'this change'}`} />;
  };

  const lineCard = (x) => {
    const it = itemOf[x.ref];
    const home = it?.pageId ?? x.links?.[0]?.pageId ?? null;
    const reasons = [...new Set((x.links || []).map((l) => reasonOf(l.pageId, x.ref)?.reason).filter(Boolean))];
    const scopeRows = rows.filter((r) => r.results?.diff && (it?.pageId == null || r.pageId === it.pageId));
    const decidable = x.kind === 'request_line';
    return (
      <li key={keyOf(x)} ref={(el) => { refs.current[keyOf(x)] = el; }} onClick={() => setCurrent(keyOf(x))}
        className="rounded-xl p-4 space-y-3" style={{ border: current === keyOf(x) ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: 'var(--color-bg)', opacity: x.kind === 'held_over' ? 0.75 : 1 }}>
        <div className="flex flex-wrap items-start gap-3">
          <span className="text-xs font-semibold w-8 shrink-0 pt-0.5" style={{ color: 'var(--color-primary)' }}>{x.ref}</span>
          <div className="flex-1 min-w-[220px] space-y-1">
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>{it?.lineText}</p>
            <p className="flex flex-wrap items-center gap-1.5 text-xs">
              <span style={{ color: ['noChange', 'changedSinceApproval', 'keepChanged', 'questioned'].includes(x.reason) ? '#991b1b' : 'var(--color-muted)' }}>{REASON[x.reason] || x.reason}</span>
              {multi && <Badge>{home == null ? 'All pages' : pageName(home)}</Badge>}
              {x.kind === 'keep' && <Badge>Keep</Badge>}
              {reasons.length > 0 && <Tooltip text={`Why the AI linked this: ${reasons.join(' ')}`}><span className="underline decoration-dotted cursor-help" tabIndex={0} style={{ color: 'var(--color-muted)' }}>why?</span></Tooltip>}
            </p>
          </div>
          {decidable && decisionButtons(x)}
        </div>
        {(x.links || []).length > 0 && (
          <ul className="space-y-2 pl-11">
            {x.links.map((l) => {
              const c = changeOf(l.pageId, l.changeId);
              return c ? (
                <React.Fragment key={l.fp}>
                  {(l.isNew || (multi && l.pageId !== home)) && <li className="list-none flex gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>{l.isNew && <NewBadge />}{multi && l.pageId !== home ? `On ${pageName(l.pageId)}` : ''}</li>}
                  <ChangeCard c={c} />
                </React.Fragment>
              ) : null;
            })}
          </ul>
        )}
        {decidable && (
          <div className="pl-11 space-y-2">
            {noteFor(x)}
            <div>
              <Tooltip text="The changes linked to this line are wrong or missing one: pick the right ones by hand. Your choice is kept on later checks.">
                <button type="button" className="text-xs underline transition-opacity duration-200 hover:opacity-60" style={{ color: 'var(--color-muted)' }} data-guide="pick-another"
                  onClick={(e) => { e.stopPropagation(); setPicking(picking === x.ref ? null : x.ref); }}>
                  {picking === x.ref ? 'Done picking' : (x.links || []).length ? 'Not this change / pick another' : 'Pick the change by hand'}
                </button>
              </Tooltip>
              {picking === x.ref && (
                <ul className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                  {scopeRows.flatMap((r) => r.results.diff.vsBaseline.changes.map((c) => {
                    const linked = (x.links || []).some((l) => l.pageId === r.pageId && l.changeId === c.id);
                    const ids = (x.links || []).filter((l) => l.pageId === r.pageId).map((l) => l.changeId);
                    return (
                      <li key={`${r.pageId}-${c.id}`} className="flex gap-2 items-start">
                        <input type="checkbox" className="mt-4" checked={linked} disabled={busy} aria-label={`Link this change to ${x.ref}`}
                          onChange={() => apply(linkChanges(number, r.pageId, x.ref, linked ? ids.filter((i) => i !== c.id) : [...ids, c.id]))} />
                        <ul className="flex-1 min-w-0">{multi && <li className="list-none text-xs" style={{ color: 'var(--color-muted)' }}>{pageName(r.pageId)}</li>}<ChangeCard c={c} /></ul>
                      </li>
                    );
                  }))}
                </ul>
              )}
            </div>
          </div>
        )}
      </li>
    );
  };

  const changeCard = (x) => {
    const c = changeOf(x.pageId, x.changeId);
    if (!c) return null;
    return (
      <li key={keyOf(x)} ref={(el) => { refs.current[keyOf(x)] = el; }} onClick={() => setCurrent(keyOf(x))}
        className="rounded-xl p-4 space-y-2" style={{ border: current === keyOf(x) ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: 'var(--color-bg)', opacity: x.volatile && x.decision?.status !== 'question' ? 0.6 : 1 }}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold" style={{ color: x.reason === 'questioned' ? '#991b1b' : 'var(--color-text)' }}>{REASON[x.reason] || x.reason}</span>
          {multi && <Badge>{pageName(x.pageId)}</Badge>}
          {x.isNew && <NewBadge />}
          {x.volatile && <Badge>Looks automatic: {(VOLATILE[x.volatile] || x.volatile).toLowerCase()}</Badge>}
          <span className="ml-auto">{decisionButtons(x)}</span>
        </div>
        <ul><ChangeCard c={c} /></ul>
        {noteFor(x)}
      </li>
    );
  };

  const prompt = openQuestionsPrompt({ jobName: job.name, items: job.items, view });
  const openCount = prompt ? review.attention.filter((x) => x.reason !== 'unmarked' && x.reason !== 'notMatched').length : 0;
  const copyQuestions = async () => {
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt('Copy the open questions:', prompt); }
  };
  const changesAttention = review.attention.filter((x) => x.type === 'change');
  const linesAttention = review.attention.filter((x) => x.type === 'line');
  const approvedLines = review.approved.filter((x) => x.type === 'line' && x.reason === 'approved').length;

  return (
    <div className="space-y-4">
      {strip}
      <section className="sticky top-0 z-20 rounded-2xl border p-4 flex flex-wrap items-center gap-3 shadow-sm" style={CARD} data-guide="review-bar">
        <div className="flex-1 min-w-[260px] text-sm" aria-live="polite" style={{ color: 'var(--color-text)' }}>
          {review.ready
            ? <span><strong style={{ color: '#166534' }}>Ready to send to the client.</strong>{review.counts.autoExpected ? ` ${review.counts.autoExpected} change${review.counts.autoExpected === 1 ? ' was' : 's were'} marked Expected automatically (dates, counters): check them under Approved.` : ''}</span>
            : <span><strong>{review.counts.attention}</strong> need{review.counts.attention === 1 ? 's' : ''} attention · <strong>{review.counts.toApprove}</strong> to approve · {review.counts.approved} done{review.counts.autoExpected ? ` (${review.counts.autoExpected} Expected automatically)` : ''}</span>}
          <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>Check {number} · {formatDate(view.fetchedAt)} · Keys: J / K move · A approve · Q question · E expected · U clear</span>
        </div>
        {review.attention.some((x) => x.reason === 'notMatched') && <PrimaryButton disabled={busy} onClick={() => apply(matchRound(number))} tip="Matching did not run for this check (the AI could not be reached, or it was interrupted). Run it again without reading the pages again.">Match the request</PrimaryButton>}
        <SecondaryButton disabled={!openCount} onClick={copyQuestions} tip="Copy every open item, page by page with your notes, as a prompt to paste straight into an LLM (or a message) to fix them.">{copied ? 'Copied' : `Copy the open questions${openCount ? ` (${openCount})` : ''}`}</SecondaryButton>
        <span data-guide="report" className="flex flex-wrap items-center gap-2">
          <Tooltip text="Also list the changes nobody asked for on the report.">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={unasked} onChange={(e) => setUnasked(e.target.checked)} /> With unrequested changes
            </label>
          </Tooltip>
          <PrimaryButton disabled={!approvedLines || busy} onClick={() => downloadReport(number, unasked)} tip={approvedLines ? 'A PDF of the approved lines, page by page, for the client. (Its new layout comes in a later update.)' : 'Approve at least one line first.'}>Client checklist</PrimaryButton>
        </span>
      </section>

      <section className="rounded-2xl border p-5 space-y-3" style={CARD} data-guide="attention">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Needs attention ({review.attention.length})</h2>
        {!review.attention.length && <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Nothing: every change is accounted for and nothing is questioned.</p>}
        {changesAttention.length > 0 && (
          <div className="space-y-2" data-guide="unrequested">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Changes nobody asked for ({changesAttention.length})</h3>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Check each one: did you make it on purpose, does it need putting back, or does it change by itself?</p>
            <ol className="space-y-2">{changesAttention.map(changeCard)}</ol>
          </div>
        )}
        {linesAttention.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Requests ({linesAttention.length})</h3>
            <ol className="space-y-2">{linesAttention.map(lineCard)}</ol>
          </div>
        )}
      </section>

      {review.approve.length > 0 && (
        <section className="rounded-2xl border p-5 space-y-3" style={CARD}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>To approve ({review.counts.toApprove})</h2>
          <ol className="space-y-2">{review.approve.map(lineCard)}</ol>
        </section>
      )}

      <section className="rounded-2xl border p-5 space-y-3" style={CARD} data-guide="approved">
        <button type="button" aria-expanded={showApproved} onClick={() => setShowApproved(!showApproved)} className="text-base font-semibold transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }}>
          {showApproved ? '▾' : '▸'} Approved and accounted for ({review.approved.length})
        </button>
        {showApproved && <ol className="space-y-2">{review.approved.map((x) => (x.type === 'line' ? lineCard(x) : changeCard(x)))}</ol>}
      </section>
    </div>
  );
}
