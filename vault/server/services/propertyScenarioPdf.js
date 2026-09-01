'use strict';

/**
 * Property Scenario PDF — server-side pdf-lib implementation.
 * Mirrors the section structure of propertyScenarioPdf.jsx but runs on the
 * server so there is no dependency on @react-pdf/renderer in the browser.
 *
 * Exports: buildPropertyScenarioPdfBuffer(calcResult, inputs, scenarioType, tabFilter, followUpAnswers)
 */

const { PDFDocument, StandardFonts, rgb, LineCapStyle } = require('pdf-lib');

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  primary:  rgb(0.80, 0.47, 0.36), // #CC785C
  text:     rgb(0.10, 0.10, 0.10),
  muted:    rgb(0.53, 0.53, 0.53),
  border:   rgb(0.85, 0.85, 0.81),
  bgAlt:    rgb(0.96, 0.96, 0.94),
  green:    rgb(0.08, 0.60, 0.24),
  red:      rgb(0.73, 0.11, 0.11),
  amber:    rgb(0.57, 0.25, 0.04),
  white:    rgb(1, 1, 1),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function clean(v) {
  return String(v == null ? '' : v)
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2265]/g, '>=')
    .replace(/[\u2264]/g, '<=')
    .replace(/\u2192/g, '->')
    .replace(/\u2026/g, '...')
    .replace(/\u00a0/g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '');
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '$0';
  return `$${Math.round(v).toLocaleString('en-AU')}`;
}

function fmtMonthly(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '-';
  return `$${Math.round(v).toLocaleString('en-AU')}/mo`;
}

function fmtPct(n) {
  const v = Number(n);
  return Number.isFinite(v) ? `${v}%` : '-';
}

