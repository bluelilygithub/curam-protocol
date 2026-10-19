import React from 'react';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { ANIMATION_PRESETS, MEDIA_OPTIONS, STATE_OPTIONS, tokenRef, toHex } from './editModel.mjs';
import { FONT_OPTIONS, SHADOW_OPTIONS, TEXT_ALIGN_OPTIONS, TEXT_TRANSFORM_OPTIONS } from './pageHelpers.mjs';
import { FIELD, PRIMARY, Status } from './RestylePanels.jsx';

// The tool panels that change the one thing clicked in the preview (or everything it is scoped to): Ask in plain English, What it
// applies to, Text, Text enhancements, Animation and Box. RestylePage.jsx owns the state and the handlers; these only show controls.
// Plain words only, no CSS jargon.

const MUTED = { color: 'var(--color-muted)' };
const SMALL_BTN = 'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50';
const OUTLINE = { borderColor: 'var(--color-border)', color: 'var(--color-text)' };

// A labelled control with a hover tip on its label.
function Field({ label, tip, children }) {
  return (
    <label className="flex flex-col gap-1 text-xs" style={MUTED}>
      <Tooltip text={tip}><span className="w-fit">{label}</span></Tooltip>
      {children}
    </label>
  );
}

/** "Contrast 7.2 to 1: easy to read" for the text of the clicked item. */
function ContrastBadge({ info }) {
  if (!info) return null;
  const good = info.passes;
  return (
    <Tooltip text={`Text ${info.fg} on ${info.bg}. ${info.large ? 'Large text needs 3 to 1.' : 'Normal text needs 4.5 to 1.'} This is the standard for text that most people, including people with weak eyesight, can read.`}>
      <p className="text-xs rounded-lg border px-2 py-1.5" style={{ borderColor: good ? '#bbf7d0' : '#fde68a', background: good ? '#ecfdf5' : '#fffbeb', color: good ? '#047857' : '#b45309' }} role="status">
        {good ? `Easy to read: contrast ${info.ratio} to 1.` : `Hard to read: contrast ${info.ratio} to 1, it needs ${info.required}.`}
      </p>
    </Tooltip>
  );
}

function SizePicks({ list, property, explanation, ctrl, onQuick }) {
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {list.map((size) => (
        <Tooltip key={size} text={`Used in your files: ${size}`}>
          <button type="button" className="px-1.5 py-0.5 rounded border text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
            onClick={() => onQuick(property, size, explanation, { [property]: parseFloat(size) || ctrl[property] })}>{size}</button>
        </Tooltip>
      ))}
    </div>
  );
}

