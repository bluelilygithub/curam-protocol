import React, { useEffect } from 'react';
import { useIcon } from '../../providers/IconProvider';

export const TUTORIAL_SEEN_KEY = 'vault_fonts_tutorial_seen';

/** Deliberately extreme — this is a "watch this" demo, not a sensible
 * starting point for real work. The goal is to make it unmistakable, in
 * one glance, that the sliders do something real to the actual exported
 * font. A subtle example would fail the exact thing this modal exists to
 * prove after a real user couldn't tell the tool was working at all. */
export const DRAMATIC_DEMO = {
  family: 'Roboto',
  transforms: { stemThickness: 90, proportionalWidth: 135, extendAscDesc: 90, counterWidth: -40 },
  kerning: { enabledGroupIds: ['diagonal-caps', 'round-pairs'], balance: -80, advancedPairs: {} },
  effect: 'fire',
};

export default function FontTutorialModal({ onClose, onRunDemo }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  const getIcon = useIcon();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {getIcon('sparkles', { size: 16 })}
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>How This Works</h2>
          </div>
          <button onClick={onClose} className="hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>
            {getIcon('x', { size: 16 })}
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            Search a Google Font, drag four sliders and some kerning checkboxes, and get back a real,
            renamed, downloadable font file — not a mockup. To prove it, here's the fastest way to see it:
          </p>

          <div className="rounded-lg p-3 text-sm space-y-1.5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p style={{ color: 'var(--color-text)' }}><strong>This demo loads Roboto and cranks every setting to an extreme:</strong></p>
            <ul className="text-xs space-y-1" style={{ color: 'var(--color-muted)' }}>
              <li>• Stem Thickness 90, Proportional Width 135 — very bold, very wide</li>
              <li>• Extend Ascenders/Descenders 90 — tall, dramatic verticals</li>
              <li>• Counter Width -40 — bowls squeezed nearly shut</li>
              <li>• Kerning tightened hard on diagonal-cap and round-lowercase pairs</li>
              <li>• Fire text effect on top (CSS only — never touches the font file)</li>
            </ul>
            <p className="text-xs pt-1" style={{ color: 'var(--color-muted)' }}>
              Real settings for real work are much subtler than this — the point here is just to make the
              change unmistakable in one glance, not to be a sensible starting point.
            </p>
          </div>

          <p className="text-sm" style={{ color: 'var(--color-text)' }}>
            After that, dial it back to something usable: pick your own font from the browsable dropdown,
            adjust to taste (watch the real preview update after you pause), optionally pick a text effect,
            then give it a new name and download.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t" style={{ borderColor: 'var(--color-border)' }}>
          <button
            onClick={onClose}
            className="text-sm px-3 py-1.5 rounded hover:opacity-70 transition-all duration-200"
            style={{ color: 'var(--color-muted)' }}
          >
            Skip
          </button>
          <button
            onClick={() => { onRunDemo(); onClose(); }}
            className="text-sm px-4 py-1.5 rounded hover:opacity-70 transition-all duration-200"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            Show me →
          </button>
        </div>
      </div>
    </div>
  );
}