function wordWrap(text, font, size, maxWidth) {
  const safe = clean(text);
  const lines = [];
  for (const para of safe.split(/\n+/)) {
    const words = para.split(/\s+/);
    let line = '';
    for (const word of words) {
      if (!word) continue;
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    if (!para.trim()) lines.push('');
  }
  return lines;
}

// ── Page builder ─────────────────────────────────────────────────────────────
function makeBuilder(pdfDoc, fonts) {
  const PAGE_W = 595, PAGE_H = 842;
  const MARGIN = 44;
  const CONTENT_W = PAGE_W - MARGIN * 2;
  const { reg, bold } = fonts;

  let page;
  let y;

  function newPage() {
    page = pdfDoc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - MARGIN;
    addFooter();
  }

  function addFooter() {
    const t = 'Property Scenario Report  ·  Curam Vault  ·  For general information only — not financial or legal advice.';
    page.drawText(clean(t), { x: MARGIN, y: 22, size: 6.5, font: reg, color: C.muted });
  }

  function ensureSpace(needed) {
    if (y - needed < MARGIN + 24) newPage();
  }

  function text(str, { x = MARGIN, size = 9, font: f = reg, color = C.text, indent = 0, gap = 3 } = {}) {
    const lines = wordWrap(str, f, size, CONTENT_W - indent);
    for (const line of lines) {
      ensureSpace(size + gap);
      if (line) page.drawText(line, { x: x + indent, y, size, font: f, color });
      y -= size + gap;
    }
  }

  function hline({ color = C.border, thickness = 0.5, indent = 0 } = {}) {
    ensureSpace(4);
    page.drawLine({ start: { x: MARGIN + indent, y }, end: { x: MARGIN + CONTENT_W, y }, thickness, color });
    y -= 4;
  }

  function gap(n = 6) { y -= n; }

  function sectionTitle(str) {
    ensureSpace(24);
    gap(6);
    text(str, { size: 11, font: bold, color: C.text });
    hline({ color: C.border });
    gap(2);
  }

  function row(label, value, { labelWidth = 0.44, valueColor = C.text } = {}) {
    const lw = CONTENT_W * labelWidth;
    const vw = CONTENT_W * (1 - labelWidth);
    const lLines = wordWrap(label, reg, 8.5, lw - 6);
    const vLines = wordWrap(String(value), bold, 8.5, vw);
    const n = Math.max(lLines.length, vLines.length);
    const lineH = 11;
    ensureSpace(n * lineH + 2);
    for (let i = 0; i < n; i++) {
      if (lLines[i]) page.drawText(lLines[i], { x: MARGIN, y, size: 8.5, font: reg, color: C.muted });
      if (vLines[i]) page.drawText(vLines[i], { x: MARGIN + lw, y, size: 8.5, font: bold, color: valueColor });
      y -= lineH;
    }
  }

  function highlight(str, sub, { color = C.primary } = {}) {
    ensureSpace(40);
    const bh = sub ? 42 : 28;
    page.drawRectangle({ x: MARGIN, y: y - bh + 10, width: CONTENT_W, height: bh, color: rgb(1, 0.97, 0.95) });
    page.drawLine({ start: { x: MARGIN, y: y - bh + 10 }, end: { x: MARGIN, y: y + 10 }, thickness: 3, color });
    y -= 4;
    text(str, { size: 10, font: bold, color, indent: 8 });
    if (sub) text(sub, { size: 8, font: reg, color: C.muted, indent: 8 });
    gap(4);
  }

  function warn(str) {
    ensureSpace(32);
    page.drawRectangle({ x: MARGIN, y: y - 24, width: CONTENT_W, height: 30, color: rgb(1, 0.98, 0.93) });
    page.drawLine({ start: { x: MARGIN, y: y - 24 }, end: { x: MARGIN, y: y + 6 }, thickness: 3, color: rgb(0.96, 0.62, 0.04) });
    y -= 2;
    text(str, { size: 7.5, font: reg, color: C.amber, indent: 8 });
    gap(4);
  }

  function table(headers, rows, { colWidths } = {}) {
    const n = headers.length;
    const cw = colWidths || headers.map(() => CONTENT_W / n);
    const hh = 14;
    ensureSpace(hh + 4);
    page.drawRectangle({ x: MARGIN, y: y - hh + 10, width: CONTENT_W, height: hh, color: C.bgAlt });
    let cx = MARGIN + 4;
    for (let i = 0; i < n; i++) {
      page.drawText(clean(headers[i]), { x: cx, y, size: 7.5, font: bold, color: C.text });
      cx += cw[i];
    }
    y -= hh;
    for (const dataRow of rows) {
      const cells = dataRow.map((c, i) => wordWrap(String(c ?? '-'), reg, 7.5, cw[i] - 6));
      const rowLines = Math.max(...cells.map((c) => c.length), 1);
      const rh = rowLines * 10 + 4;
      ensureSpace(rh + 2);
      page.drawLine({ start: { x: MARGIN, y: y + 8 }, end: { x: MARGIN + CONTENT_W, y: y + 8 }, thickness: 0.3, color: C.border });
      let cx2 = MARGIN + 4;
      for (let i = 0; i < n; i++) {
        let ty = y;
        for (const line of cells[i]) {
          if (line) page.drawText(line, { x: cx2, y: ty, size: 7.5, font: reg, color: C.text });
          ty -= 10;
        }
        cx2 += cw[i];
      }
      y -= rh;
    }
    gap(4);
  }

  function note(str) {
    text(str, { size: 7.5, font: reg, color: C.muted });
    gap(2);
  }

  newPage();
  return { newPage, text, hline, gap, sectionTitle, row, highlight, warn, table, note, pdfDoc };
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildHeader(b, scenarioType) {
  const typeLabels = {
    refinance: 'Compare Lenders / Refinance',
    sell: 'Sell a Property',
    buy: 'Buy a Property',
    compound: 'Multiple Events',
  };
  const generatedAt = new Date().toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  b.text('Property Scenario Report', { size: 18, font: b.pdfDoc._fonts?.bold, color: C.primary });
  b.text(`${typeLabels[scenarioType] || 'Scenario'}  ·  Generated ${generatedAt}`, { size: 8, color: C.muted });
  b.text('Calculations are deterministic AU rules. LLM involvement: input structuring only, not numbers.', { size: 7.5, color: C.muted });
  b.hline({ color: C.border });
  b.gap(4);
}

function buildInputs(b, inputs, scenarioType) {
  b.sectionTitle('Inputs — what was entered');
  const rows = [];
  if (scenarioType === 'refinance') {
    rows.push(['Current loan balance', inputs.rfBalance ? fmtMoney(inputs.rfBalance) : '-']);
    rows.push(['Current interest rate', inputs.rfRate ? `${inputs.rfRate}% p.a.` : '-']);
    rows.push(['Rate type', inputs.rfRateType || '-']);
    rows.push(['Term remaining', inputs.rfTermMonths ? `${inputs.rfTermMonths} months (${(Number(inputs.rfTermMonths) / 12).toFixed(1)} years)` : '-']);
    if (inputs.rfRateType === 'fixed' && inputs.rfFixedPeriod) {
      rows.push(['Fixed period remaining', `${inputs.rfFixedPeriod} months`]);
    }
    rows.push(['Compared against', inputs.rfTargetMode === 'cdr'
      ? 'Live CDR market rates - best available from 9 AU lenders'
      : inputs.rfTargetRate ? `Specific rate: ${inputs.rfTargetRate}%` : '-']);
  } else if (scenarioType === 'sell') {
    rows.push(['State', inputs.sellState || '-']);
    rows.push(['Property type', inputs.sellPpor === 'ppor' ? 'Primary residence (PPOR)' : inputs.sellPpor === 'investment' ? 'Investment property' : 'Mixed use']);
    rows.push(['Expected sale price', inputs.sellPrice ? fmtMoney(inputs.sellPrice) : '-']);
    rows.push(['Original purchase price', inputs.sellPurchasePrice ? fmtMoney(inputs.sellPurchasePrice) : '-']);
    if (inputs.sellPurchaseYear) rows.push(['Year purchased', String(inputs.sellPurchaseYear)]);
  } else if (scenarioType === 'buy') {
    rows.push(['State', inputs.buyState || '-']);
    rows.push(['Purpose', inputs.buyPpor === 'ppor' ? 'Primary residence (PPOR)' : 'Investment property']);
    rows.push(['Purchase price', inputs.buyPrice ? fmtMoney(inputs.buyPrice) : '-']);
    rows.push(['Deposit', inputs.buyDeposit ? fmtMoney(inputs.buyDeposit) : '-']);
    rows.push(['First home buyer', inputs.buyFhb === 'yes' ? 'Yes' : 'No']);
  }
  for (const [label, value] of rows) b.row(label, value);
  b.gap(6);
}

function buildRefinanceResult(b, calcResult) {
  const refi = calcResult.calculation?.event_results?.[0]?.outputs?.refinance_break_even;
  const totals = calcResult.calculation?.totals || {};
  const cdrData = calcResult.cdr_rate_used;
  const best = cdrData?.best || (cdrData?.rate ? cdrData : null);

  const monthlySaving = Number(refi?.monthly_saving ?? totals.monthly_repayment_saving ?? 0);
  const breakEvenMonths = refi?.break_even_months;
  const upfront = Number(refi?.upfront_cost ?? 0);
  const breakCost = Number(totals.break_costs ?? 0);
  const annualised = Number(totals.annualised_repayment_saving ?? 0);
  const curRepayment = Number(refi?.monthly_repayment_current ?? 0);
  const newRepayment = Number(refi?.monthly_repayment_target ?? 0);

  b.sectionTitle('Refinance Result');
  if (monthlySaving > 0) {
    b.highlight(
      `Monthly saving: ${fmtMonthly(monthlySaving)} - break-even in ${breakEvenMonths ?? '-'} months`,
      annualised > 0 ? `Annualised saving: ${fmtMoney(annualised)}` : undefined,
    );
  } else if (monthlySaving < 0) {
    b.highlight(
      `Refinancing increases repayments by ${fmtMonthly(Math.abs(monthlySaving))}/month`,
      'Consider whether the product benefits justify the higher cost.',
      { color: C.red },
    );
  } else {
    b.highlight('No repayment change', 'The target rate is equal to your current rate.', { color: C.muted });
  }

  b.row('Current repayment', fmtMonthly(curRepayment));
  b.row('New repayment (target rate)', fmtMonthly(newRepayment));
  b.row('Upfront refinance costs', fmtMoney(upfront));
  if (breakCost > 0) b.row('Break costs (fixed rate)', fmtMoney(breakCost));
  if (breakEvenMonths != null) b.row('Break-even period', `${breakEvenMonths} months`);
  if (best) {
    b.gap(4);
    b.row('CDR rate used', `${best.rate ?? best.advertised_rate ?? '-'}%${best.lender ? ` (${best.lender})` : ''}`);
  }
  b.gap(6);
}

function buildSellCgt(b, calcResult, inputs) {
  const out = calcResult.calculation?.event_results?.[0]?.outputs;
  if (!out) return;

  const salePrice = Number(out.sale_price ?? 0);
  const sellingCosts = Number(out.selling_costs ?? 0);
  const netProceeds = Number(out.net_sale_proceeds ?? 0);
  const cgt = out.cgt || {};
  const taxableCgt = Number(cgt.taxable_capital_gain_estimate ?? 0);
  const isMreExempt = Boolean(cgt.main_residence_exempt);
  const grossGain = Number(cgt.capital_gain_gross ?? 0);
  const discountApplied = Boolean(cgt.cgt_discount_applied);
  const sellingCostPct = salePrice > 0 ? `${((sellingCosts / salePrice) * 100).toFixed(1)}%` : '';

  b.sectionTitle('Sell - Net Proceeds & CGT');
  b.row('Net proceeds', fmtMoney(netProceeds));
  b.row('Sale price', fmtMoney(salePrice));
  b.row(`Selling costs (${sellingCostPct})`, fmtMoney(sellingCosts));
  b.gap(4);

  if (isMreExempt) {
    b.highlight('Main residence exemption - CGT is $0',
      grossGain > 0 ? `Gross gain on simplified cost base: ${fmtMoney(grossGain)} - fully exempt.` : undefined,
      { color: C.green });
  } else if (taxableCgt > 0) {
    b.highlight(`Taxable capital gain: ${fmtMoney(taxableCgt)}`,
      discountApplied
        ? `After 50% CGT discount (gross gain ${fmtMoney(grossGain)} / 2 - held >12 months).`
        : `Full gross gain - 50% discount not applied (held <=12 months or unknown).`,
      { color: C.red });
    b.table(
      ['Tax bracket', 'Est. tax on gain'],
      [
        ['$45k-$135k bracket (34.5% incl. Medicare)', fmtMoney(Math.round(taxableCgt * 0.345))],
        ['$135k-$190k bracket (39% incl. Medicare)', fmtMoney(Math.round(taxableCgt * 0.39))],
        ['$190k+ bracket (47% incl. Medicare)', fmtMoney(Math.round(taxableCgt * 0.47))],
      ],
      { colWidths: [340, 120] },
    );
    b.note('Your actual tax depends on total income in the year of sale, capital losses, offsets, and other deductions.');
  } else {
    b.row('Capital Gains Tax', '$0 - no capital gain on this simplified cost base.');
  }

  if (inputs?.sellPpor === 'mixed' || cgt.partial_exemption_flagged) {
    b.warn('Partial exemption may apply. The 6-year rule and partial main residence exemption may significantly reduce this figure. Consult a tax agent.');
  }
  b.warn('Cost base uses purchase price only. ATO rules also allow stamp duty, legal fees, capital improvements - all reduce taxable gain. Not tax advice.');
  b.gap(4);
}

function buildSummaryTable(b, calcResult) {
  const rows = (calcResult.summary_table?.totals || []).filter((r) => Number(r.value) !== 0 || r.key === 'total_costs');
  const events = calcResult.summary_table?.events || [];
  if (!rows.length && !events.length) return;

  b.sectionTitle('Cost / Benefit Summary');
  b.note('All figures are deterministic AU calculations. LLM involvement: zero at this stage.');
  b.table(
    ['Metric', 'Amount', 'Type'],
    [
      ...rows.map((r) => [r.label, fmtMoney(r.value), r.kind || '-']),
      ...events.map((e) => [e.label, fmtMoney(e.value), 'event cost']),
    ],
    { colWidths: [290, 100, 80] },
  );
}

function buildTimeline(b, calcResult) {
  const timeline = calcResult.calculation?.cash_flow_timeline || [];
  if (!timeline.length) return;
  b.sectionTitle('Cash-Flow Timeline');
  b.table(
    ['Event', 'Direction', 'Amount', 'Note'],
    timeline.map((item) => [
      item.label || item.event_id || '-',
      item.direction === 'in' ? 'In' : 'Out',
      fmtMoney(item.amount),
      item.note || item.category || '-',
    ]),
    { colWidths: [100, 60, 90, 220] },
  );
}

// ── Bank panel ────────────────────────────────────────────────────────────────

function fmtCapRangePdf(cap, marginPct = 0.03) {
  if (!cap || isNaN(Number(cap))) return null;
  const v = Number(cap);
  const lo = Math.round(v * (1 - marginPct) / 5000) * 5000;
  const hi = Math.round(v * (1 + marginPct) / 5000) * 5000;
  const fmt = (n) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(2)}M` : `$${(n / 1000).toFixed(0)}k`;
  return `~${fmt(lo)} – ${fmt(hi)}`;
}

function buildBankPanel(b, calcResult) {
  const panel = calcResult.bankPanel || calcResult.bankPosture;
  const banks = panel?.banks;
  if (!banks?.length) return;

  b.sectionTitle('How Each Bank May See This File');
  if (panel.capacity_note) b.note(panel.capacity_note);
  if (panel.fit_vs_overall_note) b.note(panel.fit_vs_overall_note);

  for (const bank of banks) {
    b.gap(4);
    const fitLabel = bank.fit ? String(bank.fit).toUpperCase() : '–';
    const scoreStr = bank.score != null ? ` · ${Math.round(bank.score)}` : '';
    const cap = bank.capacity?.indicative_capacity;
    const capStr = cap != null ? (fmtCapRangePdf(cap) || fmtMoney(cap)) : '–';
    const floorStr = bank.capacity?.assessment_rate_pct != null
      ? `assessed at ${Number(bank.capacity.assessment_rate_pct).toFixed(2)}%` : '';

    b.text(`${bank.name}  ${fitLabel}${scoreStr}`, { size: 9.5, bold: true, color: C.text });
    b.row('Indicative capacity', `${capStr}${floorStr ? `  (${floorStr})` : ''}`);
    if (bank.postureSummary) b.row('Posture', bank.postureSummary);
    if (bank.capacity?.narrative) b.row('Capacity note', bank.capacity.narrative);

    if (Array.isArray(bank.score_breakdown) && bank.score_breakdown.length > 0) {
      const pos = bank.score_breakdown.filter((x) => x.delta > 0).reduce((s, x) => s + x.delta, 0);
      const neg = bank.score_breakdown.filter((x) => x.delta < 0).reduce((s, x) => s + x.delta, 0);
      b.row('Score breakdown', `Start 50${pos > 0 ? ` +${pos}` : ''}${neg < 0 ? ` ${neg}` : ''} = ${Math.round(bank.score)}`);
      b.table(
        ['Factor', 'Delta'],
        bank.score_breakdown.map((x) => [x.factor, x.delta > 0 ? `+${x.delta}` : String(x.delta)]),
        { colWidths: [350, 80] },
      );
    }
    const reasons = (bank.reasons || []).filter((r) => r !== bank.capacity?.narrative).slice(0, 3);
    for (const r of reasons) b.note(`· ${r}`);
  }

  b.note('Assessment rate floor per bank: most at 8.50% (APRA); Macquarie ~8.65%, BOQ ~8.55% (curated estimates). Floor is only binding when targetRate + 3% < floor.');
  if (panel.note) b.note(panel.note);
}

function buildBankPanelAdverse(b, calcResult) {
  const panel = calcResult.bankPanelAdverse || calcResult.bankPostureAdverse;
  const normalPanel = calcResult.bankPanel || calcResult.bankPosture;
  if (!panel?.banks?.length) return;

  const normalByBank = Object.fromEntries(
    (normalPanel?.banks || []).map((bk) => [bk.id, bk])
  );

  b.sectionTitle('Adverse Credit Simulation');
  b.note('Shows the impact of assuming 1 default or adverse event in the last 2 years. Compare to the bank panel above. This is a scoring model delta — not a bureau-level credit assessment.');

  const tableRows = panel.banks.map((bk) => {
    const norm = normalByBank[bk.id];
    const scoreDelta = (norm?.score != null && bk.score != null) ? Math.round(bk.score - norm.score) : null;
    const capNorm = norm?.capacity?.indicative_capacity;
    const capAdv  = bk.capacity?.indicative_capacity;
    const capDeltaStr = (capNorm != null && capAdv != null)
      ? `${capAdv >= capNorm ? '+' : ''}${Math.round((capAdv - capNorm) / 1000)}k`
      : '–';
    return [
      bk.name,
      norm ? `${String(norm.fit || '').toUpperCase()} · ${Math.round(norm.score || 0)}` : '–',
      `${String(bk.fit || '').toUpperCase()} · ${Math.round(bk.score || 0)}`,
      scoreDelta != null ? (scoreDelta > 0 ? `+${scoreDelta}` : String(scoreDelta)) : '–',
      capDeltaStr,
    ];
  });

  b.table(
    ['Bank', 'Normal fit · score', 'Adverse fit · score', 'Δ score', 'Δ capacity'],
    tableRows,
    { colWidths: [110, 115, 115, 65, 65] },
  );
}

function buildLenders(b, calcResult) {
  const rows = calcResult.lenders?.rows || [];
  b.sectionTitle('Lender Comparison - All CDR Products');
  b.note(calcResult.lenders?.data_note || 'Live CDR Product Reference Data. Rates are lowest available owner-occupied P&I per lender.');
  b.table(
    ['Lender / Product', 'Rate', 'Comp. Rate', 'Type', 'Offset', 'Fees est.'],
    rows.map((r) => [
      r.lender + (r.name ? ` / ${r.name}` : ''),
      r.rate != null ? `${r.rate}%` : '-',
      r.comparison_rate != null ? `${r.comparison_rate}%` : '-',
      r.fixed_or_variable || '-',
      r.offset ? 'Yes' : 'No',
      r.upfront_fees != null ? fmtMoney(r.upfront_fees) : '-',
    ]),
    { colWidths: [170, 55, 65, 65, 50, 65] },
  );
  b.note('Comparison rates are standardised. Fees marked (est.) are summed from CDR fee objects heuristically - not authoritative. Verify with lender before acting.');
}

function buildCalculators(b, calcResult) {
  const calcs = calcResult.calculators;
  if (!calcs) return;
  b.sectionTitle('Calculators');
  const sections = [
    calcs.repayment?.ok && ['Repayment Calculator', [
      ['Monthly repayment', fmtMonthly(calcs.repayment.repayment)],
      ['Total repaid over term', fmtMoney(calcs.repayment.total_repaid_over_term)],
      ['Total interest', fmtMoney(calcs.repayment.total_interest_over_term)],
      calcs.repayment.explanation ? ['Note', calcs.repayment.explanation] : null,
    ].filter(Boolean)],
    calcs.extra_repayments?.ok && ['Extra Repayments (+$200/month)', [
      ['Months saved', calcs.extra_repayments.months_saved != null ? `${calcs.extra_repayments.months_saved} months` : '-'],
      ['Interest saved', fmtMoney(calcs.extra_repayments.interest_saved)],
    ].filter(Boolean)],
    calcs.offset?.ok && ['Offset Account ($50k)', [
      ['Interest saved', fmtMoney(calcs.offset.interest_saved)],
      ['Months saved', calcs.offset.months_saved != null ? `${calcs.offset.months_saved} months` : '-'],
    ].filter(Boolean)],
    calcs.borrowing_power?.ok && ['Borrowing Power (Indicative)', [
      ['Indicative max loan', fmtMoney(calcs.borrowing_power.max_loan_indicative)],
      ['Assessment rate', calcs.borrowing_power.assessment_rate_pct != null ? `${calcs.borrowing_power.assessment_rate_pct}%` : '-'],
      ['Monthly surplus', calcs.borrowing_power.monthly_surplus != null ? fmtMonthly(calcs.borrowing_power.monthly_surplus) : '-'],
      ['Note', calcs.borrowing_power.explanation || 'Indicative only - not a lending decision.'],
    ]],
  ].filter(Boolean);
  for (const [title, rows] of sections) {
    b.text(title, { size: 9.5, color: C.text });
    for (const [label, value] of rows) b.row(label, value);
    b.gap(6);
  }
}

function buildFollowUps(b, calcResult, followUpAnswers) {
  const advice = calcResult.advice;
  const caveats = calcResult.calculation?.combined_caveats || calcResult.calculation?.caveats || [];
  const assumptions = calcResult.calculation?.combined_assumptions || calcResult.calculation?.assumptions || [];
  const raise = advice?.raise_with_broker_or_tax_agent || [];
  const questions = advice?.follow_up_questions || [];
  const answered = followUpAnswers || {};
  const answeredPairs = Object.entries(answered).filter(([, v]) => v);
  const unanswered = questions.filter((q) => !answered[q]);

  if (!advice && !caveats.length && !assumptions.length) return;
  b.sectionTitle('Follow-ups, Caveats & Assumptions');

  if (answeredPairs.length > 0) {
    b.text('Answered questions', { size: 9, color: C.text });
    b.gap(2);
    for (const [q, a] of answeredPairs) {
      b.text(`Q: ${q}`, { size: 8, color: C.muted, indent: 8 });
      b.text(a, { size: 8.5, color: C.text, indent: 8 });
      b.gap(4);
    }
  }

  if (unanswered.length > 0) {
    b.text(answeredPairs.length > 0 ? 'Remaining follow-up questions' : 'Suggested follow-up questions', { size: 9, color: C.text });
    b.gap(2);
    for (const q of unanswered) {
      b.text(`- ${q}`, { size: 8, color: C.muted, indent: 8 });
    }
    b.gap(4);
  }

  if (raise.length > 0) {
    b.text('Raise with your broker or tax agent', { size: 9, color: C.text });
    b.gap(2);
    for (const item of raise) {
      b.text(`- ${item}`, { size: 8, color: C.muted, indent: 8 });
    }
    b.gap(4);
  }

  if (caveats.length > 0) {
    b.text('Caveats', { size: 9, color: C.text });
    b.gap(2);
    for (const c of caveats) {
      b.text(`- ${clean(c)}`, { size: 7.5, color: C.muted, indent: 8 });
    }
    b.gap(4);
  }

  if (assumptions.length > 0) {
    b.text('Assumptions', { size: 9, color: C.text });
    b.gap(2);
    for (const a of assumptions) {
      b.text(`- ${clean(a)}`, { size: 7.5, color: C.muted, indent: 8 });
    }
    b.gap(4);
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

async function buildPropertyScenarioPdfBuffer(calcResult, inputs, scenarioType, tabFilter = 'all', followUpAnswers = {}) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle('Property Scenario Report');
  pdfDoc.setAuthor('Curam Vault');
  pdfDoc.setCreator('Curam Vault');

  const reg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const b = makeBuilder(pdfDoc, { reg, bold });

  // Patch the text helper to use the correct fonts
  const origText = b.text;
  b.text = (str, opts = {}) => origText(str, { ...opts, font: opts.font || (opts.bold ? bold : reg) });

  // Reconfigure makeBuilder to use real font references — workaround since makeBuilder
  // captures fonts by closure. Re-attach bold via a simple wrapper:
  const B = {
    ...b,
    _bold: bold,
    _reg: reg,
    pdfDoc,
    text: (str, opts = {}) => {
      return b.text(str, { ...opts, font: opts.bold ? bold : reg });
    },
    sectionTitle: (str) => b.sectionTitle(str),
    row: (l, v, o) => b.row(l, v, o),
    highlight: (s, sub, o) => b.highlight(s, sub, o),
    warn: (s) => b.warn(s),
    table: (h, r, o) => b.table(h, r, o),
    note: (s) => b.note(s),
    hline: (o) => b.hline(o),
    gap: (n) => b.gap(n),
  };

  const all  = tabFilter === 'all';
  const show = (tab) => all || tabFilter === tab;

  buildHeader(b, scenarioType);

  if (show('overview')) buildInputs(b, inputs || {}, scenarioType);
  if (show('overview') && scenarioType === 'refinance') buildRefinanceResult(b, calcResult);
  if (show('overview') && scenarioType === 'sell') buildSellCgt(b, calcResult, inputs);
  if (show('overview')) buildSummaryTable(b, calcResult);
  if (show('overview')) buildTimeline(b, calcResult);
  if (show('overview')) buildBankPanel(b, calcResult);
  if (show('overview') && calcResult.bankPanelAdverse) buildBankPanelAdverse(b, calcResult);
  if (show('lenders')) buildLenders(b, calcResult);
  if (show('calculators')) buildCalculators(b, calcResult);
  if (show('followups')) buildFollowUps(b, calcResult, followUpAnswers);

  return pdfDoc.save();
}

module.exports = { buildPropertyScenarioPdfBuffer };
