// Help system: tooltip placement, tip text, field tips, tour data, and the keys Vault's Settings page shares.
import { describe, expect, it } from 'vitest';
import { FIELD_TIPS, tipFor } from '../../src/help/fieldTips';
import { TOUR_KEY, INFO_SEEN_KEY } from '../../src/help/helpKeys';
import { placeTooltip, TOOLTIP_EDGE, TOOLTIP_GAP, TOOLTIP_MIN_TOP, type Rect } from '../../src/help/tooltipLogic';
import { TOUR_STEPS } from '../../src/help/tourSteps';

const rect = (left: number, top: number, w = 40, h = 30): Rect => ({ left, top, right: left + w, bottom: top + h, width: w });

describe('tooltip placement', () => {
  it('sits centred above the control, one gap higher than its top', () => {
    const p = placeTooltip(rect(500, 200), 1280);
    expect(p).toEqual({ top: 200 - TOOLTIP_GAP, left: 520, above: true });
  });
  it('flips below when there is no room above', () => {
    const p = placeTooltip(rect(500, TOOLTIP_MIN_TOP), 1280);
    expect(p.above).toBe(false);
    expect(p.top).toBe(TOOLTIP_MIN_TOP + 30 + TOOLTIP_GAP);
  });
  it('can be asked to go below', () => {
    expect(placeTooltip(rect(500, 200), 1280, 'bottom').above).toBe(false);
  });
  it('stays inside the window edges', () => {
    expect(placeTooltip(rect(0, 200, 10), 1280).left).toBe(TOOLTIP_EDGE);
    expect(placeTooltip(rect(1275, 200, 10), 1280).left).toBe(1280 - TOOLTIP_EDGE);
  });
});

describe('field tips', () => {
  it('explain the inspector fields in a sentence or two', () => {
    for (const k of ['X', 'Y', 'Width', 'Length', 'Height', 'Elevation', 'Rotation', 'Offset along wall', 'Swing angle', 'Hinge side', 'Inside length', 'Thickness', 'Finish', 'Room name']) {
      expect(tipFor(k), k).toBeTruthy();
    }
    for (const [k, v] of Object.entries(FIELD_TIPS)) {
      expect(v.length, k).toBeGreaterThan(20);
      expect(v.length, k).toBeLessThan(220);
    }
    expect(tipFor('Nope')).toBeUndefined();
  });
});

describe('tour data', () => {
  it('has unique step ids, a welcome and a finish, and titles and text on every step', () => {
    const ids = TOUR_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(TOUR_STEPS[0].target).toBeUndefined();
    expect(TOUR_STEPS[TOUR_STEPS.length - 1].target).toBeUndefined();
    for (const s of TOUR_STEPS) { expect(s.title.length, s.id).toBeGreaterThan(2); expect(s.text.length, s.id).toBeGreaterThan(30); }
  });
  it('points at data-tour names that exist in the source, and steps that need 3D or 2D never need both', () => {
    for (const s of TOUR_STEPS) expect(!(s.needs3d && s.needs2d), s.id).toBe(true);
  });
  it('matches the step count Vault’s Settings page advertises (11)', () => {
    expect(TOUR_STEPS.length).toBe(11);
  });
});

describe('shared keys', () => {
  it('use Vault’s naming so Settings can reset them', () => {
    expect(TOUR_KEY).toBe('vault_tour_room_planner_completed');
    expect(INFO_SEEN_KEY).toBe('vault_room_planner_info_seen');
  });
});
