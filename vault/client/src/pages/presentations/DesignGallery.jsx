import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { BTN_SECONDARY, FIELD_STYLE, SECONDARY_STYLE, readJson } from './shared';

// The design-style gallery in Themes. Each card draws two sample slides from the server's own plan() geometry
// (GET /api/presentations/meta → designs[].samples). When a deck is open it asks for the same plans again with the
// person's own slides (POST /api/presentations/design-samples), so the cards preview designs on their content.

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
  const shapes = sample.shapes || [];
  return (
    <div className="relative w-full overflow-hidden rounded-md border" style={{ aspectRatio: '16 / 9', containerType: 'size', background: colours.bg, borderColor: 'var(--color-border)' }} aria-hidden="true">
      {shapes.filter((s) => !s.overlay).map((s, i) => (
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
      {(sample.images || []).map((im, i) => (
        <span
          key={`im${i}`}
          className="absolute overflow-hidden rounded-sm"
          style={{ ...pct(im), background: 'linear-gradient(135deg, #94a3b8 0%, #cbd5e1 45%, #94a3b8 100%)', border: '1px solid var(--color-border)' }}
        >
          <span className="block w-full h-full opacity-40" style={{ background: 'radial-gradient(circle at 30% 30%, #fff 0%, transparent 45%)' }} />
        </span>
      ))}
      {(sample.charts || []).map((c, i) => (
        <span key={`c${i}`} className="absolute rounded-sm border" style={{ ...pct(c), borderColor: colours.muted }} />
      ))}
      {(sample.tables || []).map((t, i) => (
        <span key={`t${i}`} className="absolute rounded-sm border" style={{ ...pct(t), borderColor: colours.muted }} />
      ))}
      {shapes.filter((s) => s.overlay).map((s, i) => (
        <span
          key={`o${i}`}
          className="absolute"
          style={{ ...pct(s), background: s.fill ? withAlpha(colours[s.fill], s.alpha) : 'transparent' }}
        />
      ))}
      {(sample.boxes || []).map((b, i) => (
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

export default function DesignGallery({ designs, designId, colours, onPick, onApply, deck = null }) {
  const [live, setLive] = useState({});
  const designKey = (designs || []).map((d) => d.id).join(',');
  const deckKey = deck?.slides?.length ? JSON.stringify(deck) : '';

  // Rebuild thumbnails shortly after the deck changes. Geometry only: no asset bytes are sent or stored here.
  useEffect(() => {
    if (!deckKey || !designKey) { setLive({}); return undefined; }
    let current = true;
    const timer = setTimeout(() => {
      api.post('/api/presentations/design-samples', {
        deck,
        designIds: designKey.split(','),
      })
        .then((res) => readJson(res, 'Could not make the design previews.'))
        .then((data) => {
          if (!current) return;
          const next = {};
          for (const item of data.samples || []) next[item.id] = item.samples;
          setLive(next);
        })
        .catch(() => { if (current) setLive({}); });
    }, 350);
    return () => { current = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckKey, designKey]);

  if (!designs?.length) return null;
  const previewing = deck ? 'your slides' : 'sample slides';
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 2xl:grid-cols-3 gap-3">
      {designs.map((d) => {
        const on = designId === d.id;
        const samples = live[d.id] || d.samples || [];
        return (
          <div
            key={d.id}
            className="rounded-xl border p-2.5 space-y-2"
            style={{ ...FIELD_STYLE, borderColor: on ? 'var(--color-primary)' : 'var(--color-border)', borderWidth: on ? 2 : 1 }}
          >
            <Tooltip text={`${d.label}: ${d.blurb} These are ${previewing}. Click to preview this design in the panel on the right; nothing is applied until you press Use this design.`}>
              <button
                type="button"
                onClick={() => onPick?.(d.id)}
                aria-pressed={on}
                className="w-full text-left transition-opacity duration-200 hover:opacity-70 space-y-2"
              >
                <span className="grid grid-cols-2 gap-1.5">
                  {samples.map((sample, i) => <SlideThumb key={i} sample={sample} colours={colours} />)}
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium" style={{ color: on ? 'var(--color-primary)' : 'var(--color-text)' }}>{d.label}</span>
                  {on && <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>{deck ? 'Previewing' : 'In use'}</span>}
                </span>
                <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>{d.blurb}</span>
              </button>
            </Tooltip>
            {onApply && (
              <Tooltip text={`Apply ${d.label} to the current deck. Words, pictures and notes stay exactly the same.`}>
                <button
                  type="button"
                  onClick={() => onApply(d.id)}
                  disabled={designId === d.id}
                  className={BTN_SECONDARY}
                  style={SECONDARY_STYLE}
                >
                  {designId === d.id ? 'In use' : 'Use this design'}
                </button>
              </Tooltip>
            )}
          </div>
        );
      })}
    </div>
  );
}
