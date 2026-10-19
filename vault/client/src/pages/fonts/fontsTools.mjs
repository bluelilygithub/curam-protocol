// What the Font Customizer page shows in its left-hand list, the hover text for it, and the controls its guide (the round button) can
// point at. The ids are the guide's catalogue (server/services/fontsTutor.js); npm run test:fonts-tutor fails if the two lists drift
// apart. `tool` is the tool the guide's Open button switches to. `needsFont` tools show "Load a font first" until a font is loaded.

export const FONT_TOOLS = [
  { id: 'font', label: 'Choose a font', group: 'Choose', icon: 'type', tour: 'fonts-tool-font' },
  { id: 'my-fonts', label: 'My Fonts', group: 'Choose', icon: 'folder-open', tour: 'fonts-tool-my-fonts' },
  { id: 'shape', label: 'Shape', group: 'Change', icon: 'sliders', needsFont: true, tour: 'fonts-tool-shape' },
  { id: 'kerning', label: 'Kerning', group: 'Change', icon: 'text', needsFont: true, tour: 'fonts-tool-kerning' },
  { id: 'effect', label: 'Text effect', group: 'Change', icon: 'sparkles', needsFont: true, tour: 'fonts-tool-effect' },
  { id: 'save', label: 'Save this font', group: 'Keep', icon: 'save', needsFont: true, tour: 'fonts-tool-save' },
  { id: 'settings', label: 'Saved settings', group: 'Keep', icon: 'archive', needsFont: true, tour: 'fonts-tool-settings' },
  { id: 'download', label: 'Download', group: 'Keep', icon: 'download', needsFont: true, tour: 'fonts-tool-download' },
];

export const GROUPS = ['Choose', 'Change', 'Keep'];

export const GROUP_TIPS = {
  Choose: 'Pick the Google Font to start from, or reopen one you saved earlier.',
  Change: 'Reshape the letters, tune the spacing between them, or try a text effect on the preview.',
  Keep: 'Save your work to come back to, keep settings to reuse on other fonts, or download the finished font.',
};

export const TOOL_TIPS = {
  font: 'Search Google Fonts (open-licence only) and load one. Variable fonts are turned into a fixed one before editing.',
  'my-fonts': 'The fonts you have saved. Reopening one fetches the Google Font again and puts your settings back.',
  shape: 'Make strokes thicker or thinner, the font wider or narrower, ascenders and descenders longer, and the holes in letters wider or narrower.',
  kerning: 'Tighten or loosen the space between letter pairs that are classically loose, or set one pair by hand.',
  effect: 'Try a text effect (fire, neon, emboss, outline, layered shadow) on the preview. It is not part of the downloaded font.',
  save: 'Save this font and all your settings to your account, to reopen on any device.',
  settings: 'Save your current shape and kerning settings under a name and reapply them to any font later. Kept in this browser only.',
  download: 'Give the finished font a new name and download it as .ttf, or as .ttf, .woff2 and .otf together.',
};

// One short line shown under the page title for the open tool.
export const TOOL_BLURBS = {
  font: 'Search for a Google Font and load it. Everything you change shows up in the preview.',
  'my-fonts': 'Fonts you saved earlier. Click one to carry on where you left off.',
  shape: 'Reshape the letters. The preview updates with the real changed font a moment after you stop moving a slider.',
  kerning: 'Fix loose spacing between pairs of letters.',
  effect: 'A text effect on the preview only, for fun or to show a client.',
  save: 'Keep this font and your settings in your account.',
  settings: 'Reusable shape and kerning settings, without a font.',
  download: 'Name your font and download it.',
};

// The longer text for the (i) "How the Font Customizer works" box.
export const HOW_IT_WORKS = [
  ['Choose a font', 'Search Google Fonts (only fonts with an open licence are listed). Pick one, or press Enter, then Load. A font with variable weights is turned into a fixed one before editing, which takes a few seconds.'],
  ['Change it', 'Shape makes strokes thicker or thinner, the font wider or narrower, ascenders and descenders longer, and the holes in letters wider or narrower. Kerning tightens or loosens the space between letter pairs. Every change runs for real on the server, and about a second after you stop, the preview shows the actual changed font, not an approximation.'],
  ['Preview text', 'Above the preview, three sample texts each show a specific issue (spacing, tall and tail letters, round shapes), or choose Custom to type or say your own.'],
  ['Keep it', 'Save this font stores the font and all your settings in your account, so you can reopen it on any device. Saved settings keeps just the slider values in this browser to reuse on other fonts.'],
  ['Download', 'Type a new family name (the font\'s open licence requires a changed copy to have a different name), then download .ttf, or .ttf, .woff2 and .otf together. Nothing is stored, so download before you leave. The file holds basic Latin and Western accented letters only.'],
  ['Text effects', 'Fire, neon, emboss, outline and layered shadow change how the preview looks only. They are saved with My Fonts but are not in the downloaded file.'],
];

// Everything the guide can point at: the tools plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'font', label: 'Choose a font', tool: 'font' },
  { id: 'my-fonts', label: 'My Fonts', tool: 'my-fonts' },
  { id: 'proofing-text', label: 'Preview text', tool: 'font' },
  { id: 'shape', label: 'Shape', tool: 'shape' },
  { id: 'kerning', label: 'Kerning', tool: 'kerning' },
  { id: 'effect', label: 'Text effect', tool: 'effect' },
  { id: 'save', label: 'Save this font', tool: 'save' },
  { id: 'settings', label: 'Saved settings', tool: 'settings' },
  { id: 'download', label: 'Download', tool: 'download' },
];
