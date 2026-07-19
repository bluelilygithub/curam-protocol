/**
 * Property Scenario PDF Report
 * Uses @react-pdf/renderer to produce a structured, machine-readable PDF
 * suitable for LLM validation or archiving.
 *
 * Exports:
 *   downloadPropertyScenarioPdf(calcResult, inputs, scenarioType, tabFilter?)
 *   tabFilter: 'all' | 'overview' | 'lenders' | 'calculators' | 'followups'
 */

import React from 'react';
import {
  Document, Page, View, Text, StyleSheet, pdf, Link,
} from '@react-pdf/renderer';

const PRIMARY = '#CC785C';
const MUTED = '#888888';
const BORDER = '#D8D8D0';
const BG_ALT = '#F5F5F0';

// react-pdf v3 StyleSheet: avoid multi-value shorthand strings for padding
// (e.g. '6 8') — use paddingVertical/paddingHorizontal instead.
// Border shorthand ('1 solid #hex') is supported in v3.1+.
const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#1A1A1A', padding: 40 },
  header: { marginBottom: 16, borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid', paddingBottom: 10 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: PRIMARY, marginBottom: 2 },
  subtitle: { fontSize: 9, color: MUTED },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#1A1A1A', marginBottom: 6, paddingBottom: 3, borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid' },
  sectionHint: { fontSize: 8, color: MUTED, marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 2 },
  label: { width: '42%', color: MUTED, fontSize: 8.5 },
  value: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  tableHeader: { flexDirection: 'row', backgroundColor: BG_ALT, paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid', marginBottom: 0 },
  tableRow: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid' },
  tableCell: { flex: 1, fontSize: 8 },
  tableCellBold: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold' },
  tableCellNarrow: { width: 80, fontSize: 8 },
  tableCellWide: { flex: 2, fontSize: 8 },
  caveat: { fontSize: 8, color: MUTED, marginBottom: 3, paddingLeft: 8 },
  caveatBullet: { fontSize: 8, color: MUTED, marginBottom: 2 },
  highlight: { backgroundColor: '#FFF8F5', paddingVertical: 6, paddingHorizontal: 8, borderLeftWidth: 3, borderLeftColor: PRIMARY, borderLeftStyle: 'solid', marginBottom: 8 },
  highlightText: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: PRIMARY },
  highlightSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  pill: { fontSize: 8, color: MUTED, marginBottom: 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid', marginBottom: 10, marginTop: 4 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: MUTED },
  warning: { fontSize: 8, color: '#92400E', backgroundColor: '#FFFBEB', paddingVertical: 5, paddingHorizontal: 8, marginTop: 6, borderLeftWidth: 3, borderLeftColor: '#F59E0B', borderLeftStyle: 'solid' },
});

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '$0';
  return `$${Math.round(v).toLocaleString('en-AU')}`;
}

function fmtMonthly(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `$${Math.round(v).toLocaleString('en-AU')}/month`;
}

// ─── Header ──────────────────────────────────────────────────────────────────

