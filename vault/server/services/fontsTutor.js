'use strict';

// The Font Customizer guide (the round button on Vault's /fonts page): a person says what they want ("make a bolder version of Roboto",
// "tighten the spacing", "download it for my website") and the guide points at the real tools and controls, in order, or says plainly
// that the Font Customizer does not do it. It only knows what is written here and it never sees any font or preview. Built on
// guideCore.js; the ids are the page's own, listed in client/src/pages/fonts/fontsTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'font', label: 'Choose a font', group: 'Choose',
    does: 'Type a few letters of a Google Font name (or tap the microphone and say it), pick a match from the list, where each name is drawn in its own style, or press Enter, then press Load. Only fonts with an open (OFL) licence are listed. A font with variable weights is turned into one fixed version before editing. Loading takes a few seconds. When it has loaded the page moves on to Shape.',
    notes: 'Google Fonts only: you cannot upload your own font. Fonts without an open licence are not offered.' },
  { id: 'my-fonts', label: 'My Fonts', group: 'Choose',
    does: 'The fonts you saved earlier. Click one to carry on where you left off: it fetches the Google Font again and puts your settings back. The bin beside a font deletes it from your list.',
    notes: 'What is saved is the font name and your settings, not a font file. It is kept in your account, so it works on any device.' },
  { id: 'proofing-text', label: 'Preview text', group: 'Choose',
    does: 'Above the preview, three sample texts each show a specific issue: Kerning / Spacing, Ascenders / Descenders, and Counters / Stems. Custom lets you type or say your own text to see in the font.',
    notes: 'It appears once a font is loaded. It changes what the preview shows, not the font.' },
  { id: 'shape', label: 'Shape', group: 'Change',
    does: 'Four sliders reshape the letters: Stem Thickness (thicker or thinner strokes), Proportional Width (a wider or narrower cut), Extend Ascenders/Descenders (taller b, d and h, longer tails on g, y and p) and Counter Width (open up or close the holes in o, e, a and g). Reset transforms puts them back. About a second after you stop moving a slider, the preview shows the real changed font.',
    notes: 'The change is made for real on the server, not drawn as an approximation. Extreme settings can distort letters. Needs a font loaded first.' },
  { id: 'kerning', label: 'Kerning', group: 'Change',
    does: 'Visual Balance & Rhythm tightens (negative) or loosens (positive) the spacing of letter pairs in the groups you tick, such as diagonal capitals like AV and AW. Advanced Pairs below lets you type two letters, such as AV, and set that one pair in pixels.',
    notes: 'Only the ticked groups are affected by the slider. Needs a font loaded first.' },
  { id: 'effect', label: 'Text effect', group: 'Change',
    does: 'A drop-down of text effects on the preview: None, Fire, Neon, Emboss, Outline and Shadow Multiple.',
    notes: 'Preview only: the effect is not in the downloaded font. It is saved with My Fonts, so it comes back when you reopen the font. Needs a font loaded first.' },
  { id: 'save', label: 'Save this font', group: 'Keep',
    does: 'Type a name and press Save. It stores the Google Font and all your settings (shape, kerning and effect) in your account, and it then shows in My Fonts. If you reopened a saved font and keep its name, the button says Update and changes that one; change the name to save a copy.',
    notes: 'It saves the font name and settings, not a font file. To get a font file, use Download.' },
  { id: 'settings', label: 'Saved settings', group: 'Keep',
    does: 'Name the current shape and kerning settings and press Save preset. Later, Apply puts them onto whatever font is loaded, and the bin deletes one.',
    notes: 'Kept in this browser only, with no font and no effect, so it does not follow you to another device. For that, use Save this font.' },
  { id: 'download', label: 'Download', group: 'Keep',
    does: 'Type a new family name (required), then press .ttf for the one file, or All formats for .ttf, .woff2 (for websites) and .otf together. It uses what the preview already shows, so nothing is changed again.',
    notes: 'A new name is required because the font\'s open licence says a changed copy must be called something different. It is disabled until a preview has appeared. The file holds basic Latin and Western accented letters only. Nothing is stored, so download before leaving the page.' },
];

const RULES = [
  'Start with Choose a font. Every other tool except My Fonts needs a font loaded first.',
  'Every change runs for real on the server, and the preview updates about a second after the last change. The preview is the actual changed font, not an approximation.',
  'The download is always a renamed copy: a genuinely new family name is required.',
  'The downloaded font is one fixed version of the chosen font (variable fonts are fixed before editing), with basic Latin and Western accented letters only.',
  'Text effects only change how the preview looks. They are not in the downloaded font.',
  'Save this font keeps the font name and settings in the account; Saved settings keeps only the slider values, in this browser.',
  'The Open buttons in this chat only switch to a tool; they never load, change or download anything by themselves.',
];

const NOT_POSSIBLE = [
  'Uploading your own font file, or using a font that is not a Google Font with an open (OFL) licence.',
  'Other alphabets in the downloaded file (Greek, Cyrillic, Arabic, Chinese and so on): it holds basic Latin and Western accented letters.',
  'Drawing or editing a single letter by hand, or adding new letters or symbols.',
  'Keeping a variable font\'s weight and width sliders: the result is one fixed version.',
  'Putting a text effect into the downloaded font: effects are preview only.',
  'Storing a finished font file in Vault: nothing is kept after the download, only the font name and settings of a saved font.',
  'Licence or legal advice about using a modified font commercially. The tool enforces a new name only; the person should read the font\'s licence.',
];

const SYSTEM = `You are the guide to the Font Customizer in Vault for one person who wants to start from a Google Font, reshape it, and download a renamed copy. They say, in everyday words, what they want to do. You point them to the right tool(s) and controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say the Font Customizer cannot do.
- You cannot see any font or preview. Never state or guess what a font looks like or what a setting will do to a particular font.
- Be plain and short, as to a friend who is not a type designer. Avoid jargon, or explain it in a few words.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Remember the order: choose a font first, change it, then save or download. Download needs a new family name.
- If they want a font that is not a Google Font, a non-Latin alphabet, or a hand-drawn change, say plainly it is not possible here.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Font Customizer guide', feature: 'fonts_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'FONT CUSTOMIZER TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with the font, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askFontsTutor: guide.ask,
};
