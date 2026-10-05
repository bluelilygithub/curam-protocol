import { GROWTH_STAGES, MONTHS, MONTH_NAMES, STAGE_LABEL, seasonOf } from '../plants/growth';
import { MID_MONTH_DAY, compassPoint, daylight, formatHour, solarPosition } from '../sun/solar';
import { placeFor, zoneInfo } from '../sun/timezone';
import { useApp, useProject, useUi } from './AppContext';
import { Icon } from './icons';

/** Growth, season and time-of-day controls: always visible (spec 10). They change how every plant is drawn, the shadows, the sun-hours map and the 3D light. */
export function GrowthBar() {
  const app = useApp();
  const stage = useUi((s) => s.stage);
  const month = useUi((s) => s.month);
  const hour = useUi((s) => s.hour);
  const showSun = useUi((s) => s.showSun);
  const showShadows = useUi((s) => s.showShadows);
  const location = useProject((s) => s.project?.location);
  const northDeg = useProject((s) => s.project?.northDeg ?? 0);
  const set = app.ui.getState().set;

  const place = location ? placeFor(location, month) : null;
  const zone = location ? zoneInfo(location, month) : null;
  const sun = place ? solarPosition(place, month, MID_MONTH_DAY, hour) : null;
  const day = place ? daylight(place, month) : null;
  void northDeg;

  return (
    <footer className="growthbar" aria-label="Growth, season and time of day" data-tour="gp-growth">
      <div className="gb-block">
        <span className="gb-label" title="How big the plants are: from just planted to fully grown">Growth</span>
        <div className="seg" role="radiogroup" aria-label="Growth stage">
          {GROWTH_STAGES.map((st) => (
            <button key={st} type="button" role="radio" aria-checked={stage === st} className="seg-btn" title={`Show plants at: ${STAGE_LABEL[st]}`} onClick={() => set({ stage: st })}>{STAGE_LABEL[st]}</button>
          ))}
        </div>
      </div>
      <div className="gb-block gb-month">
        <span className="gb-label" title="The month shown: flowers, bare winter trees, autumn colour, the sun's path and the sun-hours map follow it. Southern hemisphere: summer is December to February.">Month</span>
        <input type="range" min={1} max={12} step={1} value={month} aria-label="Month" aria-valuetext={MONTH_NAMES[month - 1]} onChange={(e) => set({ month: Number(e.target.value) })} />
        <div className="months" aria-hidden="true">
          {MONTHS.map((m, i) => <button key={m} type="button" tabIndex={-1} className={i + 1 === month ? 'on' : ''} onClick={() => set({ month: i + 1 })}>{m}</button>)}
        </div>
        <span className="gb-season">{MONTH_NAMES[month - 1]} · {seasonOf(month)}</span>
      </div>
      <div className="gb-block gb-time">
        <span className="gb-label" title="Time of day (local standard time, no daylight saving). Moves the shadows on the plan and the sun in the 3D view.">Time</span>
        <input type="range" min={4} max={21.5} step={0.25} value={hour} aria-label="Time of day" aria-valuetext={formatHour(hour)} onChange={(e) => set({ hour: Number(e.target.value) })} />
        <span className="gb-clock" data-testid="clock">{formatHour(hour)}</span>
        <span className="gb-sun" data-testid="sun-readout" title="Where the sun is: height above the horizon and the compass direction it is in. In Australia the sun is mostly in the north.">
          {sun && sun.altitude > 0 ? `Sun ${Math.round(sun.altitude)}° up, ${compassPoint(sun.azimuth)}` : 'Sun is down'}
        </span>
        {day && <span className="gb-day" title="Sunrise and sunset in the chosen month">{formatHour(day.sunrise)} to {formatHour(day.sunset)}</span>}
        {zone && <span className={`gb-zone${zone.dst ? ' dst' : ''}`} data-testid="zone" title="The garden's time zone, from its state. NSW, Vic, SA, Tas and the ACT use daylight saving (clocks one hour forward from the first Sunday in October to the first Sunday in April); Qld, WA and the NT do not.">{zone.text}</span>}
      </div>
      <div className="gb-block">
        <button type="button" className="chip" aria-pressed={showSun} title="Show how many hours of sun each part of the garden gets, for this month and growth stage" onClick={() => set({ showSun: !showSun })}><Icon name="sun" size={14} /> Sun map</button>
        <button type="button" className="chip" aria-pressed={showShadows} title="Show the shadows of the house, fences, structures and plants at this time of day" onClick={() => set({ showShadows: !showShadows })}>Shadows</button>
      </div>
    </footer>
  );
}
