# Fitness Planner

Personal fitness planner inside Vault (`/fitness`, flag `fitness`, Research & Utilities). A lifestyle tool, not a drill sergeant: rest and skipped days are normal, no failure language, no red for skipped or rest days. Not medical advice (said once at onboarding, once in the page footer).

Spec: "Fitness Planner App: Spec for Claude Code" (2026-10-12). Built in stages; each stage ends on `staging` for review.

## Status

| Stage | Scope | State |
|---|---|---|
| 1 | Profile, age templates, self-ratings, AI baseline, 5-year goal with ambition dial, goal revisit, re-rate form, safety check, demo user | built |
| 2 | Exercise library (~40, variation chains), phases, varied weekly program, week/day views, rest budget | next |
| 3 | Logging, back-fill, extras, post-log tips, weekly adaptation, pain-note prompt to ease next week, demo-user logs | planned |
| 4 | Dashboard charts, colour system, rating-history chart, re-rate banner on the dashboard | planned |
| 5 | Morning plan + catch-up reminders (email, `fitnessCron.js`), installable mobile Today view, re-rate email nudge | planned |

Where the approved extras land: re-rate form + revisit-goal + ambition dial are in Stage 1; the soft "time to re-rate" banner is in Stage 1 (Overview), its chart in Stage 4 and its email in Stage 5. The pain/dizzy/chest keyword check runs on the profile notes in Stage 1 and on session notes in Stage 3. Demo user: profile, ratings, goal and a weight series in Stage 1; weeks of mixed logs in Stage 3.

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

`GET /meta` · `GET /template?dob=` · `GET /me` · `PUT /profile` · `POST /safety-check` · `POST /ratings` (`kind: onboarding|rerate`) · `GET /ratings/history` · `POST /baseline` (AI, cached, `refresh`) · `POST /goal/preview` (AI, nothing saved) · `POST /goal` (accept; older goal becomes `superseded`) · `GET /goal/history` · `POST /admin/demo-seed` (admin).

AI routes use `aiLimiter`. Responses are cached in `fitness_ai_cache` keyed by the exact input, so revisiting is free and a changed rating regenerates.

## Data model

Stage 1 tables (idempotent DDL in `server/db.js`), all `"userId"`-scoped:

- `health_profiles` (dob, sex, heightCm), `health_weight_log` (time series, `source`): **shared**, deliberately not fitness-owned, so the future diet app reads and writes the same profile and weight.
- `fitness_profiles` (equipment, smoking, alcohol, dietQuality, timeFlexibility, workAround, otherNotes, templateBand, easeRequested), `fitness_ratings` (dated; onboarding + re-rates), `fitness_goals` (ambition, milestones, summary; one `active`), `fitness_ai_cache`.

Planned (Stage 2+): `fitness_exercises` + `fitness_exercise_variations` (seeded from versioned `data/fitnessExercises.v1.json`, upsert by slug), `fitness_phases`, `fitness_weeks`, `fitness_planned_sessions`, `fitness_planned_exercises`, `fitness_session_logs`, `fitness_exercise_logs`, `fitness_reminder_settings`, `fitness_signals`.

Diet app link: `getActivitySummary(userId, range)` service (weekly minutes, estimated energy, training days) and inbound `fitness_signals` (e.g. low energy intake -> ease intensity). Internal service, no HTTP API until the diet app exists.

## Demo user

Admin overflow menu -> "Create demo user" (or `POST /api/fitness/admin/demo-seed`): `fitness-demo@curam.local` (override with `FITNESS_DEMO_EMAIL`), 60M, very fit before, inactive now, no smoking/alcohol, poor diet, flexible time, gym/pool/bike/dumbbells/trails, no injuries. Password is generated and shown once on creation. Idempotent.

## Tests

`npm run test:fitness` (pure logic: age/bands, WHO bounds, goal maths, safety keywords, fallback wording, validators, JSON extraction). No database or AI needed.

## Files

Server: `server/routes/fitness.js`, `server/services/fitness/{config,targets,safety,timezone,ai,baseline,goal,profileService,demoSeed}.js`. Client: `client/src/pages/FitnessPage.jsx`, `client/src/pages/fitness/{Onboarding,BaselineView,GoalView,Overview,ProfileTab,sections,ui}.jsx`.
