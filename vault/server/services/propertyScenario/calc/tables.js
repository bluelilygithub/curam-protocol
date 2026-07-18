'use strict';

/**
 * Stamp duty progressive tables + FHB concession sketch.
 * Rates are simplified schedules for estimation — always caveat currency date.
 * AS_OF: 2025-07-01 (illustrative; confirm with state revenue office before acting).
 */

// Stamp duty tables last reviewed 2025-07-01. AU state revenue offices update
// thresholds periodically. Always direct users to the relevant state revenue
// office before relying on these figures for any financial decision.
const AS_OF = '2025-07-01 (verify with state revenue office for 2026 rates)';

/**
 * Bracket: duty = base + rate_per_dollar * max(0, value - over)
 * @typedef {{ upTo: number|null, over: number, base: number, rate: number }} DutyBracket
 */

/** @type {Record<string, { brackets: DutyBracket[], fhb: object }>} */
const STAMP_DUTY_TABLES = {
  // Simplified NSW progressive schedule (general rates)
  NSW: {
    brackets: [
      { upTo: 17_000, over: 0, base: 0, rate: 0.0125 },
      { upTo: 39_000, over: 17_000, base: 212, rate: 0.015 },
      { upTo: 97_000, over: 39_000, base: 542, rate: 0.0175 },
      { upTo: 364_000, over: 97_000, base: 1_557, rate: 0.035 },
      { upTo: 1_212_000, over: 364_000, base: 10_897, rate: 0.045 },
      { upTo: null, over: 1_212_000, base: 49_057, rate: 0.055 },
    ],
    fhb: {
      // Full exemption under value threshold (simplified)
      full_exemption_max: 800_000,
      concessional_max: 1_000_000,
      note: 'NSW FHB transfer duty exemption/concession sketched — eligibility (including true first-home tests) not verified',
    },
  },
  VIC: {
    brackets: [
      { upTo: 25_000, over: 0, base: 0, rate: 0.014 },
      { upTo: 130_000, over: 25_000, base: 350, rate: 0.024 },
      { upTo: 960_000, over: 130_000, base: 2_870, rate: 0.06 },
      { upTo: 2_000_000, over: 960_000, base: 52_670, rate: 0.055 },
      { upTo: null, over: 2_000_000, base: 110_000, rate: 0.065 },
    ],
    fhb: {
      full_exemption_max: 600_000,
      concessional_max: 750_000,
      note: 'VIC FHB exemption/concession sketched — principal place of residence and FHB criteria apply',
    },
  },
  QLD: {
    brackets: [
      { upTo: 5_000, over: 0, base: 0, rate: 0 },
      { upTo: 75_000, over: 5_000, base: 0, rate: 0.015 },
      { upTo: 540_000, over: 75_000, base: 1_050, rate: 0.035 },
      { upTo: 1_000_000, over: 540_000, base: 17_325, rate: 0.045 },
      { upTo: null, over: 1_000_000, base: 38_025, rate: 0.0575 },
    ],
    fhb: {
      full_exemption_max: 700_000,
      concessional_max: 800_000,
      note: 'QLD first-home concession sketched — check home concession vs first home concession',
    },
  },
  WA: {
    brackets: [
      { upTo: 120_000, over: 0, base: 0, rate: 0.019 },
      { upTo: 150_000, over: 120_000, base: 2_280, rate: 0.0285 },
      { upTo: 360_000, over: 150_000, base: 3_135, rate: 0.038 },
      { upTo: 725_000, over: 360_000, base: 11_115, rate: 0.0475 },
      { upTo: null, over: 725_000, base: 28_453, rate: 0.0515 },
    ],
    fhb: {
      full_exemption_max: 430_000,
      concessional_max: 530_000,
      note: 'WA FHB rate concession sketched — thresholds change frequently',
    },
  },
  SA: {
    brackets: [
      { upTo: 12_000, over: 0, base: 0, rate: 0.01 },
      { upTo: 30_000, over: 12_000, base: 120, rate: 0.02 },
      { upTo: 50_000, over: 30_000, base: 480, rate: 0.03 },
      { upTo: 100_000, over: 50_000, base: 1_080, rate: 0.035 },
      { upTo: 200_000, over: 100_000, base: 2_830, rate: 0.04 },
      { upTo: 250_000, over: 200_000, base: 6_830, rate: 0.0425 },
      { upTo: 300_000, over: 250_000, base: 8_955, rate: 0.0475 },
      { upTo: 500_000, over: 300_000, base: 11_330, rate: 0.05 },
      { upTo: null, over: 500_000, base: 21_330, rate: 0.055 },
    ],
    fhb: {
      full_exemption_max: null,
      concessional_max: null,
      note: 'SA FHB relief varies — no automatic exemption applied in this estimator',
    },
  },
  TAS: {
    brackets: [
      { upTo: 3_000, over: 0, base: 50, rate: 0 },
      { upTo: 25_000, over: 3_000, base: 50, rate: 0.0175 },
      { upTo: 75_000, over: 25_000, base: 435, rate: 0.0225 },
      { upTo: 200_000, over: 75_000, base: 1_560, rate: 0.035 },
      { upTo: 375_000, over: 200_000, base: 5_935, rate: 0.04 },
      { upTo: 725_000, over: 375_000, base: 12_935, rate: 0.0425 },
      { upTo: null, over: 725_000, base: 27_810, rate: 0.045 },
    ],
    fhb: {
      full_exemption_max: 600_000,
      concessional_max: 750_000,
      note: 'TAS FHB duty concession sketched',
    },
  },
  ACT: {
    // Approximate progressive / rates — ACT moved toward marginal rates
    brackets: [
      { upTo: 260_000, over: 0, base: 0, rate: 0.004 },
      { upTo: 300_000, over: 260_000, base: 1_040, rate: 0.022 },
      { upTo: 500_000, over: 300_000, base: 1_920, rate: 0.034 },
      { upTo: 750_000, over: 500_000, base: 8_720, rate: 0.0432 },
      { upTo: 1_000_000, over: 750_000, base: 19_520, rate: 0.059 },
      { upTo: 1_455_000, over: 1_000_000, base: 34_270, rate: 0.064 },
      { upTo: null, over: 1_455_000, base: 63_390, rate: 0.05 },
    ],
    fhb: {
      full_exemption_max: 1_000_000,
      concessional_max: null,
      note: 'ACT owner-occupier / FHB concessions sketched — offline thresholds apply',
    },
  },
  NT: {
    brackets: [
      { upTo: 525_000, over: 0, base: 0, rate: 0.0495 * 0.65 }, // approx low-value formula stub
      { upTo: 3_000_000, over: 525_000, base: 16_928, rate: 0.0495 },
      { upTo: null, over: 3_000_000, base: 139_453, rate: 0.0545 },
    ],
    fhb: {
      full_exemption_max: 650_000,
      concessional_max: null,
      note: 'NT conveyancing duty / FHB sketched — NT uses a formula at lower values; this is approximate',
    },
  },
};

