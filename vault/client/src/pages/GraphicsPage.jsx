import { useIcon } from '../providers/IconProvider';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import api from '../utils/apiClient';
import Tooltip from '../components/Tooltip';
import GraphicsAskPanel from '../components/GraphicsAskPanel';
import useToastStore from '../store/toastStore';
import GraphicsTutorChat from './graphics/GraphicsTutorChat';
import { GraphicsContext } from './graphics/GraphicsContext';
import { TOOL_COMPONENTS } from './graphics/toolRegistry';
import { BeforeAfter, readFileAsDataUrl } from './graphics/shared';
import { GoalStart, GoalBar } from './graphics/GoalStart';

const MODES = [
  { id: 'generate', label: 'Generate', icon: 'sparkles' },
  { id: 'animate', label: 'Animate (GIF)', icon: 'film' },
  { id: 'upscale', label: 'Upscale', icon: 'image' },
  { id: 'convert', label: 'Convert', icon: 'refresh-cw' },
  { id: 'compress', label: 'Compress', icon: 'archive' },
  { id: 'batch', label: 'Batch', icon: 'file-stack' },
  { id: 'pdf2img', label: 'PDF → Images', icon: 'file-text' },
  { id: 'printready', label: 'Print Ready', icon: 'printer' },
  { id: 'autoenhance', label: 'Auto-enhance', icon: 'zap' },
  { id: 'cropresize', label: 'Crop / Resize', icon: 'crop' },
  { id: 'extend', label: 'Canvas Extend', icon: 'frame' },
  { id: 'perspective', label: 'Perspective Correct', icon: 'trapezoid' },
  { id: 'smartcrop', label: 'Smart Crop', icon: 'aim' },
  { id: 'effects', label: 'Effects', icon: 'wand' },
  { id: 'adjust', label: 'Adjust', icon: 'sliders' },
  { id: 'colorgrade', label: 'Color Grading', icon: 'palette-2' },
  { id: 'pipeline', label: 'Pipeline', icon: 'workflow' },
  { id: 'annotate', label: 'Annotate', icon: 'pen-line' },
  { id: 'watermark', label: 'Watermark', icon: 'droplets' },
  { id: 'textoverlay', label: 'Text Overlay', icon: 'text' },
  { id: 'composite', label: 'Composite', icon: 'combine' },
  { id: 'batchtext', label: 'Batch Text', icon: 'text' },
  { id: 'collage', label: 'Collage', icon: 'grid' },
  { id: 'favicon', label: 'Favicon / Icons', icon: 'app-window' },
  { id: 'exportsocial', label: 'Export for Social', icon: 'share-2' },
  { id: 'svg', label: 'Vectorize (SVG)', icon: 'shapes' },
  { id: 'iconlib', label: 'AI Icon Library', icon: 'layout-grid' },
  { id: 'background', label: 'Background', icon: 'scissors' },
  { id: 'extract', label: 'Extract Element', icon: 'scan-search' },
  { id: 'recolor', label: 'Recolor', icon: 'palette' },
  { id: 'eraser', label: 'Eraser', icon: 'brush' },
  { id: 'redact', label: 'Redact', icon: 'eye-off' },
  { id: 'inpaint', label: 'Inpaint / Remove', icon: 'eraser' },
  { id: 'picker', label: 'Picker', icon: 'eye' },
  { id: 'histogram', label: 'Histogram', icon: 'bar-chart' },
  { id: 'contrast', label: 'Contrast (WCAG)', icon: 'contrast' },
  { id: 'palette', label: 'Palette', icon: 'swatch' },
  { id: 'ocr', label: 'Extract Text', icon: 'type' },
  { id: 'blurdetect', label: 'Blur Detection', icon: 'focus' },
  { id: 'diff', label: 'Image Diff', icon: 'layers' },
  { id: 'metadata', label: 'Remove Meta', icon: 'shield' },
  { id: 'fileinfo', label: 'File Info', icon: 'info' },
];

// Hover text for every item in the left-hand list: what the tool does, in plain words. The Graphics guide's test
// (server/services/graphicsTutor.test.js) fails if a tool is added to MODES without an entry here.
const TOOL_TIPS = {
  generate: 'Make a new picture from a written description, choosing a style and a size.',
  animate: 'Join several pictures into one animated GIF, with the delay per frame and looping.',
  upscale: 'Make a small picture bigger and sharper. A faithful option keeps it true; an enhanced option adds detail.',
  convert: 'Change the file type: PNG, JPG, WebP, GIF, AVIF, TIFF or ICO. iPhone HEIC photos can be opened too.',
  compress: 'Make picture files smaller at a quality you choose, and see how much was saved.',
  batch: 'Do one job (watermark, resize, convert, compress, remove metadata, or run a saved recipe) on up to 25 pictures at once.',
  exportsocial: 'Turn one picture into every social media size you tick, with a preview of each and one zip to download.',
  pdf2img: 'Turn each page of a PDF into a PNG picture. Runs in your browser.',
  printready: 'Get a picture ready for a printer: set 150, 300 or 600 DPI, add bleed, save as TIFF, PDF or PNG.',
  autoenhance: 'One click that fixes brightness, contrast and colour, with a before-and-after slider.',
  cropresize: 'Set an exact size, or drag a crop box. Has presets for common social sizes.',
  extend: 'Add empty space around a picture on any side, in white, a colour or transparent.',
  perspective: 'Straighten a picture taken at an angle, such as a sign or document that looks like a trapezoid.',
  smartcrop: 'Crop to a size or shape while keeping the most interesting or most detailed part.',
  effects: 'Flip, rotate, add a border, round the corners, add a shadow, or apply a filter such as black and white.',
  adjust: 'Fine control of brightness, contrast, colour, sharpness, blur, noise and vignette. Save your settings as presets.',
  colorgrade: 'Give a picture a film look in one click: warm, cool, vintage, noir, golden hour and more.',
  pipeline: 'Chain several edits into one run, in the order you choose, then save the steps as a named recipe to use again.',
  annotate: 'Mark up a picture by hand: type text, draw arrows, boxes and lines, then save a PNG. Runs in your browser.',
  watermark: 'Stamp text or a logo on a picture, with position, size and see-through level.',
  textoverlay: 'Put a headline or caption on a picture, with an optional box behind it and an outline for legibility.',
  composite: 'Stack up to 8 text and logo layers on a picture in one go.',
  batchtext: 'Stamp a text label on up to 20 pictures at once, using the file name, number or date.',
  collage: 'Arrange 2 to 9 pictures into a grid.',
  favicon: 'Make a full website icon set, with its manifest file, from one picture.',
  svg: 'Trace a picture into a scalable SVG drawing. Best for logos, icons and clipart.',
  iconlib: 'Create a matching set of custom SVG icons from a subject and reference styles.',
  background: 'Cut out the subject and remove the background, or replace it with a colour, gradient or picture.',
  extract: 'Paint over the part you want to keep; everything else becomes transparent.',
  recolor: 'Change one colour to another everywhere it appears in a picture.',
  eraser: 'Paint parts of a picture away to transparent, with a restore brush and undo. Runs in your browser.',
  redact: 'Draw boxes over faces, number plates or private text and blur or pixelate them. Runs in your browser.',
  inpaint: 'Paint over something to remove it, and optionally describe what to put there. The AI fills the area.',
  picker: 'Click anywhere on a picture to read its exact colour. Runs in your browser.',
  histogram: 'See how dark and light the colours in a picture are, as a graph. Runs in your browser.',
  contrast: 'Check whether a text colour on a background colour is easy enough to read (WCAG).',
  palette: 'Pull the main 5 to 12 colours out of a picture.',
  ocr: 'Read the text in a screenshot, scan or receipt photo, then edit, copy or save it. Runs in your browser.',
  blurdetect: 'Score how sharp a picture is: Sharp, Soft or Blurry.',
  diff: 'Compare two pictures and mark in red what is different.',
  metadata: 'See the hidden details in a picture (camera, date, GPS location) and strip them out.',
  fileinfo: "Show a file's name, type, size, pixel size and date. Runs in your browser.",
};

