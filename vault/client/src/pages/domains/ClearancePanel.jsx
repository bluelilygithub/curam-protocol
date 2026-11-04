import React from 'react';
import Tooltip from '../../components/Tooltip';
import { DOMAIN_ENDINGS } from './runAll.mjs';
import { REQUIRABLE_PLATFORMS, FILTER_MODES, clearance, ageLabel, isStale, freshness, oldestCheck } from './clearance.mjs';

// "What must be free?": the endings and social platforms a name has to have to be worth considering, a filter on the names, and Verify
// now (a live check of the names you are about to commit to). Also the small badge on each name saying whether it is clear.
// Status colours are deliberately outside the theme (see client/DESIGN.md).

const TONE = {
  clear: { label: 'Clear', bg: '#dcfce7', fg: '#15803d', border: '#bbf7d0' },
  blocked: { label: 'Blocked', bg: '#fef2f2', fg: '#dc2626', border: '#fecaca' },
  unconfirmed: { label: 'Not confirmed', bg: '#fef3c7', fg: '#b45309', border: '#fde68a' },
};

/** The badge under a name: clear, blocked (and why) or not confirmed (and what is missing), and how old the check is. */
export function ClearanceBadge({ suggestion, handles, req, compact }) {
  const c = clearance(suggestion, handles, req);
  const age = ageLabel(suggestion && suggestion.checkedAt);
  const fresh = freshness(suggestion);
  const stale = isStale(suggestion && suggestion.checkedAt);
  const source = fresh === 'live' ? 'live check' : fresh === 'saved' ? 'saved answer' : '';
  return (
    <div className={compact ? 'space-y-0.5' : 'space-y-1'}>
      {c.status !== 'none' && (
        <p className="text-xs">
          <span className="inline-block px-2 py-0.5 rounded-full font-medium" style={{ background: TONE[c.status].bg, color: TONE[c.status].fg, border: `1px solid ${TONE[c.status].border}` }}>{TONE[c.status].label}</span>
          {c.failed.length > 0 && <span className="ml-1.5" style={{ color: '#dc2626' }}>{c.failed.join(', ')}</span>}
          {c.status === 'unconfirmed' && <span className="ml-1.5" style={{ color: 'var(--color-muted)' }}>{c.unconfirmed.join(', ')}</span>}
        </p>
      )}
      <p className="text-xs" style={{ color: stale ? '#b45309' : 'var(--color-muted)' }}>
        {age ? `Domains checked ${age}${source ? ` (${source})` : ''}` : 'Domains: no check time'}{stale ? '. May be out of date.' : ''}
      </p>
    </div>
  );
}

export default function ClearancePanel({ ws, setWs, filter, setFilter, onVerify, verifying, targets, showFilter = true, shown, total }) {
  const req = ws.requirements || { tlds: [], platforms: [] };
  const has = req.tlds.length + req.platforms.length > 0;
  const toggle = (key, value) => setWs((w) => {
    const cur = (w.requirements && w.requirements[key]) || [];
    const next = cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value];
    return { ...w, requirements: { tlds: [], platforms: [], ...(w.requirements || {}), [key]: next } };
  });
  const oldest = oldestCheck((ws.suggestions || []).filter((s) => targets.includes(s.name)));
  const stale = targets.length > 0 && isStale(oldest);
  const credits = targets.length * (req.platforms.length ? 3 : 1);

  return (
    <div className="rounded-xl px-4 py-3 space-y-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }} data-guide="requirements">
      <div>
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>What must be free?</p>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Tick the endings and social platforms a name needs to have. A name is only Clear when every one is confirmed free.</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {DOMAIN_ENDINGS.map((t) => (
          <Tooltip key={t} text={`A name must have .${t} free to count as Clear.`}>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={req.tlds.includes(t)} onChange={() => toggle('tlds', t)} />.{t}
            </label>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {REQUIRABLE_PLATFORMS.map(([id, label]) => (
          <Tooltip key={id} text={`A name must be free on ${label} to count as Clear. This needs a social handle check.`}>
            <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={req.platforms.includes(id)} onChange={() => toggle('platforms', id)} />{label}
            </label>
          </Tooltip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {showFilter && (
          <Tooltip text="Choose which names to list. 'Meets all my requirements' needs endings or platforms ticked above, and the social handles checked.">
            <label className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text)' }}>
              Show
              <select value={filter} onChange={(e) => setFilter(e.target.value)} className="text-xs rounded-lg border px-2 py-1 outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                {FILTER_MODES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          </Tooltip>
        )}
        {showFilter && total > 0 && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Showing {shown} of {total}</span>}
        <Tooltip text={targets.length
          ? `Ask the registry and the social platforms again, right now, for ${targets.join(', ')}. Uses about ${credits} lookup credit${credits === 1 ? '' : 's'} (1 per name for domains${req.platforms.length ? ', 2 more per name for handles' : ''}).`
          : 'Make a name preferred or shortlist some first. Verify now checks those names again, live.'}>
          <button onClick={onVerify} disabled={verifying || !targets.length}
            className="px-3 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: '#fff' }}>
            {verifying ? 'Verifying…' : targets.length ? `Verify now (${targets.length} name${targets.length === 1 ? '' : 's'})` : 'Verify now'}
          </button>
        </Tooltip>
      </div>
      {stale && <p className="text-xs" style={{ color: '#b45309' }}>These names were last checked {oldest ? ageLabel(oldest) : 'at an unknown time'}. Availability changes, so press Verify now before you commit to one.</p>}
      {!has && showFilter && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing ticked yet, so no name is marked Clear or Blocked.</p>}
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Free means not registered or claimed right now. It is not a trademark or business-name check. Social handle checks are in beta: verify important ones on the platform itself.</p>
    </div>
  );
}
