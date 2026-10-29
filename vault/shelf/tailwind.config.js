/** @type {import('tailwindcss').Config} */
// Colours are Vault's own tokens (--color-bg, --color-surface, ...; see src/lib/theme.ts), so every theme Vault offers works here. Each has an -rgb twin so
// opacity utilities (bg-shelf-accent/70) work. Status colours are fixed, as in Vault (client/DESIGN.md).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media', // unused: the look is a chosen theme, never the operating system's setting
  theme: {
    extend: {
      colors: {
        shelf: {
          bg: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
          card: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
          line: 'rgb(var(--color-border-rgb) / <alpha-value>)',
          text: 'rgb(var(--color-text-rgb) / <alpha-value>)',
          muted: 'rgb(var(--color-muted-rgb) / <alpha-value>)',
          accent: 'rgb(var(--color-primary-rgb) / <alpha-value>)',
          onaccent: 'rgb(var(--color-on-primary-rgb) / <alpha-value>)',
          danger: 'rgb(239 68 68 / <alpha-value>)',   // #ef4444
          ok: 'rgb(22 163 74 / <alpha-value>)',       // #16a34a
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'DM Sans', 'sans-serif'],
        mono: ['var(--font-mono)', 'DM Mono', 'monospace'],
      },
      borderRadius: { card: '0.75rem', tray: '1rem' },   // Vault: inner rows rounded-xl, sections rounded-2xl
      transitionDuration: { DEFAULT: '200ms' },          // Vault: 200 ms everywhere, no exceptions
    },
  },
  plugins: [],
};