function ReportHeader({ scenarioType, generatedAt }) {
  const typeLabels = {
    refinance: 'Compare Lenders / Refinance',
    sell: 'Sell a Property',
    buy: 'Buy a Property',
    compound: 'Multiple Events',
    qualify: 'Buyer Qualification Check',
    calculators: 'Standalone Calculators',
  };
  return (
    <View style={s.header}>
      <Text style={s.title}>Property Scenario Report</Text>
      <Text style={s.subtitle}>
        {typeLabels[scenarioType] || 'Scenario'} · Generated {generatedAt} ·
        Calculations are deterministic AU rules. LLM involvement: input structuring only, not numbers.
      </Text>
    </View>
  );
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

function InputsSection({ inputs, scenarioType }) {
  const rows = (() => {
    if (scenarioType === 'refinance') {
      return [
        ['Current loan balance', inputs.rfBalance ? fmtMoney(inputs.rfBalance) : '—'],
        ['Current interest rate', inputs.rfRate ? `${inputs.rfRate}% p.a.` : '—'],
        ['Rate type', inputs.rfRateType || '—'],
        ['Term remaining', inputs.rfTermMonths ? `${inputs.rfTermMonths} months (${(Number(inputs.rfTermMonths) / 12).toFixed(1)} years)` : '—'],
        inputs.rfRateType === 'fixed' && inputs.rfFixedPeriod
          ? ['Fixed period remaining', `${inputs.rfFixedPeriod} months`]
          : null,
        ['Compared against', inputs.rfTargetMode === 'cdr'
          ? 'Live CDR market rates — best available from 9 AU lenders'
          : inputs.rfTargetRate ? `Specific rate: ${inputs.rfTargetRate}%` : '—'],
      ].filter(Boolean);
    }
    if (scenarioType === 'sell') {
      return [
        ['State', inputs.sellState || '—'],
        ['Property type', inputs.sellPpor === 'ppor' ? 'Primary residence (PPOR)' : inputs.sellPpor === 'investment' ? 'Investment property' : 'Mixed use'],
        ['Expected sale price', inputs.sellPrice ? fmtMoney(inputs.sellPrice) : '—'],
        ['Original purchase price', inputs.sellPurchasePrice ? fmtMoney(inputs.sellPurchasePrice) : '—'],
        inputs.sellPurchaseYear ? ['Year purchased', String(inputs.sellPurchaseYear)] : null,
      ].filter(Boolean);
    }
    if (scenarioType === 'buy') {
      return [
        ['State', inputs.buyState || '—'],
        ['Purpose', inputs.buyPpor === 'ppor' ? 'Primary residence (PPOR)' : 'Investment property'],
        ['Purchase price', inputs.buyPrice ? fmtMoney(inputs.buyPrice) : '—'],
        ['Deposit', inputs.buyDeposit ? fmtMoney(inputs.buyDeposit) : '—'],
        ['First home buyer', inputs.buyFhb === 'yes' ? 'Yes' : 'No'],
      ];
    }
    return [];
  })();

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Inputs — what was entered</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={s.row}>
          <Text style={s.label}>{label}</Text>
          <Text style={s.value}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Refinance result ─────────────────────────────────────────────────────────

function RefinanceResultSection({ calcResult }) {
  const refi = calcResult.calculation?.event_results?.[0]?.outputs?.refinance_break_even;
  const totals = calcResult.calculation?.totals || {};
  const cdrData = calcResult.cdr_rate_used;
  const best = cdrData?.best || (cdrData?.rate ? cdrData : null);
  const alternatives = cdrData?.alternatives || [];

  const monthlySaving = Number(refi?.monthly_saving ?? totals.monthly_repayment_saving ?? 0);
  const breakEvenMonths = refi?.break_even_months;
  const upfront = Number(refi?.upfront_cost ?? 0);
  const breakCost = Number(totals.break_costs ?? 0);
  const annualised = Number(totals.annualised_repayment_saving ?? 0);
  const curRepayment = Number(refi?.monthly_repayment_current ?? 0);
  const newRepayment = Number(refi?.monthly_repayment_target ?? 0);

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Refinance Result</Text>

      {/* Verdict */}
      <View style={s.highlight}>
        <Text style={s.highlightText}>
          {monthlySaving > 0
            ? `Monthly saving: ${fmtMonthly(monthlySaving)} — break-even in ${breakEvenMonths ?? '—'} months`
            : monthlySaving < 0
              ? `Repayments increase by ${fmtMonthly(Math.abs(monthlySaving))}/month — switching not beneficial on repayment maths`
              : 'No monthly saving at this rate differential'}
        </Text>
        {curRepayment > 0 && newRepayment > 0 && (
          <Text style={s.highlightSub}>
            Current repayment {fmtMonthly(curRepayment)} → new repayment {fmtMonthly(newRepayment)}
          </Text>
        )}
        {annualised > 0 && (
          <Text style={s.highlightSub}>Annualised saving: {fmtMoney(annualised)}/year</Text>
        )}
      </View>

      {/* Best CDR lender */}
      {best && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[s.label, { marginBottom: 3, fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9 }]}>
            Best available CDR rate
          </Text>
          <View style={s.row}><Text style={s.label}>Lender</Text><Text style={s.value}>{best.lender}</Text></View>
          <View style={s.row}><Text style={s.label}>Advertised rate</Text><Text style={s.value}>{best.rate}% p.a.</Text></View>
          {best.comparison_rate != null && (
            <View style={s.row}><Text style={s.label}>Comparison rate †</Text><Text style={s.value}>{best.comparison_rate}% p.a.</Text></View>
          )}
          {best.product && (
            <View style={s.row}><Text style={s.label}>Product name</Text><Text style={s.value}>{best.product}</Text></View>
          )}
          <View style={s.row}><Text style={s.label}>Rate type</Text><Text style={s.value}>{best.fixed_or_variable || '—'}</Text></View>
          <View style={s.row}><Text style={s.label}>Offset</Text><Text style={s.value}>{best.offset ? 'Yes' : 'No'}</Text></View>
          <View style={s.row}><Text style={s.label}>Redraw</Text><Text style={s.value}>{best.redraw ? 'Yes' : 'No'}</Text></View>
          {best.upfront_fees != null && (
            <View style={s.row}><Text style={s.label}>Lender upfront fees (est.)</Text><Text style={s.value}>{fmtMoney(best.upfront_fees)}</Text></View>
          )}
          {best.links?.application && (
            <View style={s.row}><Text style={s.label}>Application URL</Text><Text style={[s.value, { color: PRIMARY }]}>{best.links.application}</Text></View>
          )}
          {best.links?.overview && (
            <View style={s.row}><Text style={s.label}>Product detail URL</Text><Text style={[s.value, { color: PRIMARY }]}>{best.links.overview}</Text></View>
          )}
          <Text style={[s.pill, { marginTop: 3 }]}>
            † Comparison rate is a standardised figure required by AU law that includes most fees. The advertised rate ({best.rate}%) is used for repayment calculations.
          </Text>
        </View>
      )}

      {/* Alternatives */}
      {alternatives.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 4 }]}>
            Other options below your current rate
          </Text>
          <View style={s.tableHeader}>
            <Text style={[s.tableCell, { fontFamily: 'Helvetica-Bold' }]}>Lender</Text>
            <Text style={[s.tableCell, { fontFamily: 'Helvetica-Bold' }]}>Product</Text>
            <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Rate</Text>
            <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Comp. Rate</Text>
          </View>
          {alternatives.map((alt, i) => (
            <View key={i} style={s.tableRow}>
              <Text style={s.tableCell}>{alt.lender}</Text>
              <Text style={s.tableCell}>{alt.product || '—'}</Text>
              <Text style={s.tableCellNarrow}>{alt.rate}% p.a.</Text>
              <Text style={s.tableCellNarrow}>{alt.comparison_rate != null ? `${alt.comparison_rate}%` : '—'}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Switching costs */}
      <View style={s.row}><Text style={s.label}>Discharge fee</Text><Text style={s.value}>{fmtMoney(refi?.discharge_fee ?? 350)}</Text></View>
      <View style={s.row}><Text style={s.label}>Establishment fee</Text><Text style={s.value}>{fmtMoney(refi?.establishment_fee ?? 600)}</Text></View>
      <View style={s.row}><Text style={s.label}>Valuation / legal / misc</Text><Text style={s.value}>{fmtMoney(refi?.other_costs ?? 400)}</Text></View>
      {breakCost > 0 && (
        <View style={s.row}><Text style={s.label}>Fixed-rate break cost (IRD est.)</Text><Text style={s.value}>{fmtMoney(breakCost)}</Text></View>
      )}
      <View style={s.row}><Text style={s.label}>Total switching cost</Text><Text style={[s.value, { fontFamily: 'Helvetica-Bold' }]}>{fmtMoney(upfront + breakCost)}</Text></View>

      <Text style={[s.pill, { marginTop: 6 }]}>
        Source: CDR Product Reference Data (Open Banking AU) — unauthenticated public product data.
        {calcResult.cdr_fetched_at ? ` Fetched: ${new Date(calcResult.cdr_fetched_at).toLocaleString('en-AU')}.` : ''}
        {calcResult.coverage?.summary ? ` Coverage: ${calcResult.coverage.summary}.` : ''}
      </Text>
    </View>
  );
}

