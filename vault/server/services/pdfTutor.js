'use strict';

// The PDF Tools guide: a person says, in everyday words, what they want to do with a PDF ("make this scan searchable", "join
// these and number the pages"), and the guide points at the real tools, in order, or says plainly that PDF Tools does not do it.
//
// Same design as the Video Tools and Finance guides (videoTutor.js, financeTutor.js): it only knows what is written below, the
// model's answer is treated as untrusted (parsed, trimmed, every tool id checked against the catalogue), and a test
// (pdfTutor.test.js) fails if a tool is added to or removed from the PDF page without this file being updated.
//
// It does NOT see the person's files. Nothing here reads or writes a document.

// The model and usage modules open a database connection when loaded, so they are loaded only when the guide really calls the
// model. The tests (and anything that only reads the catalogue) need no database.

// id = the tool id on the PDF page (exactly as in MODES in client/src/pages/PdfPage.jsx); label = its name in the list.
const CATALOG = [
  { id: 'merge', label: 'Merge', group: 'Organise',
    does: 'Join two or more PDFs into one, in the order you choose.', notes: '' },
  { id: 'split', label: 'Split', group: 'Organise',
    does: 'Pull a page range such as 1-3,5,7-9 out of a PDF into a new PDF.', notes: 'Makes one new file from the pages you name; it does not cut a PDF into many files at once.' },
  { id: 'rotate', label: 'Rotate Pages', group: 'Organise',
    does: 'Rotate all pages, or only the ones you list, by 90, 180 or 270 degrees.', notes: '' },
  { id: 'organize', label: 'Organize Pages', group: 'Organise',
    does: 'Shows every page as a thumbnail. Drag to reorder, delete one page or several ticked pages, reverse the whole order, insert pages from a second PDF, or save a single page as its own file.', notes: '' },
  { id: 'removeblank', label: 'Remove Blank Pages', group: 'Organise',
    does: 'Finds blank pages (such as the empty backs of scanned sheets), marks them, and removes them. The person can click any page to override the choice, and a slider sets how strict "blank" is.', notes: 'A page with a faint speck or noise may need the slider raised.' },
  { id: 'nup', label: 'Pages per Sheet', group: 'Organise',
    does: 'Puts 2, 4, 6 or 9 pages on each A4 or Letter sheet, for printing handouts. Optional border and gap.', notes: '' },
  { id: 'img2pdf', label: 'Images → PDF', group: 'Convert',
    does: 'Turns JPG or PNG pictures into a PDF, one picture per page, with a choice of page size or fit-to-picture.', notes: '' },
  { id: 'text2pdf', label: 'Text → PDF', group: 'Convert',
    does: 'Turns pasted or typed text into a tidy PDF.', notes: '' },
  { id: 'extracttext', label: 'Extract Text', group: 'Convert',
    does: 'Copies out all the text in a PDF, to copy or save as a .txt file. Runs in the browser.', notes: 'Only works on PDFs that already contain real text. For a scan, use OCR first.' },
  { id: 'officetopdf', label: 'Office → PDF', group: 'Convert',
    does: 'Turns Word, Excel, PowerPoint, OpenDocument, RTF, CSV and text files into a PDF.', notes: '' },
  { id: 'pdftooffice', label: 'PDF → Word', group: 'Convert',
    does: 'Turns a PDF into an editable Word, OpenDocument or text file.', notes: 'Layout is rebuilt, so complex pages may not match exactly. Word only: there is no PDF to Excel or PowerPoint.' },
  { id: 'googletopdf', label: 'Google Drive → PDF', group: 'Convert',
    does: 'Exports a Google Doc, Sheet or Slides file from the person\'s connected Google account as a PDF.', notes: 'Needs Google Drive to be connected in Settings.' },
  { id: 'pdf2img', label: 'Pages → Images', group: 'Convert',
    does: 'Saves PDF pages as PNG or JPG pictures at 72, 150 or 300 DPI, for all pages or a range. Several pages download as one zip. Runs in the browser.', notes: '' },
  { id: 'extractimages', label: 'Extract Images', group: 'Convert',
    does: 'Pulls the original embedded photos out of a PDF as JPEG files, unchanged, in one zip.', notes: 'Only JPEG photos are copied out; other image formats are skipped. For scans or drawings use Pages → Images instead.' },
  { id: 'ocr', label: 'OCR (Searchable)', group: 'Convert',
    does: 'Reads a scanned PDF and adds invisible text so it can be searched, selected and copied. The page looks identical. Also shows the text it read. Runs in the browser.', notes: 'English only. Up to 30 pages at a time, a few seconds a page. Pages that already have text are skipped. Good for searching and copying; figures should be checked against the page. Not for handwriting.' },
  { id: 'watermark', label: 'Watermark', group: 'Edit',
    does: 'Stamps a diagonal text watermark such as CONFIDENTIAL across every page, with size, opacity, angle and colour.', notes: 'Text only, no logo or picture watermark.' },
  { id: 'pagenumbers', label: 'Page Numbers', group: 'Edit',
    does: 'Adds page numbers (such as "Page 3 of 10") in one of six positions, with size and a starting number.', notes: '' },
  { id: 'headerfooter', label: 'Header & Footer', group: 'Edit',
    does: 'Adds running text at the left, centre and right of the top and bottom of pages. Tokens: {n} page number, {total} page count, {date} today, {filename}.', notes: 'Characters the standard font cannot draw show as ?' },
  { id: 'crop', label: 'Crop Pages', group: 'Edit',
    does: 'Trims margins (top, bottom, left, right in millimetres) off all or some pages. A preview shades what will be removed.', notes: 'Numeric margins only; there is no draggable crop box.' },
  { id: 'compress', label: 'Compress', group: 'Edit',
    does: 'Makes the file smaller. Always tidies the file structure; optionally re-saves JPEG photos at low, medium or high quality for bigger savings. Shows the before and after size.', notes: 'Scans saved as non-JPEG pictures may not shrink much.' },
  { id: 'protect', label: 'Password Protect', group: 'Edit',
    does: 'Locks a PDF with a password (AES-256 encryption), with optional limits on printing, copying and editing.', notes: 'A forgotten password cannot be recovered. Do this last, because other tools cannot work on a locked file.' },
  { id: 'unprotect', label: 'Remove Password', group: 'Edit',
    does: 'Takes the password off a PDF when the person knows the password.', notes: 'Cannot crack or guess an unknown password.' },
  { id: 'inspect', label: 'Inspect Fields', group: 'Forms',
    does: 'Lists the fillable boxes a PDF form already has: names, types, current values.', notes: '' },
  { id: 'fill', label: 'Fill Form', group: 'Forms',
    does: 'Types answers into a PDF form\'s fields and downloads it. By default the answers are stamped as fixed page text, so they look right in every viewer.', notes: 'Stamped answers can no longer be edited. Choose the live-field option to keep them editable.' },
  { id: 'sign', label: 'Fill & Sign', group: 'Forms',
    does: 'Places a drawn, typed or uploaded signature, initials or today\'s date anywhere on any PDF, whether or not it is a form.', notes: 'A picture-style signature stamped on the page. It is not a certificate-based digital signature.' },
  { id: 'annotate', label: 'Annotate', group: 'Forms',
    does: 'Marks up pages: highlight, strikeout, freehand drawing, sticky notes and text boxes, with undo and redo.', notes: 'Marks are drawn on top of the page. A highlight or strikeout does not remove the text underneath, so it is not redaction.' },
  { id: 'flatten', label: 'Flatten', group: 'Forms',
    does: 'Turns form answers into fixed page content so they can no longer be edited.', notes: '' },
  { id: 'fielddesigner', label: 'Add Fields', group: 'Forms',
    does: 'Draw new fillable boxes (text, tick box, dropdown) onto any PDF page, with font, size, colour and border, so someone else can fill it in.', notes: 'A text box with a value typed in at design time is stamped as fixed text instead of a fillable box.' },
  { id: 'metadata', label: 'Metadata', group: 'Analyse',
    does: 'Shows and edits the PDF\'s title, author, subject, keywords and creator.', notes: '' },
  { id: 'fileinfo', label: 'File Info', group: 'Analyse',
    does: 'Shows file name, size, page count and type. Runs in the browser.', notes: '' },
  { id: 'compare', label: 'Compare', group: 'Analyse',
    does: 'Compares two PDFs page by page: a picture comparison that highlights changed areas, and a line-by-line text comparison.', notes: '' },
];

