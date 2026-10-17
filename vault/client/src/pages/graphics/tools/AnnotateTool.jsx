import { useIcon } from '../../../providers/IconProvider';
import React, { useState, useRef, useEffect, useCallback } from 'react';
import Tooltip from '../../../components/Tooltip';
import { useGraphics } from '../GraphicsContext';
import { fontFamilyFor, loadGoogleFont, clampNum, downloadDataUrl, loadImageInto, ANN_GOOGLE_FONTS } from '../shared';

export default function AnnotateTool({ active }) {
  const getIcon = useIcon();
  const { handoff, setHelpTool } = useGraphics();
  const mode = active ? 'annotate' : null;

  const [annSource, setAnnSource] = useState(null);
  const [annTool, setAnnTool] = useState('select');
  const [annColor, setAnnColor] = useState('#ff3b30');
  const [annWidth, setAnnWidth] = useState(6);
  const [annFont, setAnnFont] = useState('');
  const [annShapes, setAnnShapes] = useState([]);
  const [annSelected, setAnnSelected] = useState(null);
  const [annEditing, setAnnEditing] = useState(null);
  const annCanvasRef = useRef(null);
  const annImgRef = useRef(null);
  const annDrawRef = useRef(null);
  const annDrawFnRef = useRef(null);
  const annInputRef = useRef(null);
  const [annPast, setAnnPast] = useState([]);
  const [annFuture, setAnnFuture] = useState([]);
  const annShapesRef = useRef([]);

  useEffect(() => { annShapesRef.current = annShapes; }, [annShapes]);

  // Annotate: draw the image plus every shape; `preview` is the in-progress shape.
  const renderAnnShape = (ctx, s, W, H) => {
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.widthPx;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (s.type === 'pen') {
      if (!s.points?.length) return;
      ctx.beginPath();
      ctx.moveTo(s.points[0].x * W, s.points[0].y * H);
      for (let i = 1; i < s.points.length; i += 1) ctx.lineTo(s.points[i].x * W, s.points[i].y * H);
      ctx.stroke();
    } else if (s.type === 'rect') {
      ctx.strokeRect(s.x * W, s.y * H, s.w * W, s.h * H);
    } else if (s.type === 'arrow') {
      const ax1 = s.x1 * W;
      const ay1 = s.y1 * H;
      const ax2 = s.x2 * W;
      const ay2 = s.y2 * H;
      ctx.beginPath();
      ctx.moveTo(ax1, ay1);
      ctx.lineTo(ax2, ay2);
      ctx.stroke();
      const ang = Math.atan2(ay2 - ay1, ax2 - ax1);
      const head = Math.max(8, s.widthPx * 4);
      ctx.beginPath();
      ctx.moveTo(ax2, ay2);
      ctx.lineTo(ax2 - head * Math.cos(ang - Math.PI / 6), ay2 - head * Math.sin(ang - Math.PI / 6));
      ctx.lineTo(ax2 - head * Math.cos(ang + Math.PI / 6), ay2 - head * Math.sin(ang + Math.PI / 6));
      ctx.closePath();
      ctx.fill();
    } else if (s.type === 'text') {
      ctx.font = `bold ${s.fontPx}px ${fontFamilyFor(s.fontFamily)}`;
      ctx.textBaseline = 'top';
      const lines = String(s.text).split('\n');
      const lh = s.fontPx * 1.25;
      lines.forEach((line, i) => ctx.fillText(line, s.x * W, s.y * H + i * lh));
    }
  };

  const annShapeBBox = (s, ctx, W, H) => {
    if (s.type === 'text') {
      ctx.font = `bold ${s.fontPx}px ${fontFamilyFor(s.fontFamily)}`;
      const lines = String(s.text || '').split('\n');
      const w = Math.max(0, ...lines.map(l => ctx.measureText(l).width));
      const lh = s.fontPx * 1.25;
      return { x: s.x * W, y: s.y * H, w, h: lh * lines.length };
    }
    if (s.type === 'rect') {
      return { x: Math.min(s.x, s.x + s.w) * W, y: Math.min(s.y, s.y + s.h) * H, w: Math.abs(s.w) * W, h: Math.abs(s.h) * H };
    }
    if (s.type === 'arrow') {
      const x1 = s.x1 * W; const y1 = s.y1 * H; const x2 = s.x2 * W; const y2 = s.y2 * H;
      return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    if (s.type === 'pen') {
      const xs = s.points.map(p => p.x * W); const ys = s.points.map(p => p.y * H);
      const minx = Math.min(...xs); const miny = Math.min(...ys);
      return { x: minx, y: miny, w: Math.max(...xs) - minx, h: Math.max(...ys) - miny };
    }
    return { x: 0, y: 0, w: 0, h: 0 };
  };

  const drawAnnotate = (preview) => {
    const canvas = annCanvasRef.current;
    const img = annImgRef.current;
    if (!canvas || !img) return;
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0, W, H);
    annShapes.forEach((s, i) => {
      if (annEditing && annEditing.editIndex === i) return; // hidden while editing
      renderAnnShape(ctx, s, W, H);
    });
    if (preview) renderAnnShape(ctx, preview, W, H);
    if (annTool === 'select' && annSelected != null && !annEditing && annShapes[annSelected]) {
      const b = annShapeBBox(annShapes[annSelected], ctx, W, H);
      const pad = Math.max(6, W / 250);
      ctx.save();
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = Math.max(1.5, W / 600);
      ctx.setLineDash([8, 5]);
      ctx.strokeRect(b.x - pad, b.y - pad, b.w + pad * 2, b.h + pad * 2);
      ctx.restore();
    }
  };

  annDrawFnRef.current = drawAnnotate;

  useEffect(() => {
    if (!annFont) return;
    loadGoogleFont(annFont).then(() => annDrawFnRef.current?.(null));
  }, [annFont]);

  useEffect(() => {
    if (mode !== 'annotate' || !annSource?.imageDataUrl) return;
    const img = new Image();
    img.onload = () => {
      annImgRef.current = img;
      const canvas = annCanvasRef.current;
      if (canvas) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      annDrawFnRef.current?.(null);
    };
    img.src = annSource.imageDataUrl;
  }, [mode, annSource]);

  useEffect(() => {
    annDrawFnRef.current?.(null);
  }, [annShapes, annSelected, annTool, annEditing]);

  useEffect(() => {
    if (annEditing?.editId && annInputRef.current) {
      const el = annInputRef.current;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    }
  }, [annEditing?.editId]);

  const annSizes = () => {
    const canvas = annCanvasRef.current;
    const scale = canvas ? canvas.width / 1000 : 1;
    return { widthPx: Number(annWidth) * scale, fontPx: Number(annWidth) * 6 * scale };
  };

  const annDisplayScale = () => {
    const canvas = annCanvasRef.current;
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    return rect.width / canvas.width;
  };

  const translateAnnShape = (s, dx, dy) => {
    if (s.type === 'text' || s.type === 'rect') return { ...s, x: s.x + dx, y: s.y + dy };
    if (s.type === 'arrow') return { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy };
    if (s.type === 'pen') return { ...s, points: s.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
    return s;
  };

  const annHitTest = (cx, cy) => {
    const canvas = annCanvasRef.current;
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    const W = canvas.width; const H = canvas.height;
    const pxX = cx * W; const pxY = cy * H;
    for (let i = annShapes.length - 1; i >= 0; i -= 1) {
      const b = annShapeBBox(annShapes[i], ctx, W, H);
      const pad = Math.max(10, annShapes[i].widthPx || 0);
      if (pxX >= b.x - pad && pxX <= b.x + b.w + pad && pxY >= b.y - pad && pxY <= b.y + b.h + pad) return i;
    }
    return null;
  };

  const recordAnn = (snapshot) => {
    setAnnPast(p => [...p, snapshot].slice(-20));
    setAnnFuture([]);
  };

  const undoAnn = () => {
    if (!annPast.length) return;
    const prev = annPast[annPast.length - 1];
    setAnnFuture(f => [annShapesRef.current, ...f].slice(0, 20));
    setAnnPast(p => p.slice(0, -1));
    setAnnShapes(prev);
    setAnnSelected(null);
    setAnnEditing(null);
  };

  const redoAnn = () => {
    if (!annFuture.length) return;
    const next = annFuture[0];
    setAnnPast(p => [...p, annShapesRef.current].slice(-20));
    setAnnFuture(f => f.slice(1));
    setAnnShapes(next);
    setAnnSelected(null);
    setAnnEditing(null);
  };

  const commitAnnEditing = () => {
    const cur = annEditing;
    if (!cur) return;
    const val = (cur.value || '').replace(/^\n+|\n+$/g, '').trim();
    if (cur.editIndex != null || val) recordAnn(annShapesRef.current);
    setAnnShapes(prev => {
      if (cur.editIndex != null) {
        if (!val) return prev.filter((_, i) => i !== cur.editIndex);
        return prev.map((s, i) => (i === cur.editIndex ? { ...s, text: val, color: cur.color, fontFamily: cur.fontFamily !== undefined ? cur.fontFamily : s.fontFamily } : s));
      }
      if (!val) return prev;
      return [...prev, { type: 'text', x: cur.x, y: cur.y, text: val, color: cur.color, fontPx: cur.fontPx, fontFamily: cur.fontFamily || '', widthPx: Math.max(2, cur.fontPx * 0.08) }];
    });
    setAnnEditing(null);
    if (val) {
      // After placing/editing text, switch to Select / Move so it can be dragged straight away.
      const idx = cur.editIndex != null ? cur.editIndex : annShapes.length;
      setAnnTool('select');
      setAnnSelected(idx);
    }
  };

  const openAnnTextEditor = (x, y, { editIndex = null, value = '', fontPx, color, fontFamily } = {}) => {
    const sizes = annSizes();
    setAnnSelected(null);
    setAnnEditing({ editId: Date.now(), x, y, value, editIndex, fontPx: fontPx || sizes.fontPx, color: color || annColor, fontFamily: fontFamily !== undefined ? fontFamily : annFont, scale: annDisplayScale() });
  };

  const onAnnMove = useCallback((e) => {
    const d = annDrawRef.current;
    const canvas = annCanvasRef.current;
    if (!d || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    if (d.tool === 'select') {
      if (!d.snapped) {
        const before = d.before;
        setAnnPast(p => [...p, before].slice(-20));
        setAnnFuture([]);
        d.snapped = true;
      }
      d.moved = true;
      const dx = cx - d.startX;
      const dy = cy - d.startY;
      setAnnShapes(prev => prev.map((s, i) => (i === d.idx ? translateAnnShape(d.orig, dx, dy) : s)));
      return;
    }
    let preview;
    if (d.tool === 'pen') {
      d.points.push({ x: cx, y: cy });
      preview = { type: 'pen', points: d.points, color: d.color, widthPx: d.widthPx };
    } else if (d.tool === 'arrow') {
      preview = { type: 'arrow', x1: d.startX, y1: d.startY, x2: cx, y2: cy, color: d.color, widthPx: d.widthPx };
    } else {
      preview = { type: 'rect', x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w: Math.abs(cx - d.startX), h: Math.abs(cy - d.startY), color: d.color, widthPx: d.widthPx };
    }
    annDrawFnRef.current?.(preview);
  }, []);

  const onAnnUp = useCallback((e) => {
    const d = annDrawRef.current;
    annDrawRef.current = null;
    window.removeEventListener('mousemove', onAnnMove);
    window.removeEventListener('mouseup', onAnnUp);
    const canvas = annCanvasRef.current;
    if (!d || !canvas) return;
    if (d.tool === 'select') return;
    const rect = canvas.getBoundingClientRect();
    const cx = clampNum((e.clientX - rect.left) / rect.width, 0, 1);
    const cy = clampNum((e.clientY - rect.top) / rect.height, 0, 1);
    let shape = null;
    if (d.tool === 'pen') {
      if (d.points.length > 1) shape = { type: 'pen', points: d.points, color: d.color, widthPx: d.widthPx };
    } else if (d.tool === 'arrow') {
      if (Math.abs(cx - d.startX) > 0.005 || Math.abs(cy - d.startY) > 0.005) shape = { type: 'arrow', x1: d.startX, y1: d.startY, x2: cx, y2: cy, color: d.color, widthPx: d.widthPx };
    } else {
      const w = Math.abs(cx - d.startX);
      const h = Math.abs(cy - d.startY);
      if (w > 0.005 && h > 0.005) shape = { type: 'rect', x: Math.min(d.startX, cx), y: Math.min(d.startY, cy), w, h, color: d.color, widthPx: d.widthPx };
    }
    if (shape) {
      const before = d.before;
      setAnnPast(p => [...p, before].slice(-20));
      setAnnFuture([]);
      setAnnShapes(prev => [...prev, shape]);
    } else annDrawFnRef.current?.(null);
  }, [onAnnMove]);

  const onAnnDown = (e) => {
    const canvas = annCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = { x: clampNum((e.clientX - rect.left) / rect.width, 0, 1), y: clampNum((e.clientY - rect.top) / rect.height, 0, 1) };
    e.preventDefault();
    if (annEditing) commitAnnEditing();
    const { widthPx } = annSizes();
    if (annTool === 'text') {
      openAnnTextEditor(p.x, p.y, {});
      return;
    }
    if (annTool === 'select') {
      const idx = annHitTest(p.x, p.y);
      setAnnSelected(idx);
      if (idx == null) return;
      annDrawRef.current = { tool: 'select', idx, startX: p.x, startY: p.y, orig: annShapes[idx], moved: false, snapped: false, before: annShapesRef.current };
      window.addEventListener('mousemove', onAnnMove);
      window.addEventListener('mouseup', onAnnUp);
      return;
    }
    annDrawRef.current = { tool: annTool, startX: p.x, startY: p.y, points: [p], color: annColor, widthPx, before: annShapesRef.current };
    window.addEventListener('mousemove', onAnnMove);
    window.addEventListener('mouseup', onAnnUp);
  };

  const onAnnDoubleClick = (e) => {
    const canvas = annCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = { x: clampNum((e.clientX - rect.left) / rect.width, 0, 1), y: clampNum((e.clientY - rect.top) / rect.height, 0, 1) };
    const idx = annHitTest(p.x, p.y);
    if (idx != null && annShapes[idx].type === 'text') {
      const s = annShapes[idx];
      openAnnTextEditor(s.x, s.y, { editIndex: idx, value: s.text, fontPx: s.fontPx, color: s.color, fontFamily: s.fontFamily });
    }
  };

  const deleteAnnSelected = () => {
    if (annSelected == null) return;
    recordAnn(annShapesRef.current);
    setAnnShapes(prev => prev.filter((_, i) => i !== annSelected));
    setAnnSelected(null);
  };

  const exportAnnotate = () => {
    if (annEditing) commitAnnEditing();
    const canvas = annCanvasRef.current;
    if (!canvas) return;
    const prevSel = annSelected;
    setAnnSelected(null);
    requestAnimationFrame(() => {
      drawAnnotate(null);
      const url = canvas.toDataURL('image/png');
      downloadDataUrl(url, `annotated-${Date.now()}.png`);
      setAnnSelected(prevSel);
    });
  };

  // An image sent here from another tool (or from Ask Graphics) arrives as ctx.handoff; take it once.
  const handoffSeen = useRef(0);
  useEffect(() => {
    if (!handoff || handoff.mode !== 'annotate' || handoff.nonce === handoffSeen.current) return;
    handoffSeen.current = handoff.nonce;
    const src = handoff.src;
    setAnnShapes([]); setAnnSelected(null); setAnnEditing(null); setAnnPast([]); setAnnFuture([]); annImgRef.current = null; setAnnSource(src);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  // Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z undo and redo while this tool is showing.
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (e) => {
      const el = e.target;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z') && !typing) {
        e.preventDefault();
        if (e.shiftKey) redoAnn(); else undoAnn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  return (
    <>
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Annotate</h2>
            <button type="button" onClick={() => setHelpTool('annotate')} className="hover:opacity-60 flex-shrink-0" style={{ color: 'var(--color-muted)' }}>{getIcon('help-circle', { size: 13 })}</button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Runs locally · free · never uploaded</span>
        </div>
        <div className="rounded-2xl border p-4 mb-4 flex flex-wrap items-center gap-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="grow min-w-[200px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Source image</label>
            <Tooltip text="Choose the image to mark up."><input type="file" accept="image/*" onChange={e => { setAnnShapes([]); setAnnSelected(null); setAnnEditing(null); setAnnPast([]); setAnnFuture([]); annImgRef.current = null; loadImageInto(setAnnSource)(e.target.files?.[0]); }} className="block w-full text-xs" style={{ color: 'var(--color-text)' }} /></Tooltip>
          </div>
          <div className="flex gap-2 self-end">
            {[['select', 'Select / Move'], ['text', 'Text'], ['arrow', 'Arrow'], ['rect', 'Box'], ['pen', 'Pen']].map(([t, label]) => (
              <button key={t} type="button" onClick={() => { setAnnTool(t); if (t !== 'select') setAnnSelected(null); }} className="px-3 py-1.5 rounded-lg text-xs font-medium border" style={{ background: annTool === t ? 'var(--color-primary)' : 'transparent', color: annTool === t ? '#fff' : 'var(--color-text)', borderColor: 'var(--color-border)' }} title={t === 'select' ? 'Click an item to select it, then drag to move or resize it.' : t === 'text' ? 'Click on the image to add a text label.' : t === 'arrow' ? 'Drag on the image to draw an arrow.' : t === 'rect' ? 'Drag on the image to draw a box.' : 'Draw freehand by dragging on the image.'}>{label}</button>
            ))}
          </div>
          <div className="flex items-center gap-2 self-end">
            <label className="text-xs" style={{ color: 'var(--color-muted)' }}>Colour</label>
            <Tooltip text="Colour for new marks, or the currently selected item."><input type="color" value={annColor} onChange={e => { setAnnColor(e.target.value); setAnnEditing(cur => (cur ? { ...cur, color: e.target.value } : cur)); if (annSelected != null) setAnnShapes(prev => prev.map((s, i) => (i === annSelected ? { ...s, color: e.target.value } : s))); }} className="h-8 w-10 rounded border" style={{ borderColor: 'var(--color-border)', background: 'transparent' }} /></Tooltip>
          </div>
          <div className="self-end min-w-[160px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>Font</label>
            <Tooltip text="Font used for text labels."><select
              value={annFont}
              onChange={e => {
                const fam = e.target.value;
                setAnnFont(fam);
                loadGoogleFont(fam).then(() => annDrawFnRef.current?.(null));
                if (annSelected != null && annShapes[annSelected]?.type === 'text') {
                  setAnnShapes(prev => prev.map((s, i) => (i === annSelected ? { ...s, fontFamily: fam } : s)));
                }
              }}
              className="w-full px-3 py-2 rounded-xl border text-sm"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', fontFamily: annFont ? `"${annFont}", sans-serif` : undefined }}
            >
              {ANN_GOOGLE_FONTS.map(f => (
                <option key={f.family} value={f.family}>{f.label}</option>
              ))}
            </select></Tooltip>
          </div>
          <div className="self-end min-w-[140px]">
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-muted)' }}>{annTool === 'text' ? 'Text size' : 'Thickness'}: {annWidth}</label>
            <input type="range" min="1" max="24" value={annWidth} onChange={e => setAnnWidth(Number(e.target.value))} className="w-full" title={annTool === 'text' ? 'Size of new text labels.' : 'Line thickness for new arrows, boxes and pen strokes.'} />
          </div>
          <div className="flex gap-2 self-end">
            <Tooltip text="Delete the currently selected item."><button type="button" onClick={deleteAnnSelected} disabled={annSelected == null} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Delete</button></Tooltip>
            <Tooltip text="Undo the last change."><button type="button" onClick={undoAnn} disabled={!annPast.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Undo</button></Tooltip>
            <Tooltip text="Redo the last undone change."><button type="button" onClick={redoAnn} disabled={!annFuture.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Redo</button></Tooltip>
            <Tooltip text="Remove every mark from the image."><button type="button" onClick={() => { if (!annShapes.length) return; recordAnn(annShapesRef.current); setAnnShapes([]); setAnnSelected(null); }} disabled={!annShapes.length} className="text-xs px-3 py-2 rounded-xl border hover:opacity-70 disabled:opacity-40" style={{ color: 'var(--color-text)', borderColor: 'var(--color-border)' }}>Clear</button></Tooltip>
            <Tooltip text="Flatten all marks onto the image and save it as a PNG."><button type="button" onClick={exportAnnotate} disabled={!annSource?.imageDataUrl} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 inline-flex items-center gap-2" style={{ background: 'var(--color-primary)' }}>
              {getIcon('download', { size: 15 })} Save PNG
            </button></Tooltip>
          </div>
        </div>
        {!annSource?.imageDataUrl ? (
          <div className="rounded-2xl border flex items-center justify-center text-sm text-center px-6 py-20" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-bg)' }}>Choose an image to start annotating.</div>
        ) : (
          <div className="rounded-2xl border p-4 flex justify-center" style={{ borderColor: 'var(--color-border)', background: '#1e1e1e' }}>
            <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', lineHeight: 0 }}>
              <Tooltip text="Click or drag to use the selected tool on the image."><canvas
                ref={annCanvasRef}
                onMouseDown={onAnnDown}
                onDoubleClick={onAnnDoubleClick}
                style={{ display: 'block', maxHeight: '70vh', maxWidth: '100%', borderRadius: 6, cursor: annTool === 'text' ? 'text' : annTool === 'select' ? 'move' : 'crosshair', touchAction: 'none' }}
              /></Tooltip>
              {annEditing && (
                <textarea
                  ref={annInputRef}
                  rows={Math.max(1, (annEditing.value || '').split('\n').length)}
                  value={annEditing.value}
                  onChange={e => setAnnEditing(cur => (cur ? { ...cur, value: e.target.value } : cur))}
                  onKeyDown={e => {
                    if (e.key === 'Escape') { e.preventDefault(); setAnnEditing(null); }
                    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitAnnEditing(); }
                  }}
                  onBlur={commitAnnEditing}
                  placeholder="Type… (Enter = new line)"
                  spellCheck={false}
                  style={{
                    position: 'absolute',
                    left: `${annEditing.x * 100}%`,
                    top: `${annEditing.y * 100}%`,
                    transform: 'translateY(-2px)',
                    font: `bold ${Math.max(12, annEditing.fontPx * annEditing.scale)}px ${fontFamilyFor(annEditing.fontFamily)}`,
                    lineHeight: 1.25,
                    color: annEditing.color,
                    background: 'rgba(255,255,255,0.85)',
                    border: '1px dashed #3b82f6',
                    borderRadius: 4,
                    padding: '0 4px',
                    outline: 'none',
                    minWidth: 80,
                    width: 'auto',
                    resize: 'none',
                    overflow: 'hidden',
                    whiteSpace: 'pre',
                  }}
                />
              )}
            </div>
          </div>
        )}
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
          {annTool === 'text' && 'Text: click on the image and type. Enter adds a new line; click away (or ⌘/Ctrl+Enter) to place it — it stays selected so you can drag it straight away.'}
          {annTool === 'select' && 'Select / Move: click an item to select it, then drag to move. Double-click text to re-edit. Delete removes the selected item.'}
          {(annTool === 'arrow' || annTool === 'rect' || annTool === 'pen') && 'Drag on the image to draw. Switch to Select / Move to reposition anything.'}
          {' '}Save PNG flattens everything into an image — nothing leaves your browser.
        </p>
      </section>
    </>
  );
}
