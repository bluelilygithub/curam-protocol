/**
 * Page speed PDF report (the "PDF report" button on a saved run). Built in the browser with @react-pdf/renderer, loaded only when
 * the button is pressed. Uses the same plain-English actions as the Actions tab (pageSpeedActions.mjs) and the ticks / notes saved
 * on the run (audit.actionsDone). See docs/html-agent.md.
 */

import React from 'react';
import { Document, Page, View, Text, StyleSheet, pdf, Link, Svg, Polyline } from '@react-pdf/renderer';
import { buildActions, PRIORITY_GROUPS, METRIC_HELP, FIELD_HELP } from './pageSpeedActions.mjs';

const PRIMARY = '#9B5B46';
const TEXT = '#1F1A17';
const MUTED = '#6B625C';
const BORDER = '#DDD5CC';
const BG_ALT = '#F6F1EB';
const GOOD = '#166534';
const MID = '#B45309';
const BAD = '#DC2626';

const s = StyleSheet.create({
  page: { fontFamily: 'Helvetica', fontSize: 9, color: TEXT, paddingTop: 40, paddingBottom: 52, paddingHorizontal: 42 },
  brandRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  brand: { fontSize: 8, color: MUTED, letterSpacing: 1 },
  title: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: PRIMARY, marginBottom: 4 },
  url: { fontSize: 9, color: PRIMARY, marginBottom: 10, textDecoration: 'none' },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 14 },
  metaItem: { marginRight: 18, marginBottom: 4 },
  metaLabel: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6 },
  metaValue: { fontSize: 9, fontFamily: 'Helvetica-Bold' },
  intro: { fontSize: 9, color: MUTED, lineHeight: 1.45, marginBottom: 14 },
  h2: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: TEXT, marginTop: 6, marginBottom: 8, paddingBottom: 4, borderBottomWidth: 1.5, borderBottomColor: PRIMARY, borderBottomStyle: 'solid' },
  h3: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: TEXT, marginTop: 8, marginBottom: 6 },
  hint: { fontSize: 8, color: MUTED, marginBottom: 6, lineHeight: 1.4 },
  scoreGrid: { flexDirection: 'row', marginBottom: 10 },
  scoreBox: { flex: 1, borderWidth: 1, borderColor: BORDER, borderStyle: 'solid', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 8, marginRight: 6, backgroundColor: '#FFFFFF' },
  scoreLabel: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 3 },
  scoreValue: { fontSize: 18, fontFamily: 'Helvetica-Bold' },
  table: { borderWidth: 1, borderColor: BORDER, borderStyle: 'solid', borderRadius: 4, marginBottom: 10 },
  tr: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6, borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid' },
  trLast: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6 },
  th: { flexDirection: 'row', paddingVertical: 4, paddingHorizontal: 6, backgroundColor: BG_ALT, borderBottomWidth: 1, borderBottomColor: BORDER, borderBottomStyle: 'solid' },
  cellLabel: { flex: 2.2, fontSize: 8.5 },
  cellHelp: { flex: 3.6, fontSize: 7.5, color: MUTED, paddingRight: 6 },
  cellVal: { flex: 1, fontSize: 8.5, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
  thText: { fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5 },
  progressOuter: { height: 6, backgroundColor: BG_ALT, borderRadius: 3, marginTop: 4, marginBottom: 4 },
  progressInner: { height: 6, backgroundColor: PRIMARY, borderRadius: 3 },
  card: { borderWidth: 1, borderColor: BORDER, borderStyle: 'solid', borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 7, flexDirection: 'row' },
  box: { width: 11, height: 11, borderWidth: 1.2, borderColor: PRIMARY, borderStyle: 'solid', borderRadius: 2, marginRight: 8, marginTop: 1, alignItems: 'center', justifyContent: 'center' },
  boxDone: { width: 11, height: 11, borderRadius: 2, marginRight: 8, marginTop: 1, backgroundColor: PRIMARY, alignItems: 'center', justifyContent: 'center' },
  tick: { fontSize: 8, color: '#FFFFFF', fontFamily: 'Helvetica-Bold', marginTop: -1 },
  cardBody: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 3 },
  tag: { fontSize: 6.5, color: MUTED, borderWidth: 0.75, borderColor: BORDER, borderStyle: 'solid', borderRadius: 6, paddingVertical: 1.5, paddingHorizontal: 5, marginRight: 4, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  tagDone: { fontSize: 6.5, color: '#FFFFFF', backgroundColor: GOOD, borderRadius: 6, paddingVertical: 1.5, paddingHorizontal: 5, marginRight: 4, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.4 },
  actionTitle: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginBottom: 3 },
  para: { fontSize: 8.3, lineHeight: 1.4, marginBottom: 2 },
  paraMuted: { fontSize: 8.3, lineHeight: 1.4, marginBottom: 2, color: MUTED },
  bold: { fontFamily: 'Helvetica-Bold', color: TEXT },
  doneNote: { fontSize: 8.3, lineHeight: 1.4, marginTop: 3, paddingVertical: 4, paddingHorizontal: 6, backgroundColor: '#EEF7F0', borderLeftWidth: 2, borderLeftColor: GOOD, borderLeftStyle: 'solid' },
  dev: { marginTop: 4, paddingLeft: 6, borderLeftWidth: 1, borderLeftColor: BORDER, borderLeftStyle: 'solid' },
  devTitle: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: MUTED, marginBottom: 1 },
  devText: { fontSize: 7.3, color: MUTED, lineHeight: 1.35 },
  footer: { position: 'absolute', bottom: 22, left: 42, right: 42, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.75, borderTopColor: BORDER, borderTopStyle: 'solid', paddingTop: 6 },
  footerText: { fontSize: 7, color: MUTED },
  empty: { fontSize: 9, color: MUTED, marginBottom: 10 },
});