// Rules of the tools that the guide may explain. Taken from how PDF Tools actually behaves (docs/pdf-agent.md).
const RULES = [
  'Every tool is stateless: one file goes in and a result comes back to preview and download. Nothing is stored on the server, so keep the downloaded result; the original file is never changed.',
  'Page ranges are typed like 1-3,5,7-9, or "all".',
  'Tools work on one file at a time, so a job with several steps is done by running a tool, downloading the result, and uploading it to the next tool.',
  'A sensible order for a multi-step job: OCR a scan first (so later steps and searching work), then reorder, crop and clean up pages, then add watermark, page numbers or header and footer, then compress, and set a password last.',
  'A password-protected PDF cannot be processed by other tools until the password is removed.',
  'Fill Form and Fill & Sign stamp their content onto the page as fixed text or pictures, so it looks the same in every PDF viewer.',
  'Tools marked as running in the browser (Extract Text, Pages → Images, File Info, OCR, Remove Blank Pages) read the file on the person\'s own device.',
  'Merge keeps the order the files are listed in; Organize Pages can reorder afterwards.',
];

// Things people commonly ask for that PDF Tools does NOT do.
const NOT_POSSIBLE = [
  'Editing the existing text or pictures on a page (changing a word, replacing a logo). Tools only add things on top, or rearrange whole pages.',
  'Permanently blacking out or redacting sensitive information. Highlight, strikeout and text-box marks sit on top of the page and the text underneath can still be copied, so never rely on them to hide anything.',
  'Certificate-based digital signatures that prove who signed and detect changes. Fill & Sign stamps a visual signature only.',
  'Converting a PDF to Excel, PowerPoint or HTML, or extracting tables. PDF → Word is the only Office conversion out of PDF.',
  'OCR in languages other than English, or reading handwriting.',
  'Extracting embedded images that are not JPEG photos.',
  'Repairing a damaged PDF, converting to PDF/A, or optimising for fast web viewing.',
  'Editing bookmarks or a table of contents, or adding a logo or picture watermark.',
  'Running one tool over many files at once, or chaining tools automatically.',
  'Looking inside the person\'s file to answer a question about its contents. The guide knows what the tools do, but cannot see the file.',
];

