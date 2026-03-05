import React, { useEffect } from 'react';
import useSettingsStore from '../store/settingsStore';
import { themes } from '../themes';

const loadedFonts = new Set(['DM Sans']);

function loadFont(fontName) {
  if (loadedFonts.has(fontName)) return;
  loadedFonts.add(fontName);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  const encoded = encodeURIComponent(fontName);
  link.href = `https://fonts.googleapis.com/css2?family=${encoded}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function ThemeProvider({ children }) {
  const theme = useSettingsStore((s) => s.theme);
  const font = useSettingsStore((s) => s.font);

  useEffect(() => {
    const t = themes[theme] || themes['warm-sand'];
    let styleEl = document.getElementById('vault-theme-vars');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'vault-theme-vars';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      :root {
        --color-bg: ${t.bg};
        --color-surface: ${t.surface};
        --color-border: ${t.border};
        --color-primary: ${t.primary};
        --color-text: ${t.text};
        --color-muted: ${t.muted};
      }
    `;
  }, [theme]);

  useEffect(() => {
    loadFont(font);
    document.documentElement.style.setProperty('--font-sans', `'${font}', sans-serif`);
  }, [font]);

  return <>{children}</>;
}

export default ThemeProvider;
