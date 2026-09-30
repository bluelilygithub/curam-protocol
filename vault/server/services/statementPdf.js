'use strict';

// Customer statement PDF — same look as invoicePdf.js (react-pdf, createElement, no JSX).
// Input is the object built by buildStatement() in routes/financeReports.js:
//   { client, from, to, opening, lines: [{date, description, debit, credit, balance}], closing, aging }

const React = require('react');
const path  = require('path');
const fs    = require('fs');

const GOLD       = '#C17F3A';
const GREY       = '#6B7280';
const LIGHT_GREY = '#F9F9F9';
const WHITE      = '#FFFFFF';
const DARK       = '#1F2937';

const LOGO_PATH = path.join(__dirname, '../assets/curam-ai-logo.png');

function fmtAud(n) {
  const v = Math.abs(parseFloat(n || 0)).toFixed(2);
  const [int, dec] = v.split('.');
  return (parseFloat(n || 0) < 0 ? '-$' : '$') + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const AGING_LABELS = [['current', 'Current'], ['d30', '1–30'], ['d60', '31–60'], ['d90', '61–90'], ['d90p', '90+']];

function buildDocument(deps, stmt, cfg) {
  const { Document, Page, Text, View, StyleSheet, Image } = deps;
  const h = React.createElement;

  const styles = StyleSheet.create({
    page:        { fontSize: 10, fontFamily: 'Helvetica', color: DARK, paddingHorizontal: 42, paddingTop: 40, paddingBottom: 48 },
    headerRow:   { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    headerLeft:  { flexDirection: 'column', maxWidth: '54%' },
    headerRight: { flexDirection: 'column', alignItems: 'flex-end', maxWidth: '44%' },
    logo:        { width: 56, height: 56, marginBottom: 8, objectFit: 'contain' },
    bizName:     { fontSize: 14, fontFamily: 'Helvetica-Bold', color: GOLD, marginBottom: 3 },
    bizDetail:   { fontSize: 8, color: GREY, lineHeight: 1.5 },
    title:       { fontSize: 20, fontFamily: 'Helvetica-Bold', color: GOLD, marginBottom: 8, textAlign: 'right' },
    metaRow:     { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
    metaLabel:   { fontSize: 8, color: GREY, marginRight: 8, minWidth: 60, textAlign: 'right' },
    metaValue:   { fontSize: 8, fontFamily: 'Helvetica-Bold', color: GOLD, minWidth: 90, textAlign: 'right' },
    divider:     { borderBottomWidth: 1.5, borderBottomColor: GOLD, marginBottom: 14 },
    toLabel:     { fontSize: 7, fontFamily: 'Helvetica-Bold', color: GREY, letterSpacing: 1.2, marginBottom: 5 },
    toName:      { fontSize: 12, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 2 },
    toDetail:    { fontSize: 8.5, color: GREY, marginBottom: 1.5 },
    tHead:       { flexDirection: 'row', backgroundColor: GOLD, paddingVertical: 7, paddingHorizontal: 8, marginTop: 14 },
    tHeadCell:   { fontSize: 8, fontFamily: 'Helvetica-Bold', color: WHITE, textTransform: 'uppercase' },
    tRow:        { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
    tRowAlt:     { backgroundColor: LIGHT_GREY },
    cDate:       { width: '15%' },
    cDesc:       { width: '37%', paddingRight: 6 },
    cAmt:        { width: '16%', alignItems: 'flex-end' },
    cell:        { fontSize: 9, color: DARK },
    cellBold:    { fontSize: 9, fontFamily: 'Helvetica-Bold', color: DARK },
    closingRow:  { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
    closingLbl:  { fontSize: 11, fontFamily: 'Helvetica-Bold', color: GOLD, marginRight: 14 },
    closingVal:  { fontSize: 11, fontFamily: 'Helvetica-Bold', color: GOLD },
    agingTitle:  { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: GREY, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 22, marginBottom: 6 },
    agingRow:    { flexDirection: 'row' },
    agingCell:   { flex: 1, alignItems: 'flex-end', paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
    agingHead:   { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: GREY },
    footerDiv:   { borderBottomWidth: 0.5, borderBottomColor: '#D1D5DB', marginBottom: 10, marginTop: 22 },
    footerHead:  { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: GREY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
    footerText:  { fontSize: 8, color: GREY, lineHeight: 1.5 },
  });

  const c = stmt.client;
  const headerLeft = h(View, { style: styles.headerLeft },
    fs.existsSync(LOGO_PATH) && h(Image, { src: LOGO_PATH, style: styles.logo }),
    cfg.fin_biz_name && h(Text, { style: styles.bizName }, cfg.fin_biz_name),
    cfg.fin_website  && h(Text, { style: styles.bizDetail }, cfg.fin_website),
    cfg.fin_address  && h(Text, { style: styles.bizDetail }, cfg.fin_address),
    cfg.fin_abn      && h(Text, { style: [styles.bizDetail, { marginTop: 2 }] }, `ABN: ${cfg.fin_abn}`),
  );
  const headerRight = h(View, { style: styles.headerRight },
    h(Text, { style: styles.title }, 'STATEMENT'),
    h(View, { style: styles.metaRow }, h(Text, { style: styles.metaLabel }, 'From'), h(Text, { style: styles.metaValue }, fmtDate(stmt.from))),
    h(View, { style: styles.metaRow }, h(Text, { style: styles.metaLabel }, 'To'), h(Text, { style: styles.metaValue }, fmtDate(stmt.to))),
    h(View, { style: styles.metaRow }, h(Text, { style: styles.metaLabel }, 'Balance due'), h(Text, { style: styles.metaValue }, fmtAud(stmt.closing))),
  );
  const to = h(View, null,
    h(Text, { style: styles.toLabel }, 'STATEMENT FOR'),
    h(Text, { style: styles.toName }, c.name),
    c.contactName && h(Text, { style: styles.toDetail }, `Attn: ${c.contactName}`),
    c.email       && h(Text, { style: styles.toDetail }, `Email: ${c.email}`),
    c.address     && h(Text, { style: styles.toDetail }, c.address),
    c.abn         && h(Text, { style: styles.toDetail }, `ABN: ${c.abn}`),
  );

  const head = h(View, { style: styles.tHead },
    h(View, { style: styles.cDate }, h(Text, { style: styles.tHeadCell }, 'Date')),
    h(View, { style: styles.cDesc }, h(Text, { style: styles.tHeadCell }, 'Description')),
    h(View, { style: styles.cAmt }, h(Text, { style: styles.tHeadCell }, 'Invoiced')),
    h(View, { style: styles.cAmt }, h(Text, { style: styles.tHeadCell }, 'Received')),
    h(View, { style: styles.cAmt }, h(Text, { style: styles.tHeadCell }, 'Balance')),
  );
  const row = (key, idx, date, desc, debit, credit, balance, bold) => h(View, { key, style: [styles.tRow, idx % 2 === 1 ? styles.tRowAlt : {}], wrap: false },
    h(View, { style: styles.cDate }, h(Text, { style: styles.cell }, date ? fmtDate(date) : '')),
    h(View, { style: styles.cDesc }, h(Text, { style: bold ? styles.cellBold : styles.cell }, desc)),
    h(View, { style: styles.cAmt }, h(Text, { style: styles.cell }, debit ? fmtAud(debit) : '')),
    h(View, { style: styles.cAmt }, h(Text, { style: styles.cell }, credit ? fmtAud(credit) : '')),
    h(View, { style: styles.cAmt }, h(Text, { style: bold ? styles.cellBold : styles.cell }, fmtAud(balance))),
  );
  const rows = [
    row('open', 0, stmt.from, 'Opening balance', 0, 0, stmt.opening, true),
    ...stmt.lines.map((l, i) => row(`l${i}`, i + 1, l.date, l.description, l.debit, l.credit, l.balance, false)),
  ];

  const aging = h(View, null,
    h(Text, { style: styles.agingTitle }, `Ageing of outstanding invoices at ${fmtDate(stmt.to)} (days overdue)`),
    h(View, { style: styles.agingRow }, ...AGING_LABELS.map(([k, label]) => h(View, { key: `h${k}`, style: styles.agingCell }, h(Text, { style: styles.agingHead }, label)))),
    h(View, { style: styles.agingRow }, ...AGING_LABELS.map(([k]) => h(View, { key: `v${k}`, style: styles.agingCell }, h(Text, { style: styles.cell }, fmtAud(stmt.aging[k] || 0))))),
  );

  const paymentLines = [
    cfg.fin_bank_name      && `Bank: ${cfg.fin_bank_name}`,
    cfg.fin_account_name   && `Account Name: ${cfg.fin_account_name}`,
    cfg.fin_bsb            && `BSB: ${cfg.fin_bsb}`,
    cfg.fin_account_number && `Account Number: ${cfg.fin_account_number}`,
  ].filter(Boolean).join('\n');
  const footer = paymentLines ? h(View, null,
    h(View, { style: styles.footerDiv }),
    h(Text, { style: styles.footerHead }, 'Payment Instructions'),
    h(Text, { style: styles.footerText }, paymentLines),
  ) : null;

  return h(Document, null,
    h(Page, { size: 'A4', style: styles.page },
      h(View, { style: styles.headerRow }, headerLeft, headerRight),
      h(View, { style: styles.divider }),
      to,
      h(View, null, head, ...rows),
      h(View, { style: styles.closingRow, wrap: false },
        h(Text, { style: styles.closingLbl }, 'Balance due'),
        h(Text, { style: styles.closingVal }, fmtAud(stmt.closing)),
      ),
      aging,
      footer,
    ),
  );
}

async function generateStatementPdf(stmt, cfg) {
  const deps = await import('@react-pdf/renderer');
  return deps.renderToBuffer(buildDocument(deps, stmt, cfg));
}

module.exports = { generateStatementPdf };
