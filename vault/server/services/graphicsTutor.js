'use strict';

// The Graphics guide: a person says, in everyday words, what they want to do with an image ("make this logo transparent",
// "get this photo ready for Instagram"), and the guide points at the real Graphics tools, in order, or says plainly that
// Graphics does not do it.
//
// Same design as the Video Tools, Finance and PDF guides (videoTutor.js, financeTutor.js, pdfTutor.js): it only knows what is
// written below, the model's answer is treated as untrusted (parsed, trimmed, every tool id checked against the catalogue), and
// a test (graphicsTutor.test.js) fails if a tool is added to or removed from the Graphics page without this file being updated.
//
// It does NOT see the person's images. Nothing here reads or writes an image. (The "Ask Graphics" box at the top of the page is
// a different feature: it plans and runs a few edits. This guide only explains and points.)

// The model and usage modules open a database connection when loaded, so they are loaded only when the guide really calls the
// model. The tests (and anything that only reads the catalogue) need no database.

// id = the tool id on the Graphics page (exactly as in MODES in client/src/pages/GraphicsPage.jsx); label = its name in the list.
const CATALOG = [
  { id: 'generate', label: 'Generate', group: 'Create',
    does: 'Makes a new picture from a written description, with a style and a size. Afterwards a new variation can be made from the result ("Augment").', notes: 'Uses the hosted or local image model the workspace is set up with, so each picture costs a little. Augment is not offered with every provider.' },
  { id: 'animate', label: 'Animate (GIF)', group: 'Create',
    does: 'Joins several pictures into one animated GIF, with the delay per frame and looping.', notes: 'The first picture sets the size; the others are cropped to match. Pictures only: it does not turn a video into a GIF (Video Tools does).' },
  { id: 'upscale', label: 'Upscale', group: 'Optimise',
    does: 'Makes a small picture bigger and sharper. A faithful option keeps the picture true; an enhanced option invents extra detail.', notes: 'Hosted model, so it costs a little; the cost is shown first.' },
  { id: 'convert', label: 'Convert', group: 'Optimise',
    does: 'Changes the file type: PNG, JPG, WebP, GIF, AVIF, TIFF, or ICO for favicons. Can open iPhone HEIC photos where the server supports it, and fetch a picture from a web address.', notes: '' },
  { id: 'compress', label: 'Compress', group: 'Optimise',
    does: 'Makes picture files smaller at a quality you choose, in the same file type, and shows the saving. Never returns a bigger file.', notes: '' },
  { id: 'batch', label: 'Batch', group: 'Optimise',
    does: 'Does one job on up to 25 pictures at once: watermark, resize, convert, compress, or remove metadata. One bad file does not stop the rest, and results can be downloaded together.', notes: 'Only those five jobs; other edits are one picture at a time.' },
  { id: 'exportsocial', label: 'Export for Social', group: 'Optimise',
    does: 'Turns one picture into every social media size you tick (Instagram, Facebook, X, LinkedIn, YouTube, Pinterest), cropped sensibly, with a preview of each and one zip to download.', notes: 'The focus of each crop can be changed if a size cuts off the wrong part.' },
  { id: 'pdf2img', label: 'PDF → Images', group: 'Optimise',
    does: 'Turns each page of a PDF into a PNG picture, at the resolution you pick. Runs in the browser; nothing is uploaded.', notes: 'PDF Tools has a similar tool with JPG and page ranges.' },
  { id: 'printready', label: 'Print Ready', group: 'Optimise',
    does: 'Gets a picture ready for a printer: sets 150, 300 or 600 DPI, can add a bleed margin, and saves as TIFF (screen or CMYK colour), PDF or PNG.', notes: 'The CMYK conversion is a simple calculation, not a printer profile, so for colour-critical print work check with the printer.' },
  { id: 'autoenhance', label: 'Auto-enhance', group: 'Optimise',
    does: 'One click that corrects brightness, contrast and colour from what is in the picture, and shows what it changed with a before-and-after slider.', notes: '' },
  { id: 'cropresize', label: 'Crop / Resize', group: 'Transform',
    does: 'Sets an exact size, or lets the person drag a crop box with guide lines and an optional locked shape. Has presets for common social sizes.', notes: '' },
  { id: 'extend', label: 'Canvas Extend', group: 'Transform',
    does: 'Adds empty space around a picture on any side, in white, a colour, or transparent.', notes: 'Adds plain space only; it does not invent more picture to fill it.' },
  { id: 'perspective', label: 'Perspective Correct', group: 'Transform',
    does: 'Straightens a picture taken at an angle (a sign or document that looks like a trapezoid) using horizontal and vertical sliders.', notes: 'Two sliders, not four draggable corners.' },
  { id: 'smartcrop', label: 'Smart Crop', group: 'Transform',
    does: 'Crops to a size or shape while keeping the most interesting part, found automatically, or the most detailed part, or a chosen side.', notes: '' },
  { id: 'effects', label: 'Effects', group: 'Enhance',
    does: 'Flip, rotate (a quarter turn or any angle), add a border, round the corners, add a shadow, or apply a filter (black and white, sepia, invert, two-colour).', notes: '' },
  { id: 'adjust', label: 'Adjust', group: 'Enhance',
    does: 'Fine control of brightness, contrast, colour strength, hue, levels, sharpness, blur, noise reduction, colour warmth and vignette. Settings can be saved as presets in this browser.', notes: '' },
  { id: 'colorgrade', label: 'Color Grading', group: 'Enhance',
    does: 'Gives a picture a film look in one click: Warm, Cool, Cinematic, Vintage, Fade, Matte, Vivid, Noir, Golden hour, Teal and orange.', notes: 'Ten ready-made looks; they cannot be edited.' },
  { id: 'pipeline', label: 'Pipeline', group: 'Enhance',
    does: 'Chains up to 12 edits (such as adjust, filter, resize) into one run on a picture, in the order given.', notes: 'A recipe for the current picture; recipes are not saved for later.' },
  { id: 'annotate', label: 'Annotate', group: 'Compose',
    does: 'Marks up a picture by hand: type text anywhere, draw arrows, boxes and freehand lines, move anything, undo and redo, then save as PNG. Runs in the browser.', notes: 'Marks are baked in when saved.' },
  { id: 'watermark', label: 'Watermark', group: 'Compose',
    does: 'Stamps text or a logo picture on a picture, with position, size, see-through level and optional tiling. Brand Kit colours and logo can be used.', notes: '' },
  { id: 'textoverlay', label: 'Text Overlay', group: 'Compose',
    does: 'Puts a headline or caption on a picture: wraps automatically, with size, colour, bold, alignment, an optional box behind and an optional outline for legibility.', notes: 'Adds new text only; it cannot change text that is already in the picture.' },
  { id: 'composite', label: 'Composite', group: 'Compose',
    does: 'Stacks up to 8 text and logo layers on a base picture in one go, each with its own position and see-through level.', notes: 'Layers stack in the order added; there is no dragging to rearrange afterwards, and the result is not saved as editable layers.' },
  { id: 'batchtext', label: 'Batch Text', group: 'Compose',
    does: 'Stamps a text label on up to 20 pictures at once. The label can use {filename}, {index}, {n} and {date}.', notes: '' },
  { id: 'collage', label: 'Collage', group: 'Compose',
    does: 'Arranges 2 to 9 pictures into a grid with the columns, gap and background colour you choose.', notes: 'Grid layouts only; no free-form or overlapping layouts.' },
  { id: 'favicon', label: 'Favicon / Icons', group: 'Compose',
    does: 'Makes a full website icon set from one picture: all the PNG sizes, a manifest file and the lines to paste into a web page, in one zip.', notes: '' },
  { id: 'svg', label: 'Vectorize (SVG)', group: 'Compose',
    does: 'Traces a picture into a scalable SVG drawing, with the number of colours and the detail level to choose.', notes: 'Best for logos, icons and clipart. Photos come out as a posterised drawing. There is no SVG editor.' },
  { id: 'iconlib', label: 'AI Icon Library', group: 'Compose',
    does: 'Creates a matching set of custom SVG icons from a subject and optional reference styles, and can refine them or add more.', notes: 'Uses an AI model, so it costs a little.' },
  { id: 'background', label: 'Background', group: 'Retouch',
    does: 'Cuts out the subject and removes the background to transparent, or swaps in a solid colour, a gradient or another picture.', notes: 'Automatic; very fine hair or glass edges may need a touch-up with Eraser.' },
  { id: 'extract', label: 'Extract Element', group: 'Retouch',
    does: 'The person paints over the thing to keep (or clicks with the magic wand) and everything else becomes transparent. Edge softness is adjustable.', notes: 'Manual selection; for an automatic cut-out of the main subject use Background.' },
  { id: 'recolor', label: 'Recolor', group: 'Retouch',
    does: 'Changes one colour to another everywhere it appears (pick it with a zoomable eyedropper), with a tolerance and a mode that keeps shading.', notes: 'Works on colour, not on objects: other things of the same colour change too.' },
  { id: 'eraser', label: 'Eraser', group: 'Retouch',
    does: 'Paints parts of a picture away to transparent, with a restore brush, a magic wand and undo. Runs in the browser, and the result is always a PNG.', notes: '' },
  { id: 'redact', label: 'Redact', group: 'Retouch',
    does: 'Draw boxes over faces, number plates or private text and blur or pixelate them. Runs in the browser.', notes: 'Check the result zoomed in before sharing. Remove Meta is a separate step for hidden details such as location.' },
  { id: 'inpaint', label: 'Inpaint / Remove', group: 'Retouch',
    does: 'Paint (or magic-wand) over something to remove it, and optionally describe what to put there instead. The AI fills the area.', notes: 'Hosted AI, so it costs a little. Good for removing small things; adding a specific new person or object that matches the photo perfectly usually takes several tries.' },
  { id: 'picker', label: 'Picker', group: 'Analyse',
    does: 'Click anywhere on a picture to read the exact colour as HEX and RGB, with copy buttons and zoom. Runs in the browser.', notes: '' },
  { id: 'histogram', label: 'Histogram', group: 'Analyse',
    does: 'Shows how dark and light the colours in a picture are, as a graph, for judging exposure. Runs in the browser.', notes: '' },
  { id: 'contrast', label: 'Contrast (WCAG)', group: 'Analyse',
    does: 'Checks whether text and background colours are easy enough to read, against the AA and AAA accessibility levels, with a live preview.', notes: 'Compares two colours that are typed or picked; it does not read colours out of a picture (use Picker for that).' },
  { id: 'palette', label: 'Palette', group: 'Analyse',
    does: 'Pulls the main 5 to 12 colours out of a picture, with HEX and RGB and roughly how much of the picture each covers.', notes: '' },
  { id: 'ocr', label: 'Extract Text', group: 'Analyse',
    does: 'Reads the text in a screenshot, scan or receipt photo and lets the person edit, copy or save it as a .txt file. Languages: English, French, Spanish, German, Italian, Portuguese. Runs in the browser.', notes: 'Not for handwriting. The first use downloads the language data. Check numbers against the picture.' },
  { id: 'blurdetect', label: 'Blur Detection', group: 'Analyse',
    does: 'Scores how sharp a picture is and says Sharp, Soft or Blurry.', notes: 'Tells you about the picture; it cannot fix a blurry one.' },
  { id: 'diff', label: 'Image Diff', group: 'Analyse',
    does: 'Compares two pictures and marks in red what is different, with a sensitivity setting and the percentage that differs.', notes: '' },
  { id: 'metadata', label: 'Remove Meta', group: 'Analyse',
    does: 'Shows what hidden details a picture carries (camera, date, GPS location) and strips them out, saying what was removed.', notes: '' },
  { id: 'fileinfo', label: 'File Info', group: 'Analyse',
    does: 'Shows a file\'s name, type, size, pixel size, shape and date. Runs in the browser.', notes: '' },
];

