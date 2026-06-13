import React from 'react';

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function bandColor(label) {
  const key = String(label || '').toLowerCase();
  if (key.includes('minimal') || key.includes('low')) return '#22c55e';
  if (key.includes('mild')) return '#eab308';
  if (key.includes('moderate')) return '#f97316';
  if (key.includes('severe') || key.includes('very high')) return '#ef4444';
  return 'var(--color-primary)';
}

export function BdiSeverityGauge({ score = 0, label = '' }) {
  const bands = [
    { label: 'Minimal', from: 0, to: 13, color: '#22c55e' },
    { label: 'Mild', from: 14, to: 19, color: '#eab308' },
    { label: 'Moderate', from: 20, to: 28, color: '#f97316' },
    { label: 'Severe', from: 29, to: 63, color: '#ef4444' },
  ];
  const max = 63;
  const pct = clamp01(Number(score) / max);

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>BDI-21 severity gauge</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Score position across 0-63 colour bands.</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums" style={{ color: bandColor(label) }}>{score}/63</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
        </div>
      </div>
      <div className="relative pt-5">
        <div className="flex h-4 overflow-hidden rounded-full">
          {bands.map((band) => (
            <div
              key={band.label}
              title={`${band.label}: ${band.from}-${band.to}`}
              style={{
                width: `${((band.to - band.from + 1) / (max + 1)) * 100}%`,
                background: band.color,
              }}
            />
          ))}
        </div>
        <div
          className="absolute top-0 h-9 w-0.5 rounded-full"
          style={{ left: `${pct * 100}%`, background: 'var(--color-text)', transform: 'translateX(-1px)' }}
        />
      </div>
      <div className="grid grid-cols-4 gap-2 mt-3">
        {bands.map((band) => (
          <div key={band.label} className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: band.color }} />
            {band.label} {band.from}-{band.to}
          </div>
        ))}
      </div>
    </section>
  );
}

export function DomainRadarChart({ domains = [] }) {
  const size = 300;
  const center = size / 2;
  const radius = 92;
  const points = domains.map((domain, idx) => {
    const angle = -Math.PI / 2 + (idx / Math.max(domains.length, 1)) * Math.PI * 2;
    const value = clamp01(domain.normalized);
    return {
      ...domain,
      angle,
      x: center + Math.cos(angle) * radius * value,
      y: center + Math.sin(angle) * radius * value,
      axisX: center + Math.cos(angle) * radius,
      axisY: center + Math.sin(angle) * radius,
      labelX: center + Math.cos(angle) * (radius + 38),
      labelY: center + Math.sin(angle) * (radius + 38),
    };
  });
  const polygon = points.map((point) => `${point.x},${point.y}`).join(' ');
  const rings = [0.25, 0.5, 0.75, 1];

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Five-domain radar</h2>
      <p className="text-xs mb-3" style={{ color: 'var(--color-muted)' }}>Relative IPIP-NEO domain endorsement. Outer ring is higher endorsement.</p>
      <div className="grid md:grid-cols-[320px_1fr] gap-4 items-center">
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[320px] mx-auto" role="img" aria-label="IPIP five-domain radar chart">
          {rings.map((ring) => {
            const ringPoints = domains.map((_, idx) => {
              const angle = -Math.PI / 2 + (idx / Math.max(domains.length, 1)) * Math.PI * 2;
              return `${center + Math.cos(angle) * radius * ring},${center + Math.sin(angle) * radius * ring}`;
            }).join(' ');
            return <polygon key={ring} points={ringPoints} fill="none" stroke="var(--color-border)" strokeWidth="1" />;
          })}
          {points.map((point) => (
            <g key={point.key}>
              <line x1={center} y1={center} x2={point.axisX} y2={point.axisY} stroke="var(--color-border)" />
              <text x={point.labelX} y={point.labelY} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="var(--color-muted)">
                {point.label}
              </text>
            </g>
          ))}
          <polygon points={polygon} fill="var(--color-primary)" opacity="0.22" stroke="var(--color-primary)" strokeWidth="2" />
          {points.map((point) => <circle key={point.key} cx={point.x} cy={point.y} r="3" fill="var(--color-primary)" />)}
        </svg>
        <div className="space-y-2">
          {[...domains].sort((a, b) => Number(b.normalized) - Number(a.normalized)).map((domain) => (
            <div key={domain.key} className="flex items-center justify-between gap-3 text-sm">
              <span style={{ color: 'var(--color-text)' }}>{domain.label}</span>
              <span className="font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>{Math.round(clamp01(domain.normalized) * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function strategyColor(scale, variant) {
  const family = String(scale.family || '').toLowerCase();
  if (variant === 'cerq') {
    if (family === 'helpful') return '#3b82f6';
    if (family === 'less-helpful') return '#ef4444';
    return '#64748b';
  }
  if (['avoidant'].includes(family)) return '#ef4444';
  if (['self-evaluative', 'emotion-focused', 'attention'].includes(family)) return '#f97316';
  return '#22c55e';
}

function strategyAverage(scale, responseMax) {
  const itemCount = Number(scale.max) > 0 ? Number(scale.max) / responseMax : 1;
  return itemCount > 0 ? Number(scale.score || 0) / itemCount : 0;
}

export function StrategyBarChart({ scales = [], responseMax = 5, variant = 'cerq', title = 'Strategy scores' }) {
  const sorted = [...scales].sort((a, b) => strategyAverage(b, responseMax) - strategyAverage(a, responseMax));

  return (
    <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{title}</h2>
      <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Sorted by average item score. Colours indicate broad strategy family.</p>
      <div className="space-y-3">
        {sorted.map((scale) => {
          const avg = strategyAverage(scale, responseMax);
          const pct = clamp01((avg - 1) / (responseMax - 1)) * 100;
          const color = strategyColor(scale, variant);
          return (
            <div key={scale.key}>
              <div className="flex items-center justify-between gap-3 text-xs mb-1">
                <span className="font-medium" style={{ color: 'var(--color-text)' }}>{scale.label}</span>
                <span className="tabular-nums" style={{ color }}>{avg.toFixed(1)}/{responseMax}</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>{scale.family} · {scale.band}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
