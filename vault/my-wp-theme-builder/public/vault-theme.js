/**
 * Sync Vault appearance (colors, font) when embedded in Project Vault.
 */
(function initVaultTheme() {
  function applyVaultTheme(data) {
    if (!data?.theme) return;
    const t = data.theme;
    const root = document.documentElement;
    const map = {
      '--color-bg': t.bg,
      '--color-surface': t.surface,
      '--color-border': t.border,
      '--color-primary': t.primary,
      '--color-text': t.text,
      '--color-muted': t.muted,
      '--bg': t.bg,
      '--surface': t.surface,
      '--border': t.border,
      '--accent': t.primary,
      '--accent-hover': t.primary,
      '--text': t.text,
      '--muted': t.muted,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value) root.style.setProperty(key, value);
    }
    if (data.font) {
      root.style.setProperty('--font-sans', data.font);
      document.body.style.fontFamily = data.font;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.data?.type === 'vault-theme') {
      applyVaultTheme(event.data);
    }
  });
})();
