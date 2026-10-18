import type { CostSettings } from '../src/lite/config';

/** "No other costs": every amount is a confirmed zero and the margin is zero, so a test of the racks, door and features sees none of the new lines. */
export const NO_COSTS: CostSettings = {
  glassPerM2: { amount: 0, confirmed: true }, cooling: { amount: 0, confirmed: true }, lighting: { amount: 0, confirmed: true }, installation: { amount: 0, confirmed: true },
  margin: { pct: 0, confirmed: true },
};
