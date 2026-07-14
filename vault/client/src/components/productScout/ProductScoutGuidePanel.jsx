import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import ProductScoutFeatureBrief from './ProductScoutFeatureBrief';
import ProductScoutTierSelect from './ProductScoutTierSelect';
import ProductScoutTierLadder from './ProductScoutTierLadder';
import { getScoutedTierKeys } from '../../utils/productScoutGuide';

const STEPS = { form: 'form', brief: 'brief', selectTiers: 'selectTiers', results: 'results' };

export default function ProductScoutGuidePanel({ onRunSaved, loadedResult, loadedRunId, searchEnabled = false }) {
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [step, setStep] = useState(STEPS.form);
  const [query, setQuery] = useState('');
  const [userFeatures, setUserFeatures] = useState('');
  const [featureBrief, setFeatureBrief] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);
  const [mergeMode, setMergeMode] = useState(false);
  const [scoutingTierKey, setScoutingTierKey] = useState(null);
  const [refreshingRecommendation, setRefreshingRecommendation] = useState(false);
  const [checkingExternal, setCheckingExternal] = useState(false);

  useEffect(() => {
    if (loadedResult?.mode === 'guide') {
      setResult(loadedResult);
      setQuery(loadedResult.query || '');
      setUserFeatures((loadedResult.userFeatures || []).join(', '));
      setFeatureBrief(loadedResult.feature_brief || null);
      setStep(STEPS.results);
      setMergeMode(false);
    } else if (!loadedResult && !loadedRunId) {
      setStep(STEPS.form);
      setResult(null);
      setFeatureBrief(null);
      setMergeMode(false);
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
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Brief failed');
      setFeatureBrief(data.feature_brief);
      setMergeMode(false);
      setStep(STEPS.brief);
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const handleBriefContinue = (confirmedBrief) => {
    setFeatureBrief(confirmedBrief);
    setMergeMode(false);
    setStep(STEPS.selectTiers);
  };

  const runScoutForTiers = async (selectedTierKeys, { append = false, singleTier = false } = {}) => {
    if (singleTier && selectedTierKeys.length === 1) {
      setScoutingTierKey(selectedTierKeys[0]);
    } else {
      setRunning(true);
    }
    const count = selectedTierKeys.length;
    startProcessing(
      singleTier ? 'Searching tier…' : `Searching ${count} tier${count !== 1 ? 's' : ''}…`,
      singleTier
        ? 'Running Amazon search for this price tier.'
        : 'Searching Amazon only for the tiers you selected.'
    );
    setError(null);
    try {
      const res = await api.post('/api/product-scout/guide/run', {
        query: query.trim(),
        userFeatures: userFeatures.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean),
        featureBrief: result?.feature_brief || featureBrief,
        selectedTierKeys,
        ...(append || singleTier ? { runId: result?.runId ?? loadedRunId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Guide failed');
      setResult(data);
      setFeatureBrief(data.feature_brief || featureBrief);
      setStep(STEPS.results);
      setMergeMode(false);
      onRunSaved?.(data);
      addToast(singleTier || append ? 'Tier updated' : 'Buy guide ready', 'success');
    } catch (err) {
      setError(err.message);
      addToast(err.message, 'error');
    } finally {
      setRunning(false);
      setScoutingTierKey(null);
      stopProcessing();
    }
  };

  const handleScoutSingleTier = (tierKey) => {
    runScoutForTiers([tierKey], { append: true, singleTier: true });
  };

  const handleRefreshRecommendation = async () => {
    const runId = result?.runId ?? loadedRunId;
    if (!runId) return;
    setRefreshingRecommendation(true);
    startProcessing('Updating recommendation…', 'Comparing tier winners for best overall value.');
    try {
      const res = await api.post('/api/product-scout/guide/recommendation', { runId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Recommendation failed');
      setResult(data);
      onRunSaved?.(data);
      addToast('Recommendation updated', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setRefreshingRecommendation(false);
      stopProcessing();
    }
  };

  const handleRunExternalCheck = async () => {
    const runId = result?.runId ?? loadedRunId;
    if (!runId) return;
    setCheckingExternal(true);
    startProcessing('Checking non-Amazon options…', 'Searching retailers using your recommended product specs.');
    try {
      const res = await api.post('/api/product-scout/guide/external-check', { runId });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'External check failed');
      setResult(data);
      onRunSaved?.(data);
      addToast('Non-Amazon check complete', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setCheckingExternal(false);
      stopProcessing();
    }
  };

  const resetGuide = () => {
    setStep(STEPS.form);
    setFeatureBrief(null);
    setResult(null);
    setError(null);
    setMergeMode(false);
    onRunSaved?.(null);
  };

  const scoutedTiers = getScoutedTierKeys(result);
  const tierFramework = featureBrief?.tier_framework || result?.feature_brief?.tier_framework || [];
  const hasUnscoutedTiers = tierFramework.length > scoutedTiers.length;

  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
        Step 1: describe what you want. Step 2: review features. Step 3: pick price tiers to search. Step 4: compare results per tier.
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
          onConfirm={handleBriefContinue}
          onBack={() => setStep(STEPS.form)}
          loading={false}
        />
      )}

      {step === STEPS.selectTiers && featureBrief && (
        <ProductScoutTierSelect
          tiers={featureBrief.tier_framework}
          previouslyScouted={mergeMode ? scoutedTiers : []}
          onConfirm={(keys) => runScoutForTiers(keys, { append: mergeMode })}
          onBack={() => {
            if (mergeMode) {
              setMergeMode(false);
              setStep(STEPS.results);
            } else {
              setStep(STEPS.brief);
            }
          }}
          loading={running}
          mergeMode={mergeMode}
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
            {hasUnscoutedTiers && (
              <button
                type="button"
                onClick={() => {
                  setFeatureBrief(result.feature_brief || featureBrief);
                  setMergeMode(true);
                  setStep(STEPS.selectTiers);
                }}
                className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
              >
                Search more tiers ({scoutedTiers.length}/4 gathered)
              </button>
            )}
            {scoutedTiers.length > 0 && scoutedTiers.length < 4 && (
              <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                {scoutedTiers.length} of 4 tiers searched
              </span>
            )}
          </div>

          <ProductScoutTierLadder
            result={result}
            onScoutTier={handleScoutSingleTier}
            scoutingTierKey={scoutingTierKey}
            onRefreshRecommendation={handleRefreshRecommendation}
            refreshingRecommendation={refreshingRecommendation}
            onRunExternalCheck={handleRunExternalCheck}
            checkingExternal={checkingExternal}
            searchEnabled={searchEnabled}
          />
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
