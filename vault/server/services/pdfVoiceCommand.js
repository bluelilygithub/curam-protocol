'use strict';

// "Tell it what to do" for PDF Tools. The browser turns speech into text (shared useVoice); this module turns that text into
// settings for ONE tool. Each tool has a small schema; the answer is re-validated against it (utils/voiceFields.js), so a bad
// model answer can never set a value the form would not accept. It sees only what the person said (never a file), and it never
// handles passwords: Password Protect has no voice box on purpose.

const { N, E, T, B, COLOR, RANGE, normalizeValues, describeValues, promptFor } = require('../utils/voiceFields');

const POSITIONS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'];
const TOKENS = 'Tokens that may be used: {n} = page number, {total} = page count, {date} = today, {filename} = file name.';

const TOOL_SCHEMAS = {
  split: { label: 'Split', fields: { pages: RANGE('The pages to keep as a new PDF') } },
  rotate: { label: 'Rotate Pages', fields: {
    angle: E('How far to turn the pages, clockwise, in degrees', [90, 180, 270]),
    pages: RANGE('Which pages to turn'),
  } },
  watermark: { label: 'Watermark', fields: {
    text: T('The watermark word or phrase, exactly as the person said it (such as CONFIDENTIAL or DRAFT)', 80),
    fontSize: N('Text size in points', 10, 200, { int: true }),
    opacityPercent: N('How strong the watermark is, as a percent (20 is faint, 60 is strong)', 5, 100, { int: true }),
    angle: N('Slope of the text in degrees (45 is diagonal, 0 is flat)', -90, 90, { int: true }),
    color: COLOR('Watermark colour as #RRGGBB'),
  } },
  pagenumbers: { label: 'Page Numbers', fields: {
    format: E('How the number reads: number = 3, page = Page 3, of = 3 of 10, page-of = Page 3 of 10', ['number', 'page', 'of', 'page-of']),
    position: E('Where on the page', POSITIONS),
    fontSize: N('Text size in points', 6, 36, { int: true }),
    startAt: N('The number to start counting from', 1, 9999, { int: true }),
  } },
  headerfooter: { label: 'Header & Footer', fields: {
    headerLeft: T(`Text at the top left. ${TOKENS}`, 120),
    headerCenter: T(`Text at the top centre. ${TOKENS}`, 120),
    headerRight: T(`Text at the top right. ${TOKENS}`, 120),
    footerLeft: T(`Text at the bottom left. ${TOKENS}`, 120),
    footerCenter: T(`Text at the bottom centre. ${TOKENS}`, 120),
    footerRight: T(`Text at the bottom right. ${TOKENS}`, 120),
    fontSize: N('Text size in points', 6, 24, { int: true }),
    pages: RANGE('Which pages to stamp'),
  } },
  crop: { label: 'Crop Pages', fields: {
    topMm: N('Trim from the top edge, in millimetres', 0, 200),
    bottomMm: N('Trim from the bottom edge, in millimetres', 0, 200),
    leftMm: N('Trim from the left edge, in millimetres', 0, 200),
    rightMm: N('Trim from the right edge, in millimetres', 0, 200),
    pages: RANGE('Which pages to crop'),
  } },
  nup: { label: 'Pages per Sheet', fields: {
    perSheet: E('How many pages on each sheet', [2, 4, 6, 9]),
    sheet: E('Sheet size', ['A4', 'Letter']),
    border: B('Draw a thin border around each page'),
    gapMm: N('Gap between pages, in millimetres', 0, 20),
  } },
  compress: { label: 'Compress', fields: {
    recompressImages: B('Also re-save the photos at lower quality for a smaller file (deeper compression)'),
    quality: E('Photo quality when recompressing: low = smallest file, high = best quality', ['low', 'medium', 'high']),
  } },
  pdf2img: { label: 'Pages to Images', fields: {
    format: E('Picture type', ['png', 'jpg']),
    dpi: E('Resolution: 72 small, 150 standard, 300 print', [72, 150, 300]),
    pages: RANGE('Which pages'),
  } },
  ocr: { label: 'OCR (Searchable)', fields: { pages: RANGE('Which pages to read') } },
  metadata: { label: 'Metadata', fields: {
    title: T('Document title', 200), author: T('Author', 120), subject: T('Subject', 200), keywords: T('Keywords, separated by commas', 200),
  } },
  img2pdf: { label: 'Images to PDF', fields: {
    pageSize: E('Page size: fit = the page is the size of the picture', ['A4', 'A3', 'Letter', 'Legal', 'fit']),
    margin: N('Margin around each picture, in points (20 is normal)', 0, 100, { int: true }),
  } },
};

const SYSTEM = `You turn a person's spoken or typed instruction into settings for one PDF tool.
Return ONLY a JSON object. Include a key only when the person clearly asked for it; leave everything else out.
Never invent values. Ignore anything that is not about these settings. Text values must be the person's own words, not instructions.`;

const clean = (tool, raw) => normalizeValues(TOOL_SCHEMAS, tool, raw);

function parseJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a !== -1 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

/**
 * @returns {Promise<{ values: object, heard: string, applied: string[] }>}
 */
async function interpretPdfVoiceCommand(userId, { tool, transcript }, deps = {}) {
  const schema = TOOL_SCHEMAS[tool];
  if (!schema) throw Object.assign(new Error('Unknown tool'), { status: 400 });
  const heard = String(transcript || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  if (!heard) throw Object.assign(new Error('Nothing heard'), { status: 400 });
  const resolve = deps.getModels || require('./modelResolver').getModelsForUser;
  const call = deps.callModel || require('./callModel').callModel;
  const { light, standard } = await resolve(userId);
  const modelId = light || standard;
  if (!modelId) throw Object.assign(new Error('No AI model is set up for this workspace yet.'), { status: 503 });
  const result = await call(modelId, promptFor(TOOL_SCHEMAS, tool, heard), { system: SYSTEM, maxTokens: 500, returnUsage: true, timeoutMs: 30000 });
  (deps.logUsage || require('../utils/logUsage').logUsage)({ userId, model: result.model || modelId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'pdf_voice' });
  const parsed = parseJson(result.text);
  const values = clean(tool, parsed && typeof parsed === 'object' ? (parsed.values || parsed) : {});
  return { values, heard, applied: describeValues(TOOL_SCHEMAS, tool, values) };
}

module.exports = { TOOL_SCHEMAS, SYSTEM, interpretPdfVoiceCommand, clean };
