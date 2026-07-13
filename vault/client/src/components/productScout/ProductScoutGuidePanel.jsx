import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import ProductScoutFeatureBrief from './ProductScoutFeatureBrief';
import ProductScoutTierLadder from './ProductScoutTierLadder';

const STEPS = { form: 'form', brief: 'brief', results: 'results' };

export default function ProductScoutGuidePanel({ config, onRunSaved, loadedResult, loadedRunId }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [step, setStep] = useState(STEPS.form);
  const [query, setQuery] = useState('');
  const [userFeatures, setUserFeatures] = useState('');
  const [budgetHint, setBudgetHint] = useState('');
  const [featureBrief, setFeatureBrief] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (loadedResult?.mode === 'guide') {
      setResult(loadedResult);
      setQuery(loadedResult.query || '');
      setUserFeatures((loadedResult.userFeatures || []).join(', '));
      setBudgetHint(loadedResult.budgetHint != null ? String(loadedResult.budgetHint) : '');
      setFeatureBrief(loadedResult.feature_brief || null);
      setStep(STEPS.results);
    } else if (!loadedResult && !loadedRunId) {
      setStep(STEPS.form);
      setResult(null);
      setFeatureBrief(null);
    }
  }, [loadedResult, loadedRunId]);

  const handleBuildBrief = async (e) => {
    e.preventDefault();
    const q = query.trim();
    if (!q) {
      addToast('Describe what you are shopping for', 'error');
      return;
    }
    startProcessing('Building feature brief…', 'Analysing your needs and planning price tiers.');
    setError(null);
    try {
      const res = await api.post('/api/product-scout/guide/brief', {
        query: q,
        userFeatures,
        ...(budgetHint.trim() ? { budgetHint: Number(budgetHint) } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Brief failed');
      setFeatureBrief(data.feature_brief);
      setStep(STEPS.brief);
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleRunGuide = async (confirmedBrief) => {
    setRunning(true);
    startProcessing('Scouting each price tier…', 'Running a full Product Scout comparison for Essentials through Pro — about a minute.');
    setError(null);
    try {
      const res = await api.post('/api/product-scout/guide/run', {
        query: query.trim(),
        userFeatures: userFeatures.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        ...(budgetHint.trim() ? { budgetHint: Number(budgetHint) } : {}),
        featureBrief: confirmedBrief,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Guide failed');
      setResult(data);
      setFeatureBrief(confirmedBrief);
      setStep(STEPS.results);
      onRunSaved?.(data);
      addToast('Buy guide ready', 'success');
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setRunning(false);
      stopProcessing();
    }
  };

  const resetGuide = () => {
    setStep(STEPS.form);
    setFeatureBrief(null);
    setResult(null);
    setError(null);
    onRunSaved?.(null);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Step 1: describe what you want. Step 2: review features to consider. Step 3: we run a Product Scout at each price tier so you see the best picks at every step up.
      </p>

      {step === STEPS.form && (
        <form onSubmit={handleBuildBrief} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What are you shopping for?</span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. wireless ANC headphones for commuting"
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
              Features you think you need
            </span>
            <textarea
              value={userFeatures}
              onChange={(e) => setUserFeatures(e.target.value)}
              placeholder="noise cancelling, Bluetooth, long battery, comfortable with glasses"
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border text-sm outline-none resize-y"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>
              Budget hint (optional)
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm" style={{ color: 'var(--color-muted)' }}>$</span>
              <input
                type="number"
                min="1"
                value={budgetHint}
                onChange={(e) => setBudgetHint(e.target.value)}
                placeholder="e.g. 80"
                className="w-32 px-3 py-2.5 rounded-xl border text-sm outline-none"
                style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
              <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                Anchors tier 1 — not a hard cap
              </span>
            </div>
          </label>
          <button
            type="submit"
            className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Build my guide
          </button>
        </form>
      )}

      {step === STEPS.brief && featureBrief && (
        <ProductScoutFeatureBrief
          brief={featureBrief}
          tierFramework={featureBrief.tier_framework}
          onConfirm={handleRunGuide}
          onBack={() => setStep(STEPS.form)}
          loading={running}
        />
      )}

      {step === STEPS.results && result && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={resetGuide}
              className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              New guide
            </button>
          </div>
          <ProductScoutTierLadder result={result} />
        </div>
      )}

      {error && step !== STEPS.results && (
        <div
          className="rounded-xl border p-4 text-xs"
          style={{ borderColor: '#ef4444', background: 'var(--color-bg)', color: 'var(--color-text)' }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
