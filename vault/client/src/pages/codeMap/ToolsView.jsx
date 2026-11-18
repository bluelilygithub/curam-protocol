import React, { useMemo, useState } from 'react';
import Tooltip from '../../components/Tooltip';
import EmptyState from '../../components/EmptyState';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { Dot, LifecyclePill, ScoreBar, STATUS_WORD, card, fmt, toolLines } from './shared';

// Tools: one card per tool in the navigation, filtered by group and search, sorted by score, size or name.

const SORTS = [
  { id: 'score', label: 'Rules score (lowest first)' },
  { id: 'size', label: 'Size (largest first)' },
  { id: 'name', label: 'Name' },
];

export default function ToolsView({ data, rules, onOpenTool }) {
  const tools = data.tools || [];
  const [group, setGroup] = useState('All');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('score');
  const groups = useMemo(() => ['All', ...new Set(tools.map((t) => t.group))], [tools]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = tools.filter((t) => (group === 'All' || t.group === group)
      && (!needle || `${t.label} ${t.id} ${t.featureKey || ''} ${t.path || ''}`.toLowerCase().includes(needle)));
    const by = {
      score: (a, b) => a.score - b.score || b.fails - a.fails || a.label.localeCompare(b.label),
      size: (a, b) => toolLines(b) - toolLines(a),
      name: (a, b) => a.label.localeCompare(b.label),
    }[sort];
    return out.sort(by);
  }, [tools, group, q, sort]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3" data-tour="cm-tools-filter">
        <Tooltip text="Filter by name, id, feature flag or page path. You can also speak.">
          <div className="w-full sm:w-72"><VoiceInput value={q} onChange={setQ} placeholder="Filter tools" label="Filter tools" /></div>
        </Tooltip>
        <Tooltip text="Change the order of the cards.">
          <select
            value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort tools"
            className="px-3 py-2.5 rounded-xl border text-sm"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {SORTS.map((s) => <option key={s.id} value={s.id}>Sort: {s.label}</option>)}
          </select>
        </Tooltip>
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{list.length} of {tools.length}</span>
      </div>
      <div role="group" aria-label="Menu group" className="flex flex-wrap gap-1.5">
        {groups.map((g) => (
          <Tooltip key={g} text={g === 'All' ? 'Show tools from every menu group.' : `Show only the ${g} tools.`}>
            <button
              type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
              className="text-xs px-3 py-1 rounded-full border hover:opacity-70 transition-opacity duration-200"
              style={group === g
                ? { background: 'var(--color-primary)', borderColor: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }
                : { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {g}
            </button>
          </Tooltip>
        ))}
      </div>
      {!list.length ? (
        <EmptyState icon="search" title="No tools match" body="Clear the filter or pick another group." />
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
          {list.map((t) => (
            <Tooltip key={t.id} text={`Open ${t.label}: each rule with its evidence, its APIs, linked tools and files.`}>
              <button
                type="button" onClick={() => onOpenTool(t.id)}
                className="text-left rounded-xl border p-3.5 space-y-2 hover:opacity-70 transition-opacity duration-200"
                style={card}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{t.label}</span>
                  <LifecyclePill tool={t} />
                </div>
                <div className="text-xs truncate" style={{ color: 'var(--color-muted)' }}>
                  {t.group}{t.featureKey ? <> · <code>{t.featureKey}</code></> : null}{t.adminOnly ? ' · admin' : ''}
                </div>
                <ScoreBar score={t.score} />
                <div className="flex flex-wrap gap-3 text-xs tabular-nums" style={{ color: 'var(--color-muted)' }}>
                  <span>{t.score}% rules</span><span>{fmt(toolLines(t))} lines</span><span>{(t.tests || []).length} tests</span>
                </div>
                <div className="flex flex-wrap gap-[3px]" aria-label={`${t.fails} gaps, ${t.warns} to check`}>
                  {rules.map((r) => {
                    const c = (t.checks || {})[r.id] || { status: 'na' };
                    return <Dot key={r.id} status={c.status} label={`${r.label}: ${STATUS_WORD[c.status] || c.status}`} />;
                  })}
                </div>
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}
