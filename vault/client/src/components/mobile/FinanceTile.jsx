import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';

function fmtAUD(n) {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export default function FinanceTile() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const getIcon = useIcon();

  useEffect(() => {
    api.get('/api/finance/dashboard')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <span>💰</span>
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Finance</span>
      </div>

      <div className="px-4 py-3 space-y-2.5">
        {loading ? (
          <div className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading...</div>
        ) : data ? (
          <>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Revenue (YTD)</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                {fmtAUD(data.yearRevenue)}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Outstanding</span>
              <span
                className="text-sm font-medium"
                style={{ color: data.outstandingAmount > 0 ? '#f59e0b' : 'var(--color-text)' }}
              >
                {fmtAUD(data.outstandingAmount)}
                {data.outstandingCount > 0 && (
                  <span className="ml-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                    ({data.outstandingCount})
                  </span>
                )}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Overdue</span>
              <span
                className="text-sm font-medium"
                style={{ color: data.overdueAmount > 0 ? '#ef4444' : 'var(--color-text)' }}
              >
                {fmtAUD(data.overdueAmount)}
                {data.overdueCount > 0 && (
                  <span className="ml-1 text-xs" style={{ color: 'var(--color-muted)' }}>
                    ({data.overdueCount})
                  </span>
                )}
              </span>
            </div>
            <div
              className="flex justify-between items-center pt-2 border-t"
              style={{ borderColor: 'var(--color-border)' }}
            >
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Expenses (YTD)</span>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>
                {fmtAUD(data.yearExpenses)}
              </span>
            </div>
          </>
        ) : (
          <div className="text-sm" style={{ color: 'var(--color-muted)' }}>No data</div>
        )}
      </div>

      <div className="flex border-t" style={{ borderColor: 'var(--color-border)' }}>
        <button
          onClick={() => navigate('/finance')}
          className="flex-1 px-3 py-2.5 text-sm flex items-center justify-center gap-1.5 border-r hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)' }}
        >
          {getIcon('plus', { size: 13 })} Add Expense
        </button>
        <button
          onClick={() => navigate('/finance')}
          className="flex-1 px-3 py-2.5 text-sm flex items-center justify-center gap-1.5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-muted)' }}
        >
          View all {getIcon('chevron-right', { size: 13 })}
        </button>
      </div>
    </div>
  );
}
