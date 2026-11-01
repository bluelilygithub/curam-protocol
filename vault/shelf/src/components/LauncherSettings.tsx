import type { Settings } from '../bridge/types';
import { COLUMNS_MAX, COLUMNS_MIN, DEFAULT_LAUNCHER_HOTKEY, LAUNCHER_GROUPS, toggleTile } from '../lib/launcher';
import { TIPS } from '../lib/tips';
import Tooltip from './Tooltip';
import { HotkeyRecorder, Toggle } from './SettingsParts';

/** The quick launcher's choices: its shortcut, how many tiles across and which tools show. Used in the shelf's Settings and inside the launcher itself. */
export default function LauncherSettings({ settings, save }: { settings: Settings; save: (patch: Partial<Settings>) => Promise<void> | void }) {
  return (
    <>
        <p className="m-0 text-xs text-shelf-muted">A second shortcut that opens a grid of the Vault tools you use most. Click one and it opens in your browser.</p>
        <div className="space-y-1"><div className="text-xs text-shelf-muted">Open the launcher with</div><HotkeyRecorder value={settings.launcherHotkey} onChange={(launcherHotkey) => void save({ launcherHotkey })} defaultValue={DEFAULT_LAUNCHER_HOTKEY} tip={TIPS.launcherShortcut} resetTip={TIPS.resetLauncherShortcut} /></div>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span>Tiles across</span>
          <Tooltip text={TIPS.launcherColumns}><select value={settings.launcherColumns} onChange={(e) => void save({ launcherColumns: Number(e.target.value) })} className="px-2 py-1 rounded-lg border border-shelf-line bg-shelf-card/80 text-sm">
            {Array.from({ length: COLUMNS_MAX - COLUMNS_MIN + 1 }, (_, i) => COLUMNS_MIN + i).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></Tooltip>
        </label>
        <div className="space-y-2.5">
          <div className="text-xs text-shelf-muted">Tools to show ({settings.launcherTiles.length} chosen)</div>
          {LAUNCHER_GROUPS.map((g) => (
            <div key={g.id} className="space-y-1.5">
              <div className="text-[11px] font-medium uppercase tracking-wide text-shelf-muted">{g.label}</div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                {g.tiles.map((t) => (
                  <Toggle key={t.id} label={t.label} icon={t.icon} tip={TIPS.launcherTileSwitch(t.label)} checked={settings.launcherTiles.includes(t.id)} onChange={(on) => void save({ launcherTiles: toggleTile(settings.launcherTiles, t.id, on) })} />
                ))}
              </div>
            </div>
          ))}
        </div>

    </>
  );
}
