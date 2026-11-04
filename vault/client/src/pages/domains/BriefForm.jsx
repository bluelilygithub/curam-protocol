import React, { useState, useEffect } from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { ENDINGS, PLATFORMS, STYLES, TONES, splitWords } from './constants.mjs';
import { toneWords } from './briefSummary.mjs';

// Step 1: the brief. A short guided form (a microphone on every text field). Everything here is saved with the set and is shown as a
// plain sentence above the names, so it is always clear what they were made for.

const FIELD_LABEL = 'block text-xs font-medium mb-1';
const mute = { color: 'var(--color-muted)' };
const card = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' };

function Check({ checked, onChange, children, tip }) {
  return (
    <Tooltip text={tip}>
      <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={checked} onChange={onChange} />{children}
      </label>
    </Tooltip>
  );
}

export default function BriefForm({ brief, setBrief, onGenerate, generating, config, submitLabel = 'Generate names', compact = false }) {
  // include and avoid words are typed as text, kept as lists: the text is held here so a half-typed comma is not undone
  const [includeText, setIncludeText] = useState((brief.include || []).join(', '));
  const [avoidText, setAvoidText] = useState((brief.avoid || []).join(', '));
  useEffect(() => { setIncludeText((brief.include || []).join(', ')); setAvoidText((brief.avoid || []).join(', ')); }, [brief.include && brief.include.join('|'), brief.avoid && brief.avoid.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch) => setBrief((b) => ({ ...b, ...patch }));
  const toggle = (key, value) => setBrief((b) => {
    const cur = b[key] || [];
    return { ...b, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] };
  });
  const toggleReq = (key, value) => setBrief((b) => {
    const cur = (b.required && b.required[key]) || [];
    return { ...b, required: { ...(b.required || {}), [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } };
  });
  const ready = !!(brief.what.trim() || brief.own.trim());
  const credits = config && config.generate ? config.generate.credits : 40;
  const tone = toneWords(brief.tone);

  return (
    <div className="space-y-5 xl:grid xl:grid-cols-2 xl:gap-x-8 xl:space-y-0 xl:items-start" data-guide="brief">
      <div className="space-y-5">
      <div className="space-y-3">
        <div>
          <label className={FIELD_LABEL} style={mute}>What is it?</label>
          <Tooltip text="Describe the business, product or project in a sentence or two. Plain English is best: what it does and what it feels like.">
            <div data-guide="describe-business">
              <VoiceInput type="textarea" rows={3} append value={brief.what} onChange={(v) => set({ what: v })} label="What it is"
                placeholder="e.g. A website and book celebrating the life and work of a Tasmanian painter" />
            </div>
          </Tooltip>
        </div>
        <div>
          <label className={FIELD_LABEL} style={mute}>Who is it for?</label>
          <Tooltip text="Who will use it or read it. It helps the names fit the audience.">
            <div><VoiceInput value={brief.who} onChange={(v) => set({ who: v })} label="Who it is for" placeholder="e.g. art lovers, galleries and Tasmanian history readers" /></div>
          </Tooltip>
        </div>
        <div>
          <label className={FIELD_LABEL} style={mute}>Names I already have (optional, one per line)</label>
          <Tooltip text="A book title, a person, an existing business. Each is always included and checked exactly as written, first, with and without a leading 'The', and marked 'Your name'.">
            <div data-guide="own-names">
              <VoiceInput type="textarea" rows={2} append value={brief.own} onChange={(v) => set({ own: v })} label="Names I already have"
                placeholder={'e.g. The Staircase Suitcase\nDorothy Stoner'} />
            </div>
          </Tooltip>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label className={FIELD_LABEL} style={mute}>Words or themes to include</label>
          <Tooltip text="Words the names should work in or hint at, separated by commas.">
            <div><VoiceInput value={includeText} onChange={(v) => { setIncludeText(v); set({ include: splitWords(v) }); }} label="Words to include" placeholder="e.g. harbour, light" /></div>
          </Tooltip>
        </div>
        <div>
          <label className={FIELD_LABEL} style={mute}>Words to avoid</label>
          <Tooltip text="Words no name may contain, separated by commas.">
            <div><VoiceInput value={avoidText} onChange={(v) => { setAvoidText(v); set({ avoid: splitWords(v) }); }} label="Words to avoid" placeholder="e.g. wine, cheap" /></div>
          </Tooltip>
        </div>
      </div>

      </div>
      <div className="space-y-5">
      <div className="rounded-xl p-4 space-y-3" style={card} data-guide="tone">
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Tone {tone.length ? <span className="font-normal" style={mute}>· {tone.join(', ')}</span> : <span className="font-normal" style={mute}>· neutral</span>}</p>
        {TONES.map(([key, low, high]) => (
          <Tooltip key={key} text={`Slide towards ${low} or ${high}. The middle means no preference.`}>
            <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--color-text)' }}>
              <span className="w-24 text-right capitalize">{low}</span>
              <input type="range" min="1" max="5" step="1" value={brief.tone[key]} aria-label={`${low} to ${high}`}
                onChange={(e) => setBrief((b) => ({ ...b, tone: { ...b.tone, [key]: Number(e.target.value) } }))}
                className="flex-1" style={{ accentColor: 'var(--color-primary)' }} />
              <span className="w-24 capitalize">{high}</span>
            </div>
          </Tooltip>
        ))}
      </div>

      <div className="space-y-2" data-guide="styles">
        <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Naming style <span className="font-normal" style={mute}>· choose any, or none for a mix</span></p>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {STYLES.map(([id, label, means]) => (
            <Check key={id} checked={brief.styles.includes(id)} onChange={() => toggle('styles', id)} tip={`${label}: ${means}.`}>{label}</Check>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-4 space-y-3" style={card} data-guide="requirements">
        <div>
          <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>What must be free?</p>
          <p className="text-xs" style={mute}>A name with a required ending already taken is dropped before you see it. Required social platforms are checked when you check your shortlist.</p>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {ENDINGS.map((t) => (
            <Check key={t} checked={brief.required.tlds.includes(t)} onChange={() => toggleReq('tlds', t)} tip={`A name must have .${t} free to be shown.`}>.{t}</Check>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {PLATFORMS.map(([id, label]) => (
            <Check key={id} checked={brief.required.platforms.includes(id)} onChange={() => toggleReq('platforms', id)} tip={`A name must be free on ${label} to count as ready. This is checked for your shortlist.`}>{label}</Check>
          ))}
        </div>
      </div>

      </div>
      <div className="xl:col-span-2 xl:mt-5">
      <div className="flex flex-wrap items-center gap-3">
        <Tooltip text={`The AI writes about ${config?.generate?.wide || 180} ideas, code throws most away, and about ${config?.generate?.domainChecks || 40} are checked for your required endings. Uses about ${credits} domain lookup credits.`}>
          <button onClick={onGenerate} disabled={generating || !ready} data-guide="generate"
            className="px-5 py-2 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70 disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-on-primary, #fff)' }}>
            {generating ? 'Working…' : submitLabel}
          </button>
        </Tooltip>
        <span className="text-xs" style={mute}>About {credits} lookup credits{compact ? '' : ' · takes up to a minute'}</span>
        {!ready && <span className="text-xs" style={mute}>Say what it is, or give a name you already have.</span>}
      </div>
      </div>
    </div>
  );
}
