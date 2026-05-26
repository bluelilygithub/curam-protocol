import React, { useState, useEffect, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import api from '../utils/apiClient';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import SimpleLineChart from '../components/shares/SimpleLineChart';
import AllocationPie from '../components/shares/AllocationPie';
import HorizontalBars from '../components/shares/HorizontalBars';

const TABS = [
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'trades', label: 'Trades' },
  { id: 'cash', label: 'Cash' },
  { id: 'charts', label: 'Charts' },
  { id: 'news', label: 'News' },
  { id: 'metals', label: 'Metals' },
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
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUseShares = isAdmin || featureAccess.shares !== false;

  const [tab, setTab] = useState('portfolio');
  const [dashboard, setDashboard] = useState(null);
  const [charts, setCharts] = useState(null);
  const [trades, setTrades] = useState([]);
  const [cashRows, setCashRows] = useState([]);
  const [newsBriefings, setNewsBriefings] = useState([]);
  const [workspaceTz, setWorkspaceTz] = useState('');
  const [generatingNews, setGeneratingNews] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
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
      const [dashRes, chartRes, tradesRes, cashRes, newsRes, tzRes] = await Promise.all([
        api.get('/api/shares/dashboard'),
        api.get('/api/shares/charts'),
        api.get('/api/shares/trades'),
        api.get('/api/shares/cash'),
        api.get('/api/shares/news'),
        api.get('/api/settings/workspace-timezone'),
      ]);
      const [dash, chartData, tradeList, cashList, newsList, tzData] = await Promise.all([
        dashRes.json(),
        chartRes.json(),
        tradesRes.json(),
        cashRes.json(),
        newsRes.json(),
        tzRes.json(),
      ]);
      if (!dashRes.ok) throw new Error(dash.error || 'Failed to load dashboard');
      setDashboard(dash);
      setCharts(chartData);
      setTrades(Array.isArray(tradeList) ? tradeList : []);
      setCashRows(Array.isArray(cashList) ? cashList : []);
      setNewsBriefings(Array.isArray(newsList) ? newsList : []);
      if (tzData?.timezone) setWorkspaceTz(tzData.timezone);
    } catch (err) {
      addToast(err.message || 'Failed to load shares', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const handleGenerateNews = async () => {
    setGeneratingNews(true);
    startProcessing('Generating daily briefing…', 'Searching news and analysing price movements for your holdings.');
    try {
      const res = await api.post('/api/shares/news/generate');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate briefing');
      if (Array.isArray(data.briefings)) setNewsBriefings(data.briefings);
      addToast(data.message || 'Briefing generated', 'success');
      setTab('news');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setGeneratingNews(false);
      stopProcessing();
    }
  };

  const handleGenerateSummary = async () => {
    setGeneratingSummary(true);
    startProcessing('Generating 30-day summary…', 'Reviewing daily signals and market movements over the past month.');
    try {
      const res = await api.post('/api/shares/news/generate-summary');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to generate summary');
      if (Array.isArray(data.briefings)) setNewsBriefings(data.briefings);
      addToast(data.message || '30-day summary generated', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setGeneratingSummary(false);
      stopProcessing();
    }
  };

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
                {dashboard?.totalRealizedPnlAud != null && (
                  <div className="mb-4 px-3 py-2 rounded-lg border text-sm flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                    <span style={{ color: 'var(--color-muted)' }}>Realised P&L</span>
                    <span className="font-semibold" style={{ color: dashboard.totalRealizedPnlAud >= 0 ? '#22c55e' : '#ef4444' }}>
                      {fmtAud(dashboard.totalRealizedPnlAud)}
                    </span>
                  </div>
                )}

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
                {dashboard?.realized?.length > 0 && (
                  <div className="mt-6">
                    <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>REALISED TRADES</p>
                    <div className="overflow-x-auto border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
                      <table className="w-full text-sm">
                        <thead>
                          <tr style={{ background: 'var(--color-surface)' }}>
                            {['Symbol', 'Exch', 'Qty', 'Sell price', 'Avg cost', 'Proceeds', 'P&L', 'Date'].map((h) => (
                              <th key={h} className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {dashboard.realized.map((r) => (
                            <tr key={r.tradeId} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                              <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{r.symbol}</td>
                              <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{r.exchange}</td>
                              <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{r.quantity}</td>
                              <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{fmtAud(r.sellPriceAud)}</td>
                              <td className="px-3 py-2" style={{ color: 'var(--color-muted)' }}>{fmtAud(r.avgCostAud)}</td>
                              <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>{fmtAud(r.proceedsAud)}</td>
                              <td className="px-3 py-2 font-medium" style={{ color: r.pnlAud >= 0 ? '#22c55e' : '#ef4444' }}>
                                {fmtAud(r.pnlAud)}
                                {r.pnlPct != null && <span className="ml-1 text-xs opacity-70">({fmtPct(r.pnlPct)})</span>}
                              </td>
                              <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                                {new Date(r.tradedAt).toLocaleDateString()}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
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

            {tab === 'news' && (
              <NewsTab
                briefings={newsBriefings}
                workspaceTz={workspaceTz}
                generating={generatingNews}
                generatingSummary={generatingSummary}
                onGenerate={handleGenerateNews}
                onGenerateSummary={handleGenerateSummary}
              />
            )}

            {tab === 'metals' && <MetalsTab />}
          </>
        )}
      </>
    </div>
  );
}

// ─── Metals tab ───────────────────────────────────────────────────────────────

const EMPTY_METAL_FORM = {
  description: '',
  coinCount: '',
  coinWeightOz: '0.25',
  weightOz: '',
  paidAud: '',
  spotAudPerOz: '',
  purchasedAt: new Date().toISOString().slice(0, 10),
  notes: '',
};

function MetalsTab() {
  const addToast = useToastStore((s) => s.addToast);
  const [purchases, setPurchases] = React.useState([]);
  const [spot, setSpot] = React.useState(null);
  const [spotError, setSpotError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [fetchingSpot, setFetchingSpot] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY_METAL_FORM });
  const [editingId, setEditingId] = React.useState(null);
  const [deleteId, setDeleteId] = React.useState(null);
  const [saving, setSaving] = React.useState(false);

  const loadPurchases = React.useCallback(async () => {
    try {
      const res = await api.get('/api/metals/purchases');
      const data = await res.json();
      setPurchases(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast('Failed to load metal purchases', 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  const fetchSpot = React.useCallback(async () => {
    setFetchingSpot(true);
    setSpotError(null);
    try {
      const res = await api.get('/api/metals/spot');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch spot');
      setSpot(data);
      return data.audPerOz;
    } catch (err) {
      setSpotError(err.message);
      return null;
    } finally {
      setFetchingSpot(false);
    }
  }, []);

  React.useEffect(() => {
    loadPurchases();
    fetchSpot();
  }, [loadPurchases, fetchSpot]);

  const handleFetchSpotForForm = async () => {
    const audPerOz = await fetchSpot();
    if (audPerOz != null) {
      setForm((f) => ({ ...f, spotAudPerOz: audPerOz.toFixed(2) }));
    }
  };

  const computeWeightOz = (count, coinOz) => {
    const c = Number(count);
    const w = Number(coinOz);
    if (c > 0 && w > 0) return (c * w).toFixed(4);
    return '';
  };

  const handleCoinFieldChange = (field, value) => {
    setForm((f) => {
      const next = { ...f, [field]: value };
      next.weightOz = computeWeightOz(
        field === 'coinCount' ? value : f.coinCount,
        field === 'coinWeightOz' ? value : f.coinWeightOz,
      );
      return next;
    });
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setDeleteId(null);
    setForm({
      description: p.description || '',
      coinCount: '',
      coinWeightOz: '0.25',
      weightOz: String(p.weightOz),
      paidAud: String(p.paidAud),
      spotAudPerOz: p.spotAudPerOz != null ? String(p.spotAudPerOz) : '',
      purchasedAt: String(p.purchasedAt).slice(0, 10),
      notes: p.notes || '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm({ ...EMPTY_METAL_FORM, purchasedAt: new Date().toISOString().slice(0, 10) });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      metal: 'XAU',
      description: form.description || null,
      weightOz: Number(form.weightOz),
      paidAud: Number(form.paidAud),
      spotAudPerOz: form.spotAudPerOz ? Number(form.spotAudPerOz) : null,
      purchasedAt: form.purchasedAt,
      notes: form.notes || null,
    };
    try {
      const res = editingId
        ? await api.put(`/api/metals/purchases/${editingId}`, payload)
        : await api.post('/api/metals/purchases', payload);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');
      addToast(editingId ? 'Purchase updated' : 'Purchase recorded', 'success');
      cancelEdit();
      await loadPurchases();
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id) => {
    try {
      const res = await api.delete(`/api/metals/purchases/${id}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Delete failed');
      }
      addToast('Purchase removed', 'success');
      if (editingId === id) cancelEdit();
      setDeleteId(null);
      await loadPurchases();
    } catch (err) {
      addToast(err.message, 'error');
    }
  };

  // Summary calculations
  const totalOz = purchases.reduce((s, p) => s + Number(p.weightOz), 0);
  const totalCostAud = purchases.reduce((s, p) => s + Number(p.paidAud), 0);
  const currentValueAud = spot?.audPerOz != null ? totalOz * spot.audPerOz : null;
  const pnlAud = currentValueAud != null ? currentValueAud - totalCostAud : null;
  const pnlPct = totalCostAud > 0 && pnlAud != null ? (pnlAud / totalCostAud) * 100 : null;

  const avgPremiumPct = (() => {
    const withSpot = purchases.filter((p) => p.spotAudPerOz != null && Number(p.spotAudPerOz) > 0);
    if (!withSpot.length) return null;
    const weightedPremium = withSpot.reduce((s, p) => {
      const paid = Number(p.paidAud);
      const spotVal = Number(p.spotAudPerOz) * Number(p.weightOz);
      return s + ((paid - spotVal) / spotVal) * 100;
    }, 0);
    return weightedPremium / withSpot.length;
  })();

  if (loading) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;

  return (
    <div>
      {/* Summary cards */}
      {purchases.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total oz (XAU)', value: totalOz > 0 ? `${totalOz.toFixed(4)} oz` : '—' },
            { label: 'Total cost', value: fmtAud(totalCostAud) },
            {
              label: 'Spot value',
              value: fmtAud(currentValueAud),
              sub: spot?.audPerOz ? `${fmtAud(spot.audPerOz)}/oz` : null,
            },
            {
              label: 'Unrealised P&L',
              value: pnlPct != null ? fmtPct(pnlPct) : '—',
              sub: pnlAud != null ? fmtAud(pnlAud) : null,
              pnl: pnlAud,
            },
          ].map((card) => (
            <div
              key={card.label}
              className="rounded-lg p-3 border"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
            >
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{card.label}</p>
              <p
                className="text-lg font-semibold mt-1"
                style={{ color: card.pnl != null ? (card.pnl >= 0 ? '#22c55e' : '#ef4444') : 'var(--color-text)' }}
              >
                {card.value}
              </p>
              {card.sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{card.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {avgPremiumPct != null && (
        <div className="mb-4 px-3 py-2 rounded-lg border text-sm flex items-center gap-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <span style={{ color: 'var(--color-muted)' }}>Avg premium over spot at purchase</span>
          <span className="font-semibold" style={{ color: avgPremiumPct >= 0 ? 'var(--color-text)' : '#22c55e' }}>
            {avgPremiumPct >= 0 ? '+' : ''}{avgPremiumPct.toFixed(2)}%
          </span>
        </div>
      )}

      {spotError && (
        <p className="text-xs mb-4 px-3 py-2 rounded-md" style={{ background: '#fef3c7', color: '#92400e' }}>
          Spot price unavailable: {spotError}
        </p>
      )}

      {/* Refresh spot */}
      <div className="flex items-center justify-between mb-6">
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Gold spot (XAU/AUD){spot?.audPerOz ? `: ${fmtAud(spot.audPerOz)}/oz` : ''}
          {spot?.usdPerOz ? ` · USD ${spot.usdPerOz.toFixed(2)}/oz` : ''}
        </p>
        <button
          type="button"
          onClick={fetchSpot}
          disabled={fetchingSpot}
          className="text-xs px-2 py-1 rounded border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
        >
          {fetchingSpot ? 'Fetching…' : 'Refresh spot'}
        </button>
      </div>

      {/* Add / Edit form */}
      <form onSubmit={handleSubmit} className="mb-8 p-4 rounded-lg border space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
          {editingId ? 'Edit purchase' : 'Record purchase'}
        </p>

        <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
          Description (optional)
          <input
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            placeholder="e.g. 11 × 1/4oz Gold Sovereigns"
            className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
        </label>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
            No. of coins
            <input
              type="number"
              min="0"
              step="1"
              value={form.coinCount}
              onChange={(e) => handleCoinFieldChange('coinCount', e.target.value)}
              placeholder="11"
              className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>
          <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
            Coin weight (oz)
            <input
              type="number"
              min="0"
              step="any"
              value={form.coinWeightOz}
              onChange={(e) => handleCoinFieldChange('coinWeightOz', e.target.value)}
              placeholder="0.25"
              className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>
          <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
            Total weight (oz)
            <input
              required
              type="number"
              min="0"
              step="any"
              value={form.weightOz}
              onChange={(e) => setForm((f) => ({ ...f, weightOz: e.target.value }))}
              placeholder="2.75"
              className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>
          <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
            Total paid (AUD)
            <input
              required
              type="number"
              min="0"
              step="any"
              value={form.paidAud}
              onChange={(e) => setForm((f) => ({ ...f, paidAud: e.target.value }))}
              placeholder="0.00"
              className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
            Purchase date
            <input
              required
              type="date"
              value={form.purchasedAt}
              onChange={(e) => setForm((f) => ({ ...f, purchasedAt: e.target.value }))}
              className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
              style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            />
          </label>
          <label className="block text-xs col-span-2" style={{ color: 'var(--color-muted)' }}>
            Spot price at purchase (AUD/oz)
            <div className="flex gap-2 mt-1">
              <input
                type="number"
                min="0"
                step="any"
                value={form.spotAudPerOz}
                onChange={(e) => setForm((f) => ({ ...f, spotAudPerOz: e.target.value }))}
                placeholder="auto-fetched"
                className="flex-1 px-2 py-1.5 rounded border text-sm"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
              />
              <button
                type="button"
                onClick={handleFetchSpotForForm}
                disabled={fetchingSpot}
                className="text-xs px-3 py-1.5 rounded border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40 whitespace-nowrap"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                {fetchingSpot ? '…' : 'Use current'}
              </button>
            </div>
          </label>
        </div>

        <label className="block text-xs" style={{ color: 'var(--color-muted)' }}>
          Notes (optional)
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Mint, dealer, etc."
            className="mt-1 w-full px-2 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
        </label>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="text-sm px-4 py-2 rounded-md hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {saving ? 'Saving…' : editingId ? 'Update' : 'Save purchase'}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={cancelEdit}
              className="text-sm px-4 py-2 rounded-md border hover:opacity-70 transition-opacity duration-200"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      {/* Purchase list */}
      {!purchases.length ? (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
          No purchases recorded yet.
        </p>
      ) : (
        <div className="overflow-x-auto border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-surface)' }}>
                {['Date', 'Description', 'Weight', 'Paid', 'Spot at buy', 'Premium', 'Current value', 'P&L', ''].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => {
                const oz = Number(p.weightOz);
                const paid = Number(p.paidAud);
                const spotAtBuy = p.spotAudPerOz != null ? Number(p.spotAudPerOz) : null;
                const spotValAtBuy = spotAtBuy != null ? spotAtBuy * oz : null;
                const premiumPct = spotValAtBuy != null && spotValAtBuy > 0
                  ? ((paid - spotValAtBuy) / spotValAtBuy) * 100 : null;
                const currentVal = spot?.audPerOz != null ? oz * spot.audPerOz : null;
                const rowPnl = currentVal != null ? currentVal - paid : null;
                const rowPnlPct = paid > 0 && rowPnl != null ? (rowPnl / paid) * 100 : null;
                return (
                  <tr key={p.id} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {String(p.purchasedAt).slice(0, 10)}
                    </td>
                    <td className="px-3 py-2" style={{ color: 'var(--color-text)' }}>
                      {p.description || <span style={{ color: 'var(--color-muted)' }}>XAU</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                      {oz.toFixed(4)} oz
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                      {fmtAud(paid)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {spotAtBuy != null ? fmtAud(spotAtBuy) : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                      {premiumPct != null ? `+${premiumPct.toFixed(2)}%` : '—'}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                      {fmtAud(currentVal)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium" style={{ color: rowPnl != null ? (rowPnl >= 0 ? '#22c55e' : '#ef4444') : 'var(--color-muted)' }}>
                      {rowPnlPct != null ? fmtPct(rowPnlPct) : '—'}
                      {rowPnl != null && <span className="ml-1 text-xs opacity-70">({fmtAud(rowPnl)})</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {deleteId === p.id ? (
                        <span className="flex gap-2 text-xs">
                          <button type="button" onClick={() => confirmDelete(p.id)} style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setDeleteId(null)} style={{ color: 'var(--color-muted)' }}>No</button>
                        </span>
                      ) : (
                        <span className="flex gap-3 text-xs">
                          <button type="button" onClick={() => startEdit(p)} className="hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Edit</button>
                          <button type="button" onClick={() => setDeleteId(p.id)} className="hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Delete</button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Signal badge ─────────────────────────────────────────────────────────────

const SIGNAL_STYLES = {
  bullish: { bg: '#22c55e', label: 'Bullish' },
  bearish: { bg: '#ef4444', label: 'Bearish' },
  watch:   { bg: '#f59e0b', label: 'Watch' },
  neutral: { bg: '#888888', label: 'Neutral' },
};

function SignalBadge({ signal }) {
  const s = SIGNAL_STYLES[signal] || SIGNAL_STYLES.neutral;
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ background: s.bg + '22', color: s.bg }}
    >
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: s.bg }} />
      {s.label}
    </span>
  );
}

// ─── News tab ─────────────────────────────────────────────────────────────────

function NewsTab({ briefings, workspaceTz, generating, generatingSummary, onGenerate, onGenerateSummary }) {
  const today = workspaceTz
    ? new Intl.DateTimeFormat('en-CA', { timeZone: workspaceTz }).format(new Date())
    : new Date().toLocaleDateString('en-CA');

  const monthlySummaries = briefings.filter((b) => b.type === 'monthly_summary');
  const daily = briefings.filter((b) => b.type !== 'monthly_summary');

  const byDate = {};
  for (const b of daily) {
    const d = b.date.slice(0, 10);
    if (!byDate[d]) byDate[d] = { market: null, stocks: [] };
    if (!b.symbol) byDate[d].market = b;
    else byDate[d].stocks.push(b);
  }
  const dates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const hasToday = !!byDate[today];

  // Accordion — default to most recent date open
  const [openDate, setOpenDate] = React.useState(() => dates[0] || null);
  // Keep openDate in sync when dates list first loads
  React.useEffect(() => {
    if (!openDate && dates.length) setOpenDate(dates[0]);
  }, [dates.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const fmtDate = (dateStr) =>
    dateStr === today
      ? 'Today'
      : new Date(dateStr + 'T12:00:00').toLocaleDateString('en-AU', {
          weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
        });

  // pg returns JSONB columns as already-parsed JS objects — handle both string and object
  const parseJsonb = (val) => {
    if (!val) return {};
    if (typeof val === 'string') { try { return JSON.parse(val); } catch { return {}; } }
    return val;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Daily briefings</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
            Auto-generated at 4 AM · 45-day history · monthly summaries retained permanently
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onGenerateSummary}
            disabled={generatingSummary || generating}
            className="text-sm px-3 py-1.5 rounded-md border hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {generatingSummary ? 'Generating…' : '30-day summary'}
          </button>
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating || generatingSummary}
            className="text-sm px-4 py-1.5 rounded-md hover:opacity-70 transition-opacity duration-200 disabled:opacity-40"
            style={{ background: 'var(--color-primary)', color: '#fff' }}
          >
            {generating ? 'Generating…' : hasToday ? 'Regenerate today' : 'Generate today'}
          </button>
        </div>
      </div>

      {(generating || generatingSummary) && (
        <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>
          {generatingSummary ? 'Reviewing 30 days and generating summary…' : 'Searching news and generating briefing…'}
        </p>
      )}

      {/* Monthly summaries */}
      {monthlySummaries.length > 0 && (
        <div className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-muted)' }}>
            30-day summaries
          </p>
          <div className="space-y-4">
            {monthlySummaries.map((s) => {
              const meta = parseJsonb(s.headlines);
              const stocks = Array.isArray(meta.stocks) ? meta.stocks : [];
              return (
                <div key={s.id} className="p-4 rounded-lg border" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                      {fmtDate(s.date.slice(0, 10))}
                    </span>
                    {meta.period && (
                      <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--color-border)', color: 'var(--color-muted)' }}>
                        {meta.period}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed mb-3" style={{ color: 'var(--color-text)' }}>{s.content}</p>
                  {stocks.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {stocks.map((stock, i) => (
                        <div key={i} className="text-xs p-2 rounded" style={{ background: 'var(--color-bg)' }}>
                          <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{stock.symbol}</span>
                          <span className="ml-1.5" style={{ color: 'var(--color-muted)' }}>{stock.exchange}</span>
                          {stock.trend && <span className="ml-2" style={{ color: 'var(--color-text)' }}>{stock.trend}</span>}
                          {stock.signalAccuracy && (
                            <p className="mt-0.5 italic" style={{ color: 'var(--color-muted)' }}>{stock.signalAccuracy}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {meta.adviceQuality && (
                    <p className="text-xs italic border-t pt-2 mt-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                      Advice quality: {meta.adviceQuality}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Daily briefings — accordion, one day open at a time */}
      {!dates.length && !generating && !generatingSummary && (
        <p className="text-sm text-center py-12" style={{ color: 'var(--color-muted)' }}>
          No briefings yet. Click "Generate today" to create today's briefing.
        </p>
      )}

      <div className="space-y-2">
        {dates.map((date) => {
          const { market, stocks } = byDate[date];
          const isOpen = openDate === date;
          const allSignals = [market, ...stocks].filter(Boolean).map((b) => b.signal);
          // Show the most severe signal in the collapsed header
          const headerSignal = allSignals.includes('bearish') ? 'bearish'
            : allSignals.includes('bullish') ? 'bullish'
            : allSignals.includes('watch') ? 'watch'
            : allSignals.length ? 'neutral' : null;

          return (
            <div key={date} className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              {/* Accordion header */}
              <button
                type="button"
                onClick={() => setOpenDate(isOpen ? null : date)}
                className="w-full flex items-center justify-between px-4 py-3 hover:opacity-70 transition-opacity duration-200 text-left"
                style={{ background: 'var(--color-surface)' }}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{fmtDate(date)}</span>
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {stocks.length} stock{stocks.length !== 1 ? 's' : ''}{market ? ' · market' : ''}
                  </span>
                  {headerSignal && <SignalBadge signal={headerSignal} />}
                </div>
                <span className="text-xs ml-2" style={{ color: 'var(--color-muted)' }}>{isOpen ? '▲' : '▼'}</span>
              </button>

              {/* Accordion body */}
              {isOpen && (
                <div className="px-4 pb-4 pt-1">
                  {market && (
                    <div className="mb-4 p-3 rounded-lg border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Market overview</span>
                        <SignalBadge signal={market.signal} />
                      </div>
                      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{market.content}</p>
                    </div>
                  )}

                  {stocks.length > 0 && (
                    <div className="space-y-3">
                      {stocks.map((b) => {
                        const headlines = Array.isArray(b.headlines) ? b.headlines : parseJsonb(b.headlines);
                        return (
                          <div key={b.id} className="p-3 rounded-lg border" style={{ borderColor: 'var(--color-border)' }}>
                            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                              <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{b.symbol}</span>
                              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{b.exchange}</span>
                              {b.priceChangePct != null && (
                                <span className="text-xs font-medium" style={{ color: Number(b.priceChangePct) >= 0 ? '#22c55e' : '#ef4444' }}>
                                  {Number(b.priceChangePct) >= 0 ? '+' : ''}{Number(b.priceChangePct).toFixed(2)}%
                                </span>
                              )}
                              <SignalBadge signal={b.signal} />
                            </div>
                            <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>{b.content}</p>
                            {Array.isArray(headlines) && headlines.length > 0 && (
                              <ul className="mt-2 space-y-0.5">
                                {headlines.slice(0, 3).map((h, i) => (
                                  <li key={i} className="text-xs" style={{ color: 'var(--color-muted)' }}>· {h}</li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!market && !stocks.length && (
                    <p className="text-xs py-2" style={{ color: 'var(--color-muted)' }}>Nothing to report for this date.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
