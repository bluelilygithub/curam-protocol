import { memo } from 'react';
import type { ClipMeta } from '../bridge/types';
import type { Described } from '../lib/describe';
import { timeAgo } from '../lib/time';
import Icon from './Icon';

export const CARD_W = 172;
export const CARD_H = 150;
export const CARD_GAP = 10;

function host(url: string) { try { const u = new URL(url); return { h: u.hostname.replace(/^www\./, ''), rest: `${u.pathname === '/' ? '' : u.pathname}${u.search}` }; } catch { return { h: url, rest: '' }; } }

function Body({ meta, desc, thumb }: { meta: ClipMeta; desc: Described; thumb: string | undefined }) {
  if (meta.masked) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-1 text-shelf-muted">
        <Icon name="lock" size={22} />
        <span className="text-[11px]">Secret hidden</span>
      </div>
    );
  }
  if (meta.kind === 'image') {
    return thumb
      ? <img src={thumb} alt="" className="flex-1 min-h-0 w-full object-cover rounded-lg" draggable={false} />
      : <div className="flex-1 rounded-lg bg-shelf-text/10 animate-pulse" />;
  }
  if (meta.kind === 'svg') {
    return <div className="flex-1 flex items-center justify-center text-shelf-muted"><Icon name="svg" size={30} /></div>;
  }
  const c = desc.classified;
  if (c?.type === 'color' && c.color) {
    return (
      <div className="flex-1 flex flex-col gap-1.5 min-h-0">
        <div className="flex-1 rounded-lg border border-shelf-line" style={{ background: c.color }} />
        <span className="font-mono text-xs text-shelf-text">{c.color}</span>
      </div>
    );
  }
  if (c?.type === 'link' && c.url) {
    const { h, rest } = host(c.url);
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <div className="text-sm font-semibold text-shelf-accent break-all line-clamp-2">{h}</div>
        <div className="text-[11px] text-shelf-muted break-all line-clamp-3">{rest}</div>
      </div>
    );
  }
  if (c?.type === 'table' && c.table) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden text-[10.5px] leading-[1.35]">
        {c.table.rows.slice(0, 4).map((r, i) => (
          <div key={i} className={`flex gap-1.5 ${i === 0 ? 'font-semibold text-shelf-text' : 'text-shelf-muted'}`}>
            {r.slice(0, 3).map((cell, j) => <span key={j} className="flex-1 min-w-0 truncate">{cell}</span>)}
          </div>
        ))}
      </div>
    );
  }
  if (c?.type === 'code') {
    // code is clipped at the card's edge, not wrapped mid-word
    return <pre className="flex-1 min-h-0 overflow-hidden font-mono text-[10.5px] leading-[1.35] text-shelf-text whitespace-pre m-0">{meta.preview.split('\n').slice(0, 7).join('\n')}</pre>;
  }
  // an HTML card shows its words only: the contents of script and style blocks are dropped first, then the tags
  const words = meta.kind === 'html' ? meta.preview.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : meta.preview;
  return <div className="flex-1 min-h-0 overflow-hidden text-xs leading-[1.35] text-shelf-text whitespace-pre-wrap break-words line-clamp-5">{words || '(empty)'}</div>;
}

interface Props { meta: ClipMeta; desc: Described; selected: boolean; thumb: string | undefined; index: number; onSelect: (id: string) => void }

function ClipCard({ meta, desc, selected, thumb, index, onSelect }: Props) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      data-clip-id={meta.id}
      onClick={() => onSelect(meta.id)}
      style={{ width: CARD_W, height: CARD_H }}
      className={`group relative flex flex-col gap-1.5 p-2.5 text-left rounded-card border bg-shelf-card/75 transition-[box-shadow,border-color] focus:outline-none focus-visible:ring-2 focus-visible:ring-shelf-accent ${selected ? 'border-shelf-accent ring-1 ring-shelf-accent shadow-md' : 'border-shelf-line'}`}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-shelf-muted">
        <Icon name={meta.masked ? 'lock' : desc.type === 'color' ? 'color' : desc.type} size={13} />
        <span className="font-medium">{meta.masked ? 'Secret' : desc.label}</span>
        <span className="ml-auto">{timeAgo(meta.createdAt)}</span>
      </div>
      <Body meta={meta} desc={desc} thumb={thumb} />
      <div className="flex items-center text-[10px] text-shelf-muted/90">
        <span className="truncate">{meta.sourceApp ?? ''}</span>
        {index < 9 && <kbd className="ml-auto px-1 rounded border border-shelf-line text-[9px] leading-4">{index + 1}</kbd>}
      </div>
    </button>
  );
}

export default memo(ClipCard);