/** Helvetica in react-pdf has no glyphs for many symbols; keep text to plain ASCII-ish. */
function t(str) {
  if (str == null) return '';
  return String(str)
    .replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/→/g, '->').replace(/[—–]/g, '-')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').replace(/·/g, '-').replace(/ /g, ' ')
    .replace(/[^\x09\x0a\x0d\x20-\x7e¡-ÿ]/g, '');
}

function tint(n) {
  if (n == null) return MUTED;
  if (n >= 90) return GOOD;
  if (n >= 50) return MID;
  return BAD;
}

function fmtDate(d, withTime = false) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-AU', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function deviceLabel(v) { return v === 'desktop' ? 'Desktop' : 'Mobile'; }

function ScoreGrid({ cats }) {
  const rows = [
    ['Performance', cats.performance], ['Accessibility', cats.accessibility],
    ['Best practices', cats.bestPractices], ['SEO', cats.seo],
  ];
  return (
    <View style={s.scoreGrid}>
      {rows.map(([label, n], i) => (
        <View key={label} style={[s.scoreBox, i === rows.length - 1 ? { marginRight: 0 } : {}]}>
          <Text style={s.scoreLabel}>{label}</Text>
          <Text style={[s.scoreValue, { color: tint(n) }]}>{n ?? '-'}</Text>
        </View>
      ))}
    </View>
  );
}

function MetricsTable({ view }) {
  const metrics = view.metrics || [];
  if (!metrics.length) return null;
  return (
    <View style={s.table} wrap={false}>
      <View style={s.th}>
        <Text style={[s.cellLabel, s.thText]}>Timing (lab test)</Text>
        <Text style={[s.cellHelp, s.thText]}>What it means</Text>
        <Text style={[s.cellVal, s.thText]}>Result</Text>
      </View>
      {metrics.map((m, i) => (
        <View key={m.id} style={i === metrics.length - 1 ? s.trLast : s.tr}>
          <Text style={s.cellLabel}>{t(m.title)}</Text>
          <Text style={s.cellHelp}>{t((METRIC_HELP[m.id] || '').replace(/^[^:]+:\s*/, ''))}</Text>
          <Text style={[s.cellVal, { color: tint(m.score == null ? null : Math.round(m.score * 100)) }]}>{t(m.displayValue || '-')}</Text>
        </View>
      ))}
    </View>
  );
}