// Rules of the tools that the guide may explain. Taken from how Graphics actually behaves (docs/graphics-tools.md).
const RULES = [
  'Most tools work on one picture at a time: choose a picture, run the tool, look at the result, and download it or use "Use in…" to send it straight to another tool.',
  'Only Generate keeps pictures (in its gallery). For every other tool the result is not stored, so download it before leaving.',
  'Most edits run on the Vault server for free. Generate, Upscale, Inpaint, AI Icon Library and the AI Background cut-out use hosted AI and cost a little each time.',
  'Annotate, Redact, Eraser, Picker, Histogram, Contrast, Palette, Extract Text, PDF → Images and File Info run in the person\'s own browser, so the picture does not leave their device.',
  'A sensible order for a multi-step job: fix the picture first (Perspective Correct, Crop / Resize, Auto-enhance or Adjust), then retouch (Background, Inpaint, Recolor), then add text or a watermark, then resize or convert for where it is going, and compress last.',
  'The Brand Kit button above the tool list saves a logo, up to three colours and a font name, which Text Overlay, Watermark and Composite then offer.',
  'The Ask Graphics box at the top of the page can run a few edits from one plain sentence (Adjust, Color Grading, Background, Recolor, Canvas Extend, Augment) and can open Inpaint or Extract Element for the person to paint on. It cannot run the other tools.',
  'Many tools have an "Export…" button to re-save the result as PNG, JPG, WebP or AVIF at a size or quality, and a Compare slider to see before and after.',
];

