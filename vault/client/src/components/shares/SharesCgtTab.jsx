import React, { useState, useEffect, useMemo } from 'react';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';

// Capital gains by parcel (FIFO), in AUD, with the 12-month CGT-discount test.
// All figures come from GET /api/shares/cgt (server/services/sharesCgt.js) — nothing is summed
// or re-derived here except an indicative market value for parcels still held.

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const fmtAud = (n) => (n == null ? '—' : AUD.format(Number(n) || 0));
const fmtDate = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const gainColor = (n) => (Number(n) >= 0 ? '#22c55e' : '#ef4444');

function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="rounded-lg p-3 border" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-lg font-semibold mt-1" style={{ color: color || 'var(--color-text)' }}>{value}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{sub}</p>}
    </div>
  );
}

function Th({ children, right }) {
  return <th className={`px-3 py-2 text-xs font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)' }}>{children}</th>;
}

export default function SharesCgtTab({ positions = [] }) {
  const addToast = useToastStore((s) => s.addToast);
  const [fy, setFy] = useState(null); // null = server default (current FY)
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/shares/cgt${fy ? `?fy=${encodeURIComponent(fy)}` : ''}`)
      .then(async (r) => {
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Failed to load CGT (${r.status})`);
        return body;
      })
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e) => { if (!cancelled) addToast(e.message, 'error'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fy, addToast]);

  const priceByKey = useMemo(() => {
    const m = {};
    for (const p of positions) if (p.priceAud != null) m[`${p.symbol}:${p.exchange}`] = Number(p.priceAud);
    return m;
  }, [positions]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      [`Capital gains by parcel — FY ${data.fy}`], [`FIFO, AUD, trade dates (${data.timezone})`], [],
      ['Symbol', 'Exchange', 'Bought', 'Sold', 'Days held', 'Quantity', 'Cost AUD', 'Proceeds AUD', 'Gain/loss AUD', 'Discount eligible', 'Eligible from', 'Gain after discount AUD'],
      ...data.disposals.map((d) => [d.symbol, d.exchange, d.acquiredOn, d.soldOn, d.daysHeld, d.quantity, d.costAud.toFixed(2), d.proceedsAud.toFixed(2), d.gainAud.toFixed(2), d.discountEligible ? 'Yes' : 'No', d.eligibleFrom, d.discountedGainAud.toFixed(2)]),
      [], ['Gains eligible for discount', data.summary.gainsDiscountableAud.toFixed(2)], ['Other gains', data.summary.gainsOtherAud.toFixed(2)],
      ['Losses', data.summary.lossesAud.toFixed(2)], ['Discount (50%)', data.summary.discountAmountAud.toFixed(2)],
      ['Indicative net capital gain', data.summary.netCapitalGainAud.toFixed(2)], ['Loss carried forward', data.summary.lossCarriedForwardAud.toFixed(2)],
    ];
    downloadCsv(`cgt-parcels-${data.fy}.csv`, rows);
  };

  if (loading && !data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (!data) return null;
  const s = data.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Capital gains by parcel</p>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Each sale is matched to your oldest purchases first (FIFO). AUD, by trade date.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={data.fy}
            onChange={(e) => setFy(e.target.value)}
            className="px-2 py-1.5 rounded border text-sm"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
            title="Financial year of the sale (1 July – 30 June)"
          >
            {data.fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
            <option value="all">All years</option>
          </select>
          <button
            type="button"
            onClick={exportCsv}
            className="text-sm px-3 py-1.5 rounded-md border hover:opacity-70 transition-opacity duration-200"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {data.warnings.length > 0 && (
        <div className="rounded-lg border p-3 text-sm space-y-1" style={{ borderColor: '#f59e0b', background: '#fef3c7', color: '#b45309' }}>
          {data.warnings.map((w) => <p key={w}>⚠ {w}</p>)}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Gains eligible for discount" value={fmtAud(s.gainsDiscountableAud)} sub="held more than 12 months" />
        <StatCard label="Other gains" value={fmtAud(s.gainsOtherAud)} sub="held 12 months or less" />
        <StatCard label="Losses" value={fmtAud(s.lossesAud)} color={s.lossesAud > 0 ? '#ef4444' : undefined} />
        <StatCard
          label="Indicative net capital gain"
          value={fmtAud(s.netCapitalGainAud)}
          sub={`after ${fmtAud(s.discountAmountAud)} discount (${data.discountRatePct}%)${s.lossCarriedForwardAud > 0 ? ` · ${fmtAud(s.lossCarriedForwardAud)} loss carried forward` : ''}`}
        />
      </div>

      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>SOLD PARCELS — {data.fy === 'all' ? 'ALL YEARS' : `FY ${data.fy}`}</p>
        {data.disposals.length === 0 ? (
          <p className="text-xs py-3" style={{ color: 'var(--color-muted)' }}>No sales in this period.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)' }}>
                  <Th>Symbol</Th><Th>Bought</Th><Th>Sold</Th><Th right>Days held</Th><Th right>Qty</Th>
                  <Th right>Cost</Th><Th right>Proceeds</Th><Th right>Gain / loss</Th><Th>12-month test</Th><Th right>After discount</Th>
                </tr>
              </thead>
              <tbody>
                {data.disposals.map((d) => (
                  <tr key={d.key} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{d.symbol} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>{d.exchange}</span></td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(d.acquiredOn)}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(d.soldOn)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{d.daysHeld}</td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{d.quantity}</td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{fmtAud(d.costAud)}</td>
                    <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{fmtAud(d.proceedsAud)}</td>
                    <td className="px-3 py-2 text-right font-medium" style={{ color: gainColor(d.gainAud) }}>{fmtAud(d.gainAud)}</td>
                    <td className="px-3 py-2 text-xs">
                      {d.discountEligible
                        ? <span style={{ color: '#22c55e' }}>✓ Eligible</span>
                        : <span style={{ color: 'var(--color-muted)' }}>No — eligible from {fmtDate(d.eligibleFrom)}</span>}
                    </td>
                    <td className="px-3 py-2 text-right" style={{ color: gainColor(d.discountedGainAud) }}>{fmtAud(d.discountedGainAud)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>PARCELS STILL HELD</p>
        {data.openParcels.length === 0 ? (
          <p className="text-xs py-3" style={{ color: 'var(--color-muted)' }}>No open parcels.</p>
        ) : (
          <div className="overflow-x-auto border rounded-lg" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)' }}>
                  <Th>Symbol</Th><Th>Bought</Th><Th right>Qty</Th><Th right>Cost</Th><Th right>Value now</Th><Th right>Unrealised</Th><Th>12-month test</Th>
                </tr>
              </thead>
              <tbody>
                {data.openParcels.map((p) => {
                  const price = priceByKey[`${p.symbol}:${p.exchange}`];
                  const value = price != null ? price * p.quantity : null;
                  const unreal = value != null ? value - p.costAud : null;
                  return (
                    <tr key={`${p.parcelTradeId}`} className="border-t" style={{ borderColor: 'var(--color-border)' }}>
                      <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{p.symbol} <span className="text-xs font-normal" style={{ color: 'var(--color-muted)' }}>{p.exchange}</span></td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{fmtDate(p.acquiredOn)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{p.quantity}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{fmtAud(p.costAud)}</td>
                      <td className="px-3 py-2 text-right" style={{ color: 'var(--color-text)' }}>{fmtAud(value)}</td>
                      <td className="px-3 py-2 text-right font-medium" style={{ color: unreal == null ? 'var(--color-muted)' : gainColor(unreal) }}>{fmtAud(unreal)}</td>
                      <td className="px-3 py-2 text-xs">
                        {p.discountEligibleNow
                          ? <span style={{ color: '#22c55e' }}>✓ Eligible now</span>
                          : <span style={{ color: 'var(--color-muted)' }}>From {fmtDate(p.eligibleFrom)} ({p.daysUntilEligible} day{p.daysUntilEligible === 1 ? '' : 's'})</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Value now uses the latest quote on the Portfolio tab. Unrealised amounts are before any discount.</p>
      </div>

      <div className="text-xs space-y-1 pt-3 border-t" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
        <p className="font-medium" style={{ color: 'var(--color-text)' }}>How this is calculated</p>
        <p>• <strong>FIFO:</strong> a sale uses your oldest unsold purchase first. The Portfolio tab's Realised P&amp;L uses average cost, so its figures will differ.</p>
        <p>• <strong>Trade date, not settlement date,</strong> read as the calendar day in {data.timezone}.</p>
        <p>• <strong>12-month test:</strong> neither the purchase day nor the sale day counts — bought 1 Jan 2025, the first eligible sale is 2 Jan 2026.</p>
        <p>• <strong>AUD as stored:</strong> cost and proceeds are the AUD figures on your trades (what your broker settled) — nothing is re-converted at an exchange rate.</p>
        <p>• Cost includes buying brokerage; proceeds are after selling brokerage. The discount is {data.discountRatePct}% (an individual); losses are applied to gains that don't qualify for the discount first. Prior-year losses are not included.</p>
        <p>An indicative view for your accountant — not tax advice.</p>
      </div>
    </div>
  );
}