const GROUP_TIPS = {
  Create: 'Make something new: a picture from a description, or an animated GIF from several pictures.',
  Optimise: 'Get a picture ready for where it is going: bigger, smaller, a different file type, a social size or print.',
  Transform: 'Change the shape of a picture: crop, resize, add space around it, or straighten it.',
  Enhance: 'Change how a picture looks: filters, light and colour, film looks, or several edits chained together.',
  Compose: 'Add things to pictures or build new ones from them: text, logos, grids, icons and SVG drawings.',
  Retouch: 'Cut out, remove or recolour parts of a picture.',
  Analyse: 'Look inside a picture: colours, text, sharpness, hidden details and differences.',
};

const MODE_GROUPS = [
  { label: 'Create', ids: ['generate', 'animate'] },
  { label: 'Optimise', ids: ['upscale', 'convert', 'compress', 'batch', 'exportsocial', 'pdf2img', 'printready', 'autoenhance'] },
  { label: 'Transform', ids: ['cropresize', 'extend', 'perspective', 'smartcrop'] },
  { label: 'Enhance', ids: ['effects', 'adjust', 'colorgrade', 'pipeline'] },
  { label: 'Compose', ids: ['annotate', 'watermark', 'textoverlay', 'composite', 'batchtext', 'collage', 'favicon', 'svg', 'iconlib'] },
  { label: 'Retouch', ids: ['background', 'extract', 'recolor', 'eraser', 'redact', 'inpaint'] },
  { label: 'Analyse', ids: ['picker', 'histogram', 'contrast', 'palette', 'ocr', 'blurdetect', 'diff', 'metadata', 'fileinfo'] },
];

