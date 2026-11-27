// `primary` + `onPrimary` are chosen so text on a primary-coloured button is 4.5:1 or better, and (for the light themes) primary as text on bg/surface too.
// `muted` is chosen to give at least 4.5:1 (WCAG AA for normal text) against both that theme's bg and surface.
// `chart` becomes the --chart-* vars (DESIGN.md "Chart tokens"): gain/loss/warn 4.5:1 on bg and surface (they are also text), series c1-c4
// 3:1 on surface and 1.35:1 or more apart in lightness. Checked by client/src/components/charts/chartTokens.test.mjs.
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
    chart: { c1: '#9B5B46', c2: '#284D77', c3: '#9D812D', c4: '#153127', gain: '#2E7240', loss: '#B23A2E', warn: '#8A5A00', neutral: '#7A7A72', grid: '#D8D8D0', ink: '#1A1A1A' },
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
    chart: { c1: '#7C8CF8', c2: '#F1B982', c3: '#2C8466', c4: '#F2EBF8', gain: '#4ADE80', loss: '#F87171', warn: '#FBBF24', neutral: '#727888', grid: '#2A2D3A', ink: '#F0F0F0' },
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
    chart: { c1: '#3A745A', c2: '#2C4575', c3: '#B67535', c4: '#352545', gain: '#2A6B3A', loss: '#A8352B', warn: '#7F5300', neutral: '#727C72', grid: '#C8D4C8', ink: '#1A2A1A' },
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
    chart: { c1: '#5DADE2', c2: '#D07011', c3: '#88DDB2', c4: '#F7EFF7', gain: '#5EE08F', loss: '#FF8A80', warn: '#FFC857', neutral: '#7890A4', grid: '#2C4760', ink: '#EAF4FB' },
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
    chart: { c1: '#333333', c2: '#2E6DB6', c3: '#C76B2A', c4: '#215645', gain: '#2D7A3E', loss: '#C0392B', warn: '#8F5B00', neutral: '#7C7C7C', grid: '#E0E0E0', ink: '#111111' },
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
