# Production Merge Notes

This note tracks the recent local-runtime and finance-position updates on the `local-runtime-config` branch. Use it as a checklist when deciding what to merge into the production branch (`version-7`) and what must remain local-only on the Mac Mini.

## Summary

The current branch adds two groups of changes:

- Local/runtime configuration so the same application code can run safely against a local Mac Mini PostgreSQL copy or Railway production.
- Finance UI improvements so the business-facing position is easier to understand than the accounting trial balance control totals.
- Local graphics generation so prompts can produce article/story support images through ComfyUI on the Mac Mini.

These changes should be reviewed and tested locally before merging into `version-7`, because they touch environment configuration, database selection, cron behavior, email behavior, web search behavior, Finance reporting UI, member/mobile access controls, and the new Graphics workflow.

## Changes That Should Migrate To Production

### Runtime Configuration

- Added a centralized server runtime config module: `server/config/runtime.js`.
- Runtime mode is controlled by `APP_ENV`.
- Production should use:

```env
APP_ENV=production
DATABASE_URL=<Railway PostgreSQL URL>
```

- Local development can use:

```env
APP_ENV=local
LOCAL_DATABASE_URL=<Mac Mini local PostgreSQL URL>
```

- Database connection selection now happens through runtime config:
  - `APP_ENV=local` uses `LOCAL_DATABASE_URL` when present.
  - Production uses `DATABASE_URL`.

### Admin Environment Visibility

- Added an Admin-only `Settings -> Environment` tab.
- The tab displays safe runtime details:
  - current `APP_ENV`
  - selected database URL source
  - masked database URL
  - app URL
  - local model provider details
  - local safety flag status

This is useful in production because it confirms Railway is booted as production and using `DATABASE_URL`, not a local database URL.

### Local Safety Flags

The app now supports environment-driven safety flags:

```env
DISABLE_EMAIL=true
DISABLE_EXTERNAL_CRON=true
DISABLE_WEB_SEARCH=true
```

These are intended mainly for local Mac Mini development.

Production should normally leave these unset or set to `false`, unless we intentionally want to disable one of those systems.

Affected behavior:

- `DISABLE_EMAIL=true` skips outbound email sends.
- `DISABLE_EXTERNAL_CRON=true` prevents scheduled news/shares cron jobs from starting.
- `DISABLE_WEB_SEARCH=true` disables the web search endpoint and shares-news web-search helper.

### Environment File Hygiene

- Expanded `.env.example` with:
  - `APP_ENV`
  - `DATABASE_URL`
  - `LOCAL_DATABASE_URL`
  - Ollama/local model placeholders
  - local safety flags

- Updated `.gitignore` to ignore:

```text
.env
.env.local
.env.*.local
```

This should migrate to production because it prevents accidental commits of local or production secrets.

### Finance Position Tab

- Added a new Finance menu item: `Position`.
- This is a business-facing view separate from the accounting `Balances` trial balance.
- It shows:
  - current cash position
  - money owed to you from unpaid sent invoices
  - credit cards owed
  - credit card credits/overpayments
  - net GST position
  - near-term position

The goal is to answer the practical question: "How much money do I have right now?" without confusing that with trial balance control totals.

### Finance Position Logic

- Cash position comes from the Bank / Cash ledger account.
- Money owed to you now comes from real unpaid `sent` invoices, not stale Accounts Receivable journal balances.
- Credit cards owed only counts positive liability balances.
- Card debit/overpayment balances are treated as card credits instead of debt.
- Near-term position is calculated as:

```text
cash + unpaid sent invoices + card credits - card debt - net GST payable
```

This is a practical snapshot, not a formal accounting statement.

### Graphics Prompt-To-Image

- Added a new top-bar `Graphics` icon next to YouTube.
- Added a `Graphics` page at `/graphics`.
- Added a backend route at `/api/graphics`.
- The local implementation calls ComfyUI running on the Mac Mini:

