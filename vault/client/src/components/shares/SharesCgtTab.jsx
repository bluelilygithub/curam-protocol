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

function Th({ children, right }) {
  return <th className={`px-3 py-2 text-xs font-medium whitespace-nowrap ${right ? 'text-right' : 'text-left'}`} style={{ color: 'var(--color-muted)' }}>{children}</th>;
}

function TotalsRow({ label, value, indent, bold, color, top }) {
  return (
    <tr className={top ? 'border-t' : ''} style={{ borderColor: 'var(--color-border)' }}>
      <td className={`py-1.5 pr-3 ${indent ? 'pl-6' : 'pl-3'} ${bold ? 'font-semibold' : ''}`} style={{ color: indent ? 'var(--color-muted)' : 'var(--color-text)' }}>{label}</td>
      <td className={`py-1.5 px-3 text-right tabular-nums ${bold ? 'font-semibold' : ''}`} style={{ color: color || 'var(--color-text)' }}>{fmtAud(value)}</td>
    </tr>
  );
}

// The year's capital gains working, step by step: total gains, losses applied (to gains that
// don't qualify for the discount first), discount on what remains, then the net result.
function FyTotals({ t, ratePct }) {
  const isLoss = t.lossCarriedForwardAud > 0;
  return (
    <div>
      <p className="text-xs font-medium mb-2" style={{ color: 'var(--color-muted)' }}>FY {t.fy} TOTALS</p>
      <div className="border rounded-lg overflow-hidden max-w-xl" style={{ borderColor: 'var(--color-border)' }}>
        <table className="w-full text-sm">
          <tbody>
            <TotalsRow label="Gains eligible for discount (held over 12 months)" value={t.gainsDiscountableAud} />
            <TotalsRow label="Other gains (held 12 months or less)" value={t.gainsOtherAud} />
            <TotalsRow label="Total capital gains" value={t.totalGainsAud} bold top />
            <TotalsRow label="Less: capital losses" value={-t.lossesAud} color={t.lossesAud > 0 ? '#ef4444' : undefined} top />
            <TotalsRow label="applied to other gains first" value={-t.lossesAppliedToOtherAud} indent />
            <TotalsRow label="applied to discount-eligible gains" value={-t.lossesAppliedToDiscountableAud} indent />
            <TotalsRow label="Other gains remaining" value={t.gainsOtherRemainingAud} top />
            <TotalsRow label="Discount-eligible gains remaining" value={t.gainsDiscountableRemainingAud} />
            <TotalsRow label={`Less: ${ratePct}% discount on the discount-eligible remainder`} value={-t.discountAmountAud} />
            <TotalsRow label="Net capital gain" value={t.netCapitalGainAud} bold top />
            {isLoss && <TotalsRow label="Net capital loss carried forward" value={t.lossCarriedForwardAud} bold color="#ef4444" />}
          </tbody>
        </table>
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
        {isLoss
          ? "Losses exceed this year's gains, so there is no net capital gain to report. The unused loss carries forward to offset future capital gains."
          : 'Indicative — losses carried forward from earlier years are not included.'}
      </p>
    </div>
  );
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

  // 'All years' shows one totals block per financial year: the loss/discount working is a
  // per-year calculation, so adding years together into one figure would be wrong.
  const totalsBlocks = useMemo(() => {
    if (!data) return [];
    if (data.fy === 'all') return data.fySummaries.filter((t) => t.disposalCount > 0);
    return data.summary.disposalCount > 0 ? [{ fy: data.fy, ...data.summary }] : [];
  }, [data]);

  const exportCsv = () => {
    if (!data) return;
    const rows = [
      [`Capital gains by parcel — FY ${data.fy}`], [`FIFO, AUD, trade dates (${data.timezone})`], [],
      ['Symbol', 'Exchange', 'Bought', 'Sold', 'Days held', 'Quantity', 'Cost AUD', 'Proceeds AUD', 'Gain/loss AUD', 'Held over 12 months'],
      ...data.disposals.map((d) => [d.symbol, d.exchange, d.acquiredOn, d.soldOn, d.daysHeld, d.quantity, d.costAud.toFixed(2), d.proceedsAud.toFixed(2), d.gainAud.toFixed(2), d.discountEligible ? 'Yes' : 'No']),
      ...totalsBlocks.flatMap((t) => [
        [], [`Totals - FY ${t.fy}`],
        ['Gains eligible for discount', t.gainsDiscountableAud.toFixed(2)], ['Other gains', t.gainsOtherAud.toFixed(2)], ['Total capital gains', t.totalGainsAud.toFixed(2)],
        ['Capital losses', t.lossesAud.toFixed(2)], ['  applied to other gains first', t.lossesAppliedToOtherAud.toFixed(2)], ['  applied to discount-eligible gains', t.lossesAppliedToDiscountableAud.toFixed(2)],
        ['Other gains remaining', t.gainsOtherRemainingAud.toFixed(2)], ['Discount-eligible gains remaining', t.gainsDiscountableRemainingAud.toFixed(2)],
        [`Discount (${data.discountRatePct}%)`, t.discountAmountAud.toFixed(2)],
        ['Net capital gain', t.netCapitalGainAud.toFixed(2)], ['Net capital loss carried forward', t.lossCarriedForwardAud.toFixed(2)],
      ]),
    ];
    downloadCsv(`cgt-parcels-${data.fy}.csv`, rows);
  };

  if (loading && !data) return <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>;
  if (!data) return null;
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
                  <Th right>Cost</Th><Th right>Proceeds</Th><Th right>Gain / loss</Th><Th>Held over 12 months?</Th>
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
                        ? <span style={{ color: '#22c55e' }}>✓ Yes — held {d.daysHeld} days</span>
                        : <span style={{ color: 'var(--color-muted)' }}>No — held {d.daysHeld} days</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalsBlocks.map((t) => <FyTotals key={t.fy} t={t} ratePct={data.discountRatePct} />)}

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
