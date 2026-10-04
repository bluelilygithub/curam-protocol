// Colour palette picker for the active room: a swatch row per palette (walls, floor, upholstery, rug) and a Standard choice. One undoable step.
import { PALETTES } from '../data/palettes';
import { useApp, useProject } from './AppContext';

export function PalettePicker() {
  const app = useApp();
  const current = useProject((s) => s.project?.rooms[0]?.palette ?? null);
  return (
    <div className="palette-list" role="group" aria-label="Colour palette">
      <button
        className={`palette-row ${current === null ? 'active' : ''}`} aria-pressed={current === null}
        title="The standard colours: nothing is recoloured" onClick={() => app.setPalette(null)}
      >
        <span className="swatches"><i style={{ background: '#efe9de' }} /><i style={{ background: '#c79a62' }} /><i style={{ background: '#9a8f82' }} /><i style={{ background: '#e0d6c3' }} /></span>
        <span className="label">Standard</span>
      </button>
      {PALETTES.map((p) => (
        <button
          key={p.id} className={`palette-row ${current === p.id ? 'active' : ''}`} aria-pressed={current === p.id}
          title={`${p.note}. Colours the walls, floor, trim, sofas and rugs of this room in the 3D view; a finish you pick for a piece is kept.`}
          onClick={() => app.setPalette(p.id)}
        >
          <span className="swatches"><i style={{ background: p.wall }} /><i style={{ background: p.floor }} /><i style={{ background: p.upholstery }} /><i style={{ background: p.rugAccent }} /></span>
          <span className="label">{p.name}</span>
        </button>
      ))}
    </div>
  );
}
