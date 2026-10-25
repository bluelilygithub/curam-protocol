// The "What do you want to do?" start screen for Graphics. Each goal is DATA: a title in plain words and an
// ordered list of steps, each step naming a real tool (an id from MODES in GraphicsPage.jsx) and one line on
// what to do there. Nothing here is a hard-coded screen, so when saved recipes exist a goal can point at a
// recipe instead of a list of tools and the tiles keep working.
//
//   node client/src/pages/graphics/goals.test.mjs   (checks every step names a real tool)

export const GOALS = [
  {
    id: 'social',
    title: 'Post on social media',
    blurb: 'Add a headline and your logo, then get every platform size.',
    icon: 'share-2',
    steps: [
      { tool: 'textoverlay', note: 'Add your headline or caption.' },
      { tool: 'watermark', note: 'Put your logo or name on the picture.' },
      { tool: 'exportsocial', note: 'Download every platform size as one ZIP.' },
    ],
  },
  {
    id: 'website',
    title: 'Get a picture ready for a website',
    blurb: 'Right size, small file, modern format.',
    icon: 'globe',
    steps: [
      { tool: 'cropresize', note: 'Set the width and height the page needs.' },
      { tool: 'compress', note: 'Shrink the file so the page loads fast.' },
      { tool: 'convert', note: 'Switch to WebP or AVIF if you want the smallest file.' },
      { tool: 'alttext', note: 'Get alt text and a descriptive file name for each picture.' },
    ],
  },
  {
    id: 'product',
    title: 'Make product photos',
    blurb: 'Clean background, even framing, balanced light.',
    icon: 'image',
    steps: [
      { tool: 'background', note: 'Cut the product out and choose a plain backdrop.' },
      { tool: 'smartcrop', note: 'Crop every photo to the same frame.' },
      { tool: 'autoenhance', note: 'Even out brightness and colour in one click.' },
    ],
  },
  {
    id: 'print',
    title: 'Prepare something for print',
    blurb: 'Enough resolution, bleed and the right file type.',
    icon: 'printer',
    steps: [
      { tool: 'upscale', note: 'Add resolution if the picture is small.' },
      { tool: 'printready', note: 'Choose the print size, bleed and file type.' },
    ],
  },
  {
    id: 'privacy',
    title: 'Clean up before sharing',
    blurb: 'Hide faces and private details, remove hidden data.',
    icon: 'shield-check',
    steps: [
      { tool: 'redact', note: 'Blur or pixelate faces, plates or private text.' },
      { tool: 'metadata', note: 'Remove location, camera and date details.' },
    ],
  },
  {
    id: 'fix',
    title: 'Fix up a photo',
    blurb: 'Check it is sharp, then improve light and colour.',
    icon: 'wand',
    steps: [
      { tool: 'blurdetect', note: 'See whether the photo is sharp enough to use.' },
      { tool: 'autoenhance', note: 'Correct brightness, contrast and colour.' },
      { tool: 'adjust', note: 'Fine-tune anything still not right.' },
    ],
  },
  {
    id: 'create',
    title: 'Create a new picture',
    blurb: 'Describe it, then enlarge it for use.',
    icon: 'sparkles',
    steps: [
      { tool: 'generate', note: 'Describe the picture you want.' },
      { tool: 'upscale', note: 'Enlarge it if you need more detail or size.' },
    ],
  },
  {
    id: 'logo',
    title: 'Make a logo or icon set',
    blurb: 'Cut it out, turn it into a scalable file, build the icon pack.',
    icon: 'palette',
    steps: [
      { tool: 'background', note: 'Remove the background from your logo.' },
      { tool: 'svg', note: 'Trace it into a scalable SVG.' },
      { tool: 'favicon', note: 'Make the website icon pack from it.' },
    ],
  },
];

/** The goal that owns `toolId` as a step, if the person is part-way through `goal`. */
export function stepIndex(goal, toolId) {
  return goal ? goal.steps.findIndex((s) => s.tool === toolId) : -1;
}
