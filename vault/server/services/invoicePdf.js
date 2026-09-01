'use strict';

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
  const v = parseFloat(n || 0).toFixed(2);
  const [int, dec] = v.split('.');
  return '$' + int.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + dec;
}

function fmtDate(d) {
  if (!d) return '—';
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);
  return new Date(s + 'T00:00:00').toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
}

// Build the PDF React element tree using createElement (no JSX, server-safe)
function buildDocument(deps, invoice, items, client, cfg) {
  const { Document, Page, Text, View, StyleSheet, Image } = deps;

  const isQuote = invoice.docType === 'quote';

  const styles = StyleSheet.create({
    page:             { fontSize: 10, fontFamily: 'Helvetica', color: DARK, paddingHorizontal: 42, paddingTop: 40, paddingBottom: 36 },
    // Header
    headerRow:        { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
    headerLeft:       { flexDirection: 'column', maxWidth: '54%' },
    headerRight:      { flexDirection: 'column', alignItems: 'flex-end', maxWidth: '44%' },
    logo:             { width: 56, height: 56, marginBottom: 8, objectFit: 'contain' },
    bizName:          { fontSize: 14, fontFamily: 'Helvetica-Bold', color: GOLD, marginBottom: 3 },
    bizDetail:        { fontSize: 8, color: GREY, lineHeight: 1.5 },
    taxInvoiceLabel:  { fontSize: 20, fontFamily: 'Helvetica-Bold', color: GOLD, marginBottom: 8, textAlign: 'right' },
    metaRow:          { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 2 },
    metaLabel:        { fontSize: 8, color: GREY, marginRight: 8, minWidth: 60, textAlign: 'right' },
    metaValue:        { fontSize: 8, fontFamily: 'Helvetica-Bold', color: GOLD, minWidth: 80, textAlign: 'right' },
    // Divider
    divider:          { borderBottomWidth: 1.5, borderBottomColor: GOLD, marginBottom: 14 },
    // Bill To
    billToSection:    { marginBottom: 16 },
    billToLabel:      { fontSize: 7, fontFamily: 'Helvetica-Bold', color: GREY, letterSpacing: 1.2, marginBottom: 5 },
    billToName:       { fontSize: 12, fontFamily: 'Helvetica-Bold', color: DARK, marginBottom: 2 },
    billToDetail:     { fontSize: 8.5, color: GREY, marginBottom: 1.5 },
    // Table
    tableHeaderRow:   { flexDirection: 'row', backgroundColor: GOLD, paddingVertical: 7, paddingHorizontal: 8 },
    tableHeaderCell:  { fontSize: 8, fontFamily: 'Helvetica-Bold', color: WHITE, textTransform: 'uppercase' },
    tableRow:         { flexDirection: 'row', paddingVertical: 7, paddingHorizontal: 8, borderBottomWidth: 0.5, borderBottomColor: '#E5E7EB' },
    tableRowAlt:      { backgroundColor: LIGHT_GREY },
    colDate:          { width: '15%' },
    colDesc:          { width: '65%', paddingRight: 6 },
    colAmt:           { width: '20%', alignItems: 'flex-end' },
    cellText:         { fontSize: 9, color: DARK },
    cellSub:          { fontSize: 7.5, color: GREY, fontFamily: 'Helvetica-Oblique', marginTop: 2 },
    cellNt:           { fontSize: 7.5, color: GREY, fontFamily: 'Helvetica-Bold', marginTop: 2 },
    waivedText:       { fontSize: 9, color: GREY },
    // Totals
    totalsArea:       { alignItems: 'flex-end', marginTop: 14, marginBottom: 18 },
    totalsRow:        { flexDirection: 'row', marginBottom: 4 },
    totalsLabel:      { width: 110, fontSize: 9, color: GREY, textAlign: 'right', paddingRight: 14 },
    totalsValue:      { width: 72, fontSize: 9, textAlign: 'right', color: DARK },
    totalDivider:     { width: 182, borderBottomWidth: 1, borderBottomColor: GOLD, marginBottom: 5 },
    totalRow:         { flexDirection: 'row' },
    totalLabel:       { width: 110, fontSize: 11, fontFamily: 'Helvetica-Bold', color: GOLD, textAlign: 'right', paddingRight: 14 },
    totalValue:       { width: 72, fontSize: 11, fontFamily: 'Helvetica-Bold', color: GOLD, textAlign: 'right' },
    // Footer
    footerDivider:    { borderBottomWidth: 0.5, borderBottomColor: '#D1D5DB', marginBottom: 12, marginTop: 4 },
    footerRow:        { flexDirection: 'row' },
    footerCol:        { flex: 1 },
    footerSep:        { width: 1, backgroundColor: '#E5E7EB', marginHorizontal: 14 },
    footerHeading:    { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: GREY, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 },
    footerText:       { fontSize: 8, color: GREY, lineHeight: 1.5 },
  });

  const logoExists = fs.existsSync(LOGO_PATH);

  // Header left
  const headerLeft = React.createElement(View, { style: styles.headerLeft },
    logoExists && React.createElement(Image, { src: LOGO_PATH, style: styles.logo }),
    cfg.fin_biz_name && React.createElement(Text, { style: styles.bizName }, cfg.fin_biz_name),
    cfg.fin_address  && React.createElement(Text, { style: styles.bizDetail }, cfg.fin_address),
    cfg.fin_abn      && React.createElement(Text, { style: [styles.bizDetail, { marginTop: 2 }] }, `ABN: ${cfg.fin_abn}`),
  );

  // Header right
  const dueDateLabel = isQuote ? 'Valid Until' : 'Due Date';
  const docLabel     = isQuote ? 'QUOTE' : 'TAX INVOICE';
  const refLabel     = isQuote ? 'Quote' : 'Invoice';

  const headerRight = React.createElement(View, { style: styles.headerRight },
    React.createElement(Text, { style: styles.taxInvoiceLabel }, docLabel),
    React.createElement(View, { style: styles.metaRow },
      React.createElement(Text, { style: styles.metaLabel }, refLabel),
      React.createElement(Text, { style: styles.metaValue }, invoice.number),
    ),
    React.createElement(View, { style: styles.metaRow },
      React.createElement(Text, { style: styles.metaLabel }, 'Date'),
      React.createElement(Text, { style: styles.metaValue }, fmtDate(invoice.issueDate)),
    ),
    invoice.dueDate && React.createElement(View, { style: styles.metaRow },
      React.createElement(Text, { style: styles.metaLabel }, dueDateLabel),
      React.createElement(Text, { style: styles.metaValue }, fmtDate(invoice.dueDate)),
    ),
  );

  // Bill To / Quote For
  const addrLabel = isQuote ? 'QUOTE FOR' : 'BILL TO';
  const billTo = React.createElement(View, { style: styles.billToSection },
    React.createElement(Text, { style: styles.billToLabel }, addrLabel),
    client && React.createElement(Text, { style: styles.billToName }, client.name),
    client?.contactName && React.createElement(Text, { style: styles.billToDetail }, `Attn: ${client.contactName}`),
    client?.email   && React.createElement(Text, { style: styles.billToDetail }, `Email: ${client.email}`),
    client?.address && React.createElement(Text, { style: styles.billToDetail }, client.address),
    client?.abn     && React.createElement(Text, { style: styles.billToDetail }, `ABN: ${client.abn}`),
  );

  // Table header
  const tableHeader = React.createElement(View, { style: styles.tableHeaderRow },
    React.createElement(View, { style: styles.colDate },
      React.createElement(Text, { style: styles.tableHeaderCell }, 'Date'),
    ),
    React.createElement(View, { style: styles.colDesc },
      React.createElement(Text, { style: styles.tableHeaderCell }, 'Service Description'),
    ),
    React.createElement(View, { style: styles.colAmt },
      React.createElement(Text, { style: styles.tableHeaderCell }, 'Amount (AUD)'),
    ),
  );

  // Item rows
  const itemRows = items.map((item, idx) => {
    const isWaived = parseFloat(item.amount) === 0;
    const showQty  = parseFloat(item.qty) !== 1;
    const isNt     = (item.gstCode || (parseFloat(item.gst) > 0 ? 'GST' : 'NT')) === 'NT';
    return React.createElement(View, {
      key: String(idx),
      style: [styles.tableRow, idx % 2 === 1 ? styles.tableRowAlt : {}],
    },
      React.createElement(View, { style: styles.colDate },
        React.createElement(Text, { style: styles.cellText }, fmtDate(invoice.issueDate)),
      ),
      React.createElement(View, { style: styles.colDesc },
        React.createElement(Text, { style: styles.cellText }, item.description || ''),
        showQty && React.createElement(Text, { style: styles.cellSub }, `${item.qty} × ${fmtAud(item.unitPrice)}`),
      ),
      React.createElement(View, { style: styles.colAmt },
        isWaived
          ? React.createElement(Text, { style: styles.waivedText }, 'Waived')
          : React.createElement(Text, { style: styles.cellText }, fmtAud(item.amount)),
        isNt && !isWaived && React.createElement(Text, { style: styles.cellNt }, 'N-T'),
      ),
    );
  });

  // Totals
  const totalLabel = isQuote ? 'Total Value' : 'Total Due';
  const totals = React.createElement(View, { style: styles.totalsArea },
    React.createElement(View, { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, 'Subtotal (ex-GST)'),
      React.createElement(Text, { style: styles.totalsValue }, fmtAud(invoice.subtotal)),
    ),
    React.createElement(View, { style: styles.totalsRow },
      React.createElement(Text, { style: styles.totalsLabel }, 'GST (10%)'),
      React.createElement(Text, { style: styles.totalsValue }, fmtAud(invoice.gst)),
    ),
    React.createElement(View, { style: styles.totalDivider }),
    React.createElement(View, { style: styles.totalRow },
      React.createElement(Text, { style: styles.totalLabel }, totalLabel),
      React.createElement(Text, { style: styles.totalValue }, fmtAud(invoice.total)),
    ),
  );

  // Footer — omit payment instructions for quotes
  const paymentLines = !isQuote ? [
    cfg.fin_bank_name      && `Bank: ${cfg.fin_bank_name}`,
    cfg.fin_account_name   && `Account Name: ${cfg.fin_account_name}`,
    cfg.fin_bsb            && `BSB: ${cfg.fin_bsb}`,
    cfg.fin_account_number && `Account Number: ${cfg.fin_account_number}`,
  ].filter(Boolean).join('\n') : null;

  const footerChildren = [
    React.createElement(View, { key: 'terms', style: styles.footerCol },
      React.createElement(Text, { style: styles.footerHeading }, 'Notes'),
      React.createElement(Text, { style: styles.footerText }, invoice.notes || '—'),
    ),
  ];
  if (paymentLines) {
    footerChildren.push(React.createElement(View, { key: 'sep', style: styles.footerSep }));
    footerChildren.push(React.createElement(View, { key: 'pay', style: styles.footerCol },
      React.createElement(Text, { style: styles.footerHeading }, 'Payment Instructions'),
      React.createElement(Text, { style: styles.footerText }, paymentLines),
    ));
  }

  const footer = React.createElement(View, null,
    React.createElement(View, { style: styles.footerDivider }),
    React.createElement(View, { style: styles.footerRow }, ...footerChildren),
  );

  return React.createElement(Document, null,
    React.createElement(Page, { size: 'A4', style: styles.page },
      React.createElement(View, { style: styles.headerRow }, headerLeft, headerRight),
      React.createElement(View, { style: styles.divider }),
      billTo,
      React.createElement(View, null, tableHeader, ...itemRows),
      totals,
      footer,
    ),
  );
}

async function generateInvoicePdf(invoice, items, client, cfg) {
  const deps = await import('@react-pdf/renderer');
  const element = buildDocument(deps, invoice, items, client, cfg);
  return deps.renderToBuffer(element);
}

module.exports = { generateInvoicePdf };
