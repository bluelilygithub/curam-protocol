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

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: '#1A1A1A', padding: 40, lineHeight: 1.4 },
  header: { marginBottom: 16, borderBottom: `1 solid ${BORDER}`, paddingBottom: 10 },
  title: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: PRIMARY, marginBottom: 2 },
  subtitle: { fontSize: 9, color: MUTED },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#1A1A1A', marginBottom: 6, paddingBottom: 3, borderBottom: `1 solid ${BORDER}` },
  sectionHint: { fontSize: 8, color: MUTED, marginBottom: 6 },
  row: { flexDirection: 'row', marginBottom: 2 },
  label: { width: '42%', color: MUTED, fontSize: 8.5 },
  value: { flex: 1, fontFamily: 'Helvetica-Bold', fontSize: 8.5 },
  tableHeader: { flexDirection: 'row', backgroundColor: BG_ALT, padding: '5 6', borderBottom: `1 solid ${BORDER}`, marginBottom: 0 },
  tableRow: { flexDirection: 'row', padding: '4 6', borderBottom: `1 solid ${BORDER}` },
  tableCell: { flex: 1, fontSize: 8 },
  tableCellBold: { flex: 1, fontSize: 8, fontFamily: 'Helvetica-Bold' },
  tableCellNarrow: { width: 80, fontSize: 8 },
  tableCellWide: { flex: 2, fontSize: 8 },
  caveat: { fontSize: 8, color: MUTED, marginBottom: 3, paddingLeft: 8 },
  caveatBullet: { fontSize: 8, color: MUTED, marginBottom: 2 },
  highlight: { backgroundColor: '#FFF8F5', padding: '6 8', borderLeft: `3 solid ${PRIMARY}`, marginBottom: 8 },
  highlightText: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: PRIMARY },
  highlightSub: { fontSize: 8, color: MUTED, marginTop: 2 },
  pill: { fontSize: 8, color: MUTED, marginBottom: 2 },
  divider: { borderBottom: `1 solid ${BORDER}`, marginBottom: 10, marginTop: 4 },
  footer: { position: 'absolute', bottom: 24, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between' },
  footerText: { fontSize: 7, color: MUTED },
  warning: { fontSize: 8, color: '#92400E', backgroundColor: '#FFFBEB', padding: '5 8', marginTop: 6, borderLeft: `3 solid #F59E0B` },
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
          ? 'Live CDR market rates — best available from 8 major AU lenders'
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
  const sections = [
    calcs.repayment && ['Repayment Calculator', [
      ['Monthly repayment', fmtMonthly(calcs.repayment.monthly)],
      ['Fortnightly repayment', calcs.repayment.fortnightly ? `$${Number(calcs.repayment.fortnightly).toLocaleString('en-AU')}/fortnight` : '—'],
      ['Weekly repayment', calcs.repayment.weekly ? `$${Number(calcs.repayment.weekly).toLocaleString('en-AU')}/week` : '—'],
      calcs.repayment.explanation ? ['Note', calcs.repayment.explanation] : null,
    ].filter(Boolean)],
    calcs.extra_repayments && ['Extra Repayments Impact', [
      ['Time saved', calcs.extra_repayments.time_saved_label || '—'],
      ['Interest saved', fmtMoney(calcs.extra_repayments.interest_saved)],
      calcs.extra_repayments.explanation ? ['Note', calcs.extra_repayments.explanation] : null,
    ].filter(Boolean)],
    calcs.offset && ['Offset Account Benefit', [
      ['Interest saved over term', fmtMoney(calcs.offset.interest_saved)],
      ['Effective rate reduction', calcs.offset.effective_rate_reduction ? `${calcs.offset.effective_rate_reduction}%` : '—'],
      calcs.offset.explanation ? ['Note', calcs.offset.explanation] : null,
    ].filter(Boolean)],
    calcs.borrowing_power && ['Borrowing Power (Indicative)', [
      ['Indicative max loan', fmtMoney(calcs.borrowing_power.indicative_max_loan)],
      ['Assessment rate used', calcs.borrowing_power.assessment_rate ? `${calcs.borrowing_power.assessment_rate}%` : '—'],
      ['Note', calcs.borrowing_power.disclaimer || 'Indicative only — not a lending decision. Actual serviceability varies by lender.'],
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

function FollowUpsSection({ calcResult }) {
  const advice = calcResult.advice;
  if (!advice) return null;
  const questions = advice.follow_up_questions || [];
  const raise = advice.raise_with_broker_or_tax_agent || [];
  const caveats = calcResult.calculation?.combined_caveats || calcResult.calculation?.caveats || [];
  const assumptions = calcResult.calculation?.combined_assumptions || calcResult.calculation?.assumptions || [];

  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>Follow-ups, Caveats & Assumptions</Text>

      {questions.length > 0 && (
        <View style={{ marginBottom: 8 }}>
          <Text style={[s.label, { fontFamily: 'Helvetica-Bold', color: '#1A1A1A', fontSize: 9, marginBottom: 3 }]}>Suggested follow-up questions</Text>
          {questions.map((q, i) => (
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

function PropertyScenarioPdfDocument({ calcResult, inputs, scenarioType, tabFilter }) {
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

        {show('overview') && <SummaryTableSection calcResult={calcResult} />}

        {show('overview') && <TimelineSection calcResult={calcResult} />}

        {show('lenders') && <LendersSection calcResult={calcResult} />}

        {show('calculators') && <CalculatorsSection calcResult={calcResult} />}

        {show('followups') && <FollowUpsSection calcResult={calcResult} />}

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
 * @param {string} tabFilter  - 'all' | 'overview' | 'lenders' | 'calculators' | 'followups'
 */
export async function downloadPropertyScenarioPdf(calcResult, inputs, scenarioType, tabFilter = 'all') {
  const doc = (
    <PropertyScenarioPdfDocument
      calcResult={calcResult}
      inputs={inputs}
      scenarioType={scenarioType}
      tabFilter={tabFilter}
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
