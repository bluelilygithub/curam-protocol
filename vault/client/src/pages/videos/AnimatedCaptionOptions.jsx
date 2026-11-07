import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };

export const ANIMATED_CAPTION_DEFAULTS = {
  style: 'highlight', position: 'bottom', size: 'medium', text: '#ffffff', highlight: '#ffd400',
  box: false, boxColor: '#000000', fontSource: 'standard', useBrandColours: false,
};

/**
 * Choices for the animated look of Caption studio. `value` is the options object (see ANIMATED_CAPTION_DEFAULTS), `onChange` gets a new one.
 * Brand Kit colours and font are read on the server; this only says "use them".
 */
export default function AnimatedCaptionOptions({ value, onChange }) {
  const [brand, setBrand] = useState(null);
  const set = (patch) => onChange({ ...value, ...patch });

  useEffect(() => {
    let alive = true; // set inside the effect: a development double-mount must not leave it false
    api.get('/api/videos/animated-title/brand')
      .then((res) => (res.ok ? res.json() : null))
      .then((offer) => { if (alive && offer) setBrand(offer); })
      .catch(() => { /* no Brand Kit: the colour boxes still work */ });
    return () => { alive = false; };
  }, []);

  const fontChoices = [
    { id: 'standard', label: 'Standard font' },
    ...(brand?.fonts?.heading ? [{ id: 'brand-heading', label: 'My brand heading font' }] : []),
    ...(brand?.fonts?.body ? [{ id: 'brand-body', label: 'My brand body font' }] : []),
  ];
  const brandColours = value.useBrandColours && brand?.colours;
  const swatch = (key, fromBrand) => (brandColours ? fromBrand : value[key]);

  return (
    <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Animated look</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>How the words move</span>
          <Tooltip text={value.style === 'pop' ? 'The words appear one at a time, as they are spoken.' : 'The whole phrase is shown and the word being spoken lights up.'}>
            <select value={value.style} onChange={(e) => set({ style: e.target.value })} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
              <option value="highlight">Light up the spoken word</option>
              <option value="pop">Words pop in one at a time</option>
            </select>
          </Tooltip>
        </label>
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Position</span>
          <Tooltip text="Where the captions sit on the picture.">
            <select value={value.position} onChange={(e) => set({ position: e.target.value })} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
              <option value="bottom">Bottom</option>
              <option value="middle">Middle</option>
              <option value="top">Top</option>
            </select>
          </Tooltip>
        </label>
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Size</span>
          <Tooltip text="How big the words are, compared with the picture.">
            <select value={value.size} onChange={(e) => set({ size: e.target.value })} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
              <option value="small">Small</option>
              <option value="medium">Medium</option>
              <option value="large">Large</option>
            </select>
          </Tooltip>
        </label>
      </div>

      {brand?.hasColours && (
        <Tooltip text="Use your Brand Kit: its text colour for the words, its accent colour for the spoken word, and its main colour for the box.">
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={value.useBrandColours} onChange={(e) => set({ useBrandColours: e.target.checked })} />
            Use my Brand Kit colours
          </label>
        </Tooltip>
      )}
      <div className="grid grid-cols-3 gap-3" style={{ opacity: brandColours ? 0.6 : 1 }}>
        {[['Words', 'text', brand?.colours?.text, 'The colour of the captions.'], ['Spoken word', 'highlight', brand?.colours?.accent, 'The colour of the word being spoken.'], ['Box', 'boxColor', brand?.colours?.background, 'The colour of the box behind the words (only if the box is on).']].map(([label, key, fromBrand, tip]) => (
          <label key={key} className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
            <Tooltip text={brandColours ? 'These come from your Brand Kit. Untick "Use my Brand Kit colours" to choose your own.' : tip}>
              <input type="color" value={swatch(key, fromBrand) || value[key]} disabled={!!brandColours} onChange={(e) => set({ [key]: e.target.value })} className="w-full h-9 rounded-xl border cursor-pointer" style={FIELD} />
            </Tooltip>
          </label>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Tooltip text="Put a solid box behind the words. Off leaves the words on the picture with a dark edge so they stay readable.">
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
            <input type="checkbox" checked={value.box} onChange={(e) => set({ box: e.target.checked })} />
            Box behind the words
          </label>
        </Tooltip>
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Font</span>
          <Tooltip text={fontChoices.length > 1 ? 'The standard font, or a font file saved in your Brand Kit.' : 'The standard font. To use your own, open Graphics, then Brand Kit, read your website and tick its fonts.'}>
            <select value={value.fontSource} onChange={(e) => set({ fontSource: e.target.value })} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
              {fontChoices.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Tooltip>
        </label>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
        Captions with timings only: each caption's time is shared out over its words by length, so a word can light up a little early or late. Up to about 1,800 words.
      </p>
    </div>
  );
}
