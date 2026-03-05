import React from 'react';
import useSettingsStore from '../store/settingsStore';
import { themes, fontOptions, iconPackOptions } from '../themes';
import { useIcon } from '../providers/IconProvider';

function SettingsPage() {
  const { font, theme, iconPack, setFont, setTheme, setIconPack } = useSettingsStore();
  const getIcon = useIcon();

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-10">
      <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>
        Settings
      </h1>

      {/* Theme Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Theme
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {Object.entries(themes).map(([key, t]) => (
            <button
              key={key}
              onClick={() => setTheme(key)}
              className="p-3 rounded-lg border-2 text-left transition-all"
              style={{
                background: t.bg,
                borderColor: theme === key ? t.primary : t.border,
                boxShadow: theme === key ? `0 0 0 2px ${t.primary}33` : 'none',
              }}
            >
              <div className="flex gap-1 mb-2">
                {[t.bg, t.surface, t.primary, t.text].map((c, i) => (
                  <div
                    key={i}
                    className="w-4 h-4 rounded-full border"
                    style={{ background: c, borderColor: t.border }}
                  />
                ))}
              </div>
              <span className="text-xs font-medium" style={{ color: t.text }}>
                {t.label}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Font Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Font
        </h2>
        <div className="space-y-2">
          {fontOptions.map((f) => (
            <button
              key={f.value}
              onClick={() => setFont(f.value)}
              className="w-full flex items-center justify-between px-4 py-3 rounded-lg border transition-all"
              style={{
                background: font === f.value ? 'var(--color-surface)' : 'transparent',
                borderColor: font === f.value ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              <span style={{ fontFamily: f.style, fontSize: '1rem' }}>{f.label}</span>
              <span className="text-xs" style={{ fontFamily: f.style, color: 'var(--color-muted)' }}>
                The quick brown fox
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* Icon Pack Section */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Icon Pack
        </h2>
        <div className="flex gap-3">
          {iconPackOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setIconPack(opt.value)}
              className="flex-1 px-4 py-3 rounded-lg border text-sm font-medium transition-all"
              style={{
                background: iconPack === opt.value ? 'var(--color-surface)' : 'transparent',
                borderColor: iconPack === opt.value ? 'var(--color-primary)' : 'var(--color-border)',
                color: 'var(--color-text)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </section>

      {/* Live Preview */}
      <section>
        <h2 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'var(--color-muted)' }}>
          Preview
        </h2>
        <div
          className="p-4 rounded-lg border space-y-3"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <div className="flex items-center gap-2">
            {getIcon('folder', { size: 16 })}
            <span className="text-sm">Sample Project</span>
          </div>
          <div className="flex items-center gap-2">
            {getIcon('chat', { size: 16 })}
            <span className="text-sm">Chat Session</span>
          </div>
          <div className="flex items-center gap-2">
            {getIcon('settings', { size: 16 })}
            <span className="text-sm">Settings & Preferences</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            The quick brown fox jumps over the lazy dog
          </p>
          <button
            className="px-3 py-1 rounded text-xs text-white font-medium"
            style={{ background: 'var(--color-primary)' }}
          >
            Primary Action
          </button>
        </div>
      </section>
    </div>
  );
}

export default SettingsPage;
