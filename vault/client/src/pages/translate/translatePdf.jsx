import React from 'react';
import { Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import { LANGUAGES } from '../../utils/translateLanguages';
import { pickPdfFontUrl, needsNotoFont } from '../../utils/translatePdfFonts.mjs';

// The translated PDF, built in the browser with @react-pdf/renderer (fonts, the three layouts, the footer).

export let hyphenationDisabled = false;
export function disableHyphenation() {
  if (hyphenationDisabled) return;
  hyphenationDisabled = true;
  try {
    Font.registerHyphenationCallback((word) => [word]);
  } catch {}
}

export async function registerFonts(targetLanguage, sourceLanguage) {
  disableHyphenation();
  const fontUrl = pickPdfFontUrl(targetLanguage, sourceLanguage);
  if (!fontUrl) return;
  try {
    Font.register({ family: 'NotoTarget', src: fontUrl });
  } catch {}
}

export function buildBilingualPdf({ sourceByPage, translatedByPage, pageCount, scannedPages = [],
    avgOcrConfidence, sourceLanguage, targetLanguage, pageLabels = {}, sourceFormat = 'pdf',
    pdfLayout = 'side-by-side', engine = 'llm' }) {
  const isLowConf = (pg) => scannedPages.includes(pg) && avgOcrConfidence != null && avgOcrConfidence < 0.7;
  const footerText = engine === 'google'
    ? 'Google Translate · for reference only · not legally certified'
    : 'AI-generated translation (Vault LLM) · for reference only · not legally certified';
  const useNoto = needsNotoFont(targetLanguage, sourceLanguage);
  const layout = ['side-by-side', 'translation-only', 'bilingual-pages'].includes(pdfLayout)
    ? pdfLayout
    : 'side-by-side';

  const styles = StyleSheet.create({
    page:     { padding: 40, fontFamily: useNoto ? 'NotoTarget' : 'Helvetica' },
    header:   { fontSize: 9, color: '#6b7280', marginBottom: 12, paddingBottom: 6,
                borderBottom: '1px solid #e5e7eb', flexDirection: 'row', justifyContent: 'space-between' },
    langBadge:{ fontSize: 8, backgroundColor: '#f3f4f6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    warning:  { backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4,
                padding: 6, marginBottom: 10, fontSize: 8, color: '#92400e' },
    para:     { fontSize: 10, color: '#1f2937', marginBottom: 6, lineHeight: 1.6 },
    paraSm:   { fontSize: 9, color: '#1f2937', marginBottom: 5, lineHeight: 1.5 },
    footer:   { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7,
                color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #e5e7eb', paddingTop: 4 },
    sourceHeader: { fontSize: 9, fontWeight: 'bold', color: '#374151' },
    transHeader:  { fontSize: 9, fontWeight: 'bold', color: '#1d4ed8' },
    columns:  { flexDirection: 'row', gap: 12, flexGrow: 1 },
    col:      { width: '48%', paddingRight: 6 },
    colRight: { width: '48%', paddingLeft: 6, borderLeft: '1px solid #e5e7eb' },
    colTitle: { fontSize: 8, fontWeight: 'bold', marginBottom: 8, color: '#6b7280' },
    colTitleTrans: { fontSize: 8, fontWeight: 'bold', marginBottom: 8, color: '#1d4ed8' },
  });

  const langLabel = LANGUAGES.find(l => l.code === targetLanguage)?.label || targetLanguage;
  const srcLabel  = sourceLanguage && sourceLanguage !== 'auto'
    ? (LANGUAGES.find(l => l.code === sourceLanguage)?.label || sourceLanguage)
    : 'Original';

  const sectionLabel = (pg) => pageLabels[pg] || pageLabels[String(pg)]
    || (sourceFormat === 'xlsx' || sourceFormat === 'xls' ? `Sheet ${pg}` : `Page ${pg}`);

  const pages = [];
  for (let pg = 1; pg <= pageCount; pg++) {
    const srcParas  = sourceByPage[pg]  || sourceByPage[String(pg)] || [];
    const trnParas  = translatedByPage[pg] || translatedByPage[String(pg)] || [];
    const lowConf   = isLowConf(pg);
    const label     = sectionLabel(pg);

    if (layout === 'translation-only') {
      pages.push(
        <Page key={`trn-${pg}`} size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.transHeader}>TRANSLATION · {label}</Text>
            <Text style={styles.langBadge}>{langLabel}</Text>
          </View>
          {lowConf && (
            <View style={styles.warning}>
              <Text>⚠ Source page had low OCR confidence — translation may be inaccurate</Text>
            </View>
          )}
          {trnParas.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
          <Text style={styles.footer}>{footerText}</Text>
        </Page>
      );
      continue;
    }

    if (layout === 'side-by-side') {
      pages.push(
        <Page key={`sbs-${pg}`} size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.sourceHeader}>SIDE BY SIDE · {label}</Text>
            <Text style={styles.langBadge}>{srcLabel} → {langLabel}</Text>
          </View>
          {lowConf && (
            <View style={styles.warning}>
              <Text>⚠ Low OCR confidence on this page — review carefully</Text>
            </View>
          )}
          <View style={styles.columns}>
            <View style={styles.col}>
              <Text style={styles.colTitle}>ORIGINAL</Text>
              {srcParas.map((p, i) => <Text key={i} style={styles.paraSm}>{p}</Text>)}
            </View>
            <View style={styles.colRight}>
              <Text style={styles.colTitleTrans}>TRANSLATION</Text>
              {trnParas.map((p, i) => <Text key={i} style={styles.paraSm}>{p}</Text>)}
            </View>
          </View>
          <Text style={styles.footer}>{footerText}</Text>
        </Page>
      );
      continue;
    }

    // bilingual-pages: original page then translation page
    pages.push(
      <Page key={`src-${pg}`} size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.sourceHeader}>ORIGINAL · {label}</Text>
          </View>
          <Text style={styles.langBadge}>{srcLabel}</Text>
        </View>
        {lowConf && (
          <View style={styles.warning}>
            <Text>⚠ Low OCR confidence on this page — review carefully</Text>
          </View>
        )}
        {srcParas.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
        <Text style={styles.footer}>AI-generated translation · for reference only · not legally certified</Text>
      </Page>
    );

    pages.push(
      <Page key={`trn-${pg}`} size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.transHeader}>TRANSLATION · {label}</Text>
          </View>
          <Text style={styles.langBadge}>{langLabel}</Text>
        </View>
        {lowConf && (
          <View style={styles.warning}>
            <Text>⚠ Source page had low OCR confidence — translation may be inaccurate</Text>
          </View>
        )}
        {trnParas.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
        <Text style={styles.footer}>AI-generated translation · for reference only · not legally certified</Text>
      </Page>
    );
  }

  return <Document>{pages}</Document>;
}

// ── Translations tab ──────────────────────────────────────────────────────────
