import React from 'react';
import Tooltip from '../Tooltip';

// Small numbered source chips for the visual watchlist report. Each chip links to its source (new tab); the tip shows the title and
// site. Ids were checked against the source list on the server; one that still does not resolve is not drawn.
export default function CitationChips({ cites, sources }) {
  const list = (Array.isArray(cites) ? cites : []).map((n) => [n, sources?.[n - 1]]).filter(([, s]) => s?.url);
  if (!list.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle ml-1">
      {list.map(([n, s]) => (
        <Tooltip key={n} text={`[${n}] ${s.title || s.url}${s.source ? ` · ${s.source}` : ''}. Opens the source in a new tab.`}>
          <a
            href={s.url} target="_blank" rel="noopener noreferrer" aria-label={`Source ${n}: ${s.title || s.url}`}
            className="inline-flex items-center justify-center min-w-[1.25rem] h-4 px-1 rounded border text-[10px] leading-none tabular-nums hover:opacity-70 transition-opacity duration-200"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}
          >
            {n}
          </a>
        </Tooltip>
      ))}
    </span>
  );
}
