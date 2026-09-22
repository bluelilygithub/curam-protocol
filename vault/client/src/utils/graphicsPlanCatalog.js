// Single source of truth for what "Ask Graphics" (the NL/voice intake bar) can plan against.
// Sent to the server with every plan-request call — the server never hardcodes its own copy of
// this list, so a mode's real param ranges/requiresMask flag can't drift out of sync the way the
// info modals did (see the info-modal audit this same session). Add a mode here when it should
// be plannable; leave it out and it simply never appears as a step.
//
// requiresMask: true means the mode needs a painted/selected region — the plan always flags
// these as manual (open the real mode, prefilled), never auto-run, regardless of what the model
// says. Eraser and Redact aren't included at all — they're browser-only canvas tools with no
// server route (see server/routes/graphics/retouch.js), so there's nothing a plan step could
// call even if it wanted to.

export const GRAPHICS_PLAN_CATALOG = [
  {
    id: 'adjust',
    label: 'Adjust',
    description: 'Brightness, contrast, saturation, colour temperature, vignette.',
    endpoint: '/api/graphics/adjust',
    requiresMask: false,
    paramSchema: {
      brightness: { type: 'float', min: 0.3, max: 2, default: 1, note: '1 = unchanged, <1 darker, >1 lighter' },
      contrast: { type: 'float', min: 0.3, max: 2, default: 1, note: '1 = unchanged' },
      saturation: { type: 'float', min: 0, max: 2, default: 1, note: '1 = unchanged, 0 = greyscale' },
      temperature: { type: 'int', min: -100, max: 100, default: 0, note: 'negative = cooler/blue, positive = warmer/orange' },
      vignette: { type: 'int', min: 0, max: 100, default: 0 },
    },
  },
  {
    id: 'colorgrade',
    label: 'Color Grading',
    description: 'Apply a named cinematic look to the whole image.',
    endpoint: '/api/graphics/colorgrade',
    requiresMask: false,
    paramSchema: {
      preset: { type: 'enum', values: ['warm', 'cool', 'cinematic', 'vintage', 'fade', 'matte', 'vivid', 'noir', 'golden', 'teal_orange'], default: 'warm' },
    },
  },
  {
    id: 'background',
    label: 'Background',
    description: 'Remove the background, or replace it with a solid colour.',
    endpoint: '/api/graphics/background',
    requiresMask: false,
    paramSchema: {
      background: { type: 'hexcolor-or-transparent', default: 'transparent', note: '"transparent" to remove, or a hex colour like #1e3a8a to replace with a solid fill' },
    },
  },
  {
    id: 'recolor',
    label: 'Recolor',
    description: 'Change every pixel of one specific colour to another colour.',
    endpoint: '/api/graphics/recolor',
    requiresMask: false,
    paramSchema: {
      sourceColor: { type: 'hexcolor', note: 'the colour to change, as a hex value' },
      targetColor: { type: 'hexcolor', note: 'the colour to change it to' },
      tolerance: { type: 'int', min: 0, max: 100, default: 20, note: 'how close a pixel must be to sourceColor to count' },
    },
  },
  {
    id: 'extend',
    label: 'Canvas Extend',
    description: 'Add padding around the image on any side.',
    endpoint: '/api/graphics/extend',
    requiresMask: false,
    paramSchema: {
      top: { type: 'int', min: 0, max: 2000, default: 0 },
      right: { type: 'int', min: 0, max: 2000, default: 0 },
      bottom: { type: 'int', min: 0, max: 2000, default: 0 },
      left: { type: 'int', min: 0, max: 2000, default: 0 },
      background: { type: 'hexcolor', default: '#ffffff' },
      transparent: { type: 'bool', default: false },
    },
  },
  {
    id: 'inpaint',
    label: 'Inpaint / Remove',
    description: 'Paint over a specific area (a person\'s shirt, an object, a blemish) and describe what should replace it.',
    endpoint: null,
    requiresMask: true,
    paramSchema: {
      prompt: { type: 'string', note: 'what should fill the painted area' },
    },
  },
  {
    id: 'extract',
    label: 'Extract Element',
    description: 'Paint over one element to isolate it as a transparent PNG.',
    endpoint: null,
    requiresMask: true,
    paramSchema: {},
  },
];

export function findPlanMode(id) {
  return GRAPHICS_PLAN_CATALOG.find((m) => m.id === id) || null;
}