const VERDICTS = ['doable', 'partly', 'missing', 'beyond', 'question'];
const CATALOG_IDS = new Set(CATALOG.map((t) => t.id));
const byId = (id) => CATALOG.find((t) => t.id === id);

function catalogText() {
  return CATALOG.map((t) => `- tool "${t.id}" (${t.label}, ${t.group}): ${t.does}${t.notes ? ` Note: ${t.notes}` : ''}`).join('\n');
}

const SYSTEM = `You are the guide to PDF Tools in Vault. People say, in everyday words, what they want to do with a PDF. You point them to the right tool(s), in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a tool or a feature, and never promise something the notes say the tools cannot do.
- You cannot see this person's files. Never state or guess what is in a document. If they ask about a file's contents, say you cannot see it.
- You are not a lawyer. Never say whether a signature, a stamped form or a marked-up PDF is legally valid or will be accepted by someone; say what the tool actually does, and suggest checking with whoever receives it.
- Never suggest Annotate, Watermark or Crop to hide or remove sensitive information. Say plainly that PDF Tools cannot permanently redact.
- Be plain and short, as to someone who is not technical. Avoid jargon; if you must use a term such as "OCR" or "flatten", say what it means in the same sentence.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there. Remind the person to download the result and upload it to the next tool when a job needs several tools.
- If you need one more fact to answer, ask ONE short question and give no steps.
- Warn before anything hard to undo: setting a password (a forgotten one cannot be recovered), or stamping form answers (they can no longer be edited).
- Choose a verdict:
  "doable"   = the job can be done fully with the tools as they are.
  "partly"   = part can be done; one piece cannot. Give the possible steps and explain in "missing" what is not possible.
  "missing"  = it sounds like something PDF Tools should do, but it does not. In "missing" say what would be needed. Give any steps that still help.
  "beyond"   = not something PDF Tools is for (see the list of things it does not do). Say so kindly in "answer".
  "question" = you need to ask something first.

Reply with ONLY a JSON object, no other text:
{"verdict":"doable|partly|missing|beyond|question","answer":"1-4 short sentences","steps":[{"tool":"<tool id>","do":"what to do with this tool"}],"missing":"only for partly or missing: what is needed","tip":"optional one-line tip"}`;

