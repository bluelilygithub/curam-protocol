import React from 'react';

/**
 * Content of the "How the Fitness Planner works" modal. It grows with the app:
 * add to WORKS_NOW when a stage ships, remove it from COMING, and bump INFO_KEY so the modal shows once more.
 */
export const INFO_KEY = 'vault:fitness:info-seen:v2';

const WORKS_NOW = [
  ['Your profile', 'Date of birth, sex, height and weight, plus the equipment and places you have. Your answers are pre-filled for your age band, and you can change any of them.'],
  ['Self-ratings', 'Rate cardio, strength, flexibility and balance from 1 to 5, now and at an earlier time. Nobody checks them; they just help the plan fit you. Re-rate every 4-6 weeks and your earlier ratings are kept.'],
  ['Baseline', 'Where you are against the healthy range for your age, based on the WHO 2020 physical activity guidelines.'],
  ['Five-year goal', 'Pick a pace from Gentle to Stretch. You see a Now row, the focus and weekly targets for each year, the rating you are expected to reach, and a chart against the WHO 150-300 minute band. Revisit it any time.'],
  ['Start over', 'The three-dot menu lets you retake the wizard. By default your earlier goals and ratings are kept; you can choose to clear everything.'],
];

const COMING = [
  'A varied weekly program with days and times you can move, and a rest budget',
  'An exercise library with how-to steps and easier or harder versions',
  'Logging planned against actual, with quick back-fill',
  'Charts, a consistency calendar and gentle reminders',
];

export default function FitnessInfoBody({ disclaimer }) {
  return (
    <>
      <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
        A lifestyle planner, not a drill sergeant. Rest and skipped days are normal and are never marked as failures.
      </p>
      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>What you can do now</h3>
        <dl className="space-y-2.5">
          {WORKS_NOW.map(([term, text]) => (
            <div key={term}>
              <dt className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{term}</dt>
              <dd className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>{text}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Coming next</h3>
        <ul className="list-disc pl-5 space-y-1 text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          {COMING.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      <div className="space-y-1.5">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>How the numbers work</h3>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--color-muted)' }}>
          Targets, milestones and safety checks come from fixed rules. The AI model chosen in Vault Settings only helps with the wording, and the app
          falls back to plain wording if no model is available.
        </p>
      </div>
      {disclaimer && <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{disclaimer}</p>}
    </>
  );
}