// Things people commonly ask for that Graphics does NOT do.
const NOT_POSSIBLE = [
  'Changing words that are already in a picture (editing a screenshot\'s text). Text Overlay only adds new text on top.',
  'Layered projects: saving a design as editable layers, or opening Photoshop (PSD), Illustrator or RAW camera files. Composite is a one-go stack, not a layer editor.',
  'Editing video or turning a video into a GIF. That is Video Tools. Animate only joins still pictures.',
  'Putting a specific person into a photo, swapping faces, or perfectly matching the lighting of a new object. Inpaint can fill and remove, but this usually needs several tries and may never look right.',
  'Free-hand painting and drawing like a paint program, apart from Annotate\'s pen, the Eraser and the masks painted in Inpaint and Extract Element.',
  'Editing an SVG after Vectorize (moving points, recolouring shapes). It only traces.',
  'Doing any edit to many pictures at once. Batch covers only watermark, resize, convert, compress and remove metadata (up to 25), and Batch Text covers labels (up to 20).',
  'Reading handwriting, or text in languages other than English, French, Spanish, German, Italian and Portuguese.',
  'Colour-accurate print preparation with printer profiles. Print Ready converts to CMYK by calculation only.',
  'Looking at the person\'s pictures to say what is in them or to suggest an edit. The guide knows what the tools do, but cannot see any picture.',
];

