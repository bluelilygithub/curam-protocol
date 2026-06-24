# WP Theme Builder

Stage 1 wireframe → homepage design → Stage 2 WordPress theme export. Mounted in Vault at **`/tb`** (iframe from **Tools → WP Theme Builder**).

**Code:** `vault/my-wp-theme-builder/`  
**Local dev:** `npm run dev` from `vault/` (Vite `5173` + Vault server `3001`; `/tb` proxied to the theme-builder API).

---

## Runtime environments

| | **Local (`APP_ENV=local`)** | **Production (`APP_ENV=production`)** |
|---|---|---|
| **LLM default** | Ollama on the Mac (no paid API calls unless configured) | Cloud models from Vault Settings (`vault_models`, API keys in Railway) |
| **Typical dev setup** | `THEME_BUILDER_DEV_DESIGN_MODEL=ollama:qwen2.5-coder:14b` in `vault/.env` | `THEME_BUILDER_DESIGN_MODEL` or Settings → **Theme builder design model** |
| **Embeddings** | Ollama (`embeddingResolver`) | Gemini from Settings |

**Rule:** Do not route Theme Builder to external paid APIs in local dev unless the user has set an explicit override (`THEME_BUILDER_DESIGN_MODEL`, workspace **Theme builder design model**, or Vault default that points at a cloud id). Production uses Vault defaults and configured API keys per platform docs.

---

## Model resolution (Stage 1)

Implemented in `my-wp-theme-builder/utils/themeBuilderModel.js` → `resolveThemeBuilderDesignModel()`.

**Vault workspace defaults** (`vault_models` + `default_model`, resolved by `getModelsForUser()` in `server/services/modelResolver.js`) apply to the whole platform. Theme Builder only overrides them when an **app-specific** setting is present.

### Priority (first match wins)

| # | Source | Scope |
|---|--------|--------|
| 1 | Request body `model` | Single call |
| 2 | `THEME_BUILDER_DESIGN_MODEL` or `THEME_BUILDER_STAGE1_MODEL` | All environments |
| 3 | `THEME_BUILDER_DEV_DESIGN_MODEL` | **Local only** (`APP_ENV=local`) |
| 4 | `workspace_settings.theme_builder_design_model` | App override — Settings → AI & Chat → **Theme builder design model** (admin) |
| 5 | Vault `default_model` | Workspace default (unless overridden above) |
| 6 | Vault model tiers (`standard`, `light`, `ollama`, …) | From `vault_models` order |
| 7 | Local Ollama fallback | `APP_ENV=local` only, when nothing else is configured |

### Stage-specific notes

| Stage | Model resolver | Notes |
|-------|----------------|-------|
| Wireframe generation | `resolveStage1Model` | Same priority as above |
| Homepage design (`POST /generate/design-home`) | `resolveStage1Model` | Same priority; wireframe HTML is compacted before prompt |
| CSS-only iterate (colour, spacing) | `resolveCssIterateModel` | Prefers `THEME_BUILDER_CSS_ITERATE_MODEL` / local Ollama |
| Structural iterate | `resolveIterateModel` | Same as Stage 1 unless CSS-only |
| Stage 2 theme ZIP | `resolveStage2Model` | `THEME_BUILDER_STAGE2_MODEL` or Vault tiers |

### Settings UI

**Settings → AI & Chat:**

- **Default model** — Vault-wide `default_model` (chat, projects, and Theme Builder when no app override).
- **Theme builder design model** — writes `workspace_settings.theme_builder_design_model`. Empty = fall through to Vault defaults (and in local dev, `THEME_BUILDER_DEV_DESIGN_MODEL` if set).

The select shows **Currently resolves to** via `GET /api/settings/theme-builder-design-model`.

### Environment variables

See `vault/.env.example` and `my-wp-theme-builder/.env.example`.

```bash
# Local dev — app override for Stage 1 (recommended)
THEME_BUILDER_DEV_DESIGN_MODEL=ollama:qwen2.5-coder:14b

# Any environment — beats Settings UI and dev override
# THEME_BUILDER_DESIGN_MODEL=claude-sonnet-4-6

# CSS-only iterations (local Qwen)
# THEME_BUILDER_CSS_ITERATE_MODEL=ollama:qwen2.5-coder:14b
# THEME_BUILDER_ITERATE_MODEL=ollama:qwen2.5-coder:14b

# Stage 2 WordPress export
# THEME_BUILDER_STAGE2_MODEL=ollama:qwen2.5-coder:14b

# Lessons → Vault Memory (shared DB)
# THEME_BUILDER_VAULT_USER_ID=1
```

---

## Product flow (Stage 1)

1. **Brief** — intake wizard  
2. **Wireframe** — structure-only preview; iterate with element picker (`tb-pick-*` ids)  
3. **Approve wireframe & build homepage** — snapshots approved wireframe, runs homepage design  
4. **Design preview** — polish pass; toolbar shows **Back To Projects** (no **Start new brief** on preview)  
5. **Approve design** → Stage 2 WP wizard  

On wireframe approve, iterate styles (inline picks, `tb-pick-styles`, `style.css` targets) consolidate into `style.css` and `stage1/wireframe-approved.*`.

---

## API mount

Vault mounts the theme-builder Express app at `/tb` (`server/index.js` → `createThemeBuilderApp`). Vite proxies `/tb` to port `3001` in local dev.

---

## Related docs

- [Model selection in CLAUDE.md](../CLAUDE.md#model-selection) — Vault `vault_models` / `default_model`  
- [Local database recovery](./local-database-recovery.md) — shared Postgres for sessions + memory  
- [Embedding router](./semantic-memory.md) — Ollama local vs Gemini production  
