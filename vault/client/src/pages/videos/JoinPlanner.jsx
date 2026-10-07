import React, { useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import SlideshowLimitsModal from './SlideshowLimitsModal';
import { JOIN_CAN, JOIN_FOOTNOTE, orderedJoinLimits } from './joinLimits.mjs';
import { useJoinCapabilities, blankJoinPlan, relabelJoins, joinDefaults, JoinPicker, ClipEffectsPanel, describePlan } from './JoinEffectsEditor';

// "Describe how to join" step for Video Tools → Join videos. The server turns a plain-English description
// into a plan (play order, a transition for each join, effects for each clip); the user reviews/edits it here
// (or builds one by hand with no description), then the parent sends it with the clips to build the video. The planner sees the description and file names only — never the footage.
// Pressing "Plan my join" first opens a modal explaining what Join can't do (and how to get around it);
// nothing is planned until the user confirms there.

const fieldStyle = { background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const mutedStyle = { color: 'var(--color-muted)' };

export default function JoinPlanner({ files, plan, onPlan }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [description, setDescription] = useState('');
  const [showLimits, setShowLimits] = useState(false);
  const [openClip, setOpenClip] = useState(null); // one clip's effects open at a time
  const caps = useJoinCapabilities();

  const askToPlan = () => {
    if (!description.trim()) { addToast('Describe how you want the videos joined first', 'error'); return; }
    if (files.length < 2) { addToast('Add at least two videos first', 'error'); return; }
    setShowLimits(true);
  };

  const generate = async () => {
    setShowLimits(false);
    startProcessing('Planning your join…', 'Turning your description into a play order, transitions and effects.');
    try {
      const res = await api.post('/api/videos/join/plan', {
        description: description.trim(),
        clips: files.map((f) => ({ name: f.name })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not plan the join');
      onPlan(data);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const set = (patch) => onPlan({ ...plan, ...patch });
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= plan.order.length) return;
    const next = [...plan.order];
    [next[i], next[j]] = [next[j], next[i]];
    // Transitions stay with their position; re-point each join at the clip now before it.
    set({ order: next, joins: relabelJoins(next, plan.joins || []) });
  };
  const setClip = (fileIndex, effects) => {
    const clips = [...(plan.clips || files.map(() => ({})))];
    clips[fileIndex] = effects;
    set({ clips });
  };
  const setJoin = (gap, join) => {
    const joins = [...(plan.joins || [])];
    joins[gap] = { ...join, after: plan.order[gap] };
    set({ joins });
  };
  const setAllJoins = (type) => {
    set({
      transition: type,
      transitionSec: type === 'cut' ? 0 : 0.6,
      joins: plan.order.slice(0, -1).map((fileIndex) => ({ after: fileIndex, ...joinDefaults(caps, type) })),
    });
  };

  return (
    <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <div>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Describe how to join them (optional)</p>
        <p className="text-xs" style={mutedStyle}>
          Say how the clips should flow — type it, or tap the mic and say it. The planner works from your words and the file names, so it can't see the footage: check the plan before building.
        </p>
      </div>
      <Tooltip text="Describe the order and feel of the join, for example: outside shots first, then the inside, with slow dissolves. Type it or tap the mic and say it.">
        <div>
          <VoiceInput
            type="textarea"
            append
            value={description}
            onChange={(v) => setDescription(v.slice(0, 1500))}
            rows={3}
            placeholder="e.g. Start with the outside shots, then the inside. Slow, elegant dissolves between each clip."
            label="Describe how to join the videos"
            className="!text-xs"
          />
        </div>
      </Tooltip>
      <Tooltip text="Ask the AI to turn your description into a play order and transition you can edit before joining.">
        <button
          type="button"
          onClick={askToPlan}
          disabled={files.length < 2 || !description.trim()}
          className="px-4 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
          style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
        >
          {plan ? 'Re-plan from description' : 'Plan my join'}
        </button>
      </Tooltip>
      {!plan && files.length >= 2 && (
        <div>
          <Tooltip text="Skip the description: choose a transition for each join and effects for each clip yourself.">
            <button
              type="button"
              onClick={() => onPlan(blankJoinPlan(files.length))}
              className="px-4 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              Set transitions and effects by hand
            </button>
          </Tooltip>
        </div>
      )}
      {!plan && description.trim() && (
        <p className="text-xs" style={{ color: '#b45309' }}>
          Your description is only used when you press Plan my join — pressing Join without a plan ignores it.
        </p>
      )}

      {showLimits && (
        <SlideshowLimitsModal
          description={description}
          onConfirm={generate}
          onCancel={() => setShowLimits(false)}
          heading="Before you plan: what Join videos can and can't do"
          can={JOIN_CAN}
          limits={orderedJoinLimits(description)}
          footnote={JOIN_FOOTNOTE}
          confirmLabel="Continue — plan what's possible"
        />
      )}

      {plan && (
        <div className="space-y-3 pt-1">
          {plan.summary && <p className="text-xs italic" style={{ color: 'var(--color-text)' }}>{plan.summary}</p>}
          <p className="text-xs" style={mutedStyle}>Plan: {describePlan(plan)}</p>
          <label className="block space-y-1">
            <span className="text-xs" style={mutedStyle}>Set every transition to</span>
            <Tooltip text="Quickly give all the joins the same transition. You can still change any one of them below.">
              <select
                value=""
                onChange={(e) => { if (e.target.value) setAllJoins(e.target.value); }}
                className="w-full px-2 py-2 rounded-xl border text-xs"
                style={fieldStyle}
                disabled={!caps}
              >
                <option value="">Choose to apply to all…</option>
                {(caps?.transitions || []).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </Tooltip>
          </label>

          <div className="space-y-2">
            <p className="text-xs font-medium" style={mutedStyle}>Clips in play order, with the transition between each pair</p>
            {plan.order.map((fileIndex, i) => {
              const effects = plan.clips?.[fileIndex] || {};
              const count = Object.keys(effects).length;
              const open = openClip === fileIndex;
              return (
                <React.Fragment key={fileIndex}>
                  <div className="rounded-xl border p-2 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <p className="flex-1 min-w-0 text-xs truncate" style={{ color: 'var(--color-text)' }}>{i + 1}. {files[fileIndex]?.name}</p>
                      <Tooltip text="Trim, speed, brightness, colour look, fades and volume for this clip.">
                        <button
                          type="button"
                          onClick={() => setOpenClip(open ? null : fileIndex)}
                          aria-expanded={open}
                          className="px-2 py-0.5 rounded border text-xs transition-opacity hover:opacity-70"
                          style={{ borderColor: count ? 'var(--color-primary)' : 'var(--color-border)', color: count ? 'var(--color-primary)' : 'var(--color-muted)' }}
                        >
                          {count ? `Effects (${count})` : 'Effects'}
                        </button>
                      </Tooltip>
                      <Tooltip text="Play this clip earlier."><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move up">↑</button></Tooltip>
                      <Tooltip text="Play this clip later."><button type="button" onClick={() => move(i, 1)} disabled={i === plan.order.length - 1} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move down">↓</button></Tooltip>
                    </div>
                    {open && <ClipEffectsPanel caps={caps} effects={effects} onChange={(next) => setClip(fileIndex, next)} />}
                  </div>
                  {i < plan.order.length - 1 && (
                    <JoinPicker
                      caps={caps}
                      join={plan.joins?.[i] || { after: fileIndex, type: 'cut' }}
                      onChange={(join) => setJoin(i, join)}
                      label={`Then (${i + 1} to ${i + 2})`}
                    />
                  )}
                </React.Fragment>
              );
            })}
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
