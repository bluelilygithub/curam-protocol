// Scene settings in the Inspector: three collapsed boxes (Colour palette, Lights, Sound), below whatever is selected. They are the
// 3D view's moods, kept out of the way of the view itself.
import { AMBIENT_OPTIONS, type AmbientKind } from '../audio/ambient';
import { GLOBAL_POWER_MAX, percent } from '../render3d/lightPower';
import { useApp, useUi } from './AppContext';
import { PalettePicker } from './PalettePicker';

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="section meta-box" name="inspector">
      <summary>{title}</summary>
      <div className="section-body">{children}</div>
    </details>
  );
}

export function SceneSettings() {
  const app = useApp();
  const lightsOn = useUi((s) => s.lightsOn);
  const lightPower = useUi((s) => s.lightPower);
  const cinematic = useUi((s) => s.cinematic);
  const look = useUi((s) => s.look);
  const ambient = useUi((s) => s.ambient);
  const volume = useUi((s) => s.ambientVolume);
  const showsLights = cinematic && look === 'realistic';

  return (
    <div className="scene-settings" data-testid="scene-settings">
      <Box title="Colour palette">
        <PalettePicker />
        <p className="hint">Colours the walls, floor, trim, sofas and rugs together. Shown in the 3D view (not in the plan, and not in the Clay look).</p>
      </Box>

      <Box title="Lights">
        <div className="actions">
          <button className={`btn ${lightsOn ? 'active' : ''}`} aria-pressed={lightsOn} onClick={() => app.setLightsOn(!lightsOn)} title="Switch the ceiling lights and lamps on or off. Their bulbs and shades glow only while the lights are on.">
            <span className="label">{lightsOn ? 'Lights on' : 'Lights off'}</span>
          </button>
          {!showsLights && (
            <button className="btn" onClick={() => app.setLook('realistic')} title="Lights show in the Realistic look and in Render photo">
              <span className="label">Show Realistic</span>
            </button>
          )}
        </div>
        <label className="field power" title="How bright all the lights are together. Drag to dim or brighten; each light also has its own power when you select it.">
          <span className="field-label">All lights</span>
          <span className="field-control">
            <input
              type="range" min={0} max={GLOBAL_POWER_MAX} step={0.05} value={lightPower} aria-label="All lights power"
              onChange={(e) => app.setLightPower(Number(e.target.value))}
            />
            <span className="unit power-value">{percent(lightPower)}</span>
          </span>
        </label>
        <p className="hint">
          {showsLights ? 'Select a ceiling light or lamp to set its own power.' : 'Lights show in the Realistic look and in Render photo.'} Place lights from the Lighting group in the Library.
        </p>
      </Box>

      <Box title="Sound">
        <label className="field" title="Soothing ambient sound while the 3D view is showing: rain, ocean waves, a forest breeze or calm music. Made in your browser; nothing is downloaded.">
          <span className="field-label">Ambient sound</span>
          <span className="field-control">
            <select aria-label="Ambient sound" value={ambient} onChange={(e) => app.setAmbient(e.target.value as AmbientKind)}>
              {AMBIENT_OPTIONS.map((o) => <option key={o.id} value={o.id} title={o.note}>{o.label}</option>)}
            </select>
          </span>
        </label>
        {ambient !== 'off' && (
          <label className="field power" title="Sound volume">
            <span className="field-label">Volume</span>
            <span className="field-control">
              <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Sound volume" onChange={(e) => app.setAmbientVolume(Number(e.target.value))} />
              <span className="unit power-value">{percent(volume)}</span>
            </span>
          </label>
        )}
        <p className="hint">Plays only while you are in the 3D view. Browsers start sound after a click.</p>
      </Box>
    </div>
  );
}
