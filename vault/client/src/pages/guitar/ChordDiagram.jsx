import React from 'react';

// ── Chord shape SVG diagram ───────────────────────────────────────────────────
export default function ChordDiagram({ shape }) {
  if (!shape) return null;
  const frets = shape.fretPositions;
  const fingers = shape.fingerPositions || [];
  const base = shape.baseFret || 1;
  const W = 80, H = 100, padL = 18, padT = 18;
  const strings = 6, fretCount = 4;
  const colW = (W - padL - 6) / (strings - 1);
  const rowH = (H - padT - 14) / fretCount;

  const xOf = (s) => padL + s * colW;
  const yOf = (f) => padT + (f - 0.5) * rowH;

  // When baseFret > 1, frets are absolute — convert to relative for drawing
  const rel = (absFret) => {
    if (absFret <= 0) return absFret;
    return absFret - base + 1;
  };

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {base > 1 && (
        <text x={2} y={padT + rowH * 0.35} fontSize="9" fill="#6b7280" fontWeight="700">{base}fr</text>
      )}
      {Array.from({ length: fretCount + 1 }).map((_, f) => (
        <line key={f} x1={xOf(0)} x2={xOf(strings - 1)}
          y1={padT + f * rowH} y2={padT + f * rowH}
          stroke={f === 0 && base === 1 ? '#1f2937' : '#d1d5db'}
          strokeWidth={f === 0 && base === 1 ? 3 : 1} />
      ))}
      {Array.from({ length: strings }).map((_, s) => (
        <line key={s} x1={xOf(s)} x2={xOf(s)} y1={padT} y2={padT + fretCount * rowH}
          stroke="#9ca3af" strokeWidth={1} />
      ))}
      {frets.map((f, s) => {
        const x = xOf(strings - 1 - s);
        if (f === -1) return <text key={s} x={x} y={padT - 6} textAnchor="middle" fontSize="10" fill="#dc2626">×</text>;
        if (f === 0)  return <circle key={s} cx={x} cy={padT - 6} r={3.5} fill="none" stroke="#6b7280" strokeWidth={1.5} />;
        const rf = rel(f);
        if (rf < 1 || rf > fretCount) return null;
        return (
          <g key={s}>
            <circle cx={x} cy={yOf(rf)} r={7} fill="var(--color-primary)" />
            {fingers[s] > 0 && (
              <text x={x} y={yOf(rf) + 3.5} textAnchor="middle" fontSize="8" fill="#fff" fontWeight="700">{fingers[s]}</text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
