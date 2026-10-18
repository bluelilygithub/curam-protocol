import { saveBlob } from '@planner-core/export/csv';
import { captionLayout, photoFileName } from '@planner-core/render3d/photo';

/**
 * Save what is on screen in the 3D picture as a PNG, with the same small caption strip as the rendered photo. The picture is drawn on several stacked
 * canvases, so they are laid on top of each other here. Returns false when there is nothing to save.
 */
export async function savePicture(host: ParentNode, name: string): Promise<boolean> {
  const canvases = Array.from(host.querySelectorAll('canvas'));
  const first = canvases[0];
  if (!first || !first.width || !first.height) return false;
  const L = captionLayout(first.width, name || 'Wine cellar design', 'Preliminary design only', new Date());
  const out = document.createElement('canvas');
  out.width = first.width;
  out.height = first.height + L.stripHeight;
  const g = out.getContext('2d');
  if (!g) return false;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, out.width, out.height);
  for (const c of canvases) if (c.width && c.height) g.drawImage(c, 0, 0, first.width, first.height);
  g.fillStyle = '#1a1a1a';
  g.font = `${L.fontPx}px "Segoe UI", system-ui, sans-serif`;
  g.textBaseline = 'alphabetic';
  g.textAlign = 'left';
  g.fillText(L.left, L.padding, first.height + L.baseline);
  g.textAlign = 'right';
  g.fillStyle = '#666666';
  g.fillText(L.right, out.width - L.padding, first.height + L.baseline);
  const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
  if (!blob) return false;
  saveBlob(blob, photoFileName(name || 'wine-cellar', '', new Date()));
  return true;
}
