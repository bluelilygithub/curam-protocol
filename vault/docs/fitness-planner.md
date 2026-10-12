# Fitness Planner

Personal fitness planner inside Vault (`/fitness`, flag `fitness`, Research & Utilities). A lifestyle tool, not a drill sergeant: rest and skipped days are normal, no failure language, no red for skipped or rest days. Not medical advice (said once at onboarding, once in the page footer).

Spec: "Fitness Planner App: Spec for Claude Code" (2026-10-12). Built in stages; each stage ends on `staging` for review.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Profile, age templates, self-ratings, AI baseline, 5-year goal with ambition dial, goal revisit, re-rate form, safety check, demo user | built |
| 2 | Exercise library (47, variation chains), 5-week blocks, varied weekly program, Today/Week/Library views, movable sessions, rest budget | built, awaiting library review and staging check |
| 3 | Logging, back-fill, extras, weigh-in (step 1: built, awaiting staging check); tips, reflection, easing prompt (step 2); adaptation, comfortable-jog gate, load suggestions (step 3); swap, diet-app summary (step 4); demo-user logs | in progress |
| 4 | Dashboard charts, colour system, rating-history chart, re-rate banner on the dashboard | planned |
| 5 | Morning plan + catch-up reminders (email, `fitnessCron.js`), installable mobile Today view, re-rate email nudge | planned |

Where the approved extras land: re-rate form + revisit-goal + ambition dial are in Stage 1; the soft "time to re-rate" banner is in Stage 1 (Overview), its chart in Stage 4 and its email in Stage 5. The pain/dizzy/chest keyword check runs on the profile notes in Stage 1 and on session notes in Stage 3. Demo user: profile, ratings, goal and a weight series in Stage 1; weeks of mixed logs in Stage 3.

## Stage 2: library, blocks, weekly program

**Library** (`server/seeds/fitnessExercises.v1.json`, 47 exercises; `library.js`). The file is the source of truth; `fitness_exercises` mirrors it on boot (upsert by slug) for later joins. Each exercise: pattern, domains, settings, `requires` (any-of equipment, empty = needs nothing), level 1-4, steps, mistakes with fixes, why form matters, dosage by level, easier/harder links (two-way, level never goes down), roles (main / warmup / cooldown), optional safety note. Video and image fields are `null`; a link is only valid with `linksReviewedBy`, so the AI can never introduce one (`validateLibrary()` fails otherwise). Review sheet: `node scripts/fitnessLibraryReviewSheet.js` -> `docs/fitness-library-review.md`.

