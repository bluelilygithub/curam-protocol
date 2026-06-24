import React, { useEffect, useRef } from 'react';
import useSettingsStore from '../store/settingsStore';
import { themes, fontOptions } from '../themes';

export default function ThemeBuilderPage() {
  const iframeRef = useRef(null);
  const theme = useSettingsStore((s) => s.theme);
  const font = useSettingsStore((s) => s.font);

  useEffect(() => {
    const sendTheme = () => {
      const t = themes[theme] || themes['warm-sand'];
      const fontStyle = fontOptions.find((f) => f.value === font)?.style || "'DM Sans', sans-serif";
      iframeRef.current?.contentWindow?.postMessage({
        type: 'vault-theme',
        theme: t,
        font: fontStyle,
      }, '*');
    };

    sendTheme();
    const iframe = iframeRef.current;
    iframe?.addEventListener('load', sendTheme);
    return () => iframe?.removeEventListener('load', sendTheme);
  }, [theme, font]);

  return (
    <div className="flex flex-col h-full min-h-0" style={{ height: '100%' }}>
      <iframe
        ref={iframeRef}
        src="/tb/?embedded=1"
        title="WP Theme Builder"
        className="flex-1 w-full border-0 min-h-0"
        style={{ flex: 1, minHeight: 0, height: '100%' }}
      />
    </div>
  );
}
