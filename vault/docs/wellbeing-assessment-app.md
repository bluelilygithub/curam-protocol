# Wellbeing & Personality Checks

## Purpose

The Wellbeing & Personality Checks area is a proof-of-concept self-report app inside Curam Vault. It is accessed through the heart-pulse icon and is intended for personal reflection only.

It is not medical advice, a diagnostic assessment, a clinical risk assessment, or a substitute for a qualified professional.

## Dashboard

The heart-pulse navigation always returns the user to the wellbeing dashboard. The dashboard is the launch point for all tests, paused drafts, combined profile access, visual summaries, past mood attempts, admin demo data, and the reset flow.

The dashboard includes:

- Eight progress tiles: BDI-style mood check, GAD-7-style anxiety check, PANAS-style affect check, ASRS-5-style attention check, IPIP-NEO-120 personality inventory, HEXACO-60-style personality check, CERQ-style cognitive coping check, and Brief COPE-style coping check.
- A progress indicator showing which of the eight tests have been completed.
- Consistent **Review or retake** actions on completed test tiles.
- Module action buttons for report, charts, mind map, suggestions, and slideshow once each module's tests are complete.
- A subtly highlighted results area that unlocks the final combined profile, charts, mind map, personal development suggestions, and final recap slideshow only after all eight tests are completed.
- A clickable mood-check history tile for browsing previous BDI-style attempts.
- An admin-only **Pre-populate random test results** action for demo/testing data.
- A reset/erase action for all wellbeing test data and local drafts.

The BDI-style tile now behaves consistently with the other completed test tiles. When completed, it opens a mood-check review area with retake, latest-result review, and past-attempt access instead of jumping directly to the history list.

## Tests

### BDI-Style Mood Check

The mood check is inspired by common BDI-style symptom domains. It uses 21 ordered questions scored from 0 to 3, with optional reflections on each item.

The result includes:

- Total score out of 63.
- Symptom band.
- Severity gauge with standard 0-63 colour bands.
- Safety flag handling for self-harm related responses.
- Strongest symptom signals.
- Deeper model-assisted formulation.
- Suggested next steps.
- Full response review.
- PDF export.

### PANAS-Style Affect Check

The PANAS-style check is a proof-of-concept affect snapshot using original wording inspired by positive and negative affect schedules. It is not the official PANAS.

The result includes:

- Positive affect score.
- Negative affect score.
- Affect balance interpretation.
- Horizontal affect bar chart.
- Deeper model-assisted formulation.
- PDF export.

### GAD-7-Style Anxiety Check

The GAD-7-style check is a proof-of-concept anxiety-domain screener using original wording. It is not the official GAD-7 and does not diagnose anxiety.

The result includes:

- Total score out of 21.
- Anxiety-domain severity band.
- Gauge with 0-21 colour bands.
- Seven item responses covering nervousness, worry control, excessive worry, restlessness, tension, irritability, and fear.
- Deeper model-assisted formulation.
- PDF export.

### ASRS-5-Style Attention Check

The ASRS-5-style check is a proof-of-concept adult attention and self-regulation screener using original wording. It is not the official ASRS-5 and does not diagnose ADHD.

The result includes:

- Total score out of 24.
- Attention/self-regulation band.
- Six item-area scores covering attention, restlessness, settling, impulsive speech, procrastination, and external structure.
- Horizontal item-area bar chart.
- Deeper model-assisted formulation.
- PDF export.

### IPIP-NEO-120 Personality Inventory

The IPIP-NEO-120 profile uses public-domain IPIP-style personality items across five broad domains and 30 facets.

The result includes:

- Domain scores.
- Facet scores.
- Radar chart for the five IPIP-NEO domains.
- Strongest facet signals.
- Reverse-scored item handling.
- Deeper model-assisted formulation.
- PDF export.

### HEXACO-60-Style Personality Check

The HEXACO-60-style check uses original proof-of-concept item wording across six HEXACO-style domains. It is not the official HEXACO-PI-R.

The result includes:

- Domain scores for Honesty-Humility, Emotionality, Extraversion, Agreeableness, Conscientiousness, and Openness to Experience.
- Radar chart for the six HEXACO-style domains.
- Reverse-scored item handling.
- Deeper model-assisted formulation.
- PDF export.

### CERQ-Style Cognitive Coping Check

The CERQ-style check is inspired by Cognitive Emotion Regulation Questionnaire strategy areas, but uses original proof-of-concept item wording. It is not the official CERQ.

The result includes:

- Nine cognitive emotion-regulation strategy scores.
- Horizontal strategy bar chart with adaptive/maladaptive colour context.
- Most frequent cognitive coping strategies.
- Helpful, mixed, and less-helpful strategy context.
- Deeper model-assisted formulation.
- PDF export.