```env
IMAGE_PROVIDER=local-comfyui
LOCAL_IMAGE_API_URL=http://127.0.0.1:8188
LOCAL_IMAGE_MODEL=DreamShaper_8_pruned.safetensors
```

- The page supports a prompt, style presets, 512/768 square sizes, preview, and download.
- The backend submits a ComfyUI workflow, waits for completion, and returns the generated image as a data URL.
- The feature is configured locally for `DreamShaper_8_pruned.safetensors`; `sd_turbo.safetensors` was the earlier fast test model.
- Added an Admin `Settings -> AI & Chat -> Graphics model` setting (`graphics_model`) so production/local image model selection comes from settings first, with environment/default values only as fallbacks.
- The graphics model resolver now uses this order:
  - current user's `graphics_model`
  - first admin user's `graphics_model`
  - `LOCAL_IMAGE_MODEL`
  - server fallback
- Added image augmentation via ComfyUI img2img:
  - users can enter an augmentation prompt under a generated image
  - users can choose subtle, medium, or strong change strength
  - the current generated image is uploaded back to ComfyUI as the seed image
- Added a saved Graphics gallery:
  - saved images are stored in the app database in `graphics_gallery`
  - users can save, reopen, download, and delete gallery images
- Added generation and preview modals:
  - creation modal appears while image generation or augmentation is running
  - clicking a generated image or gallery thumbnail opens a larger preview modal
- The earlier multi-alternative generation UI was removed to reduce user overload. Graphics now generates one image at a time.

### Graphics Admin Safety Controls

- Added Admin `Settings -> Content Restrictions`.
- Admins can add/remove rows such as:

```text
graphic nudity
gore
realistic violence
```

- Graphics generation now uses those restrictions in two places:
  - prompt refinement instructions
  - ComfyUI negative prompt terms
- Added a pre-generation restriction warning:
  - the prompt is checked before generation starts
  - common variants such as `nude`, `nudity`, and `naked` are matched against nudity restrictions
  - the user can cancel before generation
  - if the user continues, restrictions still apply and the refined prompt may remove or redirect restricted content

This is prompt-based protection, not a full image moderation classifier. It should be treated as a practical guardrail rather than a guarantee.

### Global Access And Mobile Settings

- `Settings -> Feature Access` already controls member access to features.
- Added/confirmed `Graphics` as a member feature toggle.
- Admins always retain access regardless of member feature toggles.
- `Settings -> Mobile` now saves mobile dashboard/navigation configuration to `workspace_settings` instead of per-user settings.
- Mobile visibility is now a global admin setting:
  - `Settings -> Mobile` controls whether `Graphics` appears on mobile
  - `Settings -> Feature Access` controls whether members can use `Graphics`
  - Admins keep access to enabled mobile routes
- Mobile dashboard/navigation reads the workspace-wide mobile config through `/api/settings/mobile`.

Production note: Railway should not use the local ComfyUI provider. When image generation is needed in production, implement the hosted Seedance provider path behind the same `/api/graphics/generate` interface. The Railway API key variable is:

```env
IMAGE_PROVIDER=seedance
SEEDANCE_API_KEY=<Seedance API key>
```

## Local-Only Changes That Should Not Migrate

### Real `.env`

The real `vault/.env` file was created/updated locally only. It contains the local generated database password and must not be committed.

It should remain ignored by git.

### Local PostgreSQL Role

A local-only PostgreSQL role was created in the Mac Mini Docker PostgreSQL container:

```text
vault_local
```

That user and generated password are only for the local `vault` database copy. They are not part of the repository and should not be migrated to Railway.

### Local ComfyUI Install And Model

ComfyUI and the downloaded image model live outside the repository:

```text
~/AI/ComfyUI
~/AI/ComfyUI/models/checkpoints/sd_turbo.safetensors
~/AI/ComfyUI/models/checkpoints/DreamShaper_8_pruned.safetensors
```

These are local machine assets and should not be committed or migrated to Railway.

### Local Database Data