function buildTutorPrompt({ messages, currentTool }) {
  const convo = (messages || []).map((m) => `${m.role === 'assistant' ? 'Guide' : 'Person'}: ${m.content}`).join('\n');
  const where = currentTool && byId(currentTool) ? `\nThe person currently has the "${currentTool}" tool open.` : '';
  return `PDF TOOLS (the complete list):
${catalogText()}

HOW THE TOOLS WORK (rules you may explain):
${RULES.map((t) => `- ${t}`).join('\n')}

THINGS PDF TOOLS DOES NOT DO:
${NOT_POSSIBLE.map((t) => `- ${t}`).join('\n')}
${where}

CONVERSATION SO FAR:
${convo}

Reply with the JSON object now.`;
}

/** Keep only the last few turns, trimmed, with roles we know. */
function cleanMessages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.replace(/\s+/g, ' ').trim().slice(0, 1500) }));
}

function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ }
  }
  return null;
}

const clip = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Turn the model's reply into something safe to show: known tool ids only, bounded text, a valid verdict. Never throws. */
function normalizeTutorReply(raw) {
  const parsed = typeof raw === 'string' ? extractJson(raw) : raw;
  if (!parsed || typeof parsed !== 'object') {
    const prose = typeof raw === 'string' && !/[{}]/.test(raw) ? clip(raw, 900) : '';
    return {
      verdict: 'question',
      answer: prose || 'Sorry, I could not work that out. Could you say again what you want to do with your PDF, in a sentence?',
      steps: [], missing: '', tip: '',
    };
  }
  const steps = (Array.isArray(parsed.steps) ? parsed.steps : [])
    .map((s) => ({ tool: String(s?.tool || '').trim(), do: clip(s?.do, 300) }))
    .filter((s) => CATALOG_IDS.has(s.tool) && s.do)
    .slice(0, 8)
    .map((s) => ({ ...s, label: byId(s.tool).label, group: byId(s.tool).group }));
  const missing = clip(parsed.missing, 400);
  let verdict = VERDICTS.includes(parsed.verdict) ? parsed.verdict : (steps.length ? 'doable' : 'question');
  if (verdict === 'doable' && !steps.length) verdict = 'question';
  if ((verdict === 'partly' || verdict === 'missing') && !missing) verdict = steps.length ? 'doable' : 'question';
  if (verdict === 'beyond' || verdict === 'question') steps.length = 0;
  return {
    verdict,
    answer: clip(parsed.answer, 900) || (verdict === 'beyond' ? 'That is outside what PDF Tools does.' : ''),
    steps,
    missing: verdict === 'partly' || verdict === 'missing' ? missing : '',
    tip: clip(parsed.tip, 200),
  };
}

/**
 * @param {number} userId
 * @param {{ messages: Array<{role:string,content:string}>, currentTool?: string }} input
 */
async function askPdfTutor(userId, { messages, currentTool } = {}, deps = {}) {
  const convo = cleanMessages(messages);
  if (!convo.length || convo[convo.length - 1].role !== 'user') {
    const err = new Error('Type what you want to do first.');
    err.status = 400;
    throw err;
  }
  const resolve = deps.getModels || require('./modelResolver').getModelsForUser;
  const call = deps.callModel || require('./callModel').callModel;
  const { standard: modelId } = await resolve(userId);
  const result = await call(modelId, buildTutorPrompt({ messages: convo, currentTool }), {
    system: SYSTEM, maxTokens: 900, returnUsage: true, timeoutMs: 45000,
  });
  (deps.logUsage || require('../utils/logUsage').logUsage)({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'pdf' });
  return normalizeTutorReply(String(result.text || ''));
}

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS,
  buildTutorPrompt, cleanMessages, normalizeTutorReply, askPdfTutor, catalogText,
};