**Blocks** (`phases.js`, `progression.js`). 5 weeks: weeks 1-4 build, week 5 is a deload (70% of the last build week's aerobic minutes, easier variations). There is no separate phases table: block, phase and targets are computed from the goal by date and each generated week stores a snapshot (`fitness_weeks`). Aerobic minutes rise at most ~10% a week (or 15 minutes, whichever is larger) measured against the last build week, never the deload. Early blocks never sit below a gentle 60-minute starter week; the very first week adds at most 30 minutes to what the person already does (45 minimum). "Ease my first weeks" (confirmed in Stage 1) runs the first two weeks at 80%, easier variations.

**Week** (`schedule.js`, `selection.js`, `weekGenerator.js`, `weekService.js`). Code decides: planned rest days (2, Sunday and Thursday/Wednesday first, never on a strength day), strength sessions at least 48 hours apart, balance and mobility on distinct days (and they can share a session with strength or cardio), 25-75 minute aerobic sessions, at most one session a day unless the person is happy to train twice daily. Every session has ~5 minute warm-up and cool-down (two exercises each, from mobility and balance; not counted toward weekly targets). Exercises: movement patterns are the same every week; variation rotates along the easier/harder links; never the exact same session within two weeks; about a third of slots are kept from last week (not in one-exercise sessions); only equipment the person listed; level capped by rating (one lower when easing or in a deload); cardio capped at gentle (level 2) when the week holds under 90 aerobic minutes, whatever the rating. The model (Settings) only picks among the shortlist code builds and writes the week note; anything outside the shortlist is ignored; a bad or missing reply falls back to the rule-based picks. One retry at double the token budget if a reply is cut off. Weeks are created on demand for this week and next (`POST /week/generate`, idempotent); "make a different version" is refused once anything in the week has been acted on.

**Rest and skipped are recorded separately.** Session `status`: `planned | moved | done | partial | swapped | skipped | rest`. `rest` is intentional rest (including spending the flexible rest budget); `skipped` (Stage 3 logging) is a session that was planned and not done. They look the same to the person (neutral, no red) but Stage 4's planned-versus-done charts can tell them apart. Rest days live in `fitness_weeks."restDays"` as `{ day, kind: 'planned' | 'budget' }`. Taking a rest day moves each session on it to a free slot on a later day if one suits (not a rest day, room for it, 48 hours from other strength), otherwise the session is let go (`rest`). It never adds work anywhere else. Undo restores it.

**Soft notes, never blocks.** Strength sessions under 48 hours apart; an outdoor session at midday in the hot months (Nov-Mar for southern-hemisphere time zones, Jun-Aug elsewhere); more than two sessions in a day; a weekly aerobic shortfall; a movement pattern with no exercise for the equipment listed.

**API additions:** `GET /library`, `GET /library/:slug`, `POST /library/:slug/hide|unhide`, `GET /week`, `POST /week/generate`, `GET /today`, `PATCH /sessions/:id` (move), `POST /week/rest-day`, `POST /week/rest-day/undo`.

**Tables:** `fitness_exercises`, `fitness_weeks`, `fitness_planned_sessions`, `fitness_planned_exercises`, `fitness_hidden_exercises`.

**After the first library review.**
- *Gates* (`gate` on an exercise, `library.gateOpen()`): continuous *Easy jog* opens only after *Run/walk intervals* have been in the program for 2 earlier weeks, unless the person's earlier cardio rating was 4 or more ("running history", a stand-in until we ask directly). *Supported single-leg RDL (kickstand)* needs a steady *Single-leg stand* for 2 weeks; *Single-leg RDL* needs the dumbbell RDL (or the supported step) and the stand. The 90-minute cardio rule still applies to everyone. Exposure is counted from planned weeks (`weekService.loadExposure`); **Stage 3 should also require the run/walk to be rated comfortable from logged effort.**
- *Effort:* every exercise has `effort` (1-10 plus the talk test); the library page shows the scale. Loaded exercises have `loadGuide` ("start light, roughly 4-8 kg in each hand; last two reps hard but form holds"). **Stage 3 logs real kilograms so later weeks can suggest from them.**
- *Set-up cues* (`setup`, 3-4 each) on leg press, assisted pull-up, lat pulldown, rowing machine, treadmill walk.
- *Resistance band row* is the cheap pull (new "Resistance bands" equipment option in Profile). Without bands, dumbbells or a gym the week says so.
- *Balance* always says to stand beside a wall or bench.
- *Safety lines per session* (`safety.sessionSafetyLines`): the stop rule on every session; "breathe out on the effort" with strength work; "get up slowly" after floor work (`tags: ['floor']`); water and heat advice for outdoor sessions (Brisbane wording when the time zone is Brisbane); "never swim alone in open water" for pool exercises.
- *"Not for me, hide this exercise"* (`fitness_hidden_exercises`, `POST /library/:slug/hide|unhide`): the generator never picks a hidden exercise; if that empties a whole movement the week says so.

**Navigation and explanations.** Opening an exercise from Today, Week or elsewhere remembers where you came from: Back returns there ("Back to Today", "Back to the Week"), and the Week keeps the week you were looking at. `InfoTip` (`pages/fitness/ui.jsx`) is the explanation popover: hover, keyboard focus or tap, Esc to close; all its wording is in `pages/fitness/tips.js` (why move a session, whether time of day matters, rest, blocks, effort, ratings), so it is easy to extend each stage. Session cards have a labelled Move button with a tooltip. The Overview has a "self-ratings over time" card (first rating against latest, from `GET /ratings/history`): that, plus the re-rate nudge, is the only self-reported progress tracked until logging (Stage 3) and charts (Stage 4).

**Known limits.** "Things to work around" reaches the model as a constraint but code cannot parse it, so an exercise that conflicts can still be offered; hiding it is the immediate fix and a per-exercise swap arrives with logging.

## Layout, colours and the Month

All working screens (Today, Week, a single day, Month, Log, Library) share Today's comfortable width (`max-w-3xl`); only the five-year goal table is wider. The Week is a list of day blocks with small cards. **Day colours** (`dayColors.jsx`, state from `dayStatus.js`, also tested): green = done (every session done or swapped), amber = some done (partly done, a mix, or only some logged), calm blue = rest, teal = something extra, neutral = planned / not logged / "didn't do it". Colour is always paired with an icon and a word, and rest is never shown like skipped. The four week tiles show **done so far** (big number) against **planned** (`weekDone`: partly done counts half, a swapped session counts for what was planned, extras count for their kind). The week note is told not to repeat numbers and to say "days" not "sessions" (`noteVersion: 2` busts old cached notes). **Month** (`GET /month?month=YYYY-MM`, `MonthView.jsx`): a Monday-first calendar with the same colours; click a day to open it in the Week. **Exercise window:** exercise names open a modal (`ExerciseModal.jsx`, content `ExerciseDetail`) instead of a page; Library "hide" refreshes the list.

## Week view and the starter rule

**Week view.** Compact cards (icon, title, when, minutes, state, a pencil to open the day). Click a day or a card to open the day (full session cards with exercises, logging and Move); Back returns to the week. Dragging a card shows three drop places per day. The rest control appears on hover or focus of a day (always visible on touch screens). A small marker shows a session has been moved, and from where. One "?" in the header opens a single guide (moving, time of day, rest, blocks, a different version) instead of several tips.

**Starter rule.** In the first five weeks of a goal, someone who does under 60 minutes of exercise a week (or has not said) gets main work at Gentle or Moderate only: nothing marked Challenging or Advanced, whatever they rated themselves (`selection.STARTER_*`, tested in `week.test.js`: no goblet squat in week one). Week one for the worked example: bodyweight squat, incline push-up, lat pulldown, bird dog; Thursday dumbbell RDL, lateral lunge, wall push-up, dead bug; Saturday a 45 minute easy ride.

## Stage 3: the plan fits itself to you (step 3)

`adaptation.js` (pure, thresholds in `config.js` `adaptation`, editable via `fitness_config_override`) looks at finished weeks before the one being made. Only LOGGED sessions count (done 1, partly 0.5, swapped 1, didn't do it 0); rest and unlogged sessions never count; a week needs at least half its sessions logged; deload weeks are skipped and never adapted. **Nudge up:** last 3 building weeks each at least 80% done, average effort 4 or less, effort recorded on at least half the logged sessions, no ease in the last 3 weeks: volume +10% (the weekly step cap and the age-band ceiling still win) and main-work levels +1 (starter and light-cardio caps still win). **Ease:** last 2 building weeks with average effort 8 or more, or under 50% done: volume about 15% lighter (never below 60% of the last build week) and levels -1. **Hold says nothing.** Decision stored in `fitness_weeks.adaptation`; Today and Week show "Why this week looks like this" for nudge and ease only. Only weeks not yet made are affected; messages are about fitting the plan to life and never mention skipping.

*Comfortable-jog gate:* `easy-jog` now needs two weeks where run/walk was LOGGED done or partly done at effort 6 or less (no effort does not count); planned weeks alone no longer open it. Running history and the 90-minute rule are unchanged. Jogging therefore stays closed until the person logs.

*Load suggestions* (`loads.js`): from the last logged weight and effort: 5 or less, "try the next weight up"; 6-7 stay; 8+ stay until easier; two sessions at 9+ at the same weight, "next weight down". A number is named only if the person listed their dumbbell weights (Profile, `fitness_profiles."dumbbellKg"`); otherwise it just says "the next weight up". With no logged weight the library's "start light" guide remains.

*Tips:* a plain tip now records why (`tipsSource`, `tipsNote`) and the card says so; the form cue puts the fix first.

*Demo:* the admin "Reset demo data" offers three scenarios: mixed (4 weeks), easy streak (7 weeks, shows the nudge) and tough fortnight (7 weeks, shows the ease).

## Stage 3: tips, reflection, gentle week (step 2)

**Tips after a session** (`coaching.js` rules, `coachService.tipsForSession`). One or two short tips for a session that was done, partly done or swapped (none for rest or "didn't do it"). The model (Settings, `light` tier) rewords them from the same facts (exercise names, easier version, common mistake from the library, effort, kilograms); a reply that is empty, badly shaped, or uses a banned tone word (`BANNED`: fail, lazy, missed, skipped, behind, guilt, ...) is replaced by the rule-based tips. Rules: effort 9-10 -> the easier version by name; a lifted weight with effort <= 5 -> a small step up, effort >= 8 -> stay put, 6-7 -> no weight advice; effort <= 3 -> the plan steps up by itself; partly done -> part still counts; otherwise a form cue from the library that rotates with the log. Stored on the log (`fitness_session_logs.tips`), cleared when the log is edited, requested by the day card once per version of the log.

**Weekly reflection** (`GET /reflection?weekStart=`). Two or three sentences about a finished week, from facts only about what was logged (`reflectionFacts`; unlogged sessions are simply absent). Stored on the week with a hash of the facts (`fitness_weeks.reflection`, `reflectionHash`) so it refreshes when more is logged. Null when nothing was logged. Shown on the Overview ("Last week") and when browsing a past week.

**Keeping next week gentle.** A note on a log that mentions pain, dizziness or chest symptoms returns the safety notice; `SafetyNotice` offers "Yes, keep next week gentle" (`POST /ease`, body `{ confirm: true }`). It sets `fitness_profiles."easeWeek"` to next Monday and rebuilds next week if it exists and nothing in it has been done. Never automatic. `phases.targetsForWeek` treats a week as eased when its start equals `easeWeek` (80% volume and one level easier; a deload week is already lighter).

## Stage 3: logging (step 1)

**What is recorded.** `fitness_session_logs` (one per planned session, or none for an extra) and `fitness_exercise_logs` (optional sets / reps / kg / km / seconds). The planned session's `status` follows its log (`done | partial | swapped | skipped | rest`). A session with no log is **not logged**: it stays `planned`, is shown neutrally, and nothing treats it as skipped. `rest` (intentional) and `skipped` ("Didn't do it") stay separate in the data. Rules are pure code in `logging.js` (tests: `log.test.js`): effort 1-10, minutes 0-600, exercise numbers bounded, rest and skipped keep no effort or exercise rows, "none" style notes are empty, a session can only be logged on its day or later and within 28 days, extras within 28 days and never in the future.

**Screens.** Today: "Done as planned" is one tap and then offers the optional effort tiles; "Log details" opens the full form (status tiles with icons, minutes, effort with the talk-test line, note with the mic, optional exercise details). Exercise details are collapsed by default and pre-filled from the plan (sets and the low end of the reps range or hold; last logged kg shows as the placeholder); opening them is remembered per account (`fitness_profiles.prefs.logDetailOpen`, strength sessions separate from the rest). The Log tab has Catch up (quick buttons per session, "Add details", "mark all as done as planned"), "Something else I did", an optional weigh-in and recent history. The weigh-in saves to the shared `health_weight_log` (`source = 'fitness'`, one a day); Today shows at most one gentle prompt a week, with "Not this week" and "Don't ask again" (`prefs.weightPromptDismissedFor`, `prefs.weightPrompt`).

**API.** `POST/DELETE /sessions/:id/log`, `POST /logs/extra`, `DELETE /logs/:id`, `GET /logs`, `GET /catchup`, `GET/POST /weight`, `PATCH /prefs`. A log whose note mentions pain, dizziness or chest symptoms returns the safety notice; the "keep next week gentle" confirmation arrives in step 2.

## Help, tour and starting over

- **Info modal** (`pages/fitness/FitnessInfo.jsx`): "What you can do now" / "Coming next". Auto-shows once per `INFO_KEY` (localStorage). **Each stage: move items from COMING to WORKS_NOW and bump `INFO_KEY`** so it shows once more.
- **Tour** (`utils/tours/fitnessTour.js`, Shepherd, key `vault_tour_fitness_completed`): a `STEPS` registry grouped by screen (`onboarding` / `baseline` / `done`, with the tab to show), so it only walks what is on screen. **Each stage: add `STEPS` entries and the matching `data-tour` attributes.** Open it from the compass in the Fitness header, or Settings -> Tours -> Fitness Tour (`/fitness?tour=1`).
- **Start over** (header three-dot menu, `POST /api/fitness/reset`): default retakes the wizard with earlier answers filled in; lifestyle answers are removed, the active goal is kept as history, ratings are kept. "Clear everything" (type RESET) also deletes ratings, goals, cached wording and the shared date of birth / sex / height. The weight history is kept by default (shared with the diet app); "Clear everything" offers an optional "also delete my weight history" checkbox (`clearWeight`, only honoured together with `clear`).

## Goal screen

Rows: **Now** (current aerobic minutes and current ratings; minutes are the figure entered in onboarding "How active are you right now?" (left blank by default; the age-band figure is shown only as a hint, "Typical for your age: 90"), if left blank the Now row says "not entered" with a link to Profile, the chart starts at Year 1, and the AI is told `currentWeeklyMinutes: null` and must not state a figure (the cardio-rating estimate only shapes the path, never the words); `fitness_profiles."currentWeeklyMinutes"`, `now.minutesSource` says which), then Year 1-5 with a **phase focus** (Rebuild/Build base, Build, Consolidate, Maintain; config `yearPhases`, ambitious paces build for longer) and the **expected rating at the end of each year**, shown to one decimal on a gradual curve (`yearCurveRatings`; year 5 is the whole-number target). A line chart shows weekly aerobic minutes against the shaded WHO 150-300 band. Strength, balance and mobility days can be combined in one session. The selected pace tile uses a neutral colour (the theme accent is too close to the amber "partly done" status colour). The AI writes only the summary and the "what changes" text; per-year sentences were removed because they repeated the table.

AI fallbacks: `ai.js` now retries once with double the token budget if a reply was cut off, and logs the model, stop reason, output tokens and the start of the reply when it falls back. Staging showed `goal fell back to rules: model returned no JSON` (API key set; the 900-token cap was the likely cause, since the old reply also carried five year notes). Budget is now 1500 and the reply is much shorter.

## Free text

"None", "nil", "n/a", "no injuries" and similar typed into the optional boxes are treated as empty (`services/fitness/text.js`, applied on save and again before any AI call). "Anything to work around?" is passed to the model as `thingsToWorkAround` (constraints), never merged into notes, and equipment comes only from `equipmentAvailable`.

## Colour

Theme tokens only (`var(--color-*)`). Every selected state in Fitness (chips, rating buttons, step indicator, pace tiles, chart markers) is neutral via `selectedStyle()` in `pages/fitness/ui.jsx`; the theme accent is reserved for primary action buttons. The only hardcoded colour is white text on a primary button (repo convention). Stage 4's status colours (green/amber/blue/grey/teal) are fixed by the spec and will be the one exception, always paired with an icon or label.

## Rules that do not bend

- **Code decides, AI explains.** Targets, bands, milestones, progression and chart maths are plain code (`server/services/fitness/targets.js`) and tested. AI only writes wording, validated against a schema, with a rule-based fallback so a failed or missing model never blocks anyone.
- **No hardcoded model ids.** Every AI call goes through `ai.js` -> `getModelsForUser(userId)` (Settings -> AI & Chat: `vault_models` / `default_model`), `standard` for baseline and goal wording, `light` reserved for post-log tips. No model configured = rule-based text and a plain note.
- **No hardcoded time zone.** `timezone.js`: the member's own `user_timezone` setting -> the workspace default (first admin's `user_timezone`, same rule as `/api/settings/workspace-timezone`) -> `Australia/Brisbane` only if neither is set. The Fitness profile edits the same `settings` row Settings uses.
- **Pain/dizzy/chest check (`safety.js`)** never eases anything by itself. It offers; the person confirms ("keep my first weeks gentle", stored as `fitness_profiles.easeRequested`). Chest and dizziness also suggest seeing a GP; plain pain suggests a GP/physio only if it lingers.
- **Honesty system.** All ratings are self-rated and unverified; copy says "you rated", never "you are". Status words are neutral: "room to build", "in the healthy range", "above the range".

## Config (editable, not logic)

`server/services/fitness/config.js`: age bands, WHO weekly targets per band, healthy-range self-rating bands, ambition ladder, rating-to-minutes mapping, year curves, re-rate cadence (soft 4 weeks, firm 6), age templates, rating wording.

WHO source: Guidelines on physical activity and sedentary behaviour (2020), checked 2026-10-12. Adults 150-300 min moderate or 75-150 min vigorous aerobic per week; muscle strengthening 2+ days; 65+ add varied multicomponent balance and strength activity on 3+ days. Mobility days, healthy-range bands, ambition ladder and rating-to-minutes mapping are product defaults, not WHO figures, and the UI says so.

Admin override without a deploy: `workspace_settings` key `fitness_config_override` (JSON, deep-merged over the defaults by `loadConfig()`).

## Goal maths (`targets.js`)

- Weekly end-state per band and ambition 1-5: aerobic minutes from the WHO range (capped per band, in 5-minute steps), strength/balance/mobility days.
- 5-year rating target per domain: `max(current, bottom of healthy range) + bonus(ambition)`, clamped to the band ceiling, never below the current rating.
- Yearly milestones follow a front-loaded curve; a faster curve when earlier fitness was higher ("regaining"). Year 1 is deliberately gentle.
- Dialing ambition returns `diffPlans()` so the explanation quotes real numbers.

## API (`server/routes/fitness.js`, `/api/fitness`, behind `requireFeature('fitness')`)

`GET /meta` · `GET /template?dob=` · `GET /me` · `PUT /profile` · `POST /safety-check` · `POST /ratings` (`kind: onboarding|rerate`) · `GET /ratings/history` · `POST /baseline` (AI, cached, `refresh`) · `POST /goal/preview` (AI, nothing saved) · `POST /goal` (accept; older goal becomes `superseded`) · `GET /goal/history` · `POST /reset` · library and week routes (see Stage 2) · `POST /admin/demo-seed` (admin).

AI routes use `aiLimiter`. Responses are cached in `fitness_ai_cache` keyed by the exact input, so revisiting is free and a changed rating regenerates.

## Data model

Stage 1 tables (idempotent DDL in `server/db.js`), all `"userId"`-scoped:

- `health_profiles` (dob, sex, heightCm), `health_weight_log` (time series, `source`): **shared**, deliberately not fitness-owned, so the future diet app reads and writes the same profile and weight.
- `fitness_profiles` (equipment, smoking, alcohol, dietQuality, timeFlexibility, workAround, otherNotes, templateBand, easeRequested), `fitness_ratings` (dated; onboarding + re-rates), `fitness_goals` (ambition, milestones, summary; one `active`), `fitness_ai_cache`.

Planned (Stage 3+): `fitness_session_logs`, `fitness_exercise_logs`, `fitness_reminder_settings`, `fitness_signals` (diet-app signals). The Stage 2 tables (`fitness_exercises`, `fitness_weeks`, `fitness_planned_sessions`, `fitness_planned_exercises`) exist; there is no separate `fitness_phases` table (see Stage 2).

Diet app link: `getActivitySummary(userId, range)` service (weekly minutes, estimated energy, training days) and inbound `fitness_signals` (e.g. low energy intake -> ease intensity). Internal service, no HTTP API until the diet app exists.

## Demo user

Admin overflow menu -> **Create or reset demo user** (confirm first), or `POST /api/fitness/admin/demo-seed`. `fitness-demo@curam.local` (override with `FITNESS_DEMO_EMAIL`): 60M, very fit before, inactive now, no smoking/alcohol, poor diet, flexible time, gym/pool/bike/dumbbells/trails, no injuries. The password is generated and shown once, on creation.

**Every run resets** that user's fitness data and rebuilds it: the goal starts four weeks ago (ratings dated then, so the 4-6 week re-rate nudge shows), **four past weeks are planned** (rule-based, no model call) and a mixed history is logged (`demoScript.js`, assigned by kind of session so lighter weeks still get every outcome): week 1 all done and comfortable; week 2 one partly done with a note, one rest; week 3 one "didn't do it", one swapped for a swim, a strength session with the note "Left knee pain on stairs afterwards" (shows the gentle-week prompt and the hide link), and an extra walk; week 4 (last week) done, a little harder, plus some active chores. Weights rise a kilogram from week 3 and there is a weigh-in each Sunday. The current week is made on demand when the demo user opens Today. "Last week" on the Overview, the Month colours, the weekly tiles and the history all have data straight away.

## Tests

`npm run test:fitness` (pure logic: age/bands, WHO bounds, goal maths, safety keywords, fallback wording, validators, JSON extraction). No database or AI needed.

## Files

Server: `server/routes/fitness.js`, `server/services/fitness/{config,targets,safety,timezone,ai,baseline,goal,profileService,demoSeed}.js`. Client: `client/src/pages/FitnessPage.jsx`, `client/src/pages/fitness/{Onboarding,BaselineView,GoalView,AerobicChart,FitnessInfo,Overview,ProfileTab,sections,ui}.jsx`, `client/src/utils/tours/fitnessTour.js`.