// ─── Sell / CGT interpretation ────────────────────────────────────────────────

function SellCgtSection({ calcResult, inputs }) {
  const ev = calcResult.calculation?.event_results?.[0];
  const out = ev?.outputs;
  if (!out) return null;

  const salePrice = Number(out.sale_price ?? 0);
  const sellingCosts = Number(out.selling_costs ?? 0);
  const netProceeds = Number(out.net_sale_proceeds ?? 0);
  const cgt = out.cgt || {};
  const taxableCgt = Number(cgt.taxable_capital_gain_estimate ?? 0);
  const isMreExempt = Boolean(cgt.main_residence_exempt);
  const grossGain = Number(cgt.capital_gain_gross ?? 0);
  const discountApplied = Boolean(cgt.cgt_discount_applied);
  const partialFlagged = Boolean(cgt.partial_exemption_flagged);
  const isMixed = inputs?.sellPpor === 'mixed';
  const sellingCostPct = salePrice > 0 ? `${((sellingCosts / salePrice) * 100).toFixed(1)}%` : '';

  const taxRows = [
    { label: '$45k–$135k bracket (34.5% incl. Medicare)', rate: 0.345 },
    { label: '$135k–$190k bracket (39% incl. Medicare)', rate: 0.39 },
    { label: 'Top bracket 190k+ (47% incl. Medicare)', rate: 0.47 },
  ];

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Sell — Net Proceeds & CGT</Text>

      {/* Net proceeds summary */}
      <View style={{ marginBottom: 8 }}>
        <View style={s.tableRow}>
          <Text style={s.tableCellWide}>Net proceeds</Text>
          <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>{fmtMoney(netProceeds)}</Text>
        </View>
        <View style={s.tableRow}>
          <Text style={s.tableCellWide}>Sale price</Text>
          <Text style={s.tableCellNarrow}>{fmtMoney(salePrice)}</Text>
        </View>
        <View style={s.tableRow}>
          <Text style={s.tableCellWide}>Selling costs ({sellingCostPct})</Text>
          <Text style={s.tableCellNarrow}>{fmtMoney(sellingCosts)}</Text>
        </View>
      </View>

      {/* CGT */}
      <View style={{ borderTopWidth: 1, borderTopColor: '#D8D8D0', borderTopStyle: 'solid', paddingTop: 6, marginBottom: 6 }}>
        <Text style={[s.label, { fontFamily: 'Helvetica-Bold', fontSize: 9, color: '#1A1A1A', marginBottom: 4 }]}>Capital Gains Tax</Text>
        {isMreExempt ? (
          <View style={{ backgroundColor: '#f0fdf4', padding: 6, borderRadius: 4, marginBottom: 4 }}>
            <Text style={[s.caveat, { color: '#15803d', fontFamily: 'Helvetica-Bold' }]}>Main residence exemption — CGT is $0</Text>
            {grossGain > 0 && (
              <Text style={[s.caveat, { color: '#166534' }]}>Gross gain on simplified cost base: {fmtMoney(grossGain)} — fully exempt.</Text>
            )}
            <Text style={[s.caveat, { color: '#166534' }]}>Property was your principal place of residence for the entire ownership period — no taxable event occurs at all.</Text>
          </View>
        ) : taxableCgt > 0 ? (
          <View>
            <View style={{ backgroundColor: '#fef2f2', padding: 6, borderRadius: 4, marginBottom: 6 }}>
              <Text style={[s.caveat, { fontFamily: 'Helvetica-Bold', color: '#b91c1c' }]}>
                Taxable gain: {fmtMoney(taxableCgt)}
              </Text>
              <Text style={[s.caveat, { color: '#991b1b', marginTop: 2 }]}>
                {discountApplied
                  ? `After 50% CGT discount (gross gain ${fmtMoney(grossGain)} ÷ 2 — held >12 months).`
                  : `Full gross gain — 50% discount not applied (held ≤12 months or unknown).`}
              </Text>
              <Text style={[s.caveat, { color: '#991b1b', fontFamily: 'Helvetica-Bold', marginTop: 2 }]}>
                This is the gain added to your income — NOT the tax itself. There is no flat CGT rate in Australia.
              </Text>
            </View>

            <Text style={[s.label, { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#1A1A1A', marginBottom: 3 }]}>
              Indicative tax on the gain at 2025–26 marginal rates:
            </Text>
            <View style={s.tableHeader}>
              <Text style={[s.tableCellWide, { fontFamily: 'Helvetica-Bold', fontSize: 7 }]}>Bracket</Text>
              <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold', fontSize: 7 }]}>Est. tax on gain</Text>
            </View>
            {taxRows.map((r, i) => (
              <View key={i} style={s.tableRow}>
                <Text style={[s.tableCellWide, { fontSize: 7 }]}>{r.label}</Text>
                <Text style={[s.tableCellNarrow, { fontSize: 7 }]}>{fmtMoney(Math.round(taxableCgt * r.rate))}</Text>
              </View>
            ))}
            <Text style={[s.caveat, { marginTop: 4 }]}>
              Your actual tax depends on total income in the year of sale, capital losses, offsets, and other deductions. CGT is reported in your tax return — not deducted at settlement.
            </Text>

            {(partialFlagged || isMixed) && (
              <View style={{ backgroundColor: '#fefce8', padding: 5, borderRadius: 4, marginTop: 5 }}>
                <Text style={[s.caveat, { color: '#92400e', fontFamily: 'Helvetica-Bold' }]}>
                  Partial exemption may apply
                </Text>
                <Text style={[s.caveat, { color: '#92400e' }]}>
                  {isMixed
                    ? 'Property was flagged as having been both a residence and investment. The 6-year rule and partial main residence exemption may significantly reduce this figure — the calculation above is conservative (full investment CGT). Get advice from a tax agent with the full occupancy timeline.'
                    : '6-year rule / partial exemption may apply — consult a tax agent with your occupancy dates.'}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={s.caveat}>CGT: $0 — no capital gain on this simplified cost base.</Text>
        )}
      </View>

      <View style={s.warning}>
        <Text>Cost base uses purchase price only. ATO rules also allow: stamp duty at purchase, acquisition legal fees, capital improvements, and some borrowing costs — all reduce taxable gain. Not tax advice — verify with a registered tax agent.</Text>
      </View>
    </View>
  );
}

// ─── Summary table ────────────────────────────────────────────────────────────

function SummaryTableSection({ calcResult }) {
  const rows = calcResult.summary_table?.totals || [];
  const events = calcResult.summary_table?.events || [];
  const visible = rows.filter((r) => Number(r.value) !== 0 || ['total_costs'].includes(r.key));

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Cost / Benefit Summary</Text>
      <Text style={s.sectionHint}>All figures are deterministic AU calculations. LLM involvement: zero at this stage.</Text>
      <View style={s.tableHeader}>
        <Text style={[s.tableCellWide, { fontFamily: 'Helvetica-Bold' }]}>Metric</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Amount</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Type</Text>
      </View>
      {visible.map((r) => (
        <View key={r.key} style={s.tableRow}>
          <Text style={s.tableCellWide}>{r.label}</Text>
          <Text style={s.tableCellNarrow}>{fmtMoney(r.value)}</Text>
          <Text style={s.tableCellNarrow}>{r.kind}</Text>
        </View>
      ))}
      {events.map((e) => (
        <View key={e.key} style={[s.tableRow, { backgroundColor: BG_ALT }]}>
          <Text style={s.tableCellWide}>{e.label}</Text>
          <Text style={s.tableCellNarrow}>{fmtMoney(e.value)}</Text>
          <Text style={s.tableCellNarrow}>event cost</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Cash-flow timeline ───────────────────────────────────────────────────────

function TimelineSection({ calcResult }) {
  const timeline = calcResult.calculation?.cash_flow_timeline || [];
  if (!timeline.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Cash-Flow Timeline</Text>
      <View style={s.tableHeader}>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Event</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Direction</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Amount</Text>
        <Text style={[s.tableCellWide, { fontFamily: 'Helvetica-Bold' }]}>Note</Text>
      </View>
      {timeline.map((item, i) => (
        <View key={i} style={s.tableRow}>
          <Text style={s.tableCellNarrow}>{item.label || item.event_id}</Text>
          <Text style={s.tableCellNarrow}>{item.direction === 'in' ? '↑ In' : '↓ Out'}</Text>
          <Text style={s.tableCellNarrow}>{fmtMoney(item.amount)}</Text>
          <Text style={s.tableCellWide}>{item.note || item.category || ''}</Text>
        </View>
      ))}
    </View>
  );
}

// ─── Lenders tab ─────────────────────────────────────────────────────────────

function LendersSection({ calcResult }) {
  const rows = calcResult.lenders?.rows || [];
  if (!rows.length) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Lender Comparison — All CDR Products</Text>
      <Text style={s.sectionHint}>
        {calcResult.lenders?.data_note || 'Live CDR Product Reference Data. Rates are lowest available owner-occupied P&I per lender.'}
      </Text>
      <View style={s.tableHeader}>
        <Text style={[s.tableCellWide, { fontFamily: 'Helvetica-Bold' }]}>Lender / Product</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Rate</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Comp. Rate</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Type</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Offset</Text>
        <Text style={[s.tableCellNarrow, { fontFamily: 'Helvetica-Bold' }]}>Fees est.</Text>
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tableRow}>
          <Text style={s.tableCellWide}>{r.lender}{r.name ? `\n${r.name}` : ''}</Text>
          <Text style={s.tableCellNarrow}>{r.rate != null ? `${r.rate}%` : '—'}</Text>
          <Text style={s.tableCellNarrow}>{r.comparison_rate != null ? `${r.comparison_rate}%` : '—'}</Text>
          <Text style={s.tableCellNarrow}>{r.fixed_or_variable || '—'}</Text>
          <Text style={s.tableCellNarrow}>{r.offset ? 'Yes' : 'No'}</Text>
          <Text style={s.tableCellNarrow}>{r.upfront_fees != null ? fmtMoney(r.upfront_fees) : '—'}</Text>
        </View>
      ))}
      <Text style={s.pill}>
        † Comparison rates are standardised. Fees marked (est.) are summed from CDR fee objects heuristically — not authoritative. Verify with lender before acting.
      </Text>
    </View>
  );
}

// ─── Calculators ──────────────────────────────────────────────────────────────

function CalculatorsSection({ calcResult }) {
  const calcs = calcResult.calculators;
  if (!calcs) return null;
  // Field names match the actual calculator return shapes:
  //   repayment.repayment (not .monthly), extra_repayments.months_saved,
  //   borrowing_power.max_loan_indicative / .assessment_rate_pct / .explanation
  const sections = [
    calcs.repayment && calcs.repayment.ok && ['Repayment Calculator', [
      ['Monthly repayment', fmtMonthly(calcs.repayment.repayment)],
      ['Total repaid over term', fmtMoney(calcs.repayment.total_repaid_over_term)],
      ['Total interest', fmtMoney(calcs.repayment.total_interest_over_term)],
      calcs.repayment.explanation ? ['Note', calcs.repayment.explanation] : null,
    ].filter(Boolean)],
    calcs.extra_repayments && calcs.extra_repayments.ok && ['Extra Repayments (+$200/month)', [
      ['Months saved', calcs.extra_repayments.months_saved != null ? `${calcs.extra_repayments.months_saved} months` : '—'],
      ['Interest saved', fmtMoney(calcs.extra_repayments.interest_saved)],
      calcs.extra_repayments.explanation ? ['Note', calcs.extra_repayments.explanation] : null,
    ].filter(Boolean)],
    calcs.offset && calcs.offset.ok && ['Offset Account ($50k)', [
      ['Interest saved', fmtMoney(calcs.offset.interest_saved)],
      ['Months saved', calcs.offset.months_saved != null ? `${calcs.offset.months_saved} months` : '—'],
      ['First period interest saving', calcs.offset.first_period_interest_saving != null ? fmtMoney(calcs.offset.first_period_interest_saving) : '—'],
      calcs.offset.explanation ? ['Note', calcs.offset.explanation] : null,
    ].filter(Boolean)],
    calcs.borrowing_power && calcs.borrowing_power.ok && ['Borrowing Power (Indicative)', [
      ['Indicative max loan', fmtMoney(calcs.borrowing_power.max_loan_indicative)],
      ['Assessment rate', calcs.borrowing_power.assessment_rate_pct != null ? `${calcs.borrowing_power.assessment_rate_pct}%` : '—'],
      ['Monthly surplus used', calcs.borrowing_power.monthly_surplus != null ? fmtMonthly(calcs.borrowing_power.monthly_surplus) : '—'],
      ['Note', calcs.borrowing_power.explanation || 'Indicative only — not a lending decision. Actual serviceability varies by lender.'],
    ]],
  ].filter(Boolean);

  if (!sections.length) return null;

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Calculators</Text>
      {sections.map(([title, rows]) => (
        <View key={title} style={{ marginBottom: 8 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 3 }]}>{title}</Text>
          {rows.map(([label, value]) => (
            <View key={label} style={s.row}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.value}>{value}</Text>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

// ─── Follow-ups / advice ──────────────────────────────────────────────────────

function FollowUpsSection({ calcResult, followUpAnswers }) {
  const advice = calcResult.advice;
  if (!advice) return null;
  const questions = advice.follow_up_questions || [];
  const raise = advice.raise_with_broker_or_tax_agent || [];
  const caveats = calcResult.calculation?.combined_caveats || calcResult.calculation?.caveats || [];
  const assumptions = calcResult.calculation?.combined_assumptions || calcResult.calculation?.assumptions || [];
  const answered = followUpAnswers || {};
  const answeredPairs = Object.entries(answered).filter(([, v]) => v);
  const unanswered = questions.filter((q) => !answered[q]);

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Follow-ups, Caveats & Assumptions</Text>

      {/* Answered Q&A — shown prominently first */}
      {answeredPairs.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 5 }]}>
            Answered questions
          </Text>
          {answeredPairs.map(([q, a], i) => (
            <View key={i} style={{ marginBottom: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#CC785C', borderLeftStyle: 'solid' }}>
              <Text style={[s.label, { fontFamily: 'Helvetica-Bold', fontSize: 8, color: '#555', marginBottom: 2 }]}>Q: {q}</Text>
              <Text style={[s.caveat, { fontSize: 8, color: '#1A1A1A', lineHeight: 1.4 }]}>{a}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Unanswered suggested questions */}
      {unanswered.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 3 }]}>
            {answeredPairs.length > 0 ? 'Remaining follow-up questions' : 'Suggested follow-up questions'}
          </Text>
          {unanswered.map((q, i) => (
            <Text key={i} style={s.caveatBullet}>· {q}</Text>
          ))}
        </View>
      )}

      {raise.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 3 }]}>Raise with your broker / tax agent</Text>
          {raise.map((r, i) => (
            <Text key={i} style={s.caveatBullet}>· {r}</Text>
          ))}
        </View>
      )}

      {caveats.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 3 }]}>Caveats</Text>
          {caveats.map((c, i) => (
            <Text key={i} style={s.caveat}>· {c}</Text>
          ))}
        </View>
      )}

      {assumptions.length > 0 && (
        <View>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 3 }]}>Assumptions</Text>
          {assumptions.map((a, i) => (
            <Text key={i} style={s.caveat}>· {a}</Text>
          ))}
        </View>
      )}

      <View style={s.warning}>
        <Text>
          This report is generated from deterministic Australian financial calculation rules applied to inputs you provided.
          It is not financial advice. Dollar figures depend entirely on the accuracy of your inputs.
          CDR rate data is sourced from public Open Banking APIs and may not reflect current offers or your eligibility.
          Verify all figures with a licensed mortgage broker or financial adviser before acting.
        </Text>
      </View>
    </View>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────