const TOOL_HELP = {
  generate: {
    title: 'Image Generator',
    what: 'Create images from a text prompt using AI — local ComfyUI or a hosted provider such as FAL.',
    features: ['Pick aspect ratio: square, landscape or portrait', 'Style presets speed up prompt writing', 'Augment: feed an existing image as input for variations (ComfyUI + FAL)', 'Saved gallery below the form — hover a thumbnail to delete', 'Cost and token usage logged in the Usage dashboard'],
  },
  animate: {
    title: 'Animate (GIF)',
    what: 'Combine multiple images into an animated GIF.',
    features: ['Drag-and-drop or file-picker to add frames', 'Reorder with ↑ / ↓ arrows', 'Frame delay slider: 50–2000 ms per frame', 'Loop toggle — disable for a one-shot animation', 'First frame sets the canvas size; others are cropped to cover'],
  },
  upscale: {
    title: 'Upscale',
    what: 'Enlarge an image while preserving or enhancing detail.',
    features: ['Real-ESRGAN: faithful upscale, no hallucination', 'Clarity Pro: adds invented detail for a crisper look', 'Scale picker: 2×, 4× etc.', 'Fidelity slider (Clarity only): 0 = creative, 100 = faithful', 'Cost estimate shown before you run'],
  },
  convert: {
    title: 'Convert',
    what: 'Change an image\'s format.',
    features: ['Outputs: PNG, JPG, WebP, GIF, AVIF, TIFF, ICO (multi-res favicon)', 'Quality slider for lossy formats', 'HEIC/HEIF input supported where the server\'s libvips allows it', 'Import by URL — fetches server-side to bypass CORS', 'Before/after compare + Export panel'],
  },
  compress: {
    title: 'Compress',
    what: 'Reduce file size while keeping the original format.',
    features: ['Process many images at once', 'Quality presets: 90 / 75 / 60 / 40', 'Per-file savings and running total shown', 'Never returns a larger file — original kept if re-encoding doesn\'t help'],
  },
  batch: {
    title: 'Batch',
    what: 'Apply one operation to many images at once.',
    features: ['Modes: Convert format, Resize, Watermark, Compress, Run a recipe, Strip metadata', 'Convert/Resize/Watermark/Compress run in a single server round-trip (up to 25 images)', 'Per-file result with individual downloads', '"Download all" button for the full set', 'One bad file never stops the rest of the batch'],
  },
  pdf2img: {
    title: 'PDF → Images',
    what: 'Render every page of a PDF to PNG — entirely in your browser.',
    features: ['Resolution selector: 1×–4× (higher = larger files)', 'Click any page thumbnail to zoom', 'Per-page download or download all', 'Nothing is uploaded — processed fully client-side'],
  },
  autoenhance: {
    title: 'Auto-enhance',
    what: 'One-click brightness, contrast and saturation correction based on histogram analysis.',
    features: ['Analyses 5th/95th percentile tonal range per channel', 'Lifts brightness on dark images; pulls back overexposed ones', 'Stretches contrast when the tonal range is narrow', 'Shows applied multipliers (brightness, contrast, saturation)', 'Before/after compare included'],
  },
  cropresize: {
    title: 'Crop / Resize',
    what: 'Resize to exact dimensions, or interactively crop to any region.',
    features: ['Numeric resize with fit modes: cover, contain, fill, inside, outside', 'Social/web presets: Instagram, YouTube, Open Graph, etc.', 'Interactive cropper: drag the box, resize handles, rule-of-thirds guides', 'Lock aspect ratio — corner handles enforce the ratio', 'Live pixel-size readout'],
  },
  extend: {
    title: 'Canvas Extend',
    what: 'Add padding around an image — the opposite of cropping.',
    features: ['Link all sides for uniform padding, or set each side independently', 'Fill: white, transparent (PNG), or a custom hex colour', 'Before/after compare + Export'],
  },
  perspective: {
    title: 'Perspective Correct',
    what: 'Fix keystone / trapezoid distortion from off-angle shots.',
    features: ['Horizontal skew: adjusts left/right lean (−50 to +50)', 'Vertical skew: adjusts top/bottom lean (−50 to +50)', 'Corner fill: transparent PNG, white, black, or custom colour', 'Best for whiteboards, documents and architecture shots taken at an angle', 'Before/after compare + Export'],
  },
  smartcrop: {
    title: 'Smart Crop',
    what: 'Crop to a target size or aspect ratio, keeping the most important part of the image.',
    features: ['Attention: saliency detection — finds faces and salient subjects (recommended)', 'Entropy: keeps the region with the most visual detail', 'Cardinal directions: force crop to a fixed edge or corner', 'Aspect ratio field: 16:9, 1:1, 4:5 etc. — dimensions resolve automatically', 'Width/height fields for an exact pixel target'],
  },
  effects: {
    title: 'Effects',
    what: 'Apply geometric transforms and visual filters.',
    features: ['Flip horizontal or vertical', 'Rotate 90°, 180°, 270° or any free angle (−180° to 180°)', 'Free rotate: transparent corners (PNG) or a fill colour', 'Border: width + colour', 'Round corners: radius slider, exported as transparent PNG', 'Drop shadow: blur, X/Y offset, colour, opacity', 'Filters: grayscale, sepia, invert, duotone (shadow/highlight colours)'],
  },
  adjust: {
    title: 'Adjust',
    what: 'Fine-tune tones and colours with a full darkroom panel.',
    features: ['Brightness, contrast, saturation, hue shift', 'Levels: black point and white point (tonal stretch)', 'Gamma (midtone brightness)', 'Sharpness, blur, noise reduction (median filter)', 'Colour temperature (warm/cool)', 'Vignette', 'Presets: save current sliders as a named preset and recall later'],
  },
  colorgrade: {
    title: 'Color Grading',
    what: 'Apply a cinematic colour look in one click via channel recombination and tone mapping.',
    features: ['Warm — boost reds, reduce blues', 'Cool — reduce reds, boost blues', 'Cinematic — desaturated teal-orange style', 'Vintage — warm + faded shadows', 'Fade — lifted shadows, low saturation', 'Matte — soft contrast with a shadow floor', 'Vivid — high saturation + contrast boost', 'Noir (B&W) — full desaturation with contrast', 'Golden hour — strong warm reds, saturated', 'Teal & orange — cross-processed look'],
  },
  pipeline: {
    title: 'Pipeline',
    what: 'Chain multiple edits into one repeatable server-side pass, and save the steps as a recipe.',
    features: ['Up to 12 steps per pipeline', 'Ops: grayscale, sepia, invert, flip, mirror, blur, sharpen, brightness/contrast/saturation, gamma, temperature, rotate, border, resize, crop to a shape, add text, add your Brand Kit logo', 'Save as WebP, JPG, PNG or AVIF with a quality slider', 'My recipes: name the steps and save them; load, replace or delete them later (deleted recipes stay in the recycle bin for 30 days)', 'Run a saved recipe on up to 25 pictures from Batch', 'Reorder steps with ↑ / ↓ arrows', 'Per-step sliders', 'All steps applied in one server round-trip'],
  },
  annotate: {
    title: 'Annotate',
    what: 'Mark up an image with arrows, boxes, freehand drawing and text — fully in your browser.',
    features: ['Tools: Select/Move, Arrow, Box, Pen (freehand), Text', 'Click to place text; type directly; Enter to confirm', 'Double-click a text label to re-edit it', 'Google Fonts picker: 20 curated typefaces per text shape', 'Select any shape and drag to reposition; Delete removes it', 'Colour and thickness/size controls', 'Undo/redo up to 20 steps (Cmd/Ctrl+Z)', 'Nothing is uploaded — fully client-side'],
  },
  watermark: {
    title: 'Watermark',
    what: 'Overlay text or an image logo on a photo.',
    features: ['Text mode: custom text, colour, auto-scaled font size', 'Image mode: upload a PNG logo, scale as % of image width', 'Position: 7 options (corners, edges, centre)', 'Opacity slider', 'Tile: repeat the watermark across the whole image'],
  },
  batchtext: {
    title: 'Batch Text',
    what: 'Stamp a text label onto many images at once.',
    features: ['Template variables: {filename}, {index}, {n}, {date}', 'Up to 20 images per run', 'Position: 7 options (corners, edges, centre)', 'Font size, text colour and opacity controls', 'Optional backing rectangle for contrast over busy images', 'Per-image thumbnail + individual download in results'],
  },
  collage: {
    title: 'Collage',
    what: 'Arrange multiple images into a grid.',
    features: ['2–9 images, up to 9 cells', 'Column count control', 'Cell size and gap controls', 'Background colour picker', 'All cells cropped to a uniform size (cover)'],
  },
  favicon: {
    title: 'Favicon / App Icons',
    what: 'Generate a complete app icon set from one image.',
    features: ['Sizes: 16, 32, 48, 64, 180 (Apple), 192, 256, 512 px', 'Includes an apple-touch-icon.png', 'site.webmanifest with correct icon references', 'Paste-ready <head> HTML snippet', 'All files bundled into a single ZIP download'],
  },
  exportsocial: {
    title: 'Export for Social',
    what: 'Crop one image to every platform size you need, in one go.',
    features: ['Uses the same social presets as Crop/Resize (Instagram, Facebook, LinkedIn, X/Twitter, YouTube, Pinterest)', 'Smart-crop keeps the interesting part of the image in frame at each size', 'Tick the sizes you need, or select all', 'All crops bundled into a single ZIP download'],
  },
  svg: {
    title: 'Vectorize (SVG)',
    what: 'Trace a raster image into scalable SVG paths.',
    features: ['Colour count: 2–64 colours', 'Detail: smooth / medium / detailed', 'Best for logos, icons and flat clipart', 'Photos become posterised — lower colour counts suit logos', 'Image capped at 700px before tracing for speed'],
  },
  iconlib: {
    title: 'AI Icon Library',
    what: 'Generate a cohesive set of custom SVG icons from a subject description.',
    features: ['Step 1: enter a subject — see real Lucide and Font Awesome icons as reference', 'Step 2: set count (5–20), colour, stroke weight, fill style, corners and detail', 'Step 3: multi-select and download as individual .svg files', 'Refine & add more: give feedback and append new icons in the same style', 'Remove unwanted icons (hover → ×)', 'All SVG sanitised server-side before reaching your browser'],
  },
  background: {
    title: 'Background',
    what: 'Remove or replace an image background with one click.',
    features: ['Transparent: cut out the subject as a PNG', 'Solid colour: flatten onto a chosen colour', 'Gradient: two-colour blend with direction control (top→bottom, diagonal, radial)', 'Image: composite the cut-out over a chosen background photo', 'Local ONNX model in dev; Replicate model in production'],
  },
  recolor: {
    title: 'Recolor',
    what: 'Change the colour of a specific item in an image.',
    features: ['Eyedropper with zoom loupe — click to sample the colour to replace', 'Tolerance slider: how broadly to match similar shades', 'Match new colour: shifts brightness toward the target (dark items can become light)', 'Preserve shading: hue/saturation shift only, keeps original tones', '3×3 averaged sampling for reliable colour picking'],
  },
  redact: {
    title: 'Redact',
    what: 'Obscure faces, plates or sensitive text — entirely in your browser.',
    features: ['Draw boxes over any area to redact', 'Modes: pixelate or blur', 'Strength slider', 'Undo/redo up to 20 steps', 'Nothing is uploaded — fully client-side canvas'],
  },
  inpaint: {
    title: 'Inpaint / Remove',
    what: 'Paint a mask over an area and let AI fill or replace it.',
    features: ['Paint a white mask with an adjustable brush', 'Magic wand mode: click a spot to select connected similar-colour pixels instead of painting, with a tolerance slider', 'Describe what should fill the masked area', 'Object removal tip: describe the background behind the object', 'Powered by FAL (fal-ai/flux-lora/inpainting by default)', 'Model overridable via GRAPHICS_INPAINT_MODEL env var', 'Cost logged like image generation'],
  },
  picker: {
    title: 'Colour Picker',
    what: 'Click anywhere on an image to read its exact colour.',
    features: ['Zoom: 1×–6× slider', 'Drag-to-pan at high zoom', 'Reads HEX and RGB values', 'Copy HEX or RGB with one click', 'Nothing is uploaded — fully client-side'],
  },
  histogram: {
    title: 'Histogram',
    what: 'Visualise the tonal distribution of an image.',
    features: ['View combined RGB, luminance, or a single channel', 'Rendered on a canvas overlay', 'Import by URL supported', 'Image capped at 1000px for the tally', 'Nothing is uploaded — pixels read in your browser'],
  },
  contrast: {
    title: 'Contrast Checker (WCAG)',
    what: 'Check text/background colour contrast against accessibility standards.',
    features: ['WCAG 2.1 contrast ratio calculation', 'Pass/fail for AA and AAA at normal and large text sizes', 'Live preview of text on background', 'Swap colours button', 'Colour pickers + hex input for both colours', 'Fully browser-side'],
  },
  palette: {
    title: 'Palette',
    what: 'Extract the dominant colours from an image.',
    features: ['Extracts 5–12 dominant colours', 'Client-side quantisation — nothing uploaded', 'HEX, RGB and approximate share % for each swatch', 'One-click copy per swatch'],
  },
  ocr: {
    title: 'Extract Text (OCR)',
    what: 'Read text from screenshots, scans and receipts.',
    features: ['Powered by Tesseract.js, run on your device with files served from Vault itself (no CDN)', 'Languages: English, French, Spanish, German, Italian, Portuguese — pick the one the text is written in', 'Live progress readout during recognition', 'Editable result — correct OCR errors inline', 'Copy to clipboard or download as .txt', 'Nothing is uploaded — fully in your browser'],
  },
  blurdetect: {
    title: 'Blur Detection',
    what: 'Measure how sharp or blurry an image is.',
    features: ['Laplacian variance measures edge sharpness', 'Sharp: variance ≥ 500 · Soft: 100–499 · Blurry: < 100', 'Numeric score lets you compare multiple shots', 'Analysis capped at 800px for speed', 'Useful for culling near-duplicate photos'],
  },
  diff: {
    title: 'Image Diff',
    what: 'Highlight the pixel differences between two images.',
    features: ['Differing pixels shown in red over a faded copy of the first image', 'Sensitivity threshold: ignores minor differences below the level (e.g. anti-aliasing)', '"% of pixels differ" readout', 'Second image scaled to match the first automatically'],
  },
  metadata: {
    title: 'Remove Metadata',
    what: 'Strip identifying metadata from an image before sharing.',
    features: ['First shows current metadata: format, dimensions, camera, lens, GPS', 'Removes: EXIF, GPS coordinates, camera/lens info, timestamps, ICC profile, XMP/IPTC', 'EXIF orientation baked in first so the image isn\'t left mis-rotated', 'Reports exactly what was removed'],
  },
  fileinfo: {
    title: 'File Info',
    what: 'Inspect an image file\'s technical details without uploading it.',
    features: ['Name, MIME type, format', 'File size: human-readable and exact bytes', 'Pixel dimensions, aspect ratio, megapixels', 'Last-modified date', 'Image preview', 'Nothing is uploaded — fully browser-side'],
  },
  printready: {
    title: 'Print Ready',
    what: 'Prepare any image for professional printing — set target DPI, flatten transparency, add bleed, and export as TIFF, PDF or PNG.',
    features: ['Output as TIFF/sRGB, TIFF/CMYK (offset print), PDF or PNG', 'DPI presets: 150 (large format), 300 (standard), 600 (high detail)', 'Flatten transparency to white, or keep it', 'Bleed margin slider (0–25mm) pads the canvas for edge-to-edge artwork', 'CMYK conversion is mathematical RGB→CMYK — for colour-critical offset work, an ICC profile-based conversion is more accurate', 'Runs locally on the server — nothing sent to a third party'],
  },
  eraser: {
    title: 'Eraser',
    what: 'Paint over parts of an image to erase them to transparency — entirely in your browser.',
    features: ['Circular brush with adjustable size (5–120 px)', 'Magic wand mode: click a spot to select connected similar-colour pixels instead of painting, with a tolerance slider — click again to add more to the selection', 'Erase mode: removes pixels to full transparency', 'Restore mode: paints original pixels back — useful if you overshoot', 'Smooth stroke interpolation between mouse positions', 'Undo/redo stack — up to 20 snapshots (Cmd/Ctrl+Z supported)', 'Reset: restore the image to its original state', 'Output is always a PNG with an alpha channel', 'Nothing is uploaded — fully client-side'],
  },
  extract: {
    title: 'Extract Element',
    what: 'Paint a mask over the element you want to keep; the rest is removed to transparency.',
    features: ['Paint brush marks the area to keep (shown as green overlay)', 'Magic wand mode: click a spot to select connected similar-colour pixels instead of painting, with a tolerance slider — click again to add more to the selection', 'Erase brush removes paint strokes (shown in red) for fine adjustments — works with either selection mode', 'Adjustable brush size (5–120 px)', 'Feather slider (0–30 px) blurs the mask edge for soft extraction', 'Clear mask button resets all painted strokes', 'Server applies the mask: painted area is kept, everything else removed', 'Result is a transparent PNG — export or feed into other tools', 'Runs locally on the server — no external AI needed'],
  },
  textoverlay: {
    title: 'Text Overlay',
    what: 'Stamp a real headline or caption onto an image — bigger and more flexible than the Watermark tool\'s text mode.',
    features: ['Word-wraps automatically to a max-width % of the image', 'Optional background pill/box behind the text', 'Optional outline stroke for legibility over busy photos', 'Align left / center / right within its text box', 'Bold or normal weight, any hex colour', 'Position: 9 anchor points (corners, edges, centre)'],
  },
  composite: {
    title: 'Composite',
    what: 'Stack several text and/or logo layers onto a base image in one server round-trip.',
    features: ['Add any mix of text layers and logo/image layers', 'Up to 8 layers per composite', 'Each layer has its own position, opacity and (for images) scale', 'Layers stack in the order you add them — first added sits at the bottom', 'One-shot render — not a saved/reusable layer stack'],
  },
};

