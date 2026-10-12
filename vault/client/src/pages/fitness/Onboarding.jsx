import React, { useCallback, useRef, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { Notice, PrimaryButton, SecondaryButton } from './ui';
import {
  emptyDraft, draftFromState, profilePayload, ratingsPayload, useAgeTemplate,
  AboutSection, RatingsSection, LifestyleSection, WorkAroundSection,
} from './sections';

const STEPS = ['About you', 'Your fitness', 'Lifestyle', 'Work around'];

/**
 * Four quick steps, then Baseline. Everything is kept in one draft and saved together at the end
 * (profile + lifestyle in one call, then the ratings), so a half-finished visit leaves nothing half-saved.
 */
export default function Onboarding({ meta, state, onSaved }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(() => (state.profile ? draftFromState(state) : emptyDraft()));
  // Answers already given (a retake, or a half-finished visit) are never overwritten by age-band suggestions.
  const touched = useRef(new Set(state.profile ? ['scores', 'previousScores', 'previousLabel', 'equipment', 'smoking', 'alcohol', 'dietQuality', 'timeFlexibility'] : []));
  const set = useCallback((key, value) => {
    touched.current.add(key);
    setDraft((d) => ({ ...d, [key]: value }));
  }, []);

  const tpl = useAgeTemplate(draft, setDraft, touched);

  const aboutValid = /^\d{4}-\d{2}-\d{2}$/.test(draft.dob) && draft.sex && Number(draft.heightCm) >= 100 && Number(draft.weightKg) >= 30 && !tpl.error;
  const canNext = step === 0 ? aboutValid : true;

  const finish = async () => {
    startProcessing('Saving your profile…', 'Then we put together your baseline.');
    try {
      const pr = await api.put('/api/fitness/profile', profilePayload(draft));
      const pd = await pr.json();
      if (!pr.ok) throw new Error(pd.error || 'Could not save your profile');
      const rr = await api.post('/api/fitness/ratings', ratingsPayload(draft, 'onboarding'));
      const rd = await rr.json();
      if (!rr.ok) throw new Error(rd.error || 'Could not save your ratings');
      onSaved(rd);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  return (
    <div className="max-w-3xl mx-auto w-full space-y-5">
      <Notice>
        <strong>Welcome.</strong> About 4 quick steps, then a baseline and a five-year goal. {meta.disclaimer}
      </Notice>

      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Steps" data-tour="fitness-steps">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className="px-3 py-1 rounded-full border"
            style={{
              borderColor: i === step ? 'var(--color-primary)' : 'var(--color-border)',
              color: i === step ? 'var(--color-primary)' : 'var(--color-muted)',
              fontWeight: i === step ? 600 : 400,
            }}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && <AboutSection meta={meta} draft={draft} set={set} templateInfo={tpl.info} templateError={tpl.error} timezoneInfo={state.timezone} />}
      {step === 1 && <RatingsSection meta={meta} draft={draft} set={set} fromTemplate={!touched.current.has('scores')} />}
      {step === 2 && <LifestyleSection meta={meta} draft={draft} set={set} />}
      {step === 3 && <WorkAroundSection draft={draft} set={set} />}

      <div className="flex items-center gap-2">
        {step > 0 && <SecondaryButton onClick={() => setStep(step - 1)}>Back</SecondaryButton>}
        <div className="flex-1" />
        {step < STEPS.length - 1
          ? <PrimaryButton onClick={() => setStep(step + 1)} disabled={!canNext}>Next</PrimaryButton>
          : <PrimaryButton onClick={finish}>See my baseline</PrimaryButton>}
      </div>
    </div>
  );
}