function ReportFooter({ generatedAt }) {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerText}>Property Scenario Report · {generatedAt}</Text>
      <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

// ─── Document ─────────────────────────────────────────────────────────────────

function PropertyScenarioPdfDocument({ calcResult, inputs, scenarioType, tabFilter, followUpAnswers }) {
  const generatedAt = new Date().toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const all = tabFilter === 'all';
  const show = (tab) => all || tabFilter === tab;

  return (
    <Document title="Property Scenario Report" author="Curam Vault" creator="Curam Vault">
      <Page size="A4" style={s.page}>
        <ReportHeader scenarioType={scenarioType} generatedAt={generatedAt} />

        {show('overview') && <InputsSection inputs={inputs} scenarioType={scenarioType} />}

        {show('overview') && scenarioType === 'refinance' && <RefinanceResultSection calcResult={calcResult} />}

        {show('overview') && scenarioType === 'sell' && <SellCgtSection calcResult={calcResult} inputs={inputs} />}

        {show('overview') && <SummaryTableSection calcResult={calcResult} />}

        {show('overview') && <TimelineSection calcResult={calcResult} />}

        {show('lenders') && <LendersSection calcResult={calcResult} />}

        {show('calculators') && <CalculatorsSection calcResult={calcResult} />}

        {show('followups') && <FollowUpsSection calcResult={calcResult} followUpAnswers={followUpAnswers} />}

        <ReportFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

// ─── Buyer Qualification Document ─────────────────────────────────────────────

const STATUS_COLORS_PDF = {
  pass: { bg: '#f0fdf4', border: '#86efac', text: '#15803d', label: 'PASS' },
  warn: { bg: '#fefce8', border: '#fde047', text: '#92400e', label: 'CHECK REQUIRED' },
  fail: { bg: '#fef2f2', border: '#fca5a5', text: '#b91c1c', label: 'LIKELY BLOCKED' },
  info: { bg: '#eff6ff', border: '#93c5fd', text: '#1d4ed8', label: 'NOTE' },
};

function QualifyCheckRow({ check }) {
  const col = STATUS_COLORS_PDF[check.status] || STATUS_COLORS_PDF.info;
  return (
    <View style={{ marginBottom: 8, borderLeftWidth: 3, borderLeftColor: col.border, borderLeftStyle: 'solid', paddingLeft: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 }}>
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: MUTED, marginRight: 6, textTransform: 'uppercase' }}>
          {check.label}
        </Text>
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: col.text, backgroundColor: col.bg, paddingHorizontal: 4, paddingVertical: 1, borderRadius: 2 }}>
          {col.label}
        </Text>
      </View>
      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: '#1A1A1A', marginBottom: 2 }}>{check.headline}</Text>
      {check.detail ? (
        <Text style={{ fontSize: 8, color: MUTED, lineHeight: 1.4 }}>{check.detail}</Text>
      ) : null}
    </View>
  );
}