/**
 * LMI premium as % of loan amount by LVR band (indicative lender averages).
 * Not a quote from any insurer.
 */
const LMI_TABLE = [
  { lvrMax: 0.80, rate: 0 },
  { lvrMax: 0.85, rate: 0.0075 },
  { lvrMax: 0.90, rate: 0.0175 },
  { lvrMax: 0.95, rate: 0.030 },
  { lvrMax: 0.97, rate: 0.040 },
];

function roundMoney(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * @param {number} value
 * @param {DutyBracket[]} brackets
 */
function dutyFromBrackets(value, brackets) {
  const v = Number(value);
  for (const b of brackets) {
    if (b.upTo == null || v <= b.upTo) {
      return roundMoney(b.base + Math.max(0, v - b.over) * b.rate);
    }
  }
  return 0;
}

/**
 * Government mortgage registration fees (land titles office).
 * Refinancing requires: (1) discharging the old mortgage, (2) registering the new one.
 * Both transactions attract a state government fee. Figures are approximate 2024-2025
 * — verify with your conveyancer as these are updated periodically.
 *
 * Each entry is the total of discharge + new registration combined.
 */
const MORTGAGE_GOVT_FEES = {
  NSW: { discharge: 160, registration: 160, total: 320, note: 'NSW Land Registry Services — approx 2024-25' },
  VIC: { discharge: 120, registration: 120, total: 240, note: 'Land Use Victoria — approx 2024-25' },
  QLD: { discharge: 220, registration: 220, total: 440, note: 'Titles Queensland — approx 2024-25' },
  WA:  { discharge: 190, registration: 190, total: 380, note: 'Landgate WA — approx 2024-25' },
  SA:  { discharge: 195, registration: 195, total: 390, note: 'SA Land Titles — approx 2024-25' },
  TAS: { discharge: 135, registration: 135, total: 270, note: 'Land Tasmania — approx 2024-25' },
  ACT: { discharge: 160, registration: 160, total: 320, note: 'ACT Land Titles — approx 2024-25' },
  NT:  { discharge: 155, registration: 155, total: 310, note: 'NT Land Titles — approx 2024-25' },
};
// National average used when state is unknown
const MORTGAGE_GOVT_FEES_DEFAULT = 340;

module.exports = {
  AS_OF,
  STAMP_DUTY_TABLES,
  LMI_TABLE,
  MORTGAGE_GOVT_FEES,
  MORTGAGE_GOVT_FEES_DEFAULT,
  dutyFromBrackets,
  roundMoney,
};
