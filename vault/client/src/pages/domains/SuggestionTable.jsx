import React from 'react';
import Tooltip from '../../components/Tooltip';
import { tableNames, domainRows, socialRows, needHandles, columnSummary, TABLE_SLOTS } from './runAll.mjs';
import { ClearanceBadge } from './ClearancePanel';

// The side-by-side table: three candidates, one per column, each with its domain endings and its social handles, so they can be weighed
// at a glance. The columns start as the preferred name, the shortlist and then the best of the rest; each can be swapped for any other
// suggestion. Handles are checked on request (one lookup per name) and kept with the set. Status colours are outside the theme on purpose.

const STATE = {
  free: { label: 'Free', bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
  taken: { label: 'Taken', bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  unknown: { label: 'Unknown', bg: '#f5f5f5', fg: '#888', border: '#e5e5e5' },
  unchecked: { label: 'Not checked', bg: 'transparent', fg: '#999', border: 'transparent' },
};

function Cell({ state, href, title }) {
  const s = STATE[state] || STATE.unknown;
  const pill = (
    <span className="inline-block text-xs px-2 py-0.5 rounded-full font-medium" title={undefined}
      style={{ background: s.bg, color: s.fg, border: `1px solid ${s.border}` }}>{s.label}</span>
  );
  return (
    <td className="px-3 py-1.5 text-center align-middle" style={{ borderTop: '1px solid var(--color-border)' }} aria-label={title}>
      {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:opacity-70 transition-opacity">{pill}</a> : pill}
    </td>
  );
}

function RowLabel({ children, muted }) {
  return (
    <th scope="row" className="px-3 py-1.5 text-left text-xs font-medium whitespace-nowrap capitalize"
      style={{ borderTop: '1px solid var(--color-border)', color: muted ? 'var(--color-muted)' : 'var(--color-text)', background: 'var(--color-surface)', position: 'sticky', left: 0 }}>{children}</th>
  );
}

export default function SuggestionTable({ ws, setWs, onCheckHandles, checking }) {
  const names = tableNames(ws);
  if (!ws.suggestions || !ws.suggestions.length || !names.length) return null;
  const all = ws.suggestions.map((s) => s.name);
  const handles = (ws.results && ws.results.handles) || {};
  const dRows = domainRows(ws, names);
  const sRows = socialRows(handles, names);
  const missing = needHandles(handles, names);

  // Swap a column's name; if the chosen name is already in another column, the two trade places so no column is ever empty or doubled.
  const choose = (slot, name) => setWs((w) => {
    const cur = tableNames(w);
    const next = [...cur];
    const at = next.indexOf(name);
    if (at >= 0 && at !== slot) next[at] = next[slot];
    next[slot] = name;
    return { ...w, tableNames: next.slice(0, TABLE_SLOTS) };
  });

  return (
    <div className="space-y-3" data-guide="suggestion-table">
      <div className="overflow-x-auto rounded-xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-bg)' }}>
        <table className="w-full text-sm border-collapse" style={{ minWidth: 520 }}>
          <thead>
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium" style={{ color: 'var(--color-muted)', background: 'var(--color-surface)', position: 'sticky', left: 0 }}>Suggestion</th>
              {names.map((n, i) => {
                const sum = columnSummary(dRows, sRows, i);
                return (
                  <th key={`${i}-${n}`} scope="col" className="px-3 py-2 align-top text-left" style={{ background: 'var(--color-surface)', minWidth: 150 }}>
                    <Tooltip text="Swap this column for any other suggested name.">
                      <select value={n} onChange={(e) => choose(i, e.target.value)} aria-label={`Name for column ${i + 1}`}
                        className="w-full text-sm font-semibold rounded-lg border px-2 py-1 outline-none"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                        {all.map((a) => <option key={a} value={a}>{(ws.preferred === a ? '✓ ' : ws.shortlist.includes(a) ? '★ ' : '') + a}</option>)}
                      </select>
                    </Tooltip>
                    <p className="text-xs mt-1 font-normal" style={{ color: 'var(--color-muted)' }}>
                      {sum.domainsFree} of {sum.domainsTotal} endings free{sum.handlesFree !== null ? ` · ${sum.handlesFree} of ${sum.handlesTotal} handles free` : ''}
                    </p>
                    <div className="mt-1"><ClearanceBadge suggestion={ws.suggestions.find((s) => s.name === n)} handles={handles[n]} req={ws.requirements} compact /></div>
                    <Tooltip text="Make this the preferred name. The other tools run on it.">
                      <button onClick={() => setWs((w) => ({ ...w, preferred: w.preferred === n ? '' : n, results: w.preferred === n ? w.results : { ...(w.results.handles ? { handles: w.results.handles } : {}) }, errors: w.preferred === n ? w.errors : {}, runAt: w.preferred === n ? w.runAt : null }))}
                        aria-pressed={ws.preferred === n}
                        className="mt-1.5 text-xs px-2 py-1 rounded-lg border hover:opacity-70 transition-opacity font-normal"
                        style={ws.preferred === n ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: '#fff' } : { borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                        {ws.preferred === n ? '✓ Preferred' : 'Make preferred'}
                      </button>
                    </Tooltip>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            <tr><th colSpan={names.length + 1} className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)' }}>Domain names</th></tr>
            {dRows.map((row) => (
              <tr key={row.tld}>
                <RowLabel>.{row.tld}</RowLabel>
                {row.cells.map((c, i) => <Cell key={i} state={c.state} title={c.domain ? `${c.domain}: ${c.state}` : `.${row.tld} was not checked`} />)}
              </tr>
            ))}
            <tr><th colSpan={names.length + 1} className="px-3 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)' }}>Social media handles</th></tr>
            {sRows.length === 0 && (
              <tr><td colSpan={names.length + 1} className="px-3 py-3 text-xs" style={{ color: 'var(--color-muted)', borderTop: '1px solid var(--color-border)' }}>Handles have not been checked yet.</td></tr>
            )}
            {sRows.map((row) => (
              <tr key={row.platform}>
                <RowLabel>{row.platform}</RowLabel>
                {row.cells.map((c, i) => <Cell key={i} state={c.state} href={c.state === 'taken' ? c.url : null} title={`${row.platform}: ${STATE[c.state]?.label || ''}`} />)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {missing.length > 0 && (
          <Tooltip text="Look up whether each of these names is free on Instagram, X, TikTok, LinkedIn, YouTube, GitHub and more. One lookup per name.">
            <button onClick={() => onCheckHandles(names)} disabled={checking}
              className="px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {checking ? 'Checking handles…' : `Check social handles for ${missing.length === names.length ? 'these names' : missing.join(', ')}`}
            </button>
          </Tooltip>
        )}
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Free means not registered or claimed right now. It is not a trademark check. ✓ marks the preferred name, ★ the shortlist.</p>
      </div>
    </div>
  );
}