export default function GraphicsPage() {
  const getIcon = useIcon();
  const addToast = useToastStore((st) => st.addToast);

  const graphicsInfo = useToolInfoModal('vault_graphics_tools_info_seen');

  const askCapabilityInfo = useToolInfoModal('vault_ask_graphics_capability_seen');

  // 'start' is the "What do you want to do?" view (not a tool); every other value is a tool id from MODES.
  const [mode, setMode] = useState('start');
  // The job picked on the start view, while the person works through its steps (see graphics/goals.mjs).
  const [goal, setGoal] = useState(null);

  // Tools are loaded the first time they are opened and then kept (hidden when not showing), so each keeps its settings and result
  // while you move between tools.
  const [visited, setVisited] = useState(() => new Set());
  useEffect(() => { setVisited((v) => (v.has(mode) ? v : new Set(v).add(mode))); }, [mode]);
  // An image handed from one tool to another (Use in…, or an Ask Graphics step): { mode, src, prompt, nonce }. The target tool takes it.
  const [handoff, setHandoff] = useState(null);
  const handoffNonce = useRef(0);
  // Tools that can show a finished result to Ask Graphics register a reader here, by tool id.
  const resultGetters = useRef({});
  const registerResult = useCallback((id, fn) => { resultGetters.current[id] = fn; }, []);

  const [compareOn, setCompareOn] = useState(false);

  const [openGroup, setOpenGroup] = useState('Create');

  const [toolSearch, setToolSearch] = useState('');

  const toolSearchRef = useRef(null);

  const [brandKitOpen, setBrandKitOpen] = useState(false);

  const [brandKit, setBrandKit] = useState(null);

  // { logoDataUrl, colors: [], fontFamily } | null
  const [brandKitDraft, setBrandKitDraft] = useState({ logoDataUrl: '', colors: ['', '', ''], fontFamily: '' });

  const [brandKitSaving, setBrandKitSaving] = useState(false);

  const [status, setStatus] = useState(null);

  const [result, setResult] = useState(null);

  const [previewImage, setPreviewImage] = useState(null);

  // Tool help modal
  const [helpTool, setHelpTool] = useState(null);

  const isHostedProvider = status?.hosted || (status?.provider && status.provider !== 'local-comfyui');

  const serviceLabel = isHostedProvider
    ? `${status?.provider || 'Hosted'} ready: ${status?.model || 'model not selected'}`
    : `ComfyUI ready: ${status?.model}`;

  const statusLabel = !status
    ? 'Checking graphics provider...'
    : status.ok
      ? serviceLabel
      : `${isHostedProvider ? status?.provider || 'Graphics provider' : 'ComfyUI'} not ready`;

  useEffect(() => {
    api.get('/api/graphics/status')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => setStatus({ ok: false, hosted: true, provider: 'Graphics provider', error: 'Unable to check graphics service' }));
    api.get('/api/settings')
      .then(r => r.json())
      .then(settings => {
        const raw = settings?.graphics_brand_kit;
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          setBrandKit(parsed);
          setBrandKitDraft({
            logoDataUrl: parsed.logoDataUrl || '',
            colors: [0, 1, 2].map(i => parsed.colors?.[i] || ''),
            fontFamily: parsed.fontFamily || '',
          });
        } catch { /* ignore malformed stored value */ }
      })
      .catch(() => {});
  }, []);

  const saveBrandKit = async () => {
    setBrandKitSaving(true);
    try {
      const kit = {
        logoDataUrl: brandKitDraft.logoDataUrl || '',
        colors: brandKitDraft.colors.filter(Boolean).slice(0, 3),
        fontFamily: brandKitDraft.fontFamily.trim(),
      };
      const res = await api.post('/api/settings', { key: 'graphics_brand_kit', value: JSON.stringify(kit) });
      if (!res.ok) throw new Error('Failed to save Brand Kit');
      setBrandKit(kit);
      setBrandKitOpen(false);
    } catch (err) {
      addToast(err.message || 'Failed to save Brand Kit', 'error');
    } finally {
      setBrandKitSaving(false);
    }
  };

  const clearBrandKit = async () => {
    setBrandKitSaving(true);
    try {
      await api.post('/api/settings', { key: 'graphics_brand_kit', value: '' });
      setBrandKit(null);
      setBrandKitDraft({ logoDataUrl: '', colors: ['', '', ''], fontFamily: '' });
    } catch { /* best-effort */ } finally {
      setBrandKitSaving(false);
    }
  };

  useEffect(() => { setCompareOn(false); }, [mode]);

  // Global keyboard shortcuts: "/" focuses tool search, Esc closes the preview / clears search.
  // (Undo / redo in Annotate and Redact is handled inside those tools.)
  useEffect(() => {
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing) {
        e.preventDefault();
        toolSearchRef.current?.focus();
        return;
      }
      if (e.key === 'Escape') {
        if (previewImage) setPreviewImage(null);
        else if (typing && el === toolSearchRef.current) setToolSearch('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewImage]);

  // Tools an edited image can be handed straight to, without re-uploading.
  const SEND_TARGETS = [
    { mode: 'cropresize', label: 'Crop / Resize' },
    { mode: 'extend', label: 'Canvas Extend' },
    { mode: 'annotate', label: 'Annotate' },
    { mode: 'effects', label: 'Effects' },
    { mode: 'adjust', label: 'Adjust' },
    { mode: 'watermark', label: 'Watermark' },
    { mode: 'textoverlay', label: 'Text Overlay' },
    { mode: 'background', label: 'Background' },
    { mode: 'recolor', label: 'Recolour' },
    { mode: 'convert', label: 'Convert' },
    { mode: 'upscale', label: 'Upscale' },
    { mode: 'pipeline', label: 'Pipeline' },
    { mode: 'inpaint', label: 'Inpaint' },
  ];

  const HANDOFF_MODES = [...SEND_TARGETS.map((t) => t.mode), 'extract'];

  // Hand an image to another tool. The target tool picks it up from `handoff` (it may not be loaded yet).
  const sendImageTo = (targetMode, dataUrl, name = 'image.png', prompt = '') => {
    if (!dataUrl || !HANDOFF_MODES.includes(targetMode)) return;
    handoffNonce.current += 1;
    setHandoff({ mode: targetMode, src: { imageDataUrl: dataUrl, name }, prompt, nonce: handoffNonce.current });
    setCompareOn(false);
    setMode(targetMode);
  };

  // Ask Graphics (plan checklist) hands a manual/mask step off here — same hand-off every result panel uses,
  // plus the drafted prompt for tools that have one (inpaint).
  const openPlanStepInMode = (targetMode, dataUrl, prefillPrompt) => {
    sendImageTo(targetMode, dataUrl, 'ask-graphics.png', prefillPrompt || '');
  };

  // Lets Ask Graphics pull a finished result back out of whichever manual/masked mode it sent
  // the user to (inpaint, extract) — otherwise a plan step completed by hand has no way to feed
  // its output into the next step, and the checklist stalls after step 1.
  const getModeResultImage = (modeId) => resultGetters.current[modeId]?.() || null;

  // Compact "Use result in…" dropdown shown in a result header.
  const renderSendTo = (dataUrl, name, excludeMode) => (
    <Tooltip text="Continue editing this result in another tool"><select
      value=""
      onChange={(e) => { if (e.target.value) sendImageTo(e.target.value, dataUrl, name); e.target.value = ''; }}
      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70 cursor-pointer"
      style={{ color: 'var(--color-primary)', borderColor: 'var(--color-border)', background: 'transparent' }}
    >
      <option value="">Use in…</option>
      {SEND_TARGETS.filter(t => t.mode !== excludeMode).map(t => (
        <option key={t.mode} value={t.mode}>{t.label}</option>
      ))}
    </select></Tooltip>
  );

  // Compare toggle for a result header (only meaningful with both images).
  const renderCompareToggle = (hasSource, hasResult) => {
    if (!hasSource || !hasResult) return null;
    return (
      <Tooltip text="Drag a slider to compare the original and edited image side by side."><button
        type="button"
        onClick={() => setCompareOn(v => !v)}
        className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
        style={{ color: compareOn ? '#fff' : 'var(--color-primary)', background: compareOn ? 'var(--color-primary)' : 'transparent', borderColor: 'var(--color-border)' }}
      >
        {compareOn ? 'Result' : 'Compare'}
      </button></Tooltip>
    );
  };

  // Result media: a before/after slider when Compare is on, otherwise the
  // clickable result image (with optional transparency checkerboard).
  const renderResultMedia = (source, result, { transparent = false, alt = 'result' } = {}) => {
    if (compareOn && source && result?.imageDataUrl) {
      return <BeforeAfter before={source} after={result.imageDataUrl} transparent={transparent} />;
    }
    const checker = transparent ? {
      backgroundColor: '#fff',
      backgroundImage: 'linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)',
      backgroundSize: '16px 16px',
      backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
    } : {};
    return (
      <button type="button" onClick={() => setPreviewImage(result)} className="block w-full rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', ...checker }}>
        <img src={result.imageDataUrl} alt={alt} className="w-full" />
      </button>
    );
  };

  // The guide's "Open <tool>" buttons: open the tool's group and the tool, exactly as clicking it in the list would.
  const openToolById = (id) => {
    const group = MODE_GROUPS.find(g => g.ids.includes(id));
    if (!group) return;
    setOpenGroup(group.label);
    setMode(id);
  };

  const labelFor = (id) => MODES.find((m) => m.id === id)?.label || id;
  const startGoal = (g) => { setGoal(g); openToolById(g.steps[0].tool); };
  const backToStart = () => { setGoal(null); setMode('start'); };

  const ctx = {
    compareOn, setCompareOn, brandKit, status, result, setResult, previewImage, setPreviewImage, setHelpTool, setMode,
    renderSendTo, renderCompareToggle, renderResultMedia, handoff, registerResult,
  };

  const renderTools = () => MODES.map(({ id }) => {
    const Tool = TOOL_COMPONENTS[id];
    if (!Tool || !(visited.has(id) || mode === id)) return null;
    return (
      <div key={id} hidden={mode !== id}>
        <Suspense fallback={<p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>}>
          <Tool active={mode === id} />
        </Suspense>
      </div>
    );
  });

  return (
    <GraphicsContext.Provider value={ctx}>
      <div>
            <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
              {/* ── Sidebar ───────────────────────────────────────────────────── */}
              <aside
                className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
                    {getIcon('image', { size: 16 })}
                  </div>
                  <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Graphics</h1>
                  <button
                    onClick={graphicsInfo.open}
                    title="How Graphics works"
                    style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
                  >
                    {getIcon('info', { size: 13 })}
                  </button>
                  <button
                    onClick={askCapabilityInfo.open}
                    title="What Ask Graphics can actually do"
                    style={{ color: '#b45309', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
                    className="hover:opacity-70"
                  >
                    {getIcon('alert-triangle', { size: 13 })}
                  </button>
                </div>
                {askCapabilityInfo.show && (
                  <ToolInfoModal title="What Ask Graphics Can Actually Do" onClose={askCapabilityInfo.close}>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                      The text box takes literally anything you type — that's a feature of typing, not a promise about what happens next. Ask Graphics only ever plans against a fixed, narrow list of real operations. It doesn't get smarter or more capable just because a request sounds reasonable.
                    </p>
                    <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                      <p style={{ color: 'var(--color-text)' }}><strong>What it can actually run:</strong> Adjust (brightness/contrast/saturation/temperature/vignette), Color Grading (named preset), Background (remove or flat-colour replace), Recolor (swap one exact colour for another, everywhere it appears), Canvas Extend (padding), and Augment (whole-image prompt-driven regeneration — weather, mood, colourizing a black-and-white photo, style shifts).</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>What it can open for you, but not run automatically:</strong> Inpaint (paint a mask, describe the fill/replacement) and Extract Element (paint a mask, isolate it). These always need you to paint the region by hand.</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>What it can't do at all:</strong> anything outside that list — no video, no multi-image composites, no text-in-image editing, none of the other ~30 modes elsewhere in Graphics (Perspective Correct, Smart Crop, Watermark, SVG, Icon Library, etc.) are plannable here, even though they exist in the sidebar.</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Where it genuinely struggles even within scope:</strong> inserting a new, specific person or object so it photorealistically matches an existing photo's lighting, grain, and era — that's a hard compositing problem for any AI image model, commercial or otherwise, and usually takes several manual paint-and-regenerate passes in Inpaint, not one request.</p>
                    </div>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                      If a request doesn't map to the list above, the planner is supposed to say so rather than force it onto the wrong tool — if it ever silently does something unrelated instead, that's a bug, tell me.
                    </p>
                  </ToolInfoModal>
                )}
                {graphicsInfo.show && (
                  <ToolInfoModal title="How Graphics Works" onClose={graphicsInfo.close}>
                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>
                      Over 40 tools across seven groups in the list on the left — this covers the full lifecycle, not just "generate a picture". Hover over any group or tool for a plain explanation. Not sure which tool to use? Click the graduation-cap button at the bottom right and tell the guide what you want to do:
                    </p>
                    <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                      <p style={{ color: 'var(--color-text)' }}><strong>Create</strong> — Generate makes a new image from a prompt via your admin-configured model, swappable workspace-wide. Animate turns one into a GIF.</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Retouch</strong> — real masked editing, not just full re-rolls: <strong>Inpaint/Remove</strong> paints an area (brush or magic-wand select) and describes what should replace it; <strong>Background</strong> removes/replaces with AI precision; <strong>Extract Element</strong> isolates a painted region as a transparent PNG; <strong>Recolor</strong> and <strong>Eraser</strong> handle targeted color/pixel changes; <strong>Redact</strong> blurs or pixelates faces, plates, or sensitive text.</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Transform</strong> — Crop/Resize, Canvas Extend (pad outward), Perspective Correct, and Smart Crop (content-aware — attention, entropy, or a fixed direction, not a naive center-crop).</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Enhance</strong> — Effects, Adjust, Color Grading, and Pipeline (chain multiple enhance steps into one repeatable pass).</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Compose</strong> — Annotate, Watermark, Text Overlay, Composite, Batch Text, Collage, Favicon/Icons (full manifest from one image), SVG (vectorize — 3 detail presets, 2–64 color control), and AI Icon Library (one cohesive themed set in a single pass).</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Optimise</strong> — Upscale is fidelity-first with a Replicate model and a creativity dial, not a blunt resize. Plus Convert, Compress, Batch, Export for Social (every platform's crop bundled as one ZIP), PDF→Images, Print Ready, Auto-enhance — all deterministic, no AI cost, safe to re-run.</p>
                      <p style={{ color: 'var(--color-text)' }}><strong>Analyse</strong> — Picker, Histogram, Contrast (WCAG), Palette, Extract Text (OCR), Blur Detection, Image Diff, Remove Meta, File Info.</p>
                    </div>
                  </ToolInfoModal>
                )}

                <Tooltip text="Go back to the list of jobs (post on social, prepare for print, clean up before sharing and so on).">
                  <button
                    type="button"
                    onClick={backToStart}
                    className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                    style={{
                      borderColor: mode === 'start' ? 'var(--color-primary)' : 'var(--color-border)',
                      color: mode === 'start' ? 'var(--color-primary)' : 'var(--color-text)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    {getIcon('layout-grid', { size: 13 })}
                    What do you want to do?
                  </button>
                </Tooltip>

                <Tooltip text="Save a logo, up to 3 brand colours and a font name once, then reuse them in Text Overlay, Composite and Watermark.">
                  <button
                    type="button"
                    onClick={() => setBrandKitOpen(true)}
                    className="w-full flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
                  >
                    {getIcon('briefcase', { size: 13 })}
                    Brand Kit{brandKit ? ' (saved)' : ''}
                  </button>
                </Tooltip>

                <Tooltip text="Filter the tool list below by name or description. Press / to jump here.">
                  <input
                    ref={toolSearchRef}
                    type="text"
                    value={toolSearch}
                    onChange={e => setToolSearch(e.target.value)}
                    placeholder="Search tools…"
                    className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </Tooltip>

                {MODE_GROUPS.map(group => {
                  const q = toolSearch.trim().toLowerCase();
                  const ids = group.ids.filter(id => {
                    const m = MODES.find(x => x.id === id);
                    return m && (!q || m.label.toLowerCase().includes(q) || (TOOL_TIPS[id] || '').toLowerCase().includes(q));
                  });
                  if (!ids.length) return null;
                  const open = openGroup === group.label;
                  return (
                    <div key={group.label}>
                      <Tooltip text={GROUP_TIPS[group.label]} side="right">
                        <button
                          type="button"
                          onClick={() => setOpenGroup(prev => (prev === group.label ? null : group.label))}
                          className="text-xs font-semibold w-full text-left py-1 transition-opacity hover:opacity-70"
                          style={{ color: 'var(--color-primary)' }}
                        >
                          {open ? '▼' : '▶'} {group.label}
                        </button>
                      </Tooltip>
                      {(open || q) && (
                        <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                          {ids.map(id => {
                            const m = MODES.find(x => x.id === id);
                            return (
                              <li key={id}>
                                <Tooltip text={TOOL_TIPS[id] || m.label} side="right">
                                  <button
                                    type="button"
                                    onClick={() => setMode(id)}
                                    className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                                    style={{
                                      background: mode === id ? 'var(--color-bg)' : 'transparent',
                                      color: mode === id ? 'var(--color-text)' : 'var(--color-muted)',
                                    }}
                                  >
                                    {m.label}
                                  </button>
                                </Tooltip>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })}
                {toolSearch.trim() && !MODES.some(m => m.label.toLowerCase().includes(toolSearch.trim().toLowerCase()) || (TOOL_TIPS[m.id] || '').toLowerCase().includes(toolSearch.trim().toLowerCase())) && (
                  <p className="px-2 text-xs" style={{ color: 'var(--color-muted)' }}>No tools match “{toolSearch}”.</p>
                )}
              </aside>

              {/* ── Main panel ────────────────────────────────────────────────── */}
              <main className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4 max-w-5xl">
                <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-sm min-w-0 flex-1" style={{ color: 'var(--color-muted)' }}>
                  {mode === 'generate' && 'Generate local article and story support images from a prompt.'}
                  {mode === 'upscale' && 'Enlarge artwork and small images while preserving detail.'}
                  {mode === 'convert' && 'Convert an image to PNG, JPG, WebP, GIF, AVIF, TIFF or ICO (HEIC input supported where available).'}
                  {mode === 'favicon' && 'Generate a full favicon / app-icon set with manifest from one image.'}
                  {mode === 'exportsocial' && 'Crop one image to every platform size you need, bundled as a ZIP.'}
                  {mode === 'svg' && 'Trace a raster image into a scalable SVG — best for logos, icons and clipart.'}
                  {mode === 'iconlib' && 'Generate a cohesive set of custom SVG icons from a subject and reference styles.'}
                  {mode === 'compress' && 'Reduce image file sizes and see the savings.'}
                  {mode === 'batch' && 'Convert, resize or strip metadata across many images at once.'}
                  {mode === 'background' && 'Remove or replace an image background with one click.'}
                  {mode === 'recolor' && 'Change the colour of a specific item in an image.'}
                  {mode === 'cropresize' && 'Resize by dimensions, or drag the box to crop exactly what you want.'}
                  {mode === 'metadata' && 'Strip GPS, camera and timestamp metadata before sharing.'}
                  {mode === 'watermark' && 'Add a text or image watermark.'}
                  {mode === 'textoverlay' && 'Add wrapped headline or caption text, with an optional background pill and outline.'}
                  {mode === 'composite' && 'Stack multiple text and logo layers onto a base image in one pass.'}
                  {mode === 'collage' && 'Arrange several images into a grid.'}
                  {mode === 'extend' && 'Add padding around the image (white, a colour, or transparent).'}
                  {mode === 'annotate' && 'Click to type text right on the image, draw arrows/boxes/freehand, move anything, then save a PNG.'}
                  {mode === 'effects' && 'Flip, rotate (90° or any angle), border, round corners, shadow, or a filter (grayscale, sepia, invert, duotone).'}
                  {mode === 'adjust' && 'Tune brightness, contrast, colour, levels, gamma, sharpness, blur, noise reduction and vignette.'}
                  {mode === 'redact' && 'Draw boxes to blur or pixelate faces, plates or sensitive text.'}
                  {mode === 'ocr' && 'Extract text from screenshots, scans and receipts.'}
                  {mode === 'palette' && 'Pull the dominant colours out of an image.'}
                  {mode === 'diff' && 'Highlight the pixel differences between two images.'}
                  {mode === 'picker' && 'Click anywhere on an image to read its colour.'}
                  {mode === 'histogram' && 'See the tonal distribution (RGB and luminance) of an image.'}
                  {mode === 'contrast' && 'Check colour contrast against WCAG AA / AAA thresholds.'}
                  {mode === 'animate' && 'Combine several images into an animated GIF.'}
                  {mode === 'pdf2img' && 'Render each page of a PDF to a PNG image.'}
                  {mode === 'printready' && 'Convert any image to a print-ready file at 150, 300, or 600 DPI — TIFF, PDF, or PNG output with optional bleed.'}
                  {mode === 'pipeline' && 'Chain several edits into one repeatable sequence.'}
                  {mode === 'inpaint' && 'Paint over an area and let AI fill or replace it.'}
                  {mode === 'eraser' && 'Paint over parts of an image to erase them to transparency.'}
                  {mode === 'extract' && 'Paint a mask over an element to isolate it as a transparent PNG.'}
                  {mode === 'perspective' && 'Correct keystone / trapezoid distortion with horizontal and vertical shear sliders.'}
                  {mode === 'smartcrop' && 'Crop to a target size or aspect ratio, with content-aware focus (attention, entropy, or a fixed direction).'}
                  {mode === 'colorgrade' && 'Apply a cinematic colour grade — warm, cool, vintage, fade, noir, and more — in one click.'}
                  {mode === 'batchtext' && 'Stamp a text label (with {filename}, {index}, {date} variables) onto many images at once.'}
                </p>
              {(mode === 'generate' || mode === 'upscale') && (
                <div
                  className="text-xs px-3 py-1.5 rounded-full border"
                  style={{
                    color: status?.ok ? '#047857' : '#b45309',
                    borderColor: status?.ok ? '#bbf7d0' : '#fde68a',
                    background: status?.ok ? '#ecfdf5' : '#fffbeb',
                  }}
                >
                  {statusLabel}
                </div>
              )}
                </div>

            <GraphicsAskPanel onOpenInModeWithPrompt={openPlanStepInMode} getModeResultImage={getModeResultImage} currentMode={mode} />


            {mode === 'start' && <GoalStart onPick={startGoal} labelFor={labelFor} />}
            <GoalBar goal={goal} mode={mode} onStep={openToolById} onLeave={backToStart} labelFor={labelFor} />

            {renderTools()}

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

      

              </main>
            </div>

      

            {previewImage?.imageDataUrl && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
                style={{ background: 'rgba(0,0,0,0.72)' }}
                onClick={() => setPreviewImage(null)}
              >
                <div
                  className="w-full max-w-4xl max-h-full rounded-2xl border overflow-hidden shadow-xl"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="px-4 py-3 border-b flex items-center justify-between gap-3" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                        Generated image
                      </h2>
                      <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
                        Seed: {previewImage.seed || 'n/a'} · Model: {previewImage.model || 'local image'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setPreviewImage(null)}
                      className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70"
                      style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}
                    >
                      Close
                    </button>
                  </div>
                  <div className="p-4 overflow-auto max-h-[80vh]">
                    <img
                      src={previewImage.imageDataUrl}
                      alt={previewImage.refinedPrompt || previewImage.prompt}
                      className="w-full rounded-xl border"
                      style={{ borderColor: 'var(--color-border)' }}
                    />
                    <p className="text-xs mt-3 whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>
                      {previewImage.refinedPrompt || previewImage.prompt}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {brandKitOpen && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center px-4"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                onClick={() => setBrandKitOpen(false)}
              >
                <div
                  className="w-full max-w-md rounded-2xl border shadow-xl overflow-hidden"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="px-5 py-4 border-b flex items-start justify-between gap-4" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Brand Kit</h2>
                      <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Save a logo, colours and a font once — reuse them across Text Overlay, Composite and Watermark.</p>
                    </div>
                    <button type="button" onClick={() => setBrandKitOpen(false)} className="flex-shrink-0 hover:opacity-60 mt-0.5" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button>
                  </div>
                  <div className="px-5 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Logo</label>
                      <Tooltip text="Upload a logo image to reuse as a quick-add layer in Composite.">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async e => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            const dataUrl = await readFileAsDataUrl(file);
                            setBrandKitDraft(d => ({ ...d, logoDataUrl: dataUrl }));
                          }}
                          className="block w-full text-xs"
                          style={{ color: 'var(--color-text)' }}
                        />
                      </Tooltip>
                      {brandKitDraft.logoDataUrl && (
                        <div className="mt-2 rounded-xl border p-2 flex items-center justify-between gap-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                          <img src={brandKitDraft.logoDataUrl} alt="logo" className="max-h-16 rounded" />
                          <Tooltip text="Remove the saved logo."><button type="button" onClick={() => setBrandKitDraft(d => ({ ...d, logoDataUrl: '' }))} className="text-xs hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Remove</button></Tooltip>
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Brand colours (up to 3)</label>
                      <div className="flex items-center gap-2">
                        {[0, 1, 2].map(i => (
                          <Tooltip key={i} text={`Brand colour ${i + 1}.`}>
                            <input
                              type="color"
                              value={brandKitDraft.colors[i] || '#888888'}
                              onChange={e => setBrandKitDraft(d => ({ ...d, colors: d.colors.map((c, ci) => (ci === i ? e.target.value : c)) }))}
                              className="h-9 w-12 rounded border"
                              style={{ borderColor: 'var(--color-border)', background: 'transparent' }}
                            />
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Font family</label>
                      <Tooltip text="Type the font family name used in your brand (e.g. a Google Font already used in Text Overlay/Annotate). Plain text only — no preview.">
                        <input
                          type="text"
                          value={brandKitDraft.fontFamily}
                          onChange={e => setBrandKitDraft(d => ({ ...d, fontFamily: e.target.value }))}
                          placeholder="e.g. Montserrat"
                          className="w-full px-3 py-2 rounded-lg border text-sm outline-none"
                          style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                        />
                      </Tooltip>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <Tooltip text="Clear the saved Brand Kit."><button type="button" onClick={clearBrandKit} disabled={brandKitSaving || !brandKit} className="text-xs hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-muted)' }}>Clear</button></Tooltip>
                      <Tooltip text="Save this Brand Kit for reuse across tools.">
                        <button type="button" onClick={saveBrandKit} disabled={brandKitSaving} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90" style={{ background: 'var(--color-primary)' }}>
                          {brandKitSaving ? 'Saving…' : 'Save Brand Kit'}
                        </button>
                      </Tooltip>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <GraphicsTutorChat currentTool={mode} onOpenTool={openToolById} />

            {helpTool && TOOL_HELP[helpTool] && (
              <div
                className="fixed inset-0 z-50 flex items-center justify-center px-4"
                style={{ background: 'rgba(0,0,0,0.55)' }}
                onClick={() => setHelpTool(null)}
              >
                <div
                  className="w-full max-w-md rounded-2xl border shadow-xl overflow-hidden"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                  onClick={e => e.stopPropagation()}
                >
                  <div className="px-5 py-4 border-b flex items-start justify-between gap-4" style={{ borderColor: 'var(--color-border)' }}>
                    <div>
                      <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{TOOL_HELP[helpTool].title}</h2>
                      <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{TOOL_HELP[helpTool].what}</p>
                    </div>
                    <button type="button" onClick={() => setHelpTool(null)} className="flex-shrink-0 hover:opacity-60 mt-0.5" style={{ color: 'var(--color-muted)' }}>{getIcon('x', { size: 16 })}</button>
                  </div>
                  <ul className="px-5 py-4 space-y-2 max-h-96 overflow-y-auto">
                    {TOOL_HELP[helpTool].features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                        <span className="mt-1.5 flex-shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
    </GraphicsContext.Provider>
  );
}