const VERDICTS = ['doable', 'partly', 'missing', 'beyond', 'question'];
const CATALOG_IDS = new Set(CATALOG.map((t) => t.id));
const byId = (id) => CATALOG.find((t) => t.id === id);

function catalogText() {
  return CATALOG.map((t) => `- tool "${t.id}" (${t.label}, ${t.group}): ${t.does}${t.notes ? ` Note: ${t.notes}` : ''}`).join('\n');
}

const SYSTEM = `You are the guide to Graphics in Vault. People say, in everyday words, what they want to do with an image. You point them to the right tool(s), in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a tool or a feature, and never promise something the notes say the tools cannot do.
- You cannot see this person's images. Never state or guess what is in a picture. If they ask about a picture's contents, say you cannot see it.
- You are not a lawyer. Never say whether a picture, a logo or a generated image is free of copyright, trademark or licence problems; say what the tool does and suggest checking the rights if it matters.
- Never describe Redact, blur or pixelate as a guarantee that something cannot be recovered. Suggest checking the result zoomed in, and removing hidden details with Remove Meta.
- Be plain and short, as to someone who is not technical. Avoid jargon; if you must use a term such as "inpaint", "vectorize" or "DPI", say what it means in the same sentence.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there. Remind the person to download the result (or use "Use in…") before moving to the next tool when a job needs several tools.
- If you need one more fact to answer, ask ONE short question and give no steps.
- Say so when a step uses an AI model that costs a little (Generate, Upscale, Inpaint, AI Icon Library, AI Background).
- Choose a verdict:
  "doable"   = the job can be done fully with the tools as they are.
  "partly"   = part can be done; one piece cannot. Give the possible steps and explain in "missing" what is not possible.
  "missing"  = it sounds like something Graphics should do, but it does not. In "missing" say what would be needed. Give any steps that still help.
  "beyond"   = not something Graphics is for (see the list of things it does not do). Say so kindly in "answer".
  "question" = you need to ask something first.

Reply with ONLY a JSON object, no other text:
{"verdict":"doable|partly|missing|beyond|question","answer":"1-4 short sentences","steps":[{"tool":"<tool id>","do":"what to do with this tool"}],"missing":"only for partly or missing: what is needed","tip":"optional one-line tip"}`;

function buildTutorPrompt({ messages, currentTool }) {
  const convo = (messages || []).map((m) => `${m.role === 'assistant' ? 'Guide' : 'Person'}: ${m.content}`).join('\n');
  const where = currentTool && byId(currentTool) ? `\nThe person currently has the "${currentTool}" tool open.` : '';
  return `GRAPHICS (the complete list of tools):
${catalogText()}

HOW THE TOOLS WORK (rules you may explain):
${RULES.map((t) => `- ${t}`).join('\n')}

THINGS GRAPHICS DOES NOT DO:
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
      answer: prose || 'Sorry, I could not work that out. Could you say again what you want to do with your image, in a sentence?',
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
    answer: clip(parsed.answer, 900) || (verdict === 'beyond' ? 'That is outside what Graphics does.' : ''),
    steps,
    missing: verdict === 'partly' || verdict === 'missing' ? missing : '',
    tip: clip(parsed.tip, 200),
  };
}

/**
 * @param {number} userId
 * @param {{ messages: Array<{role:string,content:string}>, currentTool?: string }} input
 */
async function askGraphicsTutor(userId, { messages, currentTool } = {}, deps = {}) {
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
  (deps.logUsage || require('../utils/logUsage').logUsage)({ userId, model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens, feature: 'graphics' });
  return normalizeTutorReply(String(result.text || ''));
}

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS,
  buildTutorPrompt, cleanMessages, normalizeTutorReply, askGraphicsTutor, catalogText,
};
