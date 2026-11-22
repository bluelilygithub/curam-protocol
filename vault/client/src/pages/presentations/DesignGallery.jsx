import React from 'react';
import Tooltip from '../../components/Tooltip';
import { FIELD_STYLE } from './shared';

// The design-style gallery in Themes. Each card draws two sample slides from the server's own plan() geometry
// (GET /api/presentations/meta → designs[].samples), in the deck's current colours, so a card looks like the real slide.

const JUSTIFY = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };
const pct = (r) => ({ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` });

function withAlpha(hex, alpha) {
  if (alpha == null || alpha >= 1) return hex;
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}/.test(h)) return hex;
  const n = parseInt(h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** One sample slide at thumbnail size. Text sizes are px on a 720px-tall slide, so they scale with the card height (cqh). */
export function SlideThumb({ sample, colours }) {
  return (
    <div className="relative w-full overflow-hidden rounded-md border" style={{ aspectRatio: '16 / 9', containerType: 'size', background: colours.bg, borderColor: 'var(--color-border)' }} aria-hidden="true">
      {sample.shapes.map((s, i) => (
        <span
          key={`s${i}`}
          className="absolute flex items-center justify-center"
          style={{
            ...pct(s),
            background: s.fill ? withAlpha(colours[s.fill], s.alpha) : 'transparent',
            border: s.stroke ? `1px solid ${colours[s.stroke]}` : undefined,
            borderRadius: s.kind === 'ellipse' ? '50%' : undefined,
            clipPath: s.kind === 'tri' ? 'polygon(100% 0,100% 100%,0 100%)' : undefined,
          }}
        />
      ))}
      {sample.boxes.map((b, i) => (
        <span
          key={`b${i}`}
          className="absolute flex flex-col overflow-hidden leading-tight"
          style={{
            ...pct(b),
            color: colours[b.color] || colours.text,
            fontSize: `${(b.size / 7.2).toFixed(2)}cqh`,
            fontWeight: b.bold ? 700 : 400,
            fontStyle: b.italic ? 'italic' : undefined,
            textAlign: b.align || 'left',
            justifyContent: JUSTIFY[b.valign] || 'flex-start',
          }}
        >
          {b.bullets ? b.bullets.map((x) => <span key={x}>• {x}</span>) : b.text}
        </span>
      ))}
    </div>
  );
}

export default function DesignGallery({ designs, designId, colours, onPick }) {
  if (!designs?.length) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
      {designs.map((d) => {
        const on = designId === d.id;
        return (
          <Tooltip key={d.id} text={`${d.label}: ${d.blurb} Click to use it for this deck.`}>
            <button
              type="button"
              onClick={() => onPick(d.id)}
              aria-pressed={on}
              className="w-full rounded-xl border p-2.5 text-left transition-opacity duration-200 hover:opacity-70 space-y-2"
              style={{ ...FIELD_STYLE, borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: on ? 2 : 1 }}
            >
              <span className="grid grid-cols-2 gap-1.5">
                {d.samples.map((sample, i) => <SlideThumb key={i} sample={sample} colours={colours} />)}
              </span>
              <span className="block text-sm font-medium" style={{ color: on ? 'var(--color-primary)' : 'var(--color-text)' }}>{d.label}</span>
              <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{d.blurb}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}
