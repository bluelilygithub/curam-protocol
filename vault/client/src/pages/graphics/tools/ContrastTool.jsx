import { useIcon } from '../../../providers/IconProvider';
import React, { useState } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { contrastRatio } from '../shared';

export default function ContrastTool({ active }) {
  const getIcon = useIcon();
  const { setHelpTool } = useGraphics();

  const [contrastFg, setContrastFg] = useState('#1f2937');
  const [contrastBg, setContrastBg] = useState('#ffffff');

  return (
    <>
      {(() => {
        const ratio = contrastRatio(contrastFg, contrastBg);
        const Badge = ({ label, threshold }) => {
          const pass = ratio >= threshold;
          return (
            <div className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
              <span className="text-xs font-semibold px-2 py-1 rounded-lg" style={{ color: pass ? '#065f46' : '#991b1b', background: pass ? '#d1fae5' : '#fee2e2' }}>{pass ? 'Pass' : 'Fail'} · ≥{threshold}</span>
            </div>
          );
        };
        return (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-1.5">
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Contrast checker</h2>
              <button type="button" onClick={() => setHelpTool('contrast')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
            </div>
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free</span>
          </div>
          <div className="grid lg:grid-cols-[1fr_420px] gap-6">
            <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Check a text/background colour pair against the WCAG 2.1 contrast thresholds.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Text / foreground</label>
                  <div className="flex items-center gap-2">
                    <Tooltip text="Pick the text colour."><input type="color" value={contrastFg} onChange={e => setContrastFg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                    <Tooltip text="Hex code of the text colour."><input type="text" value={contrastFg} onChange={e => setContrastFg(e.target.value)} className="flex-1 min-w-0 px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Background</label>
                  <div className="flex items-center gap-2">
                    <Tooltip text="Pick the background colour."><input type="color" value={contrastBg} onChange={e => setContrastBg(e.target.value)} className="h-9 w-12 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
                    <Tooltip text="Hex code of the background colour."><input type="text" value={contrastBg} onChange={e => setContrastBg(e.target.value)} className="flex-1 min-w-0 px-2 py-2 rounded-xl border text-sm" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /></Tooltip>
                  </div>
                </div>
              </div>
              <Tooltip text="Swap the text and background colours."><button type="button" onClick={() => { setContrastFg(contrastBg); setContrastBg(contrastFg); }} className="text-xs px-3 py-2 rounded-xl border hover:opacity-80" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Swap colours</button></Tooltip>
              <div className="rounded-xl border p-5 space-y-2" style={{ background: contrastBg, borderColor: 'var(--color-border)' }}>
                <p style={{ color: contrastFg, fontSize: 24, fontWeight: 700, margin: 0 }}>Large text sample</p>
                <p style={{ color: contrastFg, fontSize: 15, margin: 0 }}>Normal body text sample — the quick brown fox jumps over the lazy dog.</p>
              </div>
            </div>
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
              <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Result</span>
              </div>
              <div className="p-4">
                <div className="text-center py-3">
                  <div className="text-4xl font-bold" style={{ color: 'var(--color-text)' }}>{ratio.toFixed(2)}:1</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>contrast ratio</div>
                </div>
                <Badge label="AA · normal text" threshold={4.5} />
                <Badge label="AA · large text (18pt+/14pt bold)" threshold={3} />
                <Badge label="AAA · normal text" threshold={7} />
                <Badge label="AAA · large text" threshold={4.5} />
              </div>
            </div>
          </div>
        </section>
        );
      })()}
    </>
  );
}
