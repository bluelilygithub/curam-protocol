// `primary` + `onPrimary` are chosen so text on a primary-coloured button is 4.5:1 or better, and (for the light themes) primary as text on bg/surface too.
// `muted` is chosen to give at least 4.5:1 (WCAG AA for normal text) against both that theme's bg and surface.
export const themes = {
  'warm-sand': {
    label: 'Warm Sand',
    bg: '#F5F5F0',
    surface: '#EEEEE8',
    border: '#D8D8D0',
    primary: '#9B5B46', // was #CC785C (white on it was 3.3:1); this passes 4.5:1 for white text on it AND for it as text on bg and surface
    onPrimary: '#FFFFFF',
    text: '#1A1A1A',
    muted: '#6A6A6A',
  },
  'dark-slate': {
    label: 'Dark Slate',
    bg: '#0F1117',
    surface: '#1A1D27',
    border: '#2A2D3A',
    primary: '#7C8CF8',
    onPrimary: '#0F1117', // dark text: white on this light blue was 3.0:1
    text: '#F0F0F0',
    muted: '#878787',
  },
  forest: {
    label: 'Forest',
    bg: '#F0F4F0',
    surface: '#E4EBE4',
    border: '#C8D4C8',
    primary: '#3A745A',
    onPrimary: '#FFFFFF',
    text: '#1A2A1A',
    muted: '#686868',
  },
  'midnight-blue': {
    label: 'Midnight Blue',
    bg: '#0D1B2A',
    surface: '#1A2E42',
    border: '#243D52',
    primary: '#5DADE2',
    onPrimary: '#0D1B2A', // dark text: white on this light blue was 2.5:1
    text: '#EAF4FB',
    muted: '#8096A6',
  },
  'paper-white': {
    label: 'Paper White',
    bg: '#FFFFFF',
    surface: '#F5F5F5',
    border: '#E0E0E0',
    primary: '#333333',
    onPrimary: '#FFFFFF',
    text: '#111111',
    muted: '#707070',
  },
};

export const fontOptions = [
  { value: 'DM Sans', label: 'DM Sans', style: "'DM Sans', sans-serif" },
  { value: 'Inter', label: 'Inter', style: "'Inter', sans-serif" },
  { value: 'Lato', label: 'Lato', style: "'Lato', sans-serif" },
  { value: 'Merriweather', label: 'Merriweather', style: "'Merriweather', serif" },
  { value: 'JetBrains Mono', label: 'JetBrains Mono', style: "'JetBrains Mono', monospace" },
];

export const iconPackOptions = [
  { value: 'lucide', label: 'Lucide (Default)' },
  { value: 'heroicons', label: 'Heroicons' },
  { value: 'phosphor', label: 'Phosphor' },
];