The local PostgreSQL database is a restored Railway backup. It is for testing only.

Do not push or restore this local database back to Railway unless explicitly intending to overwrite production data.

## Production Environment Checklist

Before merging to `version-7` and deploying on Railway:

- Confirm Railway has `APP_ENV=production`.
- Confirm Railway has the existing production `DATABASE_URL`.
- Do not add `LOCAL_DATABASE_URL` to Railway.
- Confirm these are unset or intentionally false in Railway:
  - `DISABLE_EMAIL`
  - `DISABLE_EXTERNAL_CRON`
  - `DISABLE_WEB_SEARCH`
- Confirm existing Railway model/API variables remain unchanged.
- Confirm Railway has `SEEDANCE_API_KEY` if `IMAGE_PROVIDER=seedance` is enabled.
- Confirm Admin `Settings -> AI & Chat -> Graphics model` is set for production if production image generation is enabled.
- Confirm Admin `Settings -> Content Restrictions` contains the desired production restrictions before enabling Graphics for members.
- Confirm Admin `Settings -> Feature Access -> Graphics` is set appropriately for members.
- Confirm Admin `Settings -> Mobile` has Graphics enabled/disabled appropriately for mobile users.
- Do not add local ComfyUI values to Railway:
  - `LOCAL_IMAGE_API_URL=http://127.0.0.1:8188`
  - `LOCAL_IMAGE_MODEL=DreamShaper_8_pruned.safetensors`
- Confirm Admin `Settings -> Environment` shows:
  - `APP_ENV=production`
  - Database source: `DATABASE_URL`
  - masked Railway database URL

## Local Test Checklist Before Merge

On the Mac Mini local environment:

- Run the app locally with `npm run dev`.
- Confirm `Settings -> Environment` shows:
  - `APP_ENV=local`
  - Database source: `LOCAL_DATABASE_URL`
  - local database host `localhost:5432`
  - email disabled
  - external cron disabled
  - web search disabled
- Open `Finance -> Position`.
- Confirm it shows a practical cash/receivables/cards/GST view.
- Confirm `Finance -> Balances` still exists as the accounting trial balance.
- Open `Graphics`.
- Confirm ComfyUI status is ready.
- Confirm `Settings -> AI & Chat -> Graphics model` shows or accepts `DreamShaper_8_pruned.safetensors`.
- Generate a small 512 x 512 test image.
- Confirm the creation modal appears while generating.
- Click the generated image and confirm the preview modal opens.
- Use `Augment` on a generated image and confirm a revised image returns.
- Save an image to Gallery, reopen it, then delete it.
- Add a test content restriction in `Settings -> Content Restrictions`, then confirm a matching Graphics prompt shows the warning before generation.
- Confirm `Settings -> Mobile` controls Graphics mobile visibility globally.
- Confirm `Settings -> Feature Access` controls member access while admins retain access.
- Confirm build passes with `npm run build`.

## Known Follow-Up Work

These issues were discovered while investigating Finance balances and should be handled separately:

- Some source deletes can leave stale journal entries behind.
  - Invoice delete should remove related invoice/payment journals.
  - Expense delete should remove related expense journals.
  - Wage delete should remove related wage journals.
  - Credit-card unsettle should remove or reverse related settlement journals.
- Manual journal entries should be validated server-side.
  - Debits should equal credits.
  - Account IDs should belong to the current user.
- A cleanup/repair tool may be needed for orphaned journal entries already present in the database.
- The Trial Balance bottom total should be labelled as a control total, not presented as a business metric.

## Current Local Observations

From the local restored database:

- Trial balance debits and credits currently match.
- The large trial balance total is an accounting control total, not revenue, cash, spend, or profit.
- A stale `$2.20` Accounts Receivable journal was found from an invoice source that no longer exists.
- Credit card presentation needed sign handling so overpaid/debit card balances are not displayed as debt.

These observations should guide future finance cleanup work, but they do not require migrating local data to production.
