import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { formatModelSelectLabel } from '../../utils/models';

/**
 * Settings -> Topic Research: which connected AI model writes research briefs. Works like Amazon Search's model override: the first option
 * is the workspace default, the rest are the models connected under AI & Chat. Nothing is hardcoded; an empty choice follows the workspace.
 * `choices` are the chat-capable models Settings already lists (the same list as the default-model picker).
 */
export default function TopicResearchModelCard({ choices, defaultModel }) {
  const [config, setConfig] = useState(null); // { modelId, assignmentValid, fromAdmin, globalStandard, effectiveModel }
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/api/topic-research/model-config').then((r) => r.json()).then((d) => { if (live && d && !d.error) setConfig(d); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const change = async (modelId) => {
    setError(''); setSaved(false);
    try {
      const r = await api.post('/api/topic-research/model-config', { modelId });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not save the model.');
      setConfig((cur) => ({ ...(cur || {}), ...d }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { setError(e.message || 'Could not reach the server.'); }
  };

  const muted = { color: 'var(--color-muted)' };
  const chosen = config?.modelId || '';
  const inList = !chosen || (choices || []).some((m) => m.id === chosen);

  return (
    <section className="mb-8" data-guide="model">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={muted}>Research brief model</h2>
      <p className="text-xs mb-4" style={muted}>
        Topic Research uses an AI model for one thing: writing a research brief (the angle, key facts with their sources, gaps and an outline). Searching, reading and ranking use no model.
        By default it uses your default chat model; pick another connected model here to use that instead.
      </p>
      <label className="block text-xs font-medium mb-1.5" style={muted} htmlFor="tr-model">Model</label>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          id="tr-model" value={chosen} onChange={(e) => change(e.target.value)} disabled={!config}
          className="px-3 py-1.5 rounded-lg border text-sm outline-none min-w-[240px] max-w-full"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <option value="">Use default model ({config?.globalStandard || defaultModel || '—'})</option>
          {!inList && <option value={chosen}>{chosen} (no longer connected)</option>}
          {(choices || []).map((m) => (
            <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: saved ? '#22c55e' : 'var(--color-muted)' }}>
          {saved ? 'Saved ✓' : (chosen || 'Using default')}
        </span>
      </div>
      {config && chosen && config.assignmentValid === false && (
        <p className="text-xs mt-2" style={{ color: '#b45309' }}>
          That model is no longer connected, so briefs use {config.effectiveModel ? `the default (${config.effectiveModel})` : 'the default'} until you choose another.
        </p>
      )}
      {config?.fromAdmin && !chosen && (
        <p className="text-xs mt-2" style={muted}>Inherited from an admin&apos;s choice.</p>
      )}
      {config && !config.effectiveModel && (
        <p className="text-xs mt-2" style={{ color: '#b45309' }}>No AI model is set up yet. Add one under AI &amp; Chat so briefs can be written.</p>
      )}
      {error && <p className="text-xs mt-2" style={{ color: '#b45309' }}>{error}</p>}
    </section>
  );
}
