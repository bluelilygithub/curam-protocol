'use strict';

// Gathers the Shares accountant pack for one financial year as normalized report objects
// ({ key, group, title, subtitle, notes, summary, sections }) so the Finance pack's PDF and Excel
// renderers lay it out unchanged. Figures come from the same code as the Shares tabs (sharesCgt.js
// for capital gains, share_cash_ledger for dividends), so the pack cannot show a number the app doesn't.
// buildSharesPack() is pure (no database) so it can be tested.

const { buildCgt, summariseDisposals, tradeDate, fyLabel, DISCOUNT_RATE } = require('../sharesCgt');

const money = (key, label) => ({ key, label, format: 'money', align: 'right' });
const text = (key, label) => ({ key, label });
const date = (key, label) => ({ key, label, format: 'date' });
const num = (key, label) => ({ key, label, format: 'num' });
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function fyBounds(fy) {
  const y = parseInt(fy.slice(0, 4), 10);
  return { fy, y, from: `${y}-07-01`, to: `${y + 1}-06-30` };
}

const qtyText = (q) => String(Math.round(Number(q) * 1e6) / 1e6);

function buildSharesPack({ fy, trades, ledger, docs = [], notes = '', tz = 'Australia/Brisbane', today, generatedAt = '' }) {
  const b = fyBounds(fy);
  const inFy = (d) => d >= b.from && d <= b.to;

  // ---- capital gains (FIFO, trade date), whole history so cost base carries across years
  const { disposals: allDisposals, warnings } = buildCgt(trades, tz, { today });
  const disposals = allDisposals.filter((d) => d.fy === fy).sort((a, c) => a.soldOn.localeCompare(c.soldOn) || a.symbol.localeCompare(c.symbol));
  const cg = summariseDisposals(disposals);

  // ---- trades in the year
  const tradeRows = trades
    .map((t) => ({ t, day: tradeDate(t.tradedAt, tz) }))
    .filter((x) => x.day && inFy(x.day))
    .sort((a, c) => a.day.localeCompare(c.day) || Number(a.t.id) - Number(c.t.id))
    .map(({ t, day }) => {
      const qty = Number(t.quantity) || 0;
      const price = Number(t.pricePerShare) || 0;
      const fees = Number(t.feesAud) || 0;
      const gross = round2(qty * price);
      return { date: day, symbol: t.symbol, side: t.side === 'sell' ? 'Sell' : 'Buy', qty: qtyText(qty), price, fees, total: round2(t.side === 'sell' ? gross - fees : gross + fees) };
    });
  const buysTotal = round2(tradeRows.filter((r) => r.side === 'Buy').reduce((s, r) => s + r.total, 0));
  const sellsTotal = round2(tradeRows.filter((r) => r.side === 'Sell').reduce((s, r) => s + r.total, 0));
  const feesTotal = round2(tradeRows.reduce((s, r) => s + r.fees, 0));

  // ---- dividends paid in the year
  const divAll = ledger
    .filter((r) => r.type === 'dividend')
    .map((r) => {
      const paid = r.paidOnText || (r.paidOn ? tradeDate(r.paidOn, tz) : null) || (r.createdAt ? tradeDate(r.createdAt, tz) : null);
      const net = round2(r.amountAud);
      const hasGross = r.grossAud != null;
      const gross = hasGross ? round2(r.grossAud) : null;
      const withheld = hasGross ? round2(r.withholdingTaxAud != null ? r.withholdingTaxAud : gross - net) : null;
      return { paid, symbol: r.symbol || '', gross, withheld, rate: r.withholdingRatePct != null ? Number(r.withholdingRatePct) : null, net, derived: !!r.grossDerived, hasGross };
    })
    .filter((d) => d.paid && inFy(d.paid))
    .sort((a, c) => a.paid.localeCompare(c.paid) || a.symbol.localeCompare(c.symbol));
  const sum = (arr, k) => round2(arr.reduce((s, r) => s + (Number(r[k]) || 0), 0));
  const divGross = sum(divAll, 'gross'), divWithheld = sum(divAll, 'withheld'), divNet = sum(divAll, 'net');
  const bySymbol = [...new Set(divAll.map((d) => d.symbol))].sort().map((s) => {
    const rows = divAll.filter((d) => d.symbol === s);
    return { symbol: s || '(none)', count: rows.length, gross: sum(rows, 'gross'), withheld: sum(rows, 'withheld'), net: sum(rows, 'net') };
  });

  // ---- holdings at 30 June: replay the trades up to the year end and read the parcels still open
  const upTo = trades.filter((t) => { const d = tradeDate(t.tradedAt, tz); return d && d <= b.to; });
  const { openParcels } = buildCgt(upTo, tz, { today: b.to });
  const holdMap = new Map();
  for (const p of openParcels) {
    const h = holdMap.get(p.symbol) || { symbol: p.symbol, exchange: p.exchange, qty: 0, cost: 0 };
    h.qty += p.quantity; h.cost += p.costAud;
    holdMap.set(p.symbol, h);
  }
  const holdRows = [...holdMap.values()].sort((a, c) => a.symbol.localeCompare(c.symbol)).map((h) => ({ symbol: h.symbol, exchange: h.exchange, qty: qtyText(h.qty), cost: round2(h.cost) }));

  // ---- reports
  const ratePct = DISCOUNT_RATE * 100;
  const isLoss = cg.lossCarriedForwardAud > 0;
  const reports = [];

  reports.push({
    key: 'tax_summary', group: 'Summary', title: 'Tax summary', subtitle: `${b.from} to ${b.to}, all figures in AUD`,
    notes: ['Indicative only, for the accountant to check. Capital gains use FIFO parcel matching on trade date; losses carried in from earlier years are not included.'],
    summary: [
      { label: isLoss ? 'Net capital loss carried forward' : 'Net capital gain', value: isLoss ? cg.lossCarriedForwardAud : cg.netCapitalGainAud, format: 'money' },
      { label: 'Dividends (gross)', value: divGross, format: 'money' },
      { label: 'Foreign tax withheld', value: divWithheld, format: 'money' },
      { label: 'Dividends (net received)', value: divNet, format: 'money' },
    ],
    sections: [
      {
        title: 'Capital gains working',
        columns: [text('item', 'Item'), money('amount', 'Amount')],
        rows: [
          { item: `Sales in the year (${cg.disposalCount} parcel${cg.disposalCount === 1 ? '' : 's'}): proceeds`, amount: cg.proceedsAud },
          { item: 'Sales in the year: cost base (incl. brokerage)', amount: cg.costAud },
          { item: 'Gains eligible for the discount (held over 12 months)', amount: cg.gainsDiscountableAud },
          { item: 'Other gains (held 12 months or less)', amount: cg.gainsOtherAud },
          { item: 'Total capital gains', amount: cg.totalGainsAud },
          { item: 'Capital losses', amount: -cg.lossesAud },
          { item: 'Losses applied to other gains first', amount: -cg.lossesAppliedToOtherAud },
          { item: 'Losses applied to discount-eligible gains', amount: -cg.lossesAppliedToDiscountableAud },
          { item: `Discount (${ratePct}%) on the discount-eligible remainder`, amount: -cg.discountAmountAud },
          { item: 'Net capital gain', amount: cg.netCapitalGainAud },
          { item: 'Net capital loss carried forward', amount: cg.lossCarriedForwardAud },
        ],
      },
      {
        title: 'Dividends by holding',
        columns: [text('symbol', 'Holding'), { key: 'count', label: 'Payments', format: 'int' }, money('gross', 'Gross'), money('withheld', 'Tax withheld'), money('net', 'Net received')],
        rows: bySymbol,
        totals: { symbol: 'Total', count: divAll.length, gross: divGross, withheld: divWithheld, net: divNet },
      },
    ],
  });

  reports.push({
    key: 'cgt_parcels', group: 'Capital gains', title: 'Capital gains: sold parcels', subtitle: `${b.from} to ${b.to}`,
    notes: ['One row per purchase parcel a sale used (FIFO, trade date). Cost includes buy brokerage; proceeds are after sell brokerage.'],
    sections: [{
      title: 'Parcels sold',
      columns: [text('symbol', 'Holding'), date('acquired', 'Bought'), date('sold', 'Sold'), num('qty', 'Qty'), { key: 'days', label: 'Days held', format: 'int' }, money('cost', 'Cost'), money('proceeds', 'Proceeds'), money('gain', 'Gain / loss'), text('discount', '12-month discount?')],
      rows: disposals.map((d) => ({ symbol: d.symbol, acquired: d.acquiredOn, sold: d.soldOn, qty: d.quantity, days: d.daysHeld, cost: d.costAud, proceeds: d.proceedsAud, gain: d.gainAud, discount: d.discountEligible ? 'Yes' : 'No' })),
      totals: { symbol: 'Total', cost: cg.costAud, proceeds: cg.proceedsAud, gain: round2(cg.proceedsAud - cg.costAud) },
    }],
  });

  reports.push({
    key: 'dividends', group: 'Income', title: 'Dividends received', subtitle: `${b.from} to ${b.to}`,
    notes: ['Gross, tax withheld and net as shown on the broker statement. "Derived" means gross was worked out from the net amount at an assumed rate, not read from a statement.'],
    sections: [{
      title: 'Payments',
      columns: [date('paid', 'Paid'), text('symbol', 'Holding'), money('gross', 'Gross'), money('withheld', 'Tax withheld'), { key: 'rate', label: 'Rate', format: 'pct' }, money('net', 'Net received'), text('source', 'Gross is')],
      rows: divAll.map((d) => ({ paid: d.paid, symbol: d.symbol, gross: d.gross, withheld: d.withheld, rate: d.rate, net: d.net, source: !d.hasGross ? 'unknown' : d.derived ? 'derived' : 'from statement' })),
      totals: { symbol: 'Total', gross: divGross, withheld: divWithheld, net: divNet },
    }],
  });

  reports.push({
    key: 'trades', group: 'Trades', title: 'Trades in the year', subtitle: `${b.from} to ${b.to}`,
    notes: ['Buy total = quantity x price + brokerage. Sell total = quantity x price - brokerage. Prices are AUD as settled by the broker.'],
    summary: [
      { label: 'Bought', value: buysTotal, format: 'money' },
      { label: 'Sold (net of brokerage)', value: sellsTotal, format: 'money' },
      { label: 'Brokerage and GST', value: feesTotal, format: 'money' },
    ],
    sections: [{
      title: 'Trades',
      columns: [date('date', 'Trade date'), text('symbol', 'Holding'), text('side', 'Side'), num('qty', 'Qty'), money('price', 'Price'), money('fees', 'Brokerage'), money('total', 'Total')],
      rows: tradeRows,
      totals: { symbol: 'Total brokerage', fees: feesTotal },
    }],
  });

  reports.push({
    key: 'holdings', group: 'Position', title: `Holdings at ${b.to}`, subtitle: 'Cost base of parcels still held at the end of the year',
    notes: ['Cost base only (quantity x price + brokerage, FIFO). The broker statement shows the market value at close.'],
    sections: [{
      title: 'Holdings',
      columns: [text('symbol', 'Holding'), text('exchange', 'Exchange'), num('qty', 'Qty'), money('cost', 'Cost base')],
      rows: holdRows,
      totals: { symbol: 'Total', cost: round2(holdRows.reduce((s, r) => s + r.cost, 0)) },
    }],
  });

  // ---- observations: generated from the data, plus the owner's own notes
  const obs = [];
  const add = (topic, observation) => obs.push({ topic, observation });
  add('Method', 'Capital gains use FIFO parcel matching on trade date (the ATO default when parcels are not specifically identified). The 12-month discount excludes both the purchase and sale day. Losses from earlier years are not included.');
  const feeTrades = tradeRows.filter((r) => r.fees > 0).length;
  add('Brokerage', feeTrades ? `${feeTrades} trade${feeTrades === 1 ? '' : 's'} in the year carried brokerage and GST (${feesTotal.toFixed(2)} in total), included in cost base and proceeds. Other trades had no brokerage.` : 'No brokerage was recorded on trades in the year.');
  const derivedN = divAll.filter((d) => d.derived || !d.hasGross).length;
  add('Dividend figures', divAll.length ? (derivedN ? `${derivedN} of ${divAll.length} dividend payments have a gross amount worked out from the net, not read from a statement. Check them against the broker statement.` : `All ${divAll.length} dividend payments carry the gross and tax withheld shown on the broker statement.`) : 'No dividends were recorded in the year.');
  const rates = bySymbol.map((s) => ({ s: s.symbol, r: s.gross > 0 ? Math.round((s.withheld / s.gross) * 100) : null })).filter((x) => x.r != null);
  if (rates.length) add('Foreign tax withheld', `Effective withholding by holding: ${rates.map((x) => `${x.s} ${x.r}%`).join(', ')}. ${rates.some((x) => x.r >= 25) ? 'Rates of about 30% on US shares are higher than the 15% treaty rate and are the usual rate withheld when the broker holds no W-8BEN form (worth confirming with the broker).' : ''}`.trim());
  add('Franking', 'Franking credits are not recorded in this app. Holdings in this year are foreign-listed; if any Australian-listed dividends were received, check the broker statement for franking.');
  add('Cash', 'The cash ledger holds dividends only. Money moved between the broker and the owner\'s bank account is shown on the broker statement.');
  add('Documents', docs.length ? `${docs.length} source document${docs.length === 1 ? ' is' : 's are'} attached (see the Source documents page and the documents folder of the zip).` : 'No source documents are attached.');
  for (const w of warnings) add('Data warning', w);
  const ownerNotes = String(notes || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const n of ownerNotes) add('Owner note', n);

  reports.push({
    key: 'observations', group: 'Notes', title: 'Observations and data checks', subtitle: 'Generated from the data, plus the owner\'s notes',
    sections: [{ title: 'Observations', columns: [text('topic', 'Topic'), text('observation', 'Observation')], rows: obs }],
  });

  reports.push({
    key: 'source_docs', group: 'Notes', title: 'Source documents', subtitle: 'Kept with the pack in the documents folder of the zip',
    sections: [{
      title: 'Documents',
      columns: [text('title', 'Title'), text('file', 'File'), date('docDate', 'Date'), text('notes', 'Notes')],
      rows: docs.map((d) => ({ title: d.title, file: d.originalName, docDate: d.docDate || '', notes: d.notes || '' })),
    }],
  });

  const cover = {
    title: `Shares tax pack — FY ${fy}`,
    business: 'Private share trading account',
    abn: '', address: '',
    period: `${b.from} to ${b.to}`,
    generatedAt,
    hideChecks: true,
    notes: [
      'Prepared from the owner\'s private share portfolio records in Vault. The broker\'s own statements are the authoritative source and are attached where uploaded.',
      'Capital gains and dividend figures are indicative and for the accountant to check. This pack is information for the accountant, not tax advice or a lodged return.',
    ],
    failed: [],
  };

  const dataSheets = [{
    name: 'Data - All trades', title: 'Every trade on record (all years)',
    columns: [date('date', 'Trade date'), text('symbol', 'Holding'), text('exchange', 'Exchange'), text('side', 'Side'), num('qty', 'Qty'), money('price', 'Price'), money('fees', 'Brokerage'), text('fy', 'Financial year')],
    rows: trades
      .map((t) => ({ day: tradeDate(t.tradedAt, tz), t }))
      .filter((x) => x.day)
      .sort((a, c) => a.day.localeCompare(c.day) || Number(a.t.id) - Number(c.t.id))
      .map(({ day, t }) => ({ date: day, symbol: t.symbol, exchange: t.exchange, side: t.side === 'sell' ? 'Sell' : 'Buy', qty: Number(t.quantity), price: Number(t.pricePerShare), fees: Number(t.feesAud) || 0, fy: fyLabel(day) })),
  }];

  return { fy, bounds: b, cover, reports, dataSheets };
}

async function collectSharesPack(userId, fy) {
  const { pool } = require('../../db');
  const portfolio = require('../sharesPortfolio');
  const { getWorkspaceTimezone, getDateInTz } = require('../sharesNewsService');
  const tz = await getWorkspaceTimezone();
  const today = getDateInTz(tz);
  const { trades, ledger } = await portfolio.getTradesAndLedger(userId);
  const { rows: docs } = await pool.query(
    `SELECT id, title, "originalName", "docDate"::text AS "docDate", notes FROM share_documents WHERE "userId"=$1 AND fy=$2 ORDER BY COALESCE("docDate","createdAt"::date), id`, [userId, fy]);
  const { rows: noteRows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='shares_pack_notes'`, [userId]);
  const generatedAt = new Intl.DateTimeFormat('en-AU', { dateStyle: 'long', timeStyle: 'short', timeZone: tz }).format(new Date());
  return buildSharesPack({ fy, trades, ledger, docs, notes: noteRows[0]?.value || '', tz, today, generatedAt });
}

module.exports = { buildSharesPack, collectSharesPack, fyBounds };
