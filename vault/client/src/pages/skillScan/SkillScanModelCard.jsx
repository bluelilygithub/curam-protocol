import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import { formatModelSelectLabel } from '../../utils/models';

/**
 * Settings -> AI & Chat (admins): which connected model Skill Scanner uses to explain findings and run a Deep scan. Same pattern as the
 * Email Follow-Up and Topic Research cards: the first option is the workspace default, the rest are the connected models. An Anthropic
 * (Claude) model is recommended, and a Deep scan needs one; the card says so and warns when the model in use is not one.
 */
export default function SkillScanModelCard({ choices, defaultModel }) {
  const [config, setConfig] = useState(null); // { modelId, assignmentValid, fromAdmin, globalStandard, effectiveModel, effectiveIsAnthropic, anthropicChoices }
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const url = '/api/skill-scan/model-config';

  useEffect(() => {
    let live = true;
    api.get(url).then((r) => r.json()).then((d) => { if (live && d && !d.error) setConfig(d); }).catch(() => {});
    return () => { live = false; };
  }, []);

  const change = async (modelId) => {
    setError(''); setSaved(false);
    try {
      const r = await api.post(url, { modelId });
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
  const amber = { color: '#b45309' };

  return (
    <section className="mb-8" data-tour="settings-skill-scan-model">
      <h2 className="text-sm font-semibold uppercase tracking-widest mb-1" style={muted}>Skill Scanner model</h2>
      <p className="text-xs mb-2" style={muted}>
        The model Skill Scanner (Admin menu) uses to explain a scan&apos;s findings in plain English and, when you tick Deep scan, to read the skill&apos;s files.
        By default it uses your default chat model.
      </p>
      <p className="text-xs mb-4 rounded-lg border p-2" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>
        <strong>Best suited to an Anthropic foundation model (Claude).</strong> This job reviews code that may have been written to mislead an AI, and its
        answers must follow a strict format, which Claude models do reliably. A Deep scan only works with a Claude model. Other models can write the
        explanation, but treat their reading with more care. Whichever you choose receives short code examples from the scanned skill.
      </p>
      <label className="block text-xs font-medium mb-1.5" style={muted} htmlFor="skill-scan-model">Model</label>
      <div className="flex items-center gap-2 flex-wrap">
        <select
          id="skill-scan-model" value={chosen} onChange={(e) => change(e.target.value)} disabled={!config}
          className="px-3 py-1.5 rounded-lg border text-sm outline-none min-w-[240px] max-w-full"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          title="Choose the model Skill Scanner uses. A Claude model is recommended."
        >
          <option value="">Use default model ({config?.globalStandard || defaultModel || '—'})</option>
          {!inList && <option value={chosen}>{chosen} (no longer connected)</option>}
          {(choices || []).map((m) => (
            <option key={m.id} value={m.id}>{formatModelSelectLabel(m)}{config?.anthropicChoices?.includes(m.id) ? ' — recommended' : ''}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: saved ? '#22c55e' : 'var(--color-muted)' }}>
          {saved ? 'Saved ✓' : (chosen || 'Using default')}
        </span>
      </div>
      {config?.effectiveModel && !config.effectiveIsAnthropic && (
        <p className="text-xs mt-2" style={amber}>
          Skill Scanner is using {config.effectiveModel}, which is not an Anthropic model: Deep scan is unavailable and the explanation may be less reliable.
          {config.anthropicChoices?.length ? ` Choose ${config.anthropicChoices[0]} (or another Claude model) above.` : ' Add a Claude model in the list above, then choose it here.'}
        </p>
      )}
      {config && chosen && config.assignmentValid === false && (
        <p className="text-xs mt-2" style={amber}>
          That model is no longer connected, so Skill Scanner uses {config.effectiveModel ? `the default (${config.effectiveModel})` : 'the default'} until you choose another.
        </p>
      )}
      {config?.fromAdmin && !chosen && <p className="text-xs mt-2" style={muted}>Inherited from an admin&apos;s choice.</p>}
      {config && !config.effectiveModel && <p className="text-xs mt-2" style={amber}>No AI model is set up yet. Add one above.</p>}
      {error && <p className="text-xs mt-2" style={amber}>{error}</p>}
    </section>
  );
}
