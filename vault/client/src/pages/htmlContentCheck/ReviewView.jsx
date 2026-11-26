import React, { useEffect, useMemo, useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { CARD, FIELD_CLASS, FIELD_INLINE, FIELD_STYLE, PrimaryButton, SecondaryButton, Badge, formatDate } from './shared';
import { LINE_STATUS } from './htmlContentCheckTools.mjs';
import { ChangeCard } from './ChangesView';
import { developerList, reviewGroups } from './reviewList.mjs';

// Review by line (Changes, change-request jobs): one list of request lines, page by page, each with the changes linked to it and the
// person's verdict (Approve / Needs work). A bar that stays on screen counts what is decided and holds Next undecided, the client report
// and the list for the developer. Keys: J / K move, A approve, N needs work, U clear. Approved lines fold to one row unless Show all is on;
// Held over and Keep lines are summed up at the end, with each page's changes nobody asked for. Linking by hand stays in All changes.
const ON = { approved: { background: '#166534', borderColor: 'transparent', color: '#fff' }, needs_work: { background: '#991b1b', borderColor: 'transparent', color: '#fff' } };
const OFF = { borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' };
const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

export default function ReviewView({ job, round, number, numbers, setRoundNumber, setVerdict, onMatch, downloadReport, busy, pageName }) {
  const [showAll, setShowAll] = useState(false);
  const [opened, setOpened] = useState(() => new Set()); // approved lines opened by hand while folded
  const [current, setCurrent] = useState(null); // the ref the keys act on
  const [unasked, setUnasked] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notes, setNotes] = useState({});
  const refs = useRef({});
  const approvals = round?.approvals || {};
  const lines = round?.lines || [];
  const rows = round?.pages || [];
  const { groups, others } = useMemo(() => reviewGroups(job, lines), [job, lines]);
  const order = groups.flatMap((g) => g.lines.map((it) => it.ref));
  const statusOf = Object.fromEntries(lines.map((l) => [l.ref, l]));
  const decided = order.filter((r) => approvals[r]?.status);
  const approved = order.filter((r) => approvals[r]?.status === 'approved').length;
  const needsWork = order.filter((r) => approvals[r]?.status === 'needs_work').length;
  const left = order.length - decided.length;
  const matched = lines.some((l) => l.kind === 'request_line' && l.status !== 'notMatched');
  const changeOf = (pageId, id) => rows.find((r) => r.pageId === pageId)?.results?.diff?.vsBaseline?.changes?.find((c) => c.id === id);
  const folded = (ref) => !showAll && approvals[ref]?.status === 'approved' && !opened.has(ref) && ref !== current;

  const go = (ref) => { if (!ref) return; setCurrent(ref); requestAnimationFrame(() => refs.current[ref]?.scrollIntoView({ block: 'center', behavior: 'smooth' })); };
  const nextUndecided = () => {
    const from = Math.max(order.indexOf(current), -1);
    go([...order.slice(from + 1), ...order.slice(0, from + 1)].find((r) => !approvals[r]?.status));
  };
  const decide = async (ref, status) => {
    await setVerdict(ref, approvals[ref]?.status === status ? null : status, status === 'needs_work' ? notes[ref] ?? approvals[ref]?.note ?? null : null);
  };

  // keys, while nothing is being typed in
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement) || busy) return;
      const k = e.key.toLowerCase();
      const i = order.indexOf(current);
      if (k === 'j') go(order[Math.min(i + 1, order.length - 1)] ?? order[0]);
      else if (k === 'k') go(order[Math.max(i - 1, 0)] ?? order[0]);
      else if (current && k === 'a') decide(current, 'approved');
      else if (current && k === 'n') decide(current, 'needs_work');
      else if (current && k === 'u' && approvals[current]?.status) setVerdict(current, null, null);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const copyForDeveloper = async () => {
    const text = developerList({ jobName: job.name, number, groups, approvals });
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { window.prompt('Copy this list for the developer:', text); }
  };
  const mailForDeveloper = () => {
    const text = developerList({ jobName: job.name, number, groups, approvals });
    window.location.href = `mailto:?subject=${encodeURIComponent(`Changes still needed: ${job.name}`)}&body=${encodeURIComponent(text)}`;
  };

  return (
    <div className="space-y-4">
      {/* ---- the bar that stays on screen ---- */}
      <section className="sticky top-0 z-20 rounded-2xl border p-4 space-y-3 shadow-sm" style={CARD} data-guide="review-bar">
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip text="Which round to review. Each round is one time the pages were read; verdicts are kept per round.">
            <select value={number} onChange={(e) => setRoundNumber(Number(e.target.value))} aria-label="Round" className={FIELD_INLINE} style={FIELD_STYLE}>
              {[...numbers].reverse().map((n) => <option key={n} value={n}>Round {n} · {formatDate(job.rounds.find((r) => r.number === n)?.fetchedAt)}</option>)}
            </select>
          </Tooltip>
          <div className="flex-1 min-w-[220px]" aria-live="polite">
            <div className="text-sm" style={{ color: 'var(--color-text)' }}>
              <strong>{decided.length} of {order.length}</strong> lines decided · {approved} approved · {needsWork} need work · {left} left
            </div>
            <div className="mt-1 h-1.5 rounded-full overflow-hidden flex" style={{ background: 'var(--color-border)' }} aria-hidden="true">
              <div style={{ width: `${order.length ? (approved / order.length) * 100 : 0}%`, background: '#166534' }} />
              <div style={{ width: `${order.length ? (needsWork / order.length) * 100 : 0}%`, background: '#991b1b' }} />
            </div>
          </div>
          {!matched && <PrimaryButton disabled={busy} onClick={onMatch} tip="The AI suggests which changes answer each line, page by page. You still decide each one.">Match to request</PrimaryButton>}
          <SecondaryButton disabled={!left} onClick={nextUndecided} tip="Go to the next line you have not decided yet.">Next undecided{left ? ` (${left})` : ''}</SecondaryButton>
          <Tooltip text="Show approved lines in full. Off: they fold to one row.">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all
            </label>
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-3" data-guide="report">
          <Tooltip text="Also list, on the report, the changes on each page that no request line asked for.">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={unasked} onChange={(e) => setUnasked(e.target.checked)} /> Include changes nobody asked for
            </label>
          </Tooltip>
          <PrimaryButton disabled={!approved || busy} onClick={() => downloadReport(number, unasked)}
            tip={approved ? `A fillable PDF of the ${approved} approved line${approved === 1 ? '' : 's'}, page by page, for the client. The first report fixes the R numbers.` : 'Approve at least one line first.'}>
            Make the client report
          </PrimaryButton>
          <span data-guide="developer" className="flex flex-wrap gap-2">
            <SecondaryButton disabled={!needsWork} onClick={copyForDeveloper} tip="Copy the lines that need work, page by page, with your notes, to paste to the developer.">{copied ? 'Copied' : `Copy for the developer${needsWork ? ` (${needsWork})` : ''}`}</SecondaryButton>
            <SecondaryButton disabled={!needsWork} onClick={mailForDeveloper} tip="Open an email with the same list, in your own email app.">Email it</SecondaryButton>
          </span>
          <span className="text-xs ml-auto" style={{ color: 'var(--color-muted)' }}>Keys: J / K move · A approve · N needs work · U clear</span>
        </div>
      </section>

      {/* ---- the lines, page by page ---- */}
      {groups.map((g) => (
        <section key={g.pageId ?? 'all'} className="rounded-2xl border p-5 space-y-3" style={CARD}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {g.label}{g.url && <span className="ml-2 text-xs font-normal break-all" style={{ color: 'var(--color-muted)' }}>{g.url}</span>}
          </h2>
          <ol className="space-y-2">
            {g.lines.map((it) => {
              const st = statusOf[it.ref];
              const verdict = approvals[it.ref]?.status || null;
              const on = current === it.ref;
              const links = st?.links || [];
              if (folded(it.ref)) {
                return (
                  <li key={it.id} ref={(el) => { refs.current[it.ref] = el; }}>
                    <Tooltip text="Approved. Open it again.">
                      <button type="button" onClick={() => { setOpened(new Set([...opened, it.ref])); setCurrent(it.ref); }}
                        className="w-full flex items-center gap-2 text-left text-sm rounded-xl border px-3 py-2 transition-opacity duration-200 hover:opacity-70"
                        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-muted)' }}>
                        <span className="text-xs font-semibold w-8 shrink-0" style={{ color: 'var(--color-primary)' }}>{it.ref}</span>
                        <span className="whitespace-nowrap shrink-0" style={{ color: '#166534' }}>✓ Approved</span>
                        <span className="truncate">{it.lineText}</span>
                      </button>
                    </Tooltip>
                  </li>
                );
              }
              return (
                <li key={it.id} ref={(el) => { refs.current[it.ref] = el; }} onClick={() => setCurrent(it.ref)}
                  className="rounded-xl p-4 space-y-3" style={{ border: on ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
                  <div className="flex flex-wrap items-start gap-3">
                    <span className="text-xs font-semibold w-8 shrink-0 pt-0.5" style={{ color: 'var(--color-primary)' }}>{it.ref}</span>
                    <div className="flex-1 min-w-[200px] space-y-1">
                      <p className="text-sm" style={{ color: 'var(--color-text)' }}>{it.lineText}</p>
                      <p className="text-xs" style={{ color: st?.status === 'noChange' ? '#991b1b' : 'var(--color-muted)' }}>
                        {it.pageId == null && (job.pages || []).length > 1 && <Badge>All pages</Badge>}{' '}
                        {st ? (st.status === 'linked' ? `${links.length} change${links.length === 1 ? '' : 's'} linked` : LINE_STATUS[st.status]) : ''}
                      </p>
                    </div>
                    <span className="flex gap-1.5" data-guide="approve">
                      {[['approved', 'Approve', 'A', 'You checked this edit and it is right: it goes on the client report.'], ['needs_work', 'Needs work', 'N', 'Missing or wrong: it stays off the report and goes on the list for the developer.']].map(([v, label, key, tip]) => (
                        <Tooltip key={v} text={verdict === v ? 'Press again to clear.' : `${tip} Key: ${key}.`}>
                          <button type="button" disabled={busy} aria-pressed={verdict === v} onClick={(e) => { e.stopPropagation(); setCurrent(it.ref); decide(it.ref, v); }}
                            className="text-sm px-3 py-1.5 rounded-full border transition-opacity duration-200 hover:opacity-70 disabled:opacity-40"
                            style={verdict === v ? ON[v] : OFF}>
                            {verdict === v ? (v === 'approved' ? '✓ Approved' : 'Needs work') : label}
                          </button>
                        </Tooltip>
                      ))}
                    </span>
                  </div>
                  {verdict === 'needs_work' && (
                    <div className="pl-11" onClick={(e) => e.stopPropagation()}>
                      <Tooltip text="What the developer should fix. It goes on the list for the developer, not on the client report.">
                        <VoiceInput value={notes[it.ref] ?? approvals[it.ref]?.note ?? ''} onChange={(v) => setNotes({ ...notes, [it.ref]: v })}
                          onBlur={() => { if ((notes[it.ref] ?? null) !== (approvals[it.ref]?.note ?? null)) setVerdict(it.ref, 'needs_work', notes[it.ref] || null); }}
                          label={`Note for the developer on ${it.ref}`} placeholder="Note for the developer (optional)" className={FIELD_CLASS} style={FIELD_STYLE} />
                      </Tooltip>
                    </div>
                  )}
                  {links.length > 0 && (
                    <ul className="space-y-2 pl-11">
                      {links.map((l) => {
                        const c = changeOf(l.pageId, l.changeId);
                        if (!c) return null;
                        return (
                          <React.Fragment key={`${l.pageId}-${l.changeId}`}>
                            {l.pageId !== g.pageId && <li className="text-xs list-none" style={{ color: 'var(--color-muted)' }}>On {pageName(l.pageId)}:</li>}
                            <ChangeCard c={c} />
                          </React.Fragment>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {/* ---- what is not reviewed line by line ---- */}
      <UnaskedAndOthers rows={rows} others={others} lines={lines} pageName={pageName} multi={(job.pages || []).length > 1} />
    </div>
  );
}

function UnaskedAndOthers({ rows, others, lines, pageName, multi }) {
  const [open, setOpen] = useState(null);
  const statusOf = Object.fromEntries(lines.map((l) => [l.ref, l]));
  const unasked = rows.map((r) => {
    const ids = new Set(r.results?.matches?.unrequestedChanges || []);
    return { pageId: r.pageId, changes: (r.results?.diff?.vsBaseline?.changes || []).filter((c) => ids.has(c.id) && !c.volatile) };
  }).filter((x) => x.changes.length);
  if (!unasked.length && !others.length) return null;
  return (
    <section className="rounded-2xl border p-5 space-y-3" style={CARD} data-guide="review-rest">
      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Not reviewed line by line</h2>
      {others.length > 0 && (
        <ul className="space-y-1 text-sm">
          {others.map((it) => {
            const st = statusOf[it.ref];
            return (
              <li key={it.id} className="flex gap-2" style={{ color: 'var(--color-muted)' }}>
                <span className="text-xs font-semibold w-8 shrink-0 pt-0.5" style={{ color: 'var(--color-primary)' }}>{it.ref}</span>
                <span className="flex-1"><Badge>{it.kind === 'keep' ? 'Keep' : 'Held over'}</Badge> {it.lineText}
                  {st && <span className="block text-xs" style={{ color: st.status === 'keepChanged' ? '#991b1b' : 'var(--color-muted)' }}>{LINE_STATUS[st.status]}</span>}</span>
              </li>
            );
          })}
        </ul>
      )}
      {unasked.map((x) => (
        <div key={x.pageId} className="space-y-2">
          <Tooltip text="Changes on this page that no request line is linked to. Link them in All changes if one does answer a line.">
            <button type="button" aria-expanded={open === x.pageId} onClick={() => setOpen(open === x.pageId ? null : x.pageId)}
              className="text-sm font-medium transition-opacity duration-200 hover:opacity-70" style={{ color: 'var(--color-text)' }}>
              {open === x.pageId ? '▾' : '▸'} Changes nobody asked for{multi ? ` on ${pageName(x.pageId)}` : ''} ({x.changes.length})
            </button>
          </Tooltip>
          {open === x.pageId && <ul className="space-y-2">{x.changes.map((c) => <ChangeCard key={c.id} c={c} />)}</ul>}
        </div>
      ))}
    </section>
  );
}
