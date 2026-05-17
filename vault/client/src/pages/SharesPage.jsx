import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import SimpleLineChart from '../components/shares/SimpleLineChart';
import AllocationPie from '../components/shares/AllocationPie';
import HorizontalBars from '../components/shares/HorizontalBars';

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'trades', label: 'Trades' },
  { id: 'cash', label: 'Cash' },
  { id: 'charts', label: 'Charts' },
];

const fmtAud = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);
};

const fmtPct = (n) => {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

function todayInputValue() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toDatetimeLocal(iso) {
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

const EMPTY_TRADE_FORM = {
  symbol: '',
  exchange: 'ASX',
  side: 'buy',
  quantity: '',
  pricePerShare: '',
  feesAud: '0',
  tradedAt: todayInputValue(),
  notes: '',
};

const EMPTY_CASH_FORM = { type: 'deposit', amountAud: '', note: '' };

export default function SharesPage() {
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const addToast = useToastStore((s) => s.addToast);
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUseShares = isAdmin || featureAccess.shares !== false;

  const [tab, setTab] = useState('portfolio');
  const [dashboard, setDashboard] = useState(null);
  const [charts, setCharts] = useState(null);
  const [trades, setTrades] = useState([]);
  const [cashRows, setCashRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [tradeForm, setTradeForm] = useState({ ...EMPTY_TRADE_FORM, tradedAt: todayInputValue() });
  const [cashForm, setCashForm] = useState({ ...EMPTY_CASH_FORM });
  const [editingTradeId, setEditingTradeId] = useState(null);
  const [editingCashId, setEditingCashId] = useState(null);
  const [deleteTradeId, setDeleteTradeId] = useState(null);
  const [deleteCashId, setDeleteCashId] = useState(null);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((data) => {
        if (data?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...data.flags });
      })
      .catch(() => {});
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dashRes, chartRes, tradesRes, cashRes] = await Promise.all([
        api.get('/api/shares/dashboard'),
        api.get('/api/shares/charts'),
        api.get('/api/shares/trades'),
        api.get('/api/shares/cash'),
      ]);
      const [dash, chartData, tradeList, cashList] = await Promise.all([
        dashRes.json(),
        chartRes.json(),
        tradesRes.json(),
        cashRes.json(),
      ]);
      if (!dashRes.ok) throw new Error(dash.error || 'Failed to load dashboard');
      setDashboard(dash);
      setCharts(chartData);
      setTrades(Array.isArray(tradeList) ? tradeList : []);
      setCashRows(Array.isArray(cashList) ? cashList : []);
    } catch (err) {
      addToast(err.message || 'Failed to load shares', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (canUseShares) loadAll();
  }, [canUseShares, loadAll]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const res = await api.post('/api/shares/refresh');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');
      setDashboard(data.dashboard);
      const chartRes = await api.get('/api/shares/charts');
      setCharts(await chartRes.json());
      addToast('Quotes updated', 'success');
    } catch (err) {
      addToast(err.message || 'Refresh failed', 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const cancelTradeEdit = () => {
    setEditingTradeId(null);
    setTradeForm({ ...EMPTY_TRADE_FORM, tradedAt: todayInputValue() });
  };

  const startEditTrade = (t) => {
    setEditingTradeId(t.id);
    setDeleteTradeId(null);
    setTradeForm({
      symbol: t.symbol,
      exchange: t.exchange === 'NYSE' || t.exchange === 'NASDAQ' ? t.exchange : 'ASX',
      side: t.side,
      quantity: String(t.quantity),
      pricePerShare: String(t.pricePerShare),
      feesAud: String(t.feesAud ?? 0),
      tradedAt: toDatetimeLocal(t.tradedAt),
      notes: t.notes || '',
    });
    setTab('trades');
  };

  const submitTrade = async (e) => {
    e.preventDefault();
    const payload = {
      ...tradeForm,
      quantity: Number(tradeForm.quantity),
      pricePerShare: Number(tradeForm.pricePerShare),
      feesAud: Number(tradeForm.feesAud) || 0,
      tradedAt: new Date(tradeForm.tradedAt).toISOString(),
    };
    try {
      const res = editingTradeId
        ? await api.put(`/api/shares/trades/${editingTradeId}`, payload)
        : await api.post('/api/shares/trades', payload);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save trade');
      const wasEdit = Boolean(editingTradeId);
      addToast(wasEdit ? 'Trade updated' : 'Trade recorded', 'success');
      cancelTradeEdit();
      await loadAll();
      if (!wasEdit) setTab('portfolio');
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const cancelCashEdit = () => {
    setEditingCashId(null);
    setCashForm({ ...EMPTY_CASH_FORM });
  };

  const startEditCash = (c) => {
    setEditingCashId(c.id);
    setDeleteCashId(null);
    setCashForm({
      type: c.type,
      amountAud: String(c.amountAud),
      note: c.note || '',
    });
    setTab('cash');
  };

  const submitCash = async (e) => {
    e.preventDefault();
    const payload = {
      type: cashForm.type,
      amountAud: Number(cashForm.amountAud),
      note: cashForm.note || null,
    };
    try {
      const res = editingCashId
        ? await api.put(`/api/shares/cash/${editingCashId}`, payload)
        : await api.post('/api/shares/cash', payload);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save cash entry');
      addToast(editingCashId ? 'Cash entry updated' : 'Cash entry recorded', 'success');
      cancelCashEdit();
      await loadAll();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const confirmDeleteTrade = async (id) => {
    try {
      const res = await api.delete(`/api/shares/trades/${id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      addToast('Trade removed', 'success');
      if (editingTradeId === id) cancelTradeEdit();
      setDeleteTradeId(null);
      await loadAll();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  const confirmDeleteCash = async (id) => {
    try {
      const res = await api.delete(`/api/shares/cash/${id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      addToast('Cash entry removed', 'success');
      if (editingCashId === id) cancelCashEdit();
      setDeleteCashId(null);
      await loadAll();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  if (!canUseShares) {
    return <Navigate to="/" replace />;
  }

  const symbolChartKeys = charts?.bySymbol ? Object.keys(charts.bySymbol) : [];

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>Shares</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              Portfolio in AUD · delayed quotes · not financial advice
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-sm px-3 py-1.5 rounded-md hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {refreshing ? 'Refreshing…' : 'Refresh quotes'}
          </button>
        </div>

        {dashboard?.quoteError && (
          <p className="text-xs mb-4 px-3 py-2 rounded-md" style={{ background: '#fef3c7', color: '#92400e' }}>
            Quote warning: {dashboard.quoteError}
          </p>
        )}

        <div className="flex gap-1 mb-6 border-b overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="px-3 py-2 text-sm whitespace-nowrap hover:opacity-70 transition-opacity duration-200"
              style={{
                color: tab === t.id ? 'var(--color-primary)' : 'var(--color-muted)',
                borderBottom: tab === t.id ? '2px solid var(--color-primary)' : '2px solid transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : (
          <>
            {tab === 'portfolio' && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  {[
                    { label: 'Total (AUD)', value: fmtAud(dashboard?.totalValueAud) },
                    { label: 'Holdings', value: fmtAud(dashboard?.holdingsValueAud) },
                    { label: 'Cash', value: fmtAud(dashboard?.cashAud) },
                    {
                      label: 'Unrealised P&L',
                      value: fmtPct(dashboard?.unrealizedPnlPct),
                      sub: fmtAud(dashboard?.unrealizedPnlAud),
                    },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="rounded-lg p-3 border"
                      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                    >
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{card.label}</p>
                      <p className="text-lg font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{card.value}</p>
                      {card.sub && (
                        <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{card.sub}</p>
                      )}
                    </div>
                  ))}
                </div>

                {!dashboard?.positions?.length ? (
                  <p className="text-sm py-8 text-center" style={{ color: 'var(--color-muted)' }}>
                    No open positions. Record a buy under Trades.
                  </p>
                ) : (
                  <div className="overflow-x-auto border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
                    <table className="w-full text-sm">
                      <thead>
                        <tr style={{ background: 'var(--color-surface)' }}>
                          {['Symbol', 'Exch', 'Qty', 'Avg cost', 'Price', 'Value', 'P&L', 'Day'].map((h) => (
                            <th key={h} className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dashboard.positions.map((p) => (
                          <tr key={`${p.symbol}-${p.exchange}`} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                            <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{p.symbol}</td>
                            <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{p.exchange}</td>
                            <td className="px-3 py-2">{p.quantity}</td>
                            <td className="px-3 py-2">{fmtAud(p.avgCostAud)}</td>
                            <td className="px-3 py-2">{fmtAud(p.priceAud)}</td>
                            <td className="px-3 py-2">{fmtAud(p.valueAud)}</td>
                            <td className="px-3 py-2" style={{ color: (p.pnlAud ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                              {fmtPct(p.pnlPct)}
                            </td>
                            <td className="px-3 py-2" style={{ color: (p.dayChangePct ?? 0) >= 0 ? '#22c55e' : '#ef4444' }}>
                              {p.dayChangePct != null ? fmtPct(p.dayChangePct) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {tab === 'trades' && (
              <>
                <form onSubmit={submitTrade} className="mb-8 p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {editingTradeId ? 'Edit trade' : 'Record trade'}
                  </p>
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        Symbol
                        <input
                          required
                          value={tradeForm.symbol}
                          onChange={(e) => setTradeForm((f) => ({ ...f, symbol: e.target.value.toUpperCase() }))}
                          placeholder="CBA or AAPL"
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        />
                      </label>
                      <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        Exchange
                        <select
                          value={tradeForm.exchange}
                          onChange={(e) => setTradeForm((f) => ({ ...f, exchange: e.target.value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        >
                          <option value="ASX">ASX</option>
                          <option value="NYSE">NYSE</option>
                          <option value="NASDAQ">NASDAQ</option>
                        </select>
                      </label>
                      <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        Side
                        <select
                          value={tradeForm.side}
                          onChange={(e) => setTradeForm((f) => ({ ...f, side: e.target.value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        >
                          <option value="buy">Buy</option>
                          <option value="sell">Sell</option>
                        </select>
                      </label>
                      <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        Quantity
                        <input
                          required
                          type="number"
                          min="0"
                          step="any"
                          value={tradeForm.quantity}
                          onChange={(e) => setTradeForm((f) => ({ ...f, quantity: e.target.value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        />
                      </label>
                      <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        Price / share (AUD)
                        <input
                          required
                          type="number"
                          min="0"
                          step="any"
                          value={tradeForm.pricePerShare}
                          onChange={(e) => setTradeForm((f) => ({ ...f, pricePerShare: e.target.value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        />
                      </label>
                      <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                        Fees (AUD)
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={tradeForm.feesAud}
                          onChange={(e) => setTradeForm((f) => ({ ...f, feesAud: e.target.value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        />
                      </label>
                      <label className="block text-xs col-span-2 sm:col-span-1" style={{ color: 'var(--color-muted)' }}>
                        Date & time
                        <input
                          required
                          type="datetime-local"
                          value={tradeForm.tradedAt}
                          onChange={(e) => setTradeForm((f) => ({ ...f, tradedAt: e.target.value }))}
                          className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        />
                      </label>
                    </div>
                  </>
                  <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="text-sm px-4 py-2 rounded-md hover:opacity-70 transition-opacity duration-200"
                        style={{ background: 'var(--color-primary)', color: '#fff' }}
                      >
                        {editingTradeId ? 'Update trade' : 'Save trade'}
                      </button>
                      {editingTradeId && (
                        <button
                          type="button"
                          onClick={cancelTradeEdit}
                          className="text-sm px-4 py-2 rounded-md border hover:opacity-70 transition-opacity duration-200"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                        >
                          Cancel
                        </button>
                      )}
                  </div>
                </form>

                <ul className="space-y-2">
                  {trades.map((t) => (
                    <li
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-lg border text-sm"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <span style={{ color: 'var(--color-text)' }}>
                        <span className={t.side === 'buy' ? 'text-green-600' : 'text-red-500'}>{t.side}</span>
                        {' '}{t.quantity} × {t.symbol} ({t.exchange}) @ {fmtAud(t.pricePerShare)}
                        <span className="ml-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                          {new Date(t.tradedAt).toLocaleString()}
                        </span>
                      </span>
                      {deleteTradeId === t.id ? (
                        <span className="flex gap-2 text-xs">
                          <button type="button" onClick={() => confirmDeleteTrade(t.id)} className="hover:opacity-70" style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setDeleteTradeId(null)} className="hover:opacity-70" style={{ color: 'var(--color-muted)' }}>No</button>
                        </span>
                      ) : (
                        <span className="flex gap-3 text-xs">
                          <button type="button" onClick={() => startEditTrade(t)} className="hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Edit</button>
                          <button type="button" onClick={() => setDeleteTradeId(t.id)} className="hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Delete</button>
                        </span>
                      )}
                    </li>
                  ))}
                  {!trades.length && (
                    <p className="text-xs text-center py-4" style={{ color: 'var(--color-muted)' }}>No trades yet.</p>
                  )}
                </ul>
              </>
            )}

            {tab === 'cash' && (
              <>
                <form onSubmit={submitCash} className="mb-8 p-4 rounded-lg border space-y-3 max-w-md" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                    {editingCashId ? 'Edit cash' : 'Cash (AUD)'}
                  </p>
                  <select
                    value={cashForm.type}
                    onChange={(e) => setCashForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded border text-sm"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  >
                    <option value="deposit">Deposit</option>
                    <option value="withdraw">Withdraw</option>
                  </select>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="Amount AUD"
                    value={cashForm.amountAud}
                    onChange={(e) => setCashForm((f) => ({ ...f, amountAud: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded border text-sm"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  />
                  <input
                    placeholder="Note (optional)"
                    value={cashForm.note}
                    onChange={(e) => setCashForm((f) => ({ ...f, note: e.target.value }))}
                    className="w-full px-2 py-1.5 rounded border text-sm"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="submit"
                      className="text-sm px-4 py-2 rounded-md hover:opacity-70 transition-opacity duration-200"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}
                    >
                      {editingCashId ? 'Update' : 'Save'}
                    </button>
                    {editingCashId && (
                      <button
                        type="button"
                        onClick={cancelCashEdit}
                        className="text-sm px-4 py-2 rounded-md border hover:opacity-70 transition-opacity duration-200"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
                <p className="text-sm mb-3" style={{ color: 'var(--color-text)' }}>
                  Balance (incl. trade settlements): <strong>{fmtAud(dashboard?.cashAud)}</strong>
                </p>
                <ul className="space-y-2">
                  {cashRows.map((c) => (
                    <li
                      key={c.id}
                      className="flex justify-between items-center px-3 py-2 rounded-lg border text-sm"
                      style={{ borderColor: 'var(--color-border)' }}
                    >
                      <span style={{ color: 'var(--color-text)' }}>
                        {c.type} {fmtAud(c.amountAud)}
                        {c.note && <span className="ml-2 text-xs" style={{ color: 'var(--color-muted)' }}>{c.note}</span>}
                      </span>
                      {deleteCashId === c.id ? (
                        <span className="flex gap-2 text-xs">
                          <button type="button" onClick={() => confirmDeleteCash(c.id)} style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setDeleteCashId(null)} style={{ color: 'var(--color-muted)' }}>No</button>
                        </span>
                      ) : (
                        <span className="flex gap-3 text-xs">
                          <button type="button" onClick={() => startEditCash(c)} className="hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Edit</button>
                          <button type="button" onClick={() => setDeleteCashId(c.id)} className="hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Delete</button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}

            {tab === 'charts' && charts && (
              <>
                <section className="mb-8 p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Portfolio value (today)</h2>
                  <SimpleLineChart points={charts.portfolioLine} valueKey="totalValueAud" label="Total AUD" />
                </section>
                <section className="mb-8 p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Holdings value (today)</h2>
                  <SimpleLineChart points={charts.portfolioLine} valueKey="holdingsValueAud" label="Holdings AUD" />
                </section>
                <section className="mb-8 p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Allocation</h2>
                  <AllocationPie slices={charts.allocation} />
                </section>
                <section className="mb-8 p-4 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                  <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>Unrealised P&L by holding</h2>
                  <HorizontalBars items={charts.holdingPnl} valueKey="pnlPct" />
                </section>
                {symbolChartKeys.map((sym) => (
                  <section
                    key={sym}
                    className="mb-6 p-4 rounded-lg border"
                    style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  >
                    <h2 className="text-sm font-medium mb-3" style={{ color: 'var(--color-text)' }}>{sym} value (today)</h2>
                    <SimpleLineChart points={charts.bySymbol[sym]} valueKey="valueAud" label={`${sym} AUD`} />
                  </section>
                ))}
              </>
            )}
          </>
        )}
      </>
    </div>
  );
}