### Brief COPE-Style Coping Check

The Brief COPE-style check is inspired by Brief COPE scale areas, with original proof-of-concept item wording. It does not produce a single overall coping score.

The result includes:

- Fourteen coping strategy scores.
- Horizontal strategy bar chart with adaptive/avoidant colour context.
- Family-level coping patterns.
- Strongest behavioural coping responses.
- Deeper model-assisted formulation.
- PDF export.

## Combined Profile

The Combined Profile area is organised around three modules:

- **Mood & Emotional State**: BDI-style mood check, GAD-7-style anxiety check, and PANAS-style affect check. This module describes how the person appears to be feeling now and recently.
- **Personality & Traits**: IPIP-NEO-120 and HEXACO-60-style personality check. This module describes more stable dispositional patterns and trait posture.
- **Regulation & Coping**: GAD-7-style anxiety check, ASRS-5-style attention check, CERQ-style cognitive coping check, and Brief COPE-style coping check. This module describes how the person responds to stress and emotion, including attention/self-regulation pressure.

Each module can generate a focused detailed report and a module-specific slideshow once the tests in that module are complete. Module reports use the same saved-report cache as combined profiles, with source keys based only on the tests in that module.

The final Combined Profile is locked until the user has completed all eight tests at least once.

When generated, it first loads or creates the three module reports, then uses those module outcomes as the basis for the final synthesis. Users can choose one of four final report levels:

- **Summary**: a concise overview of the eight tests for either client or clinician orientation.
- **Detailed profile**: the existing client-readable formulation intended for client and clinician discussion.
- **Analytical profile**: a more clinician-oriented formulation with mechanisms, caveats, and clinical questions. It remains available to clients but is written primarily for clinical interpretation.
- **Suggestions**: a client-readable personal development report that turns the eight-test pattern into reflective strengths, coping, anxiety/worry supports, communication, attention/self-regulation supports, and small-experiment suggestions without presenting them as diagnosis or treatment advice.

The detailed profile covers:

- Overall formulation.
- Mood, anxiety, and affect context.
- Attention and self-regulation context.
- Personality pattern.
- Cognitive coping pattern.
- Behavioural coping pattern.
- Reinforcing themes across tests.
- Tensions and qualifications.
- Strengths and supports.
- Growth edges.
- Suggested next steps.
- Reflection questions.

The combined profile is generated through the configured model where available, using the app's provider-agnostic model path. If model generation fails or no model is configured, a deterministic fallback formulation is returned.

Generated module and final reports are saved in PostgreSQL by report type and source-attempt set. If the same latest source attempts are still current, reopening a module report, Summary, Detailed profile, Analytical profile, or Suggestions returns the saved report instead of rebuilding it. A new report is generated when one of the underlying quiz attempts changes.

Report rendering preserves explicit paragraph breaks and line breaks in summaries, section bodies, caveats, and clinical-question sections so longer reports are easier to read.

The combined profile can be downloaded as a PDF. The PDF uses the profile currently shown on screen so the exported report matches the generated text and spacing.

## Suggested Next Steps

Reports include a **Suggested next steps** section. These are deliberately framed as supportive habits, reflection prompts, and small experiments rather than diagnosis, treatment advice, or clinical instructions.

Suggested next steps can include:

- Stabilising basics such as sleep, food, gentle movement, reducing overload, recovery time, and support contact when mood or anxiety load is elevated.
- Attention and self-regulation supports such as visible reminders, smaller task starts, timed work blocks, body doubling, fewer open decisions, and recovery breaks.
- Coping-pattern prompts such as noticing rumination, catastrophising, avoidance, self-blame, or disengagement earlier and choosing one small re-entry step.
- Strength-based prompts such as leaning on planning, support-seeking, perspective-taking, meaning-making, or communication patterns already visible in the profile.
- A reminder to discuss intense, persistent, risky, or functionally costly patterns with a qualified professional or trusted support.

## Slideshow Exports

The slideshow feature supports preview and PowerPoint download.

Module slideshows unlock when the module's tests are complete. A module deck includes:

- A module summary chart slide.
- Module synthesis.
- Individual test-finding slides for the tests in that module.
- Suggested next steps for that module.

The final recap slideshow unlocks after all eight checks are complete. The final deck includes:

- A summary chart slide across the completed wellbeing checks.
- The three module synthesis slides.
- Individual test-finding slides.
- Final synthesis/detail slides where a final profile is available.
- Suggested next steps for overall wellbeing.

Slideshows are generated server-side with Node-native `pptxgenjs`, so no local Python or desktop PowerPoint automation is required.