/** Quick picks for a colour: the brand colours first, then the colours the page already uses. */
function ColourPicks({ property, explanation, detected, tokens, onQuick, onBrand }) {
  const brand = tokens.filter((t) => t.kind === 'color');
  if (!brand.length && !detected.colors.length) return null;
  return (
    <div className="mt-1 space-y-1">
      {brand.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="text-[11px]">Brand:</span>
          {brand.map((t) => (
            <Tooltip key={t.id} text={`Use the brand colour “${t.name}”. It follows if you change that colour later.`}>
              <button type="button" aria-label={`Use brand colour ${t.name}`} className="w-5 h-5 rounded border" style={{ background: t.value, borderColor: 'var(--color-text)' }} onClick={() => onBrand(property, t)} />
            </Tooltip>
          ))}
        </div>
      )}
      {detected.colors.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {detected.colors.map((c) => (
            <Tooltip key={c} text={`Used in your files: ${c}`}>
              <button type="button" aria-label={`Use ${c}`} className="w-5 h-5 rounded border" style={{ background: c, borderColor: 'var(--color-border)' }}
                onClick={() => onQuick(property, c, explanation, { [property]: toHex(c) || c })} />
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

export function AskPanel({ value, onChange, onAsk, busy, status }) {
  return (
    <section>
      <p className="text-xs mb-2" style={MUTED}>Describe what you want done to the thing you clicked. Type it, or tap the microphone and say it.</p>
      <VoiceInput type="textarea" append rows={4} value={value} onChange={onChange} placeholder="e.g. make this bigger and give it rounded corners" label="Your request, in plain English" />
      <div className="mt-2">
        <Tooltip text="Turn your words into changes to the look of the clicked item. They follow the screen size and look chosen in What it applies to, and you can undo them.">
          <button className="px-3 py-1.5 rounded-lg text-sm font-semibold transition-opacity duration-200 hover:opacity-80 disabled:opacity-45" style={PRIMARY} disabled={busy || !value.trim()} onClick={onAsk}>{busy ? 'Asking…' : 'Ask for this change'}</button>
        </Tooltip>
      </div>
      <Status status={status} />
    </section>
  );
}

export function ScopePanel({ scopeOptions, scope, onScope, media, onMedia, state, onState, onReset }) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>What it applies to</h3>
        <label className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--color-text)' }}>
          <input type="radio" name="editScope" checked={!scope.selector} onChange={() => onScope('', '')} />
          Just this element
        </label>
        {scopeOptions.length > 0 ? scopeOptions.map((opt) => (
          <label key={opt.selector} className="flex items-center gap-1.5 text-xs mb-1" style={{ color: 'var(--color-text)' }}>
            <input type="radio" name="editScope" checked={scope.selector === opt.selector} onChange={() => onScope(opt.selector, opt.label)} />
            {opt.label}
          </label>
        )) : <p className="text-xs" style={MUTED}>This element (and nothing around it) has a class, so it can only be edited on its own.</p>}
        {scope.selector && <p className="text-xs mt-1" style={{ color: '#b3452c' }}>Changes will apply to every matching element on the page, not just this one. They are outlined in amber.</p>}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Screen sizes and look</h3>
        <Field label="Applies on" tip="Make the change on every screen, or only on tablets and smaller, or only on phones. Use the Desktop, Tablet and Phone buttons above the preview to see them.">
          <select className="rounded-lg border p-1.5" style={FIELD} value={media} onChange={(e) => onMedia(e.target.value)}>
            {MEDIA_OPTIONS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        <Field label="Which look" tip="Change how it normally looks, or how it looks when the mouse is over it (a button turning darker), or when it has been selected with the keyboard (focus). The preview shows that look while you edit it.">
          <select className="rounded-lg border p-1.5" style={FIELD} value={state} onChange={(e) => onState(e.target.value)}>
            {STATE_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </Field>
        {(media || state) && <p className="text-xs" style={MUTED}>Changes you make now are only for {[state ? STATE_OPTIONS.find((s) => s.id === state).label.toLowerCase() : '', media ? MEDIA_OPTIONS.find((m) => m.id === media).label.toLowerCase() : ''].filter(Boolean).join(', ')}.</p>}
      </div>

      <Tooltip text="Take back every change made to this item (or every matching item), on every screen size and look, back to how the page had it.">
        <button type="button" className={SMALL_BTN} style={OUTLINE} onClick={onReset}>Reset {scope.selector ? scope.label.replace(/^Every/, 'every') : 'this element'}</button>
      </Tooltip>
    </section>
  );
}

export function TextPanel({ ctrl, onCtrl, onQuick, onBrand, detected, tokens, contrast }) {
  const fontTokens = tokens.filter((t) => t.kind === 'font');
  return (
    <section className="flex flex-col gap-3">
      <Field label="Font" tip="The typeface of the clicked item. Brand fonts and fonts your own files already use are listed too.">
        <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.fontFamily} onChange={(e) => onCtrl('fontFamily', e.target.value, null, e.target.value ? 'Changed the font.' : 'Changed the font back to the default.')}>
          {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          {fontTokens.map((t) => <option key={t.id} value={tokenRef(t)}>Brand font: {t.name}</option>)}
          {detected.fonts.filter((f) => !FONT_OPTIONS.some((o) => o.value === f.value)).map((f) => <option key={f.value} value={f.value}>{f.label} (used in your files)</option>)}
        </select>
      </Field>
      <Field label="Size" tip="How big the text is, in pixels.">
        <input type="range" min={8} max={96} step={1} value={ctrl.fontSize} onChange={(e) => onCtrl('fontSize', Number(e.target.value), 'px', `Changed the text size to ${e.target.value}px.`)} />
        <span style={{ color: 'var(--color-text)' }}>{ctrl.fontSize}px</span>
        <SizePicks list={detected.sizes} property="fontSize" explanation="Changed the text size." ctrl={ctrl} onQuick={onQuick} />
      </Field>
      <Field label="Weight" tip="How light or bold the text is.">
        <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.fontWeight} onChange={(e) => onCtrl('fontWeight', e.target.value, null, 'Changed how bold the text is.')}>
          <option value="400">Normal</option><option value="600">Semi-bold</option><option value="700">Bold</option><option value="300">Light</option>
        </select>
      </Field>
      <Field label="Text color" tip="The colour of the text. Your brand colours come first, then the colours your files already use.">
        <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.color} onChange={(e) => onCtrl('color', e.target.value, null, 'Changed the text color.')} />
        <ColourPicks property="color" explanation="Changed the text color." detected={detected} tokens={tokens} onQuick={onQuick} onBrand={onBrand} />
      </Field>
      <ContrastBadge info={contrast} />
      <Field label="Space between lines" tip="How much room there is between lines of text.">
        <input type="range" min={0.8} max={3} step={0.1} value={ctrl.lineHeight} onChange={(e) => onCtrl('lineHeight', Number(e.target.value), null, 'Changed the spacing between lines of text.')} />
        <span style={{ color: 'var(--color-text)' }}>{ctrl.lineHeight}</span>
      </Field>
    </section>
  );
}

export function EnhancePanel({ ctrl, onCtrl }) {
  return (
    <section className="flex flex-col gap-3">
      <Field label="Capitalization" tip="Show the text as normal, in ALL CAPS, all lowercase or Title Case, without retyping it.">
        <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.textTransform} onChange={(e) => onCtrl('textTransform', e.target.value, null, e.target.value === 'none' ? 'Changed the text capitalization back to normal.' : 'Changed the text capitalization.')}>
          {TEXT_TRANSFORM_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label="Space between letters" tip="Pull the letters closer together or spread them apart.">
        <input type="range" min={-2} max={12} step={0.5} value={ctrl.letterSpacing} onChange={(e) => onCtrl('letterSpacing', Number(e.target.value), 'px', 'Changed the spacing between letters.')} />
        <span style={{ color: 'var(--color-text)' }}>{ctrl.letterSpacing}px</span>
      </Field>
      <Field label="Alignment" tip="Line the text up on the left, centre or right, or spread it to fill the width.">
        <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.textAlign} onChange={(e) => onCtrl('textAlign', e.target.value, null, 'Changed the text alignment.')}>
          {TEXT_ALIGN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    </section>
  );
}

export function AnimationPanel({ ctrl, onAnimation }) {
  return (
    <section className="flex flex-col gap-3">
      <Field label="Effect" tip="A short movement when the item appears: fade in, slide up, pop in, pulse or bounce.">
        <select className="rounded-lg border p-1.5" style={FIELD} value={ctrl.animation} onChange={(e) => onAnimation(e.target.value, e.target.selectedOptions[0]?.text || '')}>
          {ANIMATION_PRESETS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <p className="text-xs" style={MUTED}>The movement is included when you export the CSS.</p>
    </section>
  );
}

export function BoxPanel({ ctrl, onCtrl, onQuick, onBrand, detected, tokens, contrast }) {
  return (
    <section className="flex flex-col gap-3">
      <Field label="Background color" tip="The colour behind the item. Your brand colours come first, then the colours your files already use.">
        <input type="color" style={{ width: '100%', height: 32, border: '1px solid var(--color-border)', borderRadius: 6 }} value={ctrl.backgroundColor} onChange={(e) => onCtrl('backgroundColor', e.target.value, null, 'Changed the background color.')} />
        <ColourPicks property="backgroundColor" explanation="Changed the background color." detected={detected} tokens={tokens} onQuick={onQuick} onBrand={onBrand} />
      </Field>
      <ContrastBadge info={contrast} />
      <Field label="Rounded corners" tip="How rounded the corners of the item are, in pixels.">
        <input type="range" min={0} max={60} step={1} value={ctrl.borderRadius} onChange={(e) => onCtrl('borderRadius', Number(e.target.value), 'px', 'Changed the rounded corners.')} />
        <span style={{ color: 'var(--color-text)' }}>{ctrl.borderRadius}px</span>
        <SizePicks list={detected.radii} property="borderRadius" explanation="Changed the rounded corners." ctrl={ctrl} onQuick={onQuick} />
      </Field>
      <Field label="Space around the content" tip="How much room there is between the item's edge and what is inside it, in pixels.">
        <input type="range" min={0} max={80} step={1} value={ctrl.padding} onChange={(e) => onCtrl('padding', Number(e.target.value), 'px', 'Changed the space around the content.')} />
        <span style={{ color: 'var(--color-text)' }}>{ctrl.padding}px</span>
        <SizePicks list={detected.paddings} property="padding" explanation="Changed the space around the content." ctrl={ctrl} onQuick={onQuick} />
      </Field>
      <Field label="Shadow" tip="A shadow or glow around the item, from subtle to strong.">
        <select className="rounded-lg border p-1.5" style={FIELD} value={SHADOW_OPTIONS.some((o) => o.value === ctrl.boxShadow) ? ctrl.boxShadow : 'none'} onChange={(e) => onCtrl('boxShadow', e.target.value, null, 'Changed the shadow.')}>
          {SHADOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
    </section>
  );
}
