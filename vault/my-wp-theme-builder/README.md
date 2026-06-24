# WP Theme Builder

Express app for Curam Vault: wireframe → design → WordPress theme export.

**Full documentation:** [../docs/theme-builder.md](../docs/theme-builder.md) (model policy, env vars, Vault integration).

## Quick start (local)

From `vault/`:

```bash
npm run dev
```

Open **http://localhost:5173/tb/?embedded=1** (or Tools → WP Theme Builder in the Vault UI).

Requires:

- Ollama running for local Stage 1 (`ollama pull qwen2.5-coder:14b`)
- `THEME_BUILDER_DEV_DESIGN_MODEL=ollama:qwen2.5-coder:14b` in `vault/.env` (see `vault/.env.example`)
- Postgres (`LOCAL_DATABASE_URL`) if using DB-backed sessions

Standalone (without Vault shell): `npm start` in this directory (port `3100`).

## Model policy (summary)

- **Local:** Ollama unless you set `THEME_BUILDER_DESIGN_MODEL` or **Theme builder design model** in Settings.
- **Production:** Vault `default_model` / `vault_models` unless Theme Builder app overrides are set.
- **Never** hardcode cloud model ids in code — use env, Settings, or `themeBuilderModel.js` resolution only.

See [docs/theme-builder.md](../docs/theme-builder.md).
