// The "Download for review" Word document for a house-style test (HouseStylesPanel → Test this set): for a native speaker to read
// each example's original, the approved translation and Translate's version side by side, tick which reads better and write comments.
// Built here as a minimal .docx (Office Open XML parts zipped with jszip, already a dependency), so no Word library is needed.
//
//   reviewDocxParts(data) → { 'path in the zip': 'xml text' }   (pure; node client/src/pages/translate/reviewDocx.test.mjs)
//   buildReviewDocx(data) → Blob                                 (browser)
//
// data: { setName, languageLabel, comment, model, date, results: [{ original, originalLabel, approved, got, error }] }

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // characters Word refuses in XML (control characters other than tab/newline)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

/** One run of text; line breaks inside the text become Word line breaks. */
function run(text, { bold = false, italic = false, size = null, color = null } = {}) {
  const props = [bold ? '<w:b/>' : '', italic ? '<w:i/>' : '', color ? `<w:color w:val="${color}"/>` : '', size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ''].join('');
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : '';
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  return lines.map((line, i) => `<w:r>${rPr}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${esc(line)}</w:t></w:r>`).join('');
}

function para(content, { style = null, spacingAfter = null, keepNext = false } = {}) {
  const props = [style ? `<w:pStyle w:val="${style}"/>` : '', keepNext ? '<w:keepNext/>' : '', spacingAfter != null ? `<w:spacing w:after="${spacingAfter}"/>` : ''].join('');
  const runs = Array.isArray(content) ? content.join('') : run(content);
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`;
}

function cell(paragraphs, { width, shade = null } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${paragraphs.join('') || '<w:p/>'}</w:tc>`;
}

const BORDERS = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`).join('') + '</w:tblBorders>';

/** A two-column table: a label on the left (shaded), the content on the right. Page width 9026 twips (A4, 2.54 cm margins). */
function labelledTable(rows) {
  const L = 2300;
  const R = 9026 - L;
  return `<w:tbl><w:tblPr><w:tblW w:w="9026" w:type="dxa"/>${BORDERS}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="80" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>`
    + `<w:tblGrid><w:gridCol w:w="${L}"/><w:gridCol w:w="${R}"/></w:tblGrid>`
    + rows.map(([label, paras]) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell([para([run(label, { bold: true, size: 20 })])], { width: L, shade: 'F2F2F2' })}${cell(paras, { width: R })}</w:tr>`).join('')
    + '</w:tbl>';
}

const CHOICES = ['The approved translation reads better', 'The AI version reads better', 'Both are fine', 'Neither is right'];

export function reviewDocxParts(data) {
  const { setName = '', languageLabel = '', comment = '', model = '', date = new Date(), results = [] } = data || {};
  const when = (date instanceof Date ? date : new Date(date)).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const body = [];
  body.push(para(`Translation review: ${setName}`, { style: 'Title' }));
  body.push(para([run(`${languageLabel} · ${results.length} example${results.length === 1 ? '' : 's'} · ${when}`, { color: '595959' })], { spacingAfter: 240 }));

  body.push(para('For the reviewer', { style: 'Heading1' }));
  body.push(para(`Thank you for checking these. Each example below has an original text, the translation already approved for it, and a version made by an AI translator (Vault Translate). The AI was given the guidance below and the other approved examples, but not the approved translation of the example in front of it, so its version shows how it would translate similar text on its own.`));
  body.push(para('For each example, please tick the line that fits and write any comments: wording that is wrong, unnatural, too literal, in the wrong register, or anything you would change in either version. You can edit this document directly.'));
  if (comment) {
    body.push(para('Guidance given to the translator', { style: 'Heading2' }));
    body.push(para([run(comment, { italic: true })]));
  }

  results.forEach((r, i) => {
    body.push(para(`Example ${i + 1}`, { style: 'Heading1', keepNext: true }));
    const original = [para(r.original || '')];
    const approved = [para(r.approved || '')];
    const got = [para(r.error ? [run(`Could not be made: ${r.error}`, { italic: true, color: 'C00000' })] : (r.got || ''))];
    const choice = CHOICES.map((c) => para([run(`☐  ${c}`)], { spacingAfter: 40 }));
    const notes = [para(''), para(''), para('')];
    body.push(labelledTable([
      [`Original${r.originalLabel ? ` (${r.originalLabel})` : ''}`, original],
      [`Approved translation${languageLabel ? ` (${languageLabel})` : ''}`, approved],
      ['AI version (made without seeing the approved translation)', got],
      ['Which reads better?', choice],
      ['Reviewer\'s comments', notes],
    ]));
    body.push(para('', { spacingAfter: 120 }));
  });

  body.push(para('Overall comments', { style: 'Heading1' }));
  body.push(para('Anything that applies to all the examples: the register, words that should always or never be used, names to keep as they are.'));
  body.push(para(''), para(''), para(''));
  body.push(para([run(`Reviewed by: ____________________    Date: ____________`)]));
  body.push(para([run(`Made with Vault Translate${model ? ` (translator: ${model})` : ''}. AI translation is for reference and is not certified.`, { size: 16, color: '7F7F7F' })]));

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-NZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/><w:color w:val="1F1F1F"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="9B5B46"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
</w:styles>`;

  return {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'word/document.xml': document,
    'word/styles.xml': styles,
  };
}

/** The .docx as a Blob, in the browser. jszip is loaded only when someone downloads. */
export async function buildReviewDocx(data) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  for (const [name, xml] of Object.entries(reviewDocxParts(data))) zip.file(name, xml);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/** A file name like "review-corporate-vision-statements-te-reo-maori-2026-11-17.docx". */
export function reviewFileName(setName, languageLabel, date = new Date()) {
  const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const d = date instanceof Date ? date : new Date(date);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `review-${slug(setName) || 'house-style'}-${slug(languageLabel)}-${ymd}.docx`;
}
