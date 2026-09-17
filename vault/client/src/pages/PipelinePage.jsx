import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';

// Workspace-wide, cross-client view of client_deals — independent of the
// per-client Deals section on ClientDetailPage, which stays as-is. Table
// view first (matches this build's MVP-first sequencing); kanban/drag-drop
// stage changes and aggregate stats (win rate, value by stage) are explicit
// later phases, not this pass. See docs/crm-deals-schema.md.

// ── Formatters ─────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ── Stage config — same palette as ClientDetailPage's DealStageBadge ───────────

const DEAL_STAGE_MAP = {
  lead:        { label: 'Lead',        bg: 'var(--color-border)', color: 'var(--color-muted)' },
  qualified:   { label: 'Qualified',   bg: '#dbeafe', color: '#1e40af' },
  proposal:    { label: 'Proposal',    bg: '#fef3c7', color: '#92400e' },
  negotiation: { label: 'Negotiation', bg: '#fde68a', color: '#78350f' },
  won:         { label: 'Won',         bg: '#d1fae5', color: '#065f46' },
  lost:        { label: 'Lost',        bg: '#fee2e2', color: '#991b1b' },
};
const STAGE_ORDER = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

function DealStageBadge({ stage }) {
  const s = DEAL_STAGE_MAP[stage] || DEAL_STAGE_MAP.lead;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: s.bg, color: s.color }}>
      {s.label}
    </span>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PipelinePage() {
  const navigate = useNavigate();

  const [deals,       setDeals]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [stageFilter, setStageFilter] = useState([]); // [] = all stages
  const [openOnly,    setOpenOnly]    = useState(true);
  const [sortBy,      setSortBy]      = useState('closeDate');
  const [order,       setOrder]       = useState('asc');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (stageFilter.length) params.set('stage', stageFilter.join(','));
      if (openOnly) params.set('open', 'true');
      params.set('sortBy', sortBy);
      params.set('order', order);
      const res  = await api.get(`/api/deals?${params}`);
      const data = await res.json();
      setDeals(Array.isArray(data) ? data : []);
    } catch {
      setDeals([]);
    } finally {
      setLoading(false);
    }
  }, [stageFilter, openOnly, sortBy, order]);

  useEffect(() => { load(); }, [load]);

  const toggleStage = (stage) => {
    setStageFilter(prev => prev.includes(stage) ? prev.filter(s => s !== stage) : [...prev, stage]);
  };

  const toggleSort = (col) => {
    if (sortBy === col) {
      setOrder(o => o === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(col);
      setOrder('asc');
    }
  };

  const sortIndicator = (col) => sortBy === col ? (order === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Pipeline</h1>
      </div>

      {/* Filter bar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-5">
        <div className="flex gap-1 flex-wrap">
          {STAGE_ORDER.map(stage => (
            <button
              key={stage}
              onClick={() => toggleStage(stage)}
              className="px-3 py-1 text-xs rounded-full font-medium transition-colors"
              style={{
                background: stageFilter.includes(stage) ? 'var(--color-primary)' : 'var(--color-surface)',
                color:      stageFilter.includes(stage) ? '#fff'                  : 'var(--color-muted)',
                border:     '1px solid var(--color-border)',
              }}
            >
              {DEAL_STAGE_MAP[stage].label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs cursor-pointer sm:ml-2" style={{ color: 'var(--color-muted)' }}>
          <input type="checkbox" checked={openOnly} onChange={e => setOpenOnly(e.target.checked)} />
          Open only
        </label>
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      )}

      {/* Empty state */}
      {!loading && deals.length === 0 && (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--color-muted)' }}>
          {stageFilter.length || openOnly ? 'No deals match those filters.' : 'No deals yet — add one from a client\'s Deals section.'}
        </p>
      )}

      {/* Table */}
      {!loading && deals.length > 0 && (
        <div className="overflow-x-auto rounded-xl border" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b" style={{ borderColor: 'var(--color-border)' }}>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Client</th>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Deal</th>
                <th
                  className="text-left py-2 px-3 font-medium cursor-pointer select-none"
                  style={{ color: 'var(--color-muted)' }}
                  onClick={() => toggleSort('stage')}
                >
                  Stage{sortIndicator('stage')}
                </th>
                <th
                  className="text-right py-2 px-3 font-medium cursor-pointer select-none"
                  style={{ color: 'var(--color-muted)' }}
                  onClick={() => toggleSort('value')}
                >
                  Value{sortIndicator('value')}
                </th>
                <th
                  className="text-left py-2 px-3 font-medium cursor-pointer select-none"
                  style={{ color: 'var(--color-muted)' }}
                  onClick={() => toggleSort('closeDate')}
                >
                  Expected close{sortIndicator('closeDate')}
                </th>
                <th className="text-left py-2 px-3 font-medium" style={{ color: 'var(--color-muted)' }}>Actual close</th>
              </tr>
            </thead>
            <tbody>
              {deals.map(d => (
                <tr
                  key={d.id}
                  onClick={() => navigate(`/clients/${d.clientId}`)}
                  className="border-b last:border-b-0 cursor-pointer hover:opacity-70 transition-opacity"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{d.clientName}</td>
                  <td className="py-2 px-3" style={{ color: 'var(--color-text)' }}>{d.title}</td>
                  <td className="py-2 px-3"><DealStageBadge stage={d.stage} /></td>
                  <td className="py-2 px-3 text-right" style={{ color: 'var(--color-text)' }}>{fmt(d.value)}</td>
                  <td className="py-2 px-3" style={{ color: 'var(--color-muted)' }}>{fmtDate(d.expectedCloseDate)}</td>
                  <td className="py-2 px-3" style={{ color: 'var(--color-muted)' }}>{fmtDate(d.actualCloseDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
