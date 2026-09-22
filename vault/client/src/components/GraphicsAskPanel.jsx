import React, { useState, useRef, useEffect } from 'react';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import { useVoice } from '../hooks/useVoice';
import Tooltip from './Tooltip';
import { GRAPHICS_PLAN_CATALOG, findPlanMode } from '../utils/graphicsPlanCatalog';

// "Ask Graphics" — plain-English/voice intake that turns a request into a checklist of real
// Graphics steps, run in sequence against the actual endpoints (not the per-mode React state
// each sidebar tool keeps — those are too varied/bespoke to drive generically; this panel keeps
// its own working image and calls the backend directly, then hands the result off to whichever
// mode the user wants to keep editing in, same "Use in…" mechanism every result panel already
// has). See server/services/graphicsPlanService.js for the parsing/validation side.
//
// Scope is intentionally bounded to GRAPHICS_PLAN_CATALOG's five auto-runnable modes (adjust,
// colorgrade, background, recolor, extend) plus two mask-requiring modes (inpaint, extract) that
// are always opened manually, never auto-run — see that file's own comment for why.

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export default function GraphicsAskPanel({ onOpenInModeWithPrompt, getModeResultImage, currentMode }) {
  const getIcon = useIcon();
  const { isSTTAvailable, isLocalSTTAvailable, isListening, isTranscribing, transcript, interimText, voiceError, startListening, stopListening } = useVoice();

  const [request, setRequest] = useState('');
  const [image, setImage] = useState(null); // { imageDataUrl, name }
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState('');
  const [steps, setSteps] = useState(null); // null = no plan yet
  const [droppedNotes, setDroppedNotes] = useState([]);
  const [runningIndex, setRunningIndex] = useState(-1);
  const [stepStatus, setStepStatus] = useState({}); // index -> 'pending'|'running'|'done'|'error'|'skipped'
  const [stepError, setStepError] = useState({}); // index -> message
  const [currentImage, setCurrentImage] = useState(null); // working image as steps execute
  const [snapshot, setSnapshot] = useState(null); // pre-"Run all" image, for undo
  const [expanded, setExpanded] = useState(true);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (transcript) setRequest((prev) => (prev.trim() ? `${prev.trim()} ${transcript.trim()}` : transcript.trim()));
  }, [transcript]);

  const handleFile = async (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage({ imageDataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
  };

  const resetPlan = () => {
    setSteps(null);
    setDroppedNotes([]);
    setStepStatus({});
    setStepError({});
    setRunningIndex(-1);
    setCurrentImage(null);
    setSnapshot(null);
  };

  const askForPlan = async () => {
    const text = request.trim();
    if (!text) { setPlanError('Describe what you want to change'); return; }
    if (!image?.imageDataUrl) { setPlanError('Load an image first'); return; }
    setPlanLoading(true);
    setPlanError('');
    resetPlan();
    try {
      const res = await api.post('/api/graphics/plan-request', {
        transcript: text,
        catalog: GRAPHICS_PLAN_CATALOG,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not plan that request');
      if (!data.steps.length) {
        setPlanError(data.droppedNotes?.length
          ? `Couldn't map this to a tool: ${data.droppedNotes.join('; ')}`
          : "Couldn't map this to a specific tool — try naming what should change (e.g. \"make it lighter\", \"remove the background\").");
        return;
      }
      setSteps(data.steps);
      setDroppedNotes(data.droppedNotes || []);
      setCurrentImage(image.imageDataUrl);
    } catch (err) {
      setPlanError(err.message || 'Could not plan that request');
    } finally {
      setPlanLoading(false);
    }
  };

  const updateStepCandidate = (idx, newMode) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, mode: newMode, endpoint: findPlanMode(newMode)?.endpoint ?? null, requiresMask: !!findPlanMode(newMode)?.requiresMask } : s)));
  };

  const updateStepParam = (idx, key, value) => {
    setSteps((prev) => prev.map((s, i) => (i === idx ? { ...s, params: { ...s.params, [key]: value } } : s)));
  };

  const runAutoStep = async (step, sourceDataUrl) => {
    const res = await api.post(step.endpoint, { imageDataUrl: sourceDataUrl, ...step.params });
    const data = await res.json();
    if (!res.ok || !data.imageDataUrl) throw new Error(data.error || 'Step failed');
    return data.imageDataUrl;
  };

  const runAll = async () => {
    if (!steps?.length) return;
    setSnapshot(currentImage || image.imageDataUrl);
    let working = currentImage || image.imageDataUrl;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // Already completed manually (a masked step whose result was pulled back in) — keep its
      // output as the running image and move on, don't re-run or re-skip it.
      if (stepStatus[i] === 'done') continue;
      if (step.requiresMask) {
        setStepStatus((prev) => ({ ...prev, [i]: 'skipped' }));
        continue;
      }
      setRunningIndex(i);
      setStepStatus((prev) => ({ ...prev, [i]: 'running' }));
      try {
        working = await runAutoStep(step, working);
        setCurrentImage(working);
        setStepStatus((prev) => ({ ...prev, [i]: 'done' }));
      } catch (err) {
        setStepStatus((prev) => ({ ...prev, [i]: 'error' }));
        setStepError((prev) => ({ ...prev, [i]: err.message || 'Step failed' }));
        setRunningIndex(-1);
        return; // stop on failure — keep what succeeded, don't silently continue
      }
    }
    setRunningIndex(-1);
  };

  const retryStep = async (idx) => {
    setStepError((prev) => { const n = { ...prev }; delete n[idx]; return n; });
    setStepStatus((prev) => ({ ...prev, [idx]: 'running' }));
    try {
      const source = currentImage || image.imageDataUrl;
      const result = await runAutoStep(steps[idx], source);
      setCurrentImage(result);
      setStepStatus((prev) => ({ ...prev, [idx]: 'done' }));
    } catch (err) {
      setStepStatus((prev) => ({ ...prev, [idx]: 'error' }));
      setStepError((prev) => ({ ...prev, [idx]: err.message || 'Step failed' }));
    }
  };

  const skipStep = (idx) => {
    setStepError((prev) => { const n = { ...prev }; delete n[idx]; return n; });
    setStepStatus((prev) => ({ ...prev, [idx]: 'skipped' }));
  };

  const undoRun = () => {
    if (!snapshot) return;
    setCurrentImage(snapshot);
    setStepStatus({});
    setStepError({});
    setSnapshot(null);
  };

  const [awaitingStepIndex, setAwaitingStepIndex] = useState(null);

  const openManualStep = (idx, step) => {
    onOpenInModeWithPrompt?.(step.mode, currentImage || image.imageDataUrl, step.params?.prompt || '');
    setAwaitingStepIndex(idx);
  };

  // Pulls whatever the user just finished in the real mode (Inpaint/Extract) back into the
  // plan as this step's output, so the next step chains from it instead of the plan stalling
  // after a manual/masked step.
  const pullManualResult = (idx) => {
    const step = steps[idx];
    const result = getModeResultImage?.(step.mode);
    if (!result) return;
    setCurrentImage(result);
    setStepStatus((prev) => ({ ...prev, [idx]: 'done' }));
    setStepError((prev) => { const n = { ...prev }; delete n[idx]; return n; });
    setAwaitingStepIndex(null);
  };

  const anyRunning = runningIndex >= 0;
  const hasError = Object.values(stepStatus).includes('error');

  return (
    <div className="rounded-2xl border mb-6" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          {getIcon('sparkles', { size: 15, style: { color: 'var(--color-primary)' } })}
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Ask Graphics</span>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>describe an edit in plain English or by voice</span>
        </div>
        <span style={{ color: 'var(--color-muted)' }}>{getIcon(expanded ? 'chevron-up' : 'chevron-down', { size: 14 })}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {!image?.imageDataUrl ? (
            <div>
              <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Load an image to start.</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="block text-xs"
                style={{ color: 'var(--color-text)' }}
              />
            </div>
          ) : (
            <div className="grid sm:grid-cols-[140px_1fr] gap-4">
              <div>
                <img src={currentImage || image.imageDataUrl} alt="working" className="w-full rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
                <button
                  type="button"
                  onClick={() => { setImage(null); resetPlan(); setRequest(''); }}
                  className="text-xs mt-1 hover:opacity-70"
                  style={{ color: 'var(--color-muted)' }}
                >Change image</button>
              </div>

              <div className="space-y-2">
                <textarea
                  value={(isListening || isTranscribing) ? (request ? `${request} ${interimText}` : interimText) : request}
                  onChange={(e) => setRequest(e.target.value)}
                  disabled={isListening || isTranscribing || anyRunning}
                  placeholder="e.g. make it lighter, change the background to a blueish hue, and replace the shirt with a business shirt"
                  rows={2}
                  className="w-full px-3 py-2 rounded-xl border text-sm"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <div className="flex items-center gap-2">
                  {(isSTTAvailable || isLocalSTTAvailable) && (
                    <Tooltip text={isListening ? 'Stop listening and use what was said' : 'Speak your request'}>
                      <button
                        type="button"
                        onClick={isListening ? stopListening : startListening}
                        disabled={isTranscribing || anyRunning}
                        className="w-7 h-7 flex items-center justify-center rounded-lg relative"
                        style={{ color: isListening || isTranscribing ? '#ef4444' : 'var(--color-muted)', background: 'transparent' }}
                      >
                        {getIcon('mic', { size: 14 })}
                        {(isListening || isTranscribing) && <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full animate-pulse" style={{ background: '#ef4444' }} />}
                      </button>
                    </Tooltip>
                  )}
                  {isListening && (
                    <button type="button" onClick={stopListening} className="text-xs font-semibold px-2 py-1 rounded-md" style={{ background: '#fee2e2', color: '#ef4444' }}>Stop &amp; use this</button>
                  )}
                  {isTranscribing && <span className="text-xs" style={{ color: '#ef4444' }}>Transcribing…</span>}
                  {!isListening && voiceError && <span className="text-xs truncate" style={{ color: '#b3452c' }} title={voiceError}>{voiceError}</span>}
                  <Tooltip text="Turn this request into a checklist of Graphics steps.">
                    <button
                      type="button"
                      onClick={askForPlan}
                      disabled={planLoading || isListening || isTranscribing || anyRunning}
                      className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                      style={{ background: 'var(--color-primary)' }}
                    >
                      {planLoading ? 'Thinking…' : 'Plan it'}
                    </button>
                  </Tooltip>
                </div>
                {planError && <p className="text-xs" style={{ color: '#991b1b' }}>{planError}</p>}
              </div>
            </div>
          )}

          {steps?.length > 0 && (
            <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
              {droppedNotes.length > 0 && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Couldn't map: {droppedNotes.join('; ')}</p>
              )}
              {steps.map((step, i) => {
                const mode = findPlanMode(step.mode);
                const status = stepStatus[i];
                return (
                  <div key={i} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono" style={{ color: 'var(--color-muted)' }}>{i + 1}.</span>
                        {step.candidates.length > 1 ? (
                          <select
                            value={step.mode}
                            onChange={(e) => updateStepCandidate(i, e.target.value)}
                            disabled={anyRunning}
                            className="text-sm font-semibold px-1.5 py-0.5 rounded border"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-surface)' }}
                          >
                            {step.candidates.map((c) => (
                              <option key={c} value={c}>{findPlanMode(c)?.label || c}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{mode?.label || step.mode}</span>
                        )}
                        {step.requiresMask && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>you'll paint this area</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {status === 'done' && <span style={{ color: '#22c55e' }}>{getIcon('check', { size: 14 })}</span>}
                        {status === 'running' && <span style={{ color: 'var(--color-primary)' }}>{getIcon('loader', { size: 14, className: 'animate-spin' })}</span>}
                        {status === 'skipped' && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>skipped</span>}
                        {step.requiresMask && status !== 'done' && (
                          <button type="button" onClick={() => openManualStep(i, step)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                            Open {mode?.label}
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{step.note}</p>
                    {step.requiresMask && status !== 'done' && (
                      <div className="mt-2 px-2.5 py-2 rounded-lg flex items-center justify-between gap-2 flex-wrap" style={{ background: '#fffbeb' }}>
                        <span className="text-xs" style={{ color: '#92400e' }}>
                          {awaitingStepIndex === i && currentMode === step.mode
                            ? `Finish it in ${mode?.label} above, then pull the result back in here.`
                            : `Needs a mask — open ${mode?.label}, paint the area, run it there first.`}
                        </span>
                        <Tooltip text={`Bring the result you just made in ${mode?.label} back into this plan, so the next step continues from it.`}>
                          <button
                            type="button"
                            onClick={() => pullManualResult(i)}
                            disabled={!getModeResultImage?.(step.mode)}
                            className="text-xs px-2 py-1 rounded-lg font-semibold text-white disabled:opacity-40 flex-shrink-0"
                            style={{ background: '#92400e' }}
                          >
                            Use this result
                          </button>
                        </Tooltip>
                      </div>
                    )}
                    {status === 'error' && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <span className="text-xs" style={{ color: '#991b1b' }}>{stepError[i]}</span>
                        <button type="button" onClick={() => retryStep(i)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Retry</button>
                        <button type="button" onClick={() => skipStep(i)} className="text-xs px-2 py-0.5 rounded border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Skip</button>
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center gap-2 pt-1">
                <Tooltip text="Run every step above that doesn't need you to paint a mask, in order — each step works on the previous step's result.">
                  <button
                    type="button"
                    onClick={runAll}
                    disabled={anyRunning || (hasError && runningIndex === -1 && false)}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-50"
                    style={{ background: 'var(--color-primary)' }}
                  >
                    {anyRunning ? 'Running…' : 'Run all'}
                  </button>
                </Tooltip>
                {snapshot && !anyRunning && (
                  <button type="button" onClick={undoRun} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    Undo run
                  </button>
                )}
              </div>

              {currentImage && currentImage !== image.imageDataUrl && (
                <div className="pt-2">
                  <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Current result:</p>
                  <img src={currentImage} alt="result" className="max-w-xs rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