function QualificationDocument({ result, inputs }) {
  const generatedAt = new Date().toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const s2 = result?.summary || {};
  const checks = result?.checks || [];
  const caveats = result?.caveats || [];
  const assumptions = result?.assumptions || [];
  const lenderGuidance = result?.lender_guidance || [];
  const stress = s2.stress || null;
  const inp = inputs || {};

  const statusColors = STATUS_COLORS_PDF[s2.overall_status] || STATUS_COLORS_PDF.info;

  return (
    <Document title="Buyer Qualification Report" author="Curam Vault" creator="Curam Vault">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <Text style={s.title}>Buyer Qualification Report</Text>
          <Text style={s.subtitle}>
            Generated {generatedAt} · Deterministic AU mortgage pre-qualification checks · Not a credit decision or pre-approval
          </Text>
        </View>

        {/* Inputs summary */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>What was assessed</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {[
              ['Purchase price', inp.property_value ? fmtMoney(inp.property_value) : '—'],
              ['Deposit', inp.deposit_amount ? fmtMoney(inp.deposit_amount) : '—'],
              ['Deposit %', s2.lvr_pct != null ? `${(100 - s2.lvr_pct).toFixed(1)}%` : '—'],
              ['LVR', s2.lvr_pct != null ? `${s2.lvr_pct.toFixed(1)}%` : '—'],
              ['State', inp.state || '—'],
              ['FHB', inp.is_fhb ? 'Yes' : 'No'],
              ['Purpose', inp.is_ppor !== false ? 'PPOR' : 'Investment'],
              ['Gross income', inp.gross_annual_income ? `$${Number(inp.gross_annual_income).toLocaleString('en-AU')}/yr` : '—'],
              ['Partner income', inp.partner_gross_income ? `$${Number(inp.partner_gross_income).toLocaleString('en-AU')}/yr` : 'None'],
              ['Household', inp.household_type || '—'],
              ['Employment', inp.employment_type?.replace(/_/g, ' ') || '—'],
              ['HECS/HELP', inp.has_hecs ? 'Yes' : 'No'],
              ['Existing debts/mo', inp.monthly_debt_repayments ? fmtMoney(inp.monthly_debt_repayments) : '$0'],
              ['Declared expenses/mo', inp.monthly_expenses ? fmtMoney(inp.monthly_expenses) : 'HEM benchmark used'],
              ['Target rate', inp.target_rate_pct ? `${inp.target_rate_pct}% p.a.` : '—'],
              ['Loan term', inp.loan_term_years ? `${inp.loan_term_years} years` : '30 years'],
              inp.is_new_build ? ['Property', 'New build / off-the-plan'] : ['Property', inp.property_type_class?.replace(/_/g, ' ') || 'Established'],
              inp.applicant_age ? ['Applicant age', `${inp.applicant_age} (matures age ${Number(inp.applicant_age) + Number(inp.loan_term_years || 30)})`] : null,
              inp.gross_rental_income ? ['Gross rental income', `$${Number(inp.gross_rental_income).toLocaleString('en-AU')}/yr`] : null,
            ].filter(Boolean).map(([label, value]) => (
              <View key={label} style={{ width: '50%', flexDirection: 'row', marginBottom: 3 }}>
                <Text style={{ width: '55%', fontSize: 8, color: MUTED }}>{label}</Text>
                <Text style={{ flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold' }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Overall verdict */}
        <View style={[s.section, { backgroundColor: statusColors.bg, padding: 10, borderLeftWidth: 4, borderLeftColor: statusColors.border, borderLeftStyle: 'solid' }]}>
          <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: statusColors.text, marginBottom: 4 }}>
            Overall: {statusColors.label}
            {s2.fail_count > 0 ? ` — ${s2.fail_count} likely block${s2.fail_count !== 1 ? 's' : ''}` : ''}
            {s2.warn_count > 0 ? ` — ${s2.warn_count} area${s2.warn_count !== 1 ? 's' : ''} to verify` : ''}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
            {[
              ['Loan requested', fmtMoney(s2.loan_requested)],
              ['Max indicative capacity', s2.max_borrowing_capacity != null ? fmtMoney(s2.max_borrowing_capacity) : '—'],
              ['Est. monthly repayment', s2.monthly_repayment_estimate != null ? fmtMonthly(s2.monthly_repayment_estimate) : '—'],
              ['APRA assessment rate', `${s2.assessment_rate_pct}%`],
              ['DTI ratio', s2.dti_ratio != null ? `${s2.dti_ratio.toFixed(1)}×` : '—'],
              ['HECS annual repayment', s2.hecs_annual_repayment > 0 ? fmtMoney(s2.hecs_annual_repayment) : 'None'],
            ].map(([label, value]) => (
              <View key={label} style={{ width: '50%', flexDirection: 'row', marginBottom: 3 }}>
                <Text style={{ width: '55%', fontSize: 8, color: MUTED }}>{label}</Text>
                <Text style={{ flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold' }}>{value}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Individual checks */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Qualification checks</Text>
          {checks.map((check) => (
            <QualifyCheckRow key={check.id} check={check} />
          ))}
        </View>

        {/* Assumptions */}
        {assumptions.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Assumptions applied</Text>
            {assumptions.map((a, i) => (
              <Text key={i} style={s.caveatBullet}>· {a}</Text>
            ))}
          </View>
        )}

        {/* Lender guidance */}
        {lenderGuidance.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Lenders likely to discuss your situation</Text>
            <Text style={{ ...s.caveatBullet, marginBottom: 6, fontSize: 8, color: '#6b7280' }}>
              These are lenders known to be more flexible on the specific barriers identified above. This is not an endorsement or recommendation — policies change and a mortgage broker will have current intelligence.
            </Text>
            {lenderGuidance.map((g, gi) => (
              <View key={gi} style={{ marginBottom: 10, borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4 }}>
                <View style={{ backgroundColor: '#f9fafb', paddingHorizontal: 10, paddingVertical: 5, borderTopLeftRadius: 4, borderTopRightRadius: 4 }}>
                  <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#374151' }}>{g.barrier}</Text>
                  <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 2 }}>{g.intro}</Text>
                </View>
                {(g.lenders || []).map((l, li) => (
                  <View key={li} style={{ flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#e5e7eb', alignItems: 'flex-start' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 9, fontWeight: 'bold', color: '#111827' }}>{l.name}
                        <Text style={{ fontSize: 7, fontWeight: 'normal', color: '#9ca3af' }}>  {l.category}</Text>
                      </Text>
                      <Text style={{ fontSize: 8, color: '#6b7280', marginTop: 1 }}>{l.flexible_on}</Text>
                    </View>
                    <View style={{ width: 110, textAlign: 'right' }}>
                      {l.rate_premium && l.rate_premium !== 'Standard rates' && l.rate_premium !== 'Competitive' && l.rate_premium !== 'Standard' && (
                        <Text style={{ fontSize: 7, color: '#b45309' }}>{l.rate_premium}</Text>
                      )}
                      {l.contact && (
                        <Text style={{ fontSize: 7, color: '#6b7280' }}>{l.contact}</Text>
                      )}
                    </View>
                  </View>
                ))}
                {g.broker_note && (
                  <View style={{ backgroundColor: '#eff6ff', paddingHorizontal: 10, paddingVertical: 5, borderTopWidth: 1, borderTopColor: '#e5e7eb', borderBottomLeftRadius: 4, borderBottomRightRadius: 4 }}>
                    <Text style={{ fontSize: 8, color: '#1d4ed8' }}>
                      <Text style={{ fontWeight: 'bold' }}>Broker tip: </Text>{g.broker_note}
                    </Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* Settlement cost summary */}
        {s2.cash_to_settle != null && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Total cash needed to settle</Text>
            <View style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#111827' }}>
                ${(s2.fhog_offset > 0 ? s2.net_cash_to_settle : s2.cash_to_settle)?.toLocaleString('en-AU')}
                {s2.lmi_required ? `  (+$${s2.lmi_estimate?.toLocaleString('en-AU')} LMI if not capitalised)` : ''}
              </Text>
            </View>
            {[
              { label: 'Deposit', value: s2.deposit_amount },
              { label: 'Transfer duty (stamp duty)', value: s2.stamp_duty_estimate, note: s2.stamp_duty_estimate === 0 ? 'FHB exemption applied' : '' },
              { label: 'Legal / conveyancing (estimate)', value: s2.legal_estimate, note: '$2,000 mid-point — confirm with conveyancer' },
              ...(s2.lmi_required && s2.lmi_estimate ? [{ label: 'LMI (indicative — often capitalised into loan)', value: s2.lmi_estimate }] : []),
              ...(s2.fhog_offset > 0 ? [{ label: 'FHOG grant offset', value: -s2.fhog_offset, note: 'State first home owner grant reduces cash needed' }] : []),
            ].filter(r => r.value != null).map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                <View>
                  <Text style={{ fontSize: 9, color: '#374151' }}>{row.label}</Text>
                  {row.note ? <Text style={{ fontSize: 7, color: '#9ca3af' }}>{row.note}</Text> : null}
                </View>
                <Text style={{ fontSize: 9, fontWeight: 'bold', color: row.value < 0 ? '#16a34a' : '#111827' }}>
                  {row.value < 0 ? `−$${Math.abs(row.value).toLocaleString('en-AU')}` : `$${row.value.toLocaleString('en-AU')}`}
                </Text>
              </View>
            ))}
            <Text style={{ fontSize: 7, color: '#6b7280', marginTop: 5 }}>Does not include building inspection (~$500–$800), loan application fees, or council/water rate adjustments.</Text>
          </View>
        )}

        {/* Stress test */}
        {stress && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>Rate &amp; income stress — how much buffer do you have?</Text>
            {[
              { label: `Rate +1% (product ${stress.rate_plus_1.rate_pct?.toFixed(2)}%, assessed ${stress.rate_plus_1.assessment_rate_pct?.toFixed(2)}%)`, pass: stress.rate_plus_1.still_qualifies, max: stress.rate_plus_1.max_borrowing },
              { label: `Rate +2% (product ${stress.rate_plus_2.rate_pct?.toFixed(2)}%, assessed ${stress.rate_plus_2.assessment_rate_pct?.toFixed(2)}%)`, pass: stress.rate_plus_2.still_qualifies, max: stress.rate_plus_2.max_borrowing },
              { label: `Income at ${100 - stress.income_haircut.haircut_pct}% ($${stress.income_haircut.assessed_income?.toLocaleString('en-AU')} p.a.) — ${stress.income_haircut.note}`, pass: stress.income_haircut.still_qualifies, max: stress.income_haircut.max_borrowing },
            ].map((row, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#e5e7eb' }}>
                <Text style={{ fontSize: 8, color: '#6b7280', flex: 1, marginRight: 8 }}>{row.label}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 9, fontWeight: 'bold', color: row.pass ? '#16a34a' : '#ef4444' }}>{row.pass ? 'Still qualifies' : 'Falls short'}</Text>
                  <Text style={{ fontSize: 7, color: '#9ca3af' }}>Max ~${row.max?.toLocaleString('en-AU', { maximumFractionDigits: 0 }) ?? '—'}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* Caveats & disclaimer */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Important caveats</Text>
          {caveats.map((c, i) => (
            <Text key={i} style={s.caveatBullet}>· {c}</Text>
          ))}
          <View style={s.warning}>
            <Text>
              This report is an indicative pre-qualification check using published Australian lending rules (APRA serviceability buffer, HEM benchmarks, ATO 2025-26 HECS marginal method, NHFIC FHBG caps effective 1 Oct 2025). It is NOT a credit decision, NOT pre-approval, and NOT a guarantee of finance. Lenders conduct full credit assessments using proprietary systems, credit history files, and policy overlays that cannot be replicated here. Figures may differ materially from a lender's actual assessment.
            </Text>
          </View>
        </View>

        <ReportFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

// ─── Standalone Calculators Document ──────────────────────────────────────────

function CalculatorsDocument({ calcInputs, calcResults }) {
  const generatedAt = new Date().toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  const { loanAmount, rate, termYears, extra, offsetBalance } = calcInputs || {};
  const { repayment, extra_repayments, offset, borrowing_power } = calcResults || {};

  return (
    <Document title="Loan Calculators Report" author="Curam Vault" creator="Curam Vault">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <Text style={s.title}>Standalone Loan Calculators Report</Text>
          <Text style={s.subtitle}>
            Generated {generatedAt} · Deterministic P&I calculations · Standalone — not linked to any scenario
          </Text>
        </View>

        {/* Inputs */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Inputs used</Text>
          {[
            ['Loan amount', loanAmount ? fmtMoney(loanAmount) : '—'],
            ['Interest rate', rate ? `${rate}% p.a.` : '—'],
            ['Loan term', termYears ? `${termYears} years` : '—'],
            ['Extra monthly repayment', extra ? fmtMoney(extra) : '$200 (default)'],
            ['Offset account balance', offsetBalance ? fmtMoney(offsetBalance) : '$50,000 (default)'],
          ].map(([label, value]) => (
            <View key={label} style={s.row}>
              <Text style={s.label}>{label}</Text>
              <Text style={s.value}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Results */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Calculator results</Text>
          {[
            { title: 'Monthly repayment (P&I)', result: repayment },
            { title: `Extra repayments (+$${extra || 200}/mo)`, result: extra_repayments },
            { title: `Offset account ($${Number(offsetBalance || 50000).toLocaleString('en-AU')})`, result: offset },
            borrowing_power ? { title: 'Borrowing power', result: borrowing_power } : null,
          ].filter(Boolean).map((c) => (
            <View key={c.title} style={{ marginBottom: 10 }}>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: PRIMARY, marginBottom: 3 }}>{c.title}</Text>
              <Text style={{ fontSize: 9, color: '#1A1A1A', lineHeight: 1.4 }}>
                {c.result?.explanation || (c.result?.ok === false ? `Error: ${c.result?.errors?.[0] || 'calculation failed'}` : '—')}
              </Text>
              {c.title.includes('Borrowing') && c.result?.caveats?.[0] && (
                <Text style={[s.caveat, { marginTop: 3 }]}>{c.result.caveats[0]}</Text>
              )}
            </View>
          ))}
        </View>

        <View style={s.warning}>
          <Text>
            These calculations use the standard Australian P&I amortisation formula. They are standalone estimates and do not constitute financial or lending advice. Actual repayments depend on your lender's specific product terms, fees, and repayment schedule.
          </Text>
        </View>

        <ReportFooter generatedAt={generatedAt} />
      </Page>
    </Document>
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate and download a Property Scenario PDF.
 * @param {object} calcResult - full API response from /calculate or /clarify
 * @param {object} inputs     - form state (rfBalance, rfRate, etc.)
 * @param {string} scenarioType - 'refinance' | 'sell' | 'buy' | 'compound'
 * @param {string} tabFilter       - 'all' | 'overview' | 'lenders' | 'calculators' | 'followups'
 * @param {object} [followUpAnswers] - { [question]: answer } map from interactive Q&A
 */
export async function downloadPropertyScenarioPdf(calcResult, inputs, scenarioType, tabFilter = 'all', followUpAnswers) {
  const doc = (
    <PropertyScenarioPdfDocument
      calcResult={calcResult}
      inputs={inputs}
      scenarioType={scenarioType}
      tabFilter={tabFilter}
      followUpAnswers={followUpAnswers || {}}
    />
  );

  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const label = tabFilter === 'all' ? 'full' : tabFilter;
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `property-scenario-${scenarioType}-${label}-${ts}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate and download a buyer qualification PDF.
 * @param {object} result  - response from /calculators/buyer-qualify
 * @param {object} inputs  - the raw form inputs sent to that endpoint
 */
export async function downloadQualificationPdf(result, inputs) {
  const doc = <QualificationDocument result={result} inputs={inputs} />;
  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `buyer-qualification-${ts}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Generate and download a standalone calculators PDF.
 * @param {object} calcInputs   - { loanAmount, rate, termYears, extra, offsetBalance }
 * @param {object} calcResults  - { repayment, extra_repayments, offset, borrowing_power }
 */
export async function downloadCalculatorsPdf(calcInputs, calcResults) {
  const doc = <CalculatorsDocument calcInputs={calcInputs} calcResults={calcResults} />;
  const blob = await pdf(doc).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `loan-calculators-${ts}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
