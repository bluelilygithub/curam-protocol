import React, { useRef, useState } from 'react';
import Tooltip from '../../components/Tooltip';

// Remove logo: draw a box over the logo on a frame of the video. The box is kept as fractions of the picture (0-1), so it
// does not matter how large the video is shown; the server turns it into pixels (videoCleanup.logoBox).
// Pointer drag draws the box; the corner buttons place a typical-size box for keyboard and touch use.

const CORNERS = [
  { id: 'tl', label: 'Top left', box: { x: 0.02, y: 0.03, w: 0.16, h: 0.1 } },
  { id: 'tr', label: 'Top right', box: { x: 0.82, y: 0.03, w: 0.16, h: 0.1 } },
  { id: 'bl', label: 'Bottom left', box: { x: 0.02, y: 0.87, w: 0.16, h: 0.1 } },
  { id: 'br', label: 'Bottom right', box: { x: 0.82, y: 0.87, w: 0.16, h: 0.1 } },
];

const clamp01 = (v) => Math.min(1, Math.max(0, v));

export default function LogoBoxPicker({ src, box, onChange }) {
  const videoRef = useRef(null);
  const areaRef = useRef(null);
  const dragRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);

  const at = (e) => {
    const r = areaRef.current.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01((e.clientY - r.top) / r.height) };
  };
  const onDown = (e) => {
    if (!areaRef.current) return;
    e.preventDefault();
    areaRef.current.setPointerCapture?.(e.pointerId);
    dragRef.current = at(e);
    onChange({ ...dragRef.current, w: 0, h: 0 });
  };
  const onMove = (e) => {
    if (!dragRef.current) return;
    const p = at(e);
    const s = dragRef.current;
    onChange({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) });
  };
  const onUp = () => { dragRef.current = null; };

  if (!src) {
    return <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Choose a video above, then draw a box over the logo.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="relative inline-block max-w-full rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)' }}>
        <video
          ref={videoRef}
          src={src}
          muted
          playsInline
          preload="metadata"
          className="block max-w-full"
          style={{ maxHeight: 420 }}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        />
        <div
          ref={areaRef}
          role="presentation"
          className="absolute inset-0 cursor-crosshair"
          style={{ touchAction: 'none' }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          {box && box.w > 0 && box.h > 0 && (
            <div
              className="absolute pointer-events-none"
              style={{
                left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`,
                border: '2px solid #ef4444', background: 'rgba(239,68,68,0.18)',
              }}
            />
          )}
        </div>
      </div>
      {duration > 0 && (
        <label className="block space-y-1 max-w-md">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Move through the video to find a frame where the logo is clear</span>
          <Tooltip text="Drag to show a different moment. The logo must stay in the same place for the whole video.">
            <input
              type="range"
              min={0}
              max={duration}
              step={0.1}
              value={time}
              onChange={(e) => {
                const t = Number(e.target.value);
                setTime(t);
                if (videoRef.current) videoRef.current.currentTime = t;
              }}
              className="w-full"
            />
          </Tooltip>
        </label>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Or start from a corner:</span>
        {CORNERS.map((c) => (
          <Tooltip key={c.id} text={`Place a box in the ${c.label.toLowerCase()} corner. You can then draw over it to fit the logo exactly.`}>
            <button
              type="button"
              onClick={() => onChange(c.box)}
              className="px-2 py-1 rounded-lg border text-xs transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', background: 'var(--color-bg)' }}
            >
              {c.label}
            </button>
          </Tooltip>
        ))}
        {box && box.w > 0 && (
          <Tooltip text="Remove the box and start again.">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="px-2 py-1 rounded-lg border text-xs transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}
            >
              Clear box
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
