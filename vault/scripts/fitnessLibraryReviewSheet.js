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
w('First round of answers, now in the data (please confirm they read right):');
w();
w('1. **Jogging.** Continuous *Easy jog* only opens after two weeks of *Run/walk intervals* in the program (Stage 3 will also require them to be rated comfortable), unless someone rated their earlier cardio fitness 4 or more. The rule that under 90 aerobic minutes a week keeps cardio gentle still applies to everyone.');
w('2. **Loads.** Loaded exercises say: start light, roughly 4-8 kg in each hand, and pick a weight where the last two reps feel hard but form holds. Machines say the same without kilograms.');
w('3. **Single-leg Romanian deadlift** now needs the dumbbell RDL (or the new *Supported single-leg RDL*) and a steady *Single-leg stand*, each in the program for two weeks. *Supported single-leg RDL (kickstand)* is the step between and needs a steady single-leg stand.');
w('4. **Leg press and assisted pull-up** have 4 set-up cues each (also lat pulldown, rowing machine and treadmill). "Ask gym staff" stays as an extra.');
w('5. **Bodyweight pull.** Added *Resistance band row*. It needs a band (Profile has a new "Resistance bands" equipment option); the week tells people who have no pull exercise that a band is inexpensive.');
w('6. **Balance warm-ups** say to stand beside a wall or bench, in the exercise and in every session.');
w('7. **Intensity.** Every exercise shows the 1-10 effort and the talk test, with a scale on each library page. Stage 3 logging will use the same 1-10.');
w('8. **Safety.** Every session shows the stop rule (chest pain, dizziness, unusual breathlessness). Strength sessions add "breathe out on the effort, do not hold your breath"; floor work adds "get up slowly"; outdoor sessions add water and heat advice (Brisbane-specific in Brisbane); pool exercises add "never swim alone in open water". Library pages have "Not for me, hide this exercise".');
w();
w('Still open for your eye:');
w();
w('- Is the 2-week gate long enough for running, and for the single-leg hinge?');
w('- Should anything else be gated (for example slow-tempo push-ups, side plank, interval ride)?');
w('- Are the set-up cues for the machines complete and correct?');
w('- Anything dangerous or missing that you would not want an older or deconditioned person doing from this wording.');
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
    w(`**How hard.** ${e.effort}${e.loadGuide ? ` ${e.loadGuide}` : ''}`);
    w();
    if (e.setup) { w('**Set-up cues**'); w(); for (const c of e.setup) w(`- ${c}`); w(); }
    if (e.gate) {
      const groups = e.gate.after.map((g) => g.map(name).join(' or ')).join(' and ');
      w(`**Unlocks after** ${groups} have been in the program for ${e.gate.weeks} weeks${e.gate.waivedBy ? ` (skipped with an earlier running history)` : ''}.`);
      w();
    }
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
