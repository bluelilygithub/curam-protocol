/** @type {import('tailwindcss').Config} */
// Colours come from CSS variables in src/index.css (light and dark follow the Windows setting), so there is one place to tune the look.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        shelf: {
          bg: 'rgb(var(--shelf-bg) / <alpha-value>)',
          card: 'rgb(var(--shelf-card) / <alpha-value>)',
          line: 'rgb(var(--shelf-line) / <alpha-value>)',
          text: 'rgb(var(--shelf-text) / <alpha-value>)',
          muted: 'rgb(var(--shelf-muted) / <alpha-value>)',
          accent: 'rgb(var(--shelf-accent) / <alpha-value>)',
          danger: 'rgb(var(--shelf-danger) / <alpha-value>)',
          ok: 'rgb(var(--shelf-ok) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Code"', 'Consolas', 'ui-monospace', 'monospace'],
      },
      borderRadius: { card: '8px', tray: '12px' },
    },
  },
  plugins: [],
};
