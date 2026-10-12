'use strict';

/**
 * Writes docs/fitness-library-review.md from server/seeds/fitnessExercises.v1.json, grouped by movement pattern, with a
 * sign-off line for every exercise. Re-run after editing the data:  node scripts/fitnessLibraryReviewSheet.js
 */

const fs = require('fs');
const path = require('path');

const data = require('../server/seeds/fitnessExercises.v1.json');
const list = data.exercises;
const by = new Map(list.map((e) => [e.slug, e]));
const name = (s) => by.get(s)?.name || s;
const LEVELS = ['', 'gentle', 'moderate', 'challenging', 'advanced'];
const ORDER = ['squat', 'hinge', 'lunge', 'push', 'pull', 'core', 'carry', 'cardio', 'balance', 'mobility'];

const out = [];
const w = (s = '') => out.push(s);

w(`# Fitness exercise library: review sheet (${data.version})`);
w();
w(`${list.length} exercises. Generated from \`server/seeds/fitnessExercises.v1.json\` (the file the app reads), so this sheet always matches what users see.`);
w('Nothing here is final until it has been read by someone who has trained seriously. Please mark each exercise **Approve** or **Change** and write what to change.');
w();
w('## What to look for');
w();
w('- **Steps and cues:** would a sensible beginner end up doing this safely and correctly from the words alone? Anything missing, or wrong?');
w('- **Mistakes and fixes:** are these the mistakes people really make, and are the fixes right?');
w('- **Level:** is the 1-4 level (and so who is offered it) right? Beginner-rated people only see levels 1-2; intermediate 1-3; advanced 1-4; one lower in easing and lighter weeks.');
w('- **Dosage:** sets, reps, holds and minutes for beginner / intermediate / advanced. Are they sensible for a lifestyle program (health and longevity, not bodybuilding)?');
w('- **Equipment and setting:** is what each one needs listed correctly?');
w('- **Safety notes:** shown on the exercise page; anything missing?');
w();
w('## Coverage');
w();
w('| Movement | Count | Exercises (easiest to hardest where there is a chain) |');
w('|---|---|---|');
for (const p of ORDER) {
  const inP = list.filter((e) => e.pattern === p).sort((a, b) => a.level - b.level);
  w(`| ${p} | ${inP.length} | ${inP.map((e) => e.name).join(', ')} |`);
}
w();
w(`Warm-up exercises (drawn from mobility and balance): ${list.filter((e) => e.roles.includes('warmup')).map((e) => e.name).join(', ')}.`);
w();
w(`Cool-down exercises: ${list.filter((e) => e.roles.includes('cooldown')).map((e) => e.name).join(', ')}.`);
w();
w('## Judgement calls I would like you to check first');
w();
w('1. **Jogging.** *Easy jog* is level 3 and *Run/walk intervals* level 2. People with fewer than 90 minutes of cardio in the week are never offered level 3+ cardio, whatever they rate themselves. Is that cautious enough, or too cautious?');
w('2. **Heavier loads.** Dumbbell exercises say "light", "heavier" and so on but never give kilograms. Is that right for a general audience, or should there be a guide?');
w('3. **Single-leg Romanian deadlift** is level 3 and also counts as balance work. Offered to intermediate-rated people. Too early?');
w('4. **Leg press and assisted pull-up** tell people to ask gym staff to set up the first time. Enough?');
w('5. **No pulling exercise without dumbbells or a gym.** People who list only bodyweight get no row or pull-down; the week says so and leaves the slot out. Is there a safe bodyweight pull I should add (for example a towel row)?');
w('6. **Warm-up and cool-down** are about 5 minutes each, two exercises each, drawn from mobility and balance. Are the choices sensible as warm-ups (for example *Tandem stand* and *Single-leg stand* as balance warm-ups)?');
w('7. **Aerobic intensity** is described with the talk test only. Fine, or should there also be a 1-10 effort scale?');
w('8. **Anything dangerous or missing** that you would not want an older or deconditioned person doing from this wording.');
w();

for (const p of ORDER) {
  const inP = list.filter((e) => e.pattern === p).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  w(`## ${p[0].toUpperCase()}${p.slice(1)} (${inP.length})`);
  w();
  for (const e of inP) {
    w(`### ${e.name}`);
    w();
    w(`\`${e.slug}\` · level ${e.level} (${LEVELS[e.level]}) · ${e.domains.join(' + ')} · ${e.equipment} · where: ${e.settings.join(', ')} · needs: ${e.requires.length ? `any of ${e.requires.join(' / ')}` : 'nothing'} · roles: ${e.roles.join(', ')}`);
    w();
    w('**Steps**');
    w();
    e.steps.forEach((s, i) => w(`${i + 1}. ${s}`));
    w();
    w('**Common mistakes**');
    w();
    for (const m of e.mistakes) w(`- ${m.mistake}. *Fix:* ${m.fix}`);
    w();
    w(`**Why form matters.** ${e.whyFormMatters}`);
    w();
    w(`**Dosage.** Beginner: ${e.dosage.beginner}. Intermediate: ${e.dosage.intermediate}. Advanced: ${e.dosage.advanced}.`);
    if (e.safety) { w(); w(`**Safety note shown to the user.** ${e.safety}`); }
    w();
    w(`**Easier:** ${e.easier.length ? e.easier.map(name).join(', ') : 'none'}. **Harder:** ${e.harder.length ? e.harder.map(name).join(', ') : 'none'}.`);
    w();
    w('- [ ] Approve   - [ ] Change: ______________________________________________');
    w();
  }
}

fs.writeFileSync(path.join(__dirname, '..', 'docs', 'fitness-library-review.md'), out.join('\n'), 'utf8');
console.log(`wrote docs/fitness-library-review.md (${list.length} exercises)`);