function FieldTable({ view }) {
  const rows = view.fieldData || [];
  if (!rows.length) return null;
  const col = (c) => (c === 'FAST' ? GOOD : c === 'SLOW' ? BAD : c === 'AVERAGE' ? MID : MUTED);
  return (
    <View style={s.table} wrap={false}>
      <View style={s.th}>
        <Text style={[s.cellLabel, s.thText]}>Real visitors (28 days)</Text>
        <Text style={[s.cellHelp, s.thText]}>What it means</Text>
        <Text style={[s.cellVal, s.thText]}>Result</Text>
      </View>
      {rows.map((m, i) => {
        const [label, help] = FIELD_HELP[m.id] || [m.id.replace(/_/g, ' ').toLowerCase(), ''];
        return (
          <View key={m.id} style={i === rows.length - 1 ? s.trLast : s.tr}>
            <Text style={s.cellLabel}>{t(label)}</Text>
            <Text style={s.cellHelp}>{t(help)}</Text>
            <Text style={[s.cellVal, { color: col(m.category) }]}>{t(`${m.category || '-'}${m.percentile != null ? ` ${m.percentile}` : ''}`)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ActionCard({ a, state, includeDeveloper }) {
  const done = !!state?.done;
  return (
    <View style={s.card} wrap={false}>
      <View style={done ? s.boxDone : s.box}>
        {done ? (
          <Svg width={9} height={9} viewBox="0 0 10 10">
            <Polyline points="2,5.2 4.2,7.4 8,2.8" stroke="#FFFFFF" strokeWidth={1.6} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </Svg>
        ) : null}
      </View>
      <View style={s.cardBody}>
        <View style={s.tags}>
          {done ? <Text style={s.tagDone}>Done{state.doneAt ? ` ${t(fmtDate(state.doneAt))}` : ''}</Text> : null}
          <Text style={s.tag}>{t(a.categoryLabel)}</Text>
          {a.who ? <Text style={s.tag}>{t(a.who)}</Text> : null}
          {a.effort ? <Text style={s.tag}>{t(a.effort)}</Text> : null}
        </View>
        <Text style={[s.actionTitle, done ? { color: MUTED } : {}]}>{t(a.title)}</Text>
        <Text style={s.paraMuted}><Text style={s.bold}>Why it matters: </Text>{t(a.why)}</Text>
        <Text style={s.para}><Text style={s.bold}>What to do: </Text>{t(a.how)}</Text>
        {state?.note ? <Text style={s.doneNote}><Text style={s.bold}>{done ? 'What was done: ' : 'Note: '}</Text>{t(state.note)}</Text> : null}
        {includeDeveloper ? (
          <View style={s.dev}>
            <Text style={s.devTitle}>For your developer: {t(a.technicalTitle)}</Text>
            {a.technicalAction && a.technicalAction !== a.how ? <Text style={s.devText}>{t(a.technicalAction).slice(0, 700)}</Text> : null}
            {a.evidence.slice(0, 6).map((ev) => <Text key={ev} style={s.devText}>- {t(ev).slice(0, 220)}</Text>)}
            {a.evidence.length > 6 ? <Text style={s.devText}>... and {a.evidence.length - 6} more</Text> : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function DeviceSection({ device, view, other, doneMap, options, first }) {
  const all = buildActions(view, other);
  const isDone = (a) => !!doneMap?.[a.key]?.done;
  const shown = all.filter((a) => (options.which === 'outstanding' ? !isDone(a) : options.which === 'done' ? isDone(a) : true));
  const doneCount = all.filter(isDone).length;
  const pct = all.length ? Math.round((doneCount / all.length) * 100) : 100;
  return (
    <View break={!first}>
      <Text style={s.h2}>{deviceLabel(device)}</Text>
      {options.includeScores ? (
        <>
          <ScoreGrid cats={view.categories || {}} />
          <Text style={s.hint}>90-100 good, 50-89 needs work, 0-49 poor. Scores come from one lab test by Google and can move a few points between runs.</Text>
          <MetricsTable view={view} />
          <FieldTable view={view} />
        </>
      ) : null}
      <View wrap={false} minPresenceAhead={160}>
        <Text style={s.h3}>Actions: {doneCount} of {all.length} done</Text>
        <View style={s.progressOuter}><View style={[s.progressInner, { width: `${pct}%` }]} /></View>
      </View>
      {options.which !== 'all' ? (
        <Text style={s.hint}>Showing {options.which === 'done' ? 'completed' : 'outstanding'} actions only ({shown.length}).</Text>
      ) : null}
      {shown.length === 0 ? (
        <Text style={s.empty}>{all.length === 0 ? 'Google found nothing to fix on this device.' : 'No actions match this report\'s filter.'}</Text>
      ) : PRIORITY_GROUPS.map((g) => {
        const rows = shown.filter((a) => a.priority === g.id);
        if (!rows.length) return null;
        return (
          <View key={g.id}>
            {/* The heading travels with its first card so it is never left alone at the foot of a page. */}
            <View wrap={false}>
              <Text style={s.h3}>{g.label} ({rows.length})</Text>
              <ActionCard a={rows[0]} state={doneMap?.[rows[0].key]} includeDeveloper={options.includeDeveloper} />
            </View>
            {rows.slice(1).map((a) => <ActionCard key={a.key} a={a} state={doneMap?.[a.key]} includeDeveloper={options.includeDeveloper} />)}
          </View>
        );
      })}
    </View>
  );
}

function ReportDoc({ audit, options }) {
  const report = audit.report || {};
  const views = { mobile: report.mobile || null, desktop: report.desktop || null };
  const devices = options.devices.filter((d) => views[d]);
  const done = audit.actionsDone || {};
  const tested = audit.createdAt || views.mobile?.fetchTime || views.desktop?.fetchTime;
  const title = options.title?.trim() || `Page speed report: ${audit.name || audit.hostname || ''}`;
  return (
    <Document title={t(title)} author={t(options.preparedBy || 'Curam Vault')} creator="Curam Vault" producer="Curam Vault">
      <Page size="A4" style={s.page} wrap>
        <View style={s.brandRow} fixed>
          <Text style={s.brand}>PAGE SPEED REPORT</Text>
          <Text style={s.brand}>{t(audit.hostname || '')}</Text>
        </View>
        <Text style={s.title}>{t(title)}</Text>
        <Link src={audit.url} style={s.url}>{t(audit.url)}</Link>
        <View style={s.metaRow}>
          <View style={s.metaItem}><Text style={s.metaLabel}>Tested</Text><Text style={s.metaValue}>{t(fmtDate(tested))}</Text></View>
          <View style={s.metaItem}><Text style={s.metaLabel}>Report date</Text><Text style={s.metaValue}>{t(fmtDate(new Date()))}</Text></View>
          {devices.map((d) => (
            <View key={d} style={s.metaItem}>
              <Text style={s.metaLabel}>{deviceLabel(d)} performance</Text>
              <Text style={[s.metaValue, { color: tint(views[d].categories?.performance) }]}>{views[d].categories?.performance ?? '-'}</Text>
            </View>
          ))}
          {options.preparedFor?.trim() ? <View style={s.metaItem}><Text style={s.metaLabel}>Prepared for</Text><Text style={s.metaValue}>{t(options.preparedFor.trim())}</Text></View> : null}
          {options.preparedBy?.trim() ? <View style={s.metaItem}><Text style={s.metaLabel}>Prepared by</Text><Text style={s.metaValue}>{t(options.preparedBy.trim())}</Text></View> : null}
        </View>
        {options.summary?.trim() ? <Text style={[s.para, { marginBottom: 10 }]}>{t(options.summary.trim())}</Text> : null}
        <Text style={s.intro}>
          Google PageSpeed Insights tested this page as a phone on a slower mobile connection and as a desktop computer. Below are the scores and a
          plain-English list of what to fix, most important first ("Fix first", then "Do next", then "When there is time"). A ticked box means the
          action has been marked done; run a new test to confirm each fix in the scores.
        </Text>
        {devices.map((d, i) => (
          <DeviceSection key={d} device={d} view={views[d]} other={views[d === 'mobile' ? 'desktop' : 'mobile']} doneMap={done[d]} options={options} first={i === 0} />
        ))}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>{t(audit.url)}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Build and download the PDF. options: { devices: ['mobile','desktop'], which: 'all'|'outstanding'|'done', includeScores, includeDeveloper, title, preparedFor, preparedBy, summary } */
export async function downloadPageSpeedPdf(audit, options) {
  const blob = await pdf(<ReportDoc audit={audit} options={options} />).toBlob();
  const url = URL.createObjectURL(blob);
  const host = String(audit.hostname || audit.name || 'site').replace(/[^a-z0-9.-]+/gi, '-').toLowerCase();
  const a = document.createElement('a');
  a.href = url;
  a.download = `page-speed-${host}-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
