import React, { useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';

// "Describe the video" step for the Slideshow tool. The server turns a plain-English description
// into a plan (order, per-slide timing/captions, transition, camera motion, colour mood); the
// user reviews/edits it here, then the parent sends it with the images to build the video.
// The planner sees the description and file names only — never the pictures themselves.

export const PLAN_OPTIONS = {
  aspect: [['9:16', '9:16 · Reels/Stories'], ['16:9', '16:9 · Landscape'], ['1:1', '1:1 · Square'], ['4:5', '4:5 · Portrait']],
  mode: [['pad', 'Show whole image (bars)'], ['crop', 'Fill the frame (trim edges)']],
  transition: [
    ['cut', 'Hard cut'], ['fade', 'Crossfade'], ['dissolve', 'Dissolve'], ['fadeblack', 'Fade through black'],
    ['wipeleft', 'Wipe left'], ['wiperight', 'Wipe right'], ['slideleft', 'Slide left'], ['slideright', 'Slide right'],
    ['circleopen', 'Circle open'], ['zoomin', 'Zoom in'],
  ],
  motion: [['none', 'None'], ['zoom-in', 'Slow zoom in'], ['zoom-out', 'Slow zoom out'], ['pan-left', 'Pan left'], ['pan-right', 'Pan right'], ['mixed', 'Mixed (varies per slide)']],
  mood: [['none', 'Natural'], ['warm', 'Warm'], ['cool', 'Cool'], ['vivid', 'Vivid'], ['mono', 'Black & white'], ['vintage', 'Vintage'], ['cinematic', 'Cinematic']],
  captionPosition: [['bottom-center', 'Bottom'], ['center', 'Middle'], ['top-center', 'Top']],
};

const fieldStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const mutedStyle = { color: 'var(--color-muted)' };

function PlanSelect({ label, tip, value, options, onChange }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs" style={mutedStyle}>{label}</span>
      <Tooltip text={tip}>
        <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={fieldStyle}>
          {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
        </select>
      </Tooltip>
    </label>
  );
}

function SlideThumb({ file }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt="" className="w-12 h-12 object-cover rounded-lg shrink-0" />;
}

export default function SlideshowPlanner({ files, hasAudio, plan, onPlan }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [description, setDescription] = useState('');

  const generate = async () => {
    if (!description.trim()) { addToast('Describe the video you want first', 'error'); return; }
    if (files.length < 2) { addToast('Add at least two images first', 'error'); return; }
    startProcessing('Planning your video…', 'Turning your description into order, timing, transitions and look.');
    try {
      const res = await api.post('/api/videos/slideshow/plan', {
        description: description.trim(),
        images: files.map((f) => ({ name: f.name })),
        hasAudio,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not plan the video');
      onPlan(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const set = (patch) => onPlan({ ...plan, ...patch });
  const setSlide = (i, patch) => set({ slides: plan.slides.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const moveSlide = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= plan.slides.length) return;
    const next = [...plan.slides];
    [next[i], next[j]] = [next[j], next[i]];
    set({ slides: next });
  };
  const total = plan ? plan.slides.reduce((n, s) => n + (Number(s.durationSec) || 0), 0) : 0;

  return (
    <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Describe the video (optional)</p>
        <p className="text-xs" style={mutedStyle}>
          Say what you want it to feel like. The planner works from your words and the file names — it can't see the pictures, so check the plan before building.
        </p>
      </div>
      <VoiceInput
        type="textarea"
        append
        value={description}
        onChange={(v) => setDescription(v.slice(0, 1500))}
        rows={3}
        placeholder="e.g. A calm, elegant 20-second showcase for a boutique hotel. Slow zoom, warm tones, soft crossfades, with the hotel name on the first slide. (Tap the mic to say it instead.)"
        label="Describe the video"
        className="!text-xs"
      />
      <Tooltip text="Ask the AI to turn your description into a plan you can edit before building.">
        <button
          type="button"
          onClick={generate}
          disabled={files.length < 2 || !description.trim()}
          className="px-4 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
        >
          {plan ? 'Re-plan from description' : 'Plan my video'}
        </button>
      </Tooltip>

      {plan && (
        <div className="space-y-3 pt-1">
          {plan.summary && <p className="text-xs italic" style={{ color: 'var(--color-text)' }}>{plan.summary}</p>}
          <div className="grid grid-cols-2 gap-3">
            <PlanSelect label="Aspect" tip="Frame shape of the finished video." value={plan.aspect} options={PLAN_OPTIONS.aspect} onChange={(aspect) => set({ aspect })} />
            <PlanSelect label="Fit" tip="Show the whole image with bars, or fill the frame and trim the edges." value={plan.mode} options={PLAN_OPTIONS.mode} onChange={(mode) => set({ mode })} />
            <PlanSelect
              label="Transition"
              tip="How one slide changes to the next."
              value={plan.transition}
              options={PLAN_OPTIONS.transition}
              onChange={(transition) => set({ transition, transitionSec: transition === 'cut' ? 0 : (plan.transitionSec || 0.6) })}
            />
            <label className="block space-y-1">
              <span className="text-xs" style={mutedStyle}>Transition length (s)</span>
              <Tooltip text="How long each transition takes. Ignored for hard cuts.">
                <input
                  type="number" min={0.2} max={2} step={0.1}
                  disabled={plan.transition === 'cut'}
                  value={plan.transitionSec}
                  onChange={(e) => set({ transitionSec: Number(e.target.value) })}
                  className="w-full px-2 py-2 rounded-xl border text-xs disabled:opacity-40"
                  style={fieldStyle}
                />
              </Tooltip>
            </label>
            <PlanSelect label="Camera motion" tip="A slow zoom or pan on every still so the picture never feels frozen." value={plan.motion} options={PLAN_OPTIONS.motion} onChange={(motion) => set({ motion })} />
            <PlanSelect label="Colour look" tip="A colour grade applied to every slide." value={plan.mood} options={PLAN_OPTIONS.mood} onChange={(mood) => set({ mood })} />
            <PlanSelect label="Caption position" tip="Where slide captions sit in the frame." value={plan.captionPosition} options={PLAN_OPTIONS.captionPosition} onChange={(captionPosition) => set({ captionPosition })} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium" style={mutedStyle}>Slides in play order · about {total.toFixed(1)}s</p>
            {plan.slides.map((s, i) => (
              <div key={s.index} className="flex items-center gap-2 rounded-xl border p-2" style={{ borderColor: 'var(--color-border)' }}>
                {files[s.index] && <SlideThumb file={files[s.index]} />}
                <div className="flex-1 min-w-0 space-y-1">
                  <p className="text-xs truncate" style={{ color: 'var(--color-text)' }}>{i + 1}. {files[s.index]?.name}</p>
                  <VoiceInput
                    value={s.caption} placeholder="Caption (optional)" label={`Caption for slide ${i + 1}`}
                    onChange={(v) => setSlide(i, { caption: v.slice(0, 80) })}
                    className="!py-1 !text-xs"
                  />
                </div>
                <Tooltip text="Seconds this slide stays on screen.">
                  <input
                    type="number" min={1} max={15} step={0.5} value={s.durationSec}
                    onChange={(e) => setSlide(i, { durationSec: Number(e.target.value) })}
                    className="w-16 px-2 py-1 rounded-lg border text-xs" style={fieldStyle}
                  />
                </Tooltip>
                <Tooltip text="Play this slide earlier."><button type="button" onClick={() => moveSlide(i, -1)} disabled={i === 0} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move up">↑</button></Tooltip>
                <Tooltip text="Play this slide later."><button type="button" onClick={() => moveSlide(i, 1)} disabled={i === plan.slides.length - 1} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move down">↓</button></Tooltip>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onPlan(null)}
            className="text-xs underline transition-opacity hover:opacity-60"
            style={mutedStyle}
          >
            Discard plan and use the simple controls
          </button>
        </div>
      )}
    </div>
  );
}
