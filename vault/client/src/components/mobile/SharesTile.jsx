import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

function fmtAUD(n) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(Number(n));
}

function fmtPct(n) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  const value = Number(n);
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function SharesTile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const getIcon = useIcon();

  useEffect(() => {
    api.get('/api/shares/dashboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const topPositions = Array.isArray(data?.positions) ? data.positions.slice(0, 3) : [];
  const pnlColor = data?.unrealizedPnlAud > 0
    ? '#22c55e'
    : data?.unrealizedPnlAud < 0
      ? '#ef4444'
      : 'var(--color-text)';

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        {getIcon('bar-chart', { size: 16, style: { color: 'var(--color-text)' } })}
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Shares</span>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        ) : data ? (
          <>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Portfolio</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {fmtAUD(data.totalValueAud)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Unrealised P&amp;L</span>
              <span className="text-sm font-medium" style={{ color: pnlColor }}>
                {fmtAUD(data.unrealizedPnlAud)}
                <span className="ml-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                  {fmtPct(data.unrealizedPnlPct)}
                </span>
              </span>
            </div>
            {topPositions.length > 0 ? (
              <div className="pt-2 border-t space-y-1.5" style={{ borderColor: 'var(--color-border)' }}>
                {topPositions.map((position) => (
                  <div key={`${position.symbol}-${position.exchange}`} className="flex justify-between items-center">
                    <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>
                      {position.symbol}
                    </span>
                    <span className="text-xs" style={{ color: position.dayChangePct >= 0 ? '#22c55e' : '#ef4444' }}>
                      {fmtPct(position.dayChangePct)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm pt-1" style={{ color: 'var(--color-muted)' }}>No open positions</div>
            )}
          </>
        ) : (
          <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No data</div>
        )}
      </div>

      <button
        onClick={() => navigate('/shares')}
        className="w-full px-4 py-2.5 text-sm flex items-center justify-between hover:opacity-70 transition-opacity border-t"
        style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
      >
        Open shares
        {getIcon('chevron-right', { size: 14 })}
      </button>
    </div>
  );
}