## Combined Visual Summary

The visual summary unlocks after all eight tests are completed.

It includes:

- BDI-style single severity gauge.
- GAD-7-style anxiety gauge.
- PANAS-style affect bar chart.
- ASRS-5-style attention/self-regulation bar chart.
- IPIP-NEO five-domain radar chart.
- HEXACO six-domain radar chart.
- CERQ-style horizontal strategy bar chart.
- Brief COPE-style horizontal strategy bar chart.
- Mind map connecting related themes across the eight tests.

Both the chart view and the mind map view have PDF download buttons.

## Quiz Purpose Guidance

Each test page includes an **About this quiz** panel that explains:

- The purpose of the test.
- What the result is trying to clarify.
- How the person should answer.
- The proof-of-concept caveat and non-clinical limits.

## Drafts And Navigation

All eight tests support pause/resume and back navigation.

Paused drafts are stored in browser `localStorage` on the current device:

- `curam:wellbeing-mood:draft`
- `curam:gad-7-style:draft`
- `curam:panas-style:draft`
- `curam:asrs-5-style:draft`
- `curam:ipip-neo-120:draft`
- `curam:hexaco-60-style:draft`
- `curam:cerq-style:draft`
- `curam:brief-cope-style:draft`

Completed attempts are stored in PostgreSQL.

## Reset / Erase All Tests

The dashboard includes a reset action that:

- Deletes all completed mood attempts for the current user.
- Deletes all completed GAD-7-style attempts for the current user.
- Deletes all completed PANAS-style attempts for the current user.
- Deletes all completed ASRS-5-style attempts for the current user.
- Deletes all completed IPIP-NEO-120 attempts for the current user.
- Deletes all completed HEXACO-60-style attempts for the current user.
- Deletes all completed CERQ-style attempts for the current user.
- Deletes all completed Brief COPE-style attempts for the current user.
- Clears paused local drafts on the current device.

The reset action requires an in-app confirmation modal before running. It also removes random demo attempts generated by the admin-only pre-populate button.

## Backend

Main route file:

- `server/routes/wellbeing.js`

Service files:

- `server/services/wellbeingPdf.js`
- `server/services/gad7Style.js`
- `server/services/panasStyle.js`
- `server/services/asrs5Style.js`
- `server/services/ipipNeo120.js`
- `server/services/hexaco60Style.js`
- `server/services/cerqStyle.js`
- `server/services/briefCopeStyle.js`
- `server/services/wellbeingModelInsights.js`
- `server/services/combinedProfilePdf.js`
- `server/services/wellbeingVisualPdf.js`

Database tables:

- `wellbeing_attempts`
- `gad7_attempts`
- `panas_attempts`
- `asrs5_attempts`
- `ipip_neo_attempts`
- `hexaco_attempts`
- `cerq_attempts`
- `cope_attempts`
- `wellbeing_combined_reports`

The tables are created idempotently during app startup by `server/db.js`.

## Frontend

Main page:

- `client/src/pages/WellbeingPage.jsx`

Components:

- `client/src/components/wellbeing/IpipNeo120Panel.jsx`
- `client/src/components/wellbeing/Gad7StylePanel.jsx`
- `client/src/components/wellbeing/PanasStylePanel.jsx`
- `client/src/components/wellbeing/Asrs5StylePanel.jsx`
- `client/src/components/wellbeing/Hexaco60Panel.jsx`
- `client/src/components/wellbeing/CerqStylePanel.jsx`
- `client/src/components/wellbeing/BriefCopeStylePanel.jsx`
- `client/src/components/wellbeing/CombinedProfilePanel.jsx`
- `client/src/components/wellbeing/ModelInsightPanel.jsx`
- `client/src/components/wellbeing/WellbeingCharts.jsx`
- `client/src/components/wellbeing/WellbeingVisualSummaryPanel.jsx`
- `client/src/components/wellbeing/QuizPurposePanel.jsx`

Navigation updates:

- `client/src/components/Layout.jsx`
- `client/src/components/mobile/MobileNavDropdown.jsx`

## Production Migration Notes

The wellbeing tables are created automatically on application boot. There is no separate migration script for this feature.

For production:

1. Deploy the code changes.
2. Ensure production has `APP_ENV=production`.
3. Ensure production uses the existing `DATABASE_URL`.
4. Ensure at least one text model is configured for users or inherited from the first admin through `vault_models`.
5. Restart the Node process so `server/db.js` creates the new attempt tables.
6. Run `npm run build` before release.
7. Smoke test the wellbeing dashboard, one test submission, combined profile gating, and reset flow with a non-production test user before enabling broad access.

Do not migrate local test result data into production unless explicitly intended.
