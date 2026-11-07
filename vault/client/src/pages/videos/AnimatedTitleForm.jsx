import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

const FIELD = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const LAYOUTS = [
  { id: 'rise', label: 'Slide in from the left', tip: 'The headline rises into place on the left, a line draws across under it, then the supporting line follows.' },
  { id: 'centre', label: 'Centred', tip: 'The headline and supporting line fade in at the centre of the screen.' },
];
const SHAPES = [
  { id: '16:9', label: 'Widescreen (16:9)' },
  { id: '9:16', label: 'Tall (9:16, Reels and Stories)' },
  { id: '1:1', label: 'Square (1:1)' },
];

/**
 * The animated look of Title card. It only collects the choices and hands them to `onBuild(spec)`; the page runs the background job.
 * `mode` is 'overlay' (the title is laid over the person's video between two times: no shape, length or background, the picture is
 * darkened instead) or 'clip' (a separate title video: shape, length, sharpness and a background). Brand Kit colours, logo and font
 * are read on the server: this form only says "use them".
 */
export default function AnimatedTitleForm({ onBuild, busy, mode = 'clip' }) {
  const overlay = mode === 'overlay';
  const [headline, setHeadline] = useState('');
  const [subline, setSubline] = useState('');
  const [layout, setLayout] = useState('rise');
  const [shape, setShape] = useState('16:9');
  const [quality, setQuality] = useState('hd');
  const [seconds, setSeconds] = useState(5);
  const [gradient, setGradient] = useState(true);
  const [background, setBackground] = useState('#1f2a37');
  const [text, setText] = useState('#ffffff');
  const [accent, setAccent] = useState('#f4c9a8');
  const [dimPct, setDimPct] = useState(35);
  const [dimColor, setDimColor] = useState('#000000');
  const [useBrandColours, setUseBrandColours] = useState(false);
  const [useLogo, setUseLogo] = useState(false);
  const [fontSource, setFontSource] = useState('standard');
  const [brand, setBrand] = useState(null); // what the Brand Kit offers; null while loading or unavailable

  useEffect(() => {
    let alive = true; // set inside the effect: a development double-mount must not leave it false
    api.get('/api/videos/animated-title/brand')
      .then((res) => (res.ok ? res.json() : null))
      .then((offer) => {
        if (!alive || !offer) return;
        setBrand(offer);
        if (offer.hasColours) setUseBrandColours(true);
      })
      .catch(() => { /* no Brand Kit: the colour boxes still work */ });
    return () => { alive = false; };
  }, []);

  const fontChoices = [
    { id: 'standard', label: 'Standard font' },
    ...(brand?.fonts?.heading ? [{ id: 'brand-heading', label: 'My brand heading font' }] : []),
    ...(brand?.fonts?.body ? [{ id: 'brand-body', label: 'My brand body font' }] : []),
  ];
  const brandOn = useBrandColours && brand?.colours;
  // the colour boxes: in a separate clip the first is the background; over a video it is the colour the picture is darkened with
  const boxes = [
    overlay
      ? ['Darken with', dimColor, setDimColor, null, 'The colour the picture is darkened with behind the title. Brand Kit colours do not change this one.']
      : ['Background', background, setBackground, 'background', 'The colour behind the title.'],
    ['Text', text, setText, 'text', 'The colour of the headline and the supporting line.'],
    ['Line', accent, setAccent, 'accent', 'The colour of the line that draws across under the headline.'],
  ];

  const submit = () => onBuild({
    headline, subline, layout, shape, quality, seconds, gradient, background, text, accent, dimPct, dimColor, useBrandColours, useLogo, fontSource,
  });

  return (
    <div className="space-y-3">
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Headline</span>
        <Tooltip text="The big line of the title, up to 80 characters.">
          <VoiceInput value={headline} maxLength={80} onChange={setHeadline} placeholder="Spring Collection" label="Headline" />
        </Tooltip>
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Supporting line (optional)</span>
        <Tooltip text="A smaller line under the headline, such as a name, a date or a web address. A line draws across between the two.">
          <VoiceInput value={subline} maxLength={120} onChange={setSubline} placeholder="Margot Cairnes Interiors" label="Supporting line" />
        </Tooltip>
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>How it moves</span>
          <Tooltip text={LAYOUTS.find((l) => l.id === layout)?.tip || ''}>
            <select value={layout} onChange={(e) => setLayout(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
              {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </Tooltip>
        </label>
        {overlay ? (
          <label className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Darken the picture: {dimPct}%</span>
            <Tooltip text="How much the video is darkened behind the title so the words are easy to read. 0 keeps the picture in full colour.">
              <input type="range" min={0} max={80} step={5} value={dimPct} onChange={(e) => setDimPct(Number(e.target.value))} className="w-full" />
            </Tooltip>
          </label>
        ) : (
          <>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Shape</span>
              <Tooltip text="The shape of the picture. Choose tall for Reels and Stories, square for a feed post.">
                <select value={shape} onChange={(e) => setShape(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
                  {SHAPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Length: {seconds} seconds</span>
              <Tooltip text="How long the title stays on screen, from 2 to 8 seconds. It fades out at the end.">
                <input type="range" min={2} max={8} step={0.5} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} className="w-full" />
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Sharpness</span>
              <Tooltip text="Standard is quicker and plenty for social media. Full HD is sharper but takes longer to make.">
                <select value={quality} onChange={(e) => setQuality(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
                  <option value="hd">Standard (720p)</option>
                  <option value="full">Full HD (1080p)</option>
                </select>
              </Tooltip>
            </label>
          </>
        )}
      </div>

      <div className="space-y-2">
        {brand?.hasColours && (
          <Tooltip text={overlay ? 'Use the colours saved in your Brand Kit: its text colour for the words and its accent for the line.' : 'Use the colours saved in your Brand Kit: its main colour behind the title, its text colour for the words and its accent for the line.'}>
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={useBrandColours} onChange={(e) => setUseBrandColours(e.target.checked)} />
              Use my Brand Kit colours
            </label>
          </Tooltip>
        )}
        <div className="grid grid-cols-3 gap-3">
          {boxes.map(([label, value, setter, key, tip]) => {
            const fromBrand = key && brandOn ? brand.colours[key] : null;
            return (
              <label key={label} className="block space-y-1" style={{ opacity: fromBrand ? 0.6 : 1 }}>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
                <Tooltip text={fromBrand ? 'These come from your Brand Kit. Untick "Use my Brand Kit colours" to choose your own.' : tip}>
                  <input type="color" value={fromBrand || value} disabled={!!fromBrand} onChange={(e) => setter(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={FIELD} />
                </Tooltip>
              </label>
            );
          })}
        </div>
        {!overlay && (
          <Tooltip text="Fade the background from your colour to a slightly lighter shade of it. Off gives one flat colour.">
            <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={gradient} onChange={(e) => setGradient(e.target.checked)} />
              Soft gradient background
            </label>
          </Tooltip>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Font</span>
          <Tooltip text={fontChoices.length > 1 ? 'The standard font, or a font file saved in your Brand Kit.' : 'The standard font. To use your own, open Graphics, then Brand Kit, read your website and tick its fonts.'}>
            <select value={fontSource} onChange={(e) => setFontSource(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={FIELD}>
              {fontChoices.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </Tooltip>
        </label>
        {brand?.hasLogo && (
          <Tooltip text="Show the logo saved in your Brand Kit above the headline.">
            <label className="flex items-center gap-2 text-xs cursor-pointer self-end pb-2" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={useLogo} onChange={(e) => setUseLogo(e.target.checked)} />
              Add my logo
            </label>
          </Tooltip>
        )}
      </div>

      <Tooltip text={overlay ? 'Lay the animated title over your video between the start and end times above. Your original video is not changed, and its sound is kept.' : 'Make the title video. It takes about 10 to 30 seconds. You can watch it, download it, or use it in another tool.'}>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: 'var(--color-primary)' }}
        >
          {overlay ? 'Add animated title to my video' : 'Make animated title'}
        </button>
      </Tooltip>
    </div>
  );
}
