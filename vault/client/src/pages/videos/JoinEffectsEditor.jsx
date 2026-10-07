import React, { useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import Tooltip from '../../components/Tooltip';

// Controls for Join videos: a transition picker for each join and an effects panel for each clip.
// Every control is rendered from GET /api/videos/join/capabilities, i.e. from the same registries the
// server validates against and the AI planner reads — a newly registered effect or transition appears
// here with no UI change.

const fieldStyle = { background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' };
const mutedStyle = { color: 'var(--color-muted)' };

let capsPromise = null;

export function useJoinCapabilities() {
  const [caps, setCaps] = useState(null);
  useEffect(() => {
    let alive = true;
    if (!capsPromise) {
      capsPromise = api.get('/api/videos/join/capabilities')
        .then((res) => (res.ok ? res.json() : null))
        .catch(() => null);
    }
    capsPromise.then((data) => {
      if (!data) capsPromise = null; // allow a retry next time the editor opens
      if (alive) setCaps(data);
    });
    return () => { alive = false; };
  }, []);
  return caps;
}

export function blankJoinPlan(count) {
  return {
    order: Array.from({ length: count }, (_, i) => i),
    transition: 'cut',
    transitionSec: 0,
    clips: Array.from({ length: count }, () => ({})),
    joins: Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({ after: i, type: 'cut' })),
    summary: '',
  };
}

/** Joins are stored per gap in play order; after a reorder, re-point each one at the clip before it. */
export function relabelJoins(order, joins) {
  return joins.map((j, gap) => ({ ...j, after: order[gap] }));
}

export function describePlan(plan) {
  const blends = (plan.joins || []).filter((j) => j.type !== 'cut').length;
  const fx = (plan.clips || []).filter((c) => c && Object.keys(c).length > 0).length;
  const parts = [];
  parts.push(blends ? `${blends} transition${blends === 1 ? '' : 's'}` : 'hard cuts');
  if (fx) parts.push(`${fx} clip${fx === 1 ? '' : 's'} with effects`);
  return parts.join(', ');
}

const words = (key) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

function stepFor(spec) {
  const range = (spec.max ?? 1) - (spec.min ?? 0);
  if (range <= 3) return 0.05;
  if (range <= 100) return 0.1;
  return 1;
}

function ParamField({ spec, value, onChange }) {
  const label = words(spec.key);
  if (spec.type === 'enum') {
    return (
      <label className="block space-y-1">
        <span className="text-[10px]" style={mutedStyle}>{label}</span>
        <Tooltip text={spec.description}>
          <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border text-xs" style={fieldStyle}>
            {spec.values.map((v) => <option key={v} value={v}>{words(v.replace(/_/g, ' ')).replace(/^./, (c) => c.toUpperCase())}</option>)}
          </select>
        </Tooltip>
      </label>
    );
  }
  if (spec.type === 'bool') {
    return (
      <Tooltip text={spec.description}>
        <label className="flex items-center gap-2 text-xs cursor-pointer pt-4" style={mutedStyle}>
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {label}
        </label>
      </Tooltip>
    );
  }
  return (
    <label className="block space-y-1">
      <span className="text-[10px]" style={mutedStyle}>{label}</span>
      <Tooltip text={`${spec.description} (${spec.min} to ${spec.max})`}>
        <input
          type="number"
          min={spec.min}
          max={spec.max}
          step={stepFor(spec)}
          value={value}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-full px-2 py-1.5 rounded-lg border text-xs"
          style={fieldStyle}
        />
      </Tooltip>
    </label>
  );
}

/** Defaults for a transition type, in the shape the server expects. */
export function joinDefaults(caps, type) {
  const def = caps?.transitions.find((t) => t.id === type);
  const out = { type };
  for (const p of def?.params || []) out[p.key] = p.default;
  return out;
}

/** The transition for one gap between two clips: a type plus that type's own settings. */
export function JoinPicker({ caps, join, onChange, label }) {
  const def = caps?.transitions.find((t) => t.id === join.type);
  return (
    <div className="rounded-xl border border-dashed p-2 space-y-2" style={{ borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2">
        <span className="text-[10px] shrink-0" style={mutedStyle}>{label}</span>
        <Tooltip text={def?.description || 'How this clip changes to the next one.'}>
          <select
            value={join.type}
            onChange={(e) => onChange({ after: join.after, ...joinDefaults(caps, e.target.value) })}
            className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border text-xs"
            style={fieldStyle}
            disabled={!caps}
          >
            {(caps?.transitions || [{ id: join.type, label: join.type }]).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </Tooltip>
      </div>
      {def && def.params.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {def.params.map((spec) => (
            <ParamField
              key={spec.key}
              spec={spec}
              value={join[spec.key] ?? spec.default}
              onChange={(v) => onChange({ ...join, [spec.key]: v === '' ? spec.default : v })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Per-clip effects. Only settings that differ from their default are stored, so {} means "no effects". */
export function ClipEffectsPanel({ caps, effects, onChange }) {
  if (!caps) return <p className="text-[10px]" style={mutedStyle}>Loading effects…</p>;
  const set = (spec, v) => {
    const next = { ...effects };
    if (v === '' || v === spec.default) delete next[spec.key];
    else next[spec.key] = v;
    onChange(next);
  };
  return (
    <div className="space-y-3 pt-1">
      {caps.clipEffects.map((effect) => (
        <div key={effect.id} className="space-y-1">
          <p className="text-[10px]" style={mutedStyle}>{effect.description}</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {effect.params.map((spec) => (
              <ParamField key={spec.key} spec={spec} value={effects[spec.key] ?? spec.default} onChange={(v) => set(spec, v)} />
            ))}
          </div>
        </div>
      ))}
      {Object.keys(effects).length > 0 && (
        <button type="button" onClick={() => onChange({})} className="text-xs underline transition-opacity hover:opacity-60" style={mutedStyle}>
          Reset this clip's effects
        </button>
      )}
    </div>
  );
}
