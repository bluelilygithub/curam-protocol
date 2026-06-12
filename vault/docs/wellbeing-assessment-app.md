# Wellbeing & Personality Checks

## Purpose

The Wellbeing & Personality Checks area is a proof-of-concept self-report app inside Curam Vault. It is accessed through the heart-pulse icon and is intended for personal reflection only.

It is not medical advice, a diagnostic assessment, a clinical risk assessment, or a substitute for a qualified professional.

## Dashboard

The heart-pulse navigation always returns the user to the wellbeing dashboard. The dashboard is the launch point for all tests, paused mood drafts, combined profile access, past mood attempts, and the reset flow.

The dashboard includes:

- A BDI-style mood check.
- An IPIP-NEO-120 personality inventory.
- A CERQ-style cognitive coping check.
- A Brief COPE-style coping check.
- A Combined Profile option that unlocks only after all four tests are completed.
- A reset/erase action for all wellbeing test data.

## Tests

### BDI-Style Mood Check

The mood check is inspired by common BDI-style symptom domains. It uses 21 ordered questions scored from 0 to 3, with optional reflections on each item.

The result includes:

- Total score out of 63.
- Symptom band.
- Safety flag handling for self-harm related responses.
- Strongest symptom signals.
- Deeper model-assisted formulation.
- Suggested next steps.
- Full response review.
- PDF export.

### IPIP-NEO-120 Personality Inventory

The IPIP-NEO-120 profile uses public-domain IPIP-style personality items across five broad domains and 30 facets.

The result includes:

- Domain scores.
- Facet scores.
- Strongest facet signals.
- Reverse-scored item handling.
- Deeper model-assisted formulation.
- PDF export.

### CERQ-Style Cognitive Coping Check

The CERQ-style check is inspired by Cognitive Emotion Regulation Questionnaire strategy areas, but uses original proof-of-concept item wording. It is not the official CERQ.

The result includes:

- Nine cognitive emotion-regulation strategy scores.
- Most frequent cognitive coping strategies.
- Helpful, mixed, and less-helpful strategy context.
- Deeper model-assisted formulation.
- PDF export.

### Brief COPE-Style Coping Check

The Brief COPE-style check is inspired by Brief COPE scale areas, with original proof-of-concept item wording. It does not produce a single overall coping score.

The result includes:

- Fourteen coping strategy scores.
- Family-level coping patterns.
- Strongest behavioural coping responses.
- Deeper model-assisted formulation.
- PDF export.

## Combined Profile

The Combined Profile is the fifth option. It is locked until the user has completed all four tests at least once.

When generated, it uses the latest completed result from each test and produces a detailed profile covering:

- Overall formulation.
- Mood and energy context.
- Personality pattern.
- Cognitive coping pattern.
- Behavioural coping pattern.
- Reinforcing themes across tests.
- Tensions and qualifications.
- Strengths and supports.
- Growth edges.
- Reflection questions.

The combined profile is generated through the configured model where available, using the app's provider-agnostic model path. If model generation fails or no model is configured, a deterministic fallback formulation is returned.

The combined profile can be downloaded as a PDF. The PDF uses the profile currently shown on screen so the exported report matches the generated text.

## Drafts And Navigation

All four tests support pause/resume and back navigation.

Paused drafts are stored in browser `localStorage` on the current device:

- `curam:wellbeing-mood:draft`
- `curam:ipip-neo-120:draft`
- `curam:cerq-style:draft`
- `curam:brief-cope-style:draft`

Completed attempts are stored in PostgreSQL.

## Reset / Erase All Tests

The dashboard includes a reset action that:

- Deletes all completed mood attempts for the current user.
- Deletes all completed IPIP-NEO-120 attempts for the current user.
- Deletes all completed CERQ-style attempts for the current user.
- Deletes all completed Brief COPE-style attempts for the current user.
- Clears paused local drafts on the current device.

The reset action requires browser confirmation before running.

## Backend

Main route file:

- `server/routes/wellbeing.js`

Service files:

- `server/services/wellbeingPdf.js`
- `server/services/ipipNeo120.js`
- `server/services/cerqStyle.js`
- `server/services/briefCopeStyle.js`
- `server/services/wellbeingModelInsights.js`
- `server/services/combinedProfilePdf.js`

Database tables:

- `wellbeing_attempts`
- `ipip_neo_attempts`
- `cerq_attempts`
- `cope_attempts`

The tables are created idempotently during app startup by `server/db.js`.

## Frontend

Main page:

- `client/src/pages/WellbeingPage.jsx`

Components:

- `client/src/components/wellbeing/IpipNeo120Panel.jsx`
- `client/src/components/wellbeing/CerqStylePanel.jsx`
- `client/src/components/wellbeing/BriefCopeStylePanel.jsx`
- `client/src/components/wellbeing/CombinedProfilePanel.jsx`
- `client/src/components/wellbeing/ModelInsightPanel.jsx`

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
