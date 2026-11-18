import React from 'react';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';

// Pieces shared by the Code Map views (CodeMapPage.jsx). The data is one stored analysis run (server/services/codeMap/index.js).

// Status colours are the fixed ones from client/DESIGN.md (outside the theme); "not applicable" uses the theme border.
export const STATUS_COLOR = { pass: '#16a34a', warn: '#f59e0b', fail: '#ef4444', na: 'var(--color-border)' };
export const STATUS_WORD = { pass: 'follows', warn: 'check', fail: 'gap', na: 'not applicable' };
export const SEV_COLOR = { high: '#ef4444', medium: '#f59e0b', low: 'var(--color-muted)' };
export const SEV_TIP = {
  high: 'High: fix soon. Each high finding is also raised in the Suggestions inbox, once per tool.',
  medium: 'Medium: worth fixing when you next work on the tool.',
  low: 'Low: housekeeping. Fine to leave until it gets in the way.',
};

export const scoreColor = (s) => (s >= 90 ? STATUS_COLOR.pass : s >= 70 ? STATUS_COLOR.warn : STATUS_COLOR.fail);
export const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-AU'));
export const toolLines = (t) => (t.locClient || 0) + (t.locServer || 0);

export const fmtWhen = (iso) => {
  try { return new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return String(iso || ''); }
};
export const fmtSecs = (ms) => (ms == null ? '' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export function Dot({ status, size = 10, label }) {
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="inline-block flex-shrink-0"
      style={{ width: size, height: size, borderRadius: 3, background: STATUS_COLOR[status] || STATUS_COLOR.na }}
    />
  );
}

export function Pill({ children, color, tip }) {
  const pill = (
    <span className="inline-block text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border" style={{ color: color || 'var(--color-muted)', borderColor: color || 'var(--color-border)' }}>
      {children}
    </span>
  );
  return tip ? <Tooltip text={tip}><span tabIndex={0}>{pill}</span></Tooltip> : pill;
}

export function LifecyclePill({ tool }) {
  if (tool.lifecycle && tool.lifecycle !== 'ga') {
    return <Pill color={tool.lifecycle === 'preview' ? '#f59e0b' : undefined} tip={tool.lifecycle === 'preview' ? 'Preview: shipped but not yet proven (FEATURE_LIFECYCLE).' : 'Parked: kept but not being worked on (FEATURE_LIFECYCLE).'}>{tool.lifecycle}</Pill>;
  }
  if (tool.defaultOn === false) return <Pill tip="Its feature flag is off by default.">off</Pill>;
  return null;
}

export function ScoreBar({ score }) {
  return (
    <Tooltip text={`Follows ${score}% of the rules that apply to it.`}>
      <div role="img" aria-label={`Rules score ${score}%`} className="h-1.5 rounded-full overflow-hidden border" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
        <span className="block h-full" style={{ width: `${score}%`, background: scoreColor(score) }} />
      </div>
    </Tooltip>
  );
}

/** file:line evidence rows. */
export function Evidence({ items, wrap = false }) {
  if (!items || !items.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {items.map((e, i) => (
        <li
          key={`${e.file}:${e.line}:${i}`}
          className={`font-mono text-xs rounded-md border px-2.5 py-1.5 ${wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre overflow-x-auto'}`}
          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
        >
          <span style={{ color: 'var(--color-primary)' }}>{e.file}{e.line ? `:${e.line}` : ''}</span>
          {e.text ? <span style={{ color: 'var(--color-muted)' }}>{`  ${e.text}`}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** A tool name as a chip that opens its detail panel. */
export function ToolChip({ tool, onOpen, label }) {
  if (!tool) return null;
  return (
    <Tooltip text={`Open ${tool.label}: its rules, APIs, links and files.`}>
      <button
        type="button"
        onClick={() => onOpen(tool.id)}
        className="text-xs px-2.5 py-0.5 rounded-full border hover:opacity-70 transition-opacity duration-200"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
      >
        {label || tool.label}
      </button>
    </Tooltip>
  );
}

/** A collapsible block: a small button that shows or hides its children. */
export function Collapsible({ label, tip, children, defaultOpen = false }) {
  const getIcon = useIcon();
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div>
      <Tooltip text={tip || (open ? 'Hide' : 'Show')}>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-xs flex items-center gap-1 hover:opacity-70 transition-opacity duration-200" style={{ color: 'var(--color-muted)' }}>
          {getIcon(open ? 'chevron-down' : 'chevron-right', { size: 13 })}{label}
        </button>
      </Tooltip>
      {open && children}
    </div>
  );
}

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
      {['pass', 'warn', 'fail', 'na'].map((s) => <span key={s} className="inline-flex items-center gap-1.5"><Dot status={s} />{STATUS_WORD[s]}</span>)}
    </div>
  );
}

export const card = { background: 'var(--color-surface)', borderColor: 'var(--color-border)' };
