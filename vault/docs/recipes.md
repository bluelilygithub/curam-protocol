# Recipes

Leftover-based recipe assistant at **`/recipes`**. List what you have in the fridge or pantry; the AI suggests four dish ideas, then expands your pick into full steps, nutrition notes, optional dish photo, and web links. Save favourites to a personal library with category tags.

**Frontend:** `vault/client/src/pages/RecipesPage.jsx`  
**Backend:** `vault/server/routes/recipes.js` · `vault/server/services/recipeService.js` · `vault/server/services/graphicsImageService.js` (dish photos — shared Graphics model routing)  
**Table:** `recipes` (JSONB `payload` + optional `imageDataUrl`)

---

## Flow

1. **Leftover recipes** — enter ingredients (e.g. canned tuna, mushrooms, pasta, milk, rice, eggplant) and optional notes (servings, preferences, no oven, etc.).
2. **Suggest** — `POST /api/recipes/suggest` returns **four recipe cards** (title, summary, time, meal type, tags). Pantry staples are always assumed: **salt, pepper, olive oil**.
3. **Pick one** — `POST /api/recipes/expand` returns full **ingredients**, numbered **steps**, **nutrition** (summary, benefits, cautions, rough calories), and **links** from web search (YouTube videos + similar articles).
4. **Dish photo** — `POST /api/recipes/image` delegates to **`graphicsImageService`** (same **`graphics_model`** as Settings → AI & Chat + `FAL_API_KEY` on Railway).
5. **Save** — `POST /api/recipes/library` with chosen **tags** (breakfast, lunch, dinner, curry, pasta, fast, slow, etc.).

**My recipes** — browse saved items, filter by tag, expand to view steps, delete with inline confirm.

All long operations use the global **ProcessingModal**.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/recipes/status` | AI, image gen, web search availability + pantry staples |
| `POST` | `/api/recipes/suggest` | `{ ingredients, notes? }` → four cards |
| `POST` | `/api/recipes/expand` | `{ recipe, ingredients, notes? }` → full recipe + links |
| `POST` | `/api/recipes/image` | `{ title, imagePrompt }` → `{ imageDataUrl }` |
| `GET` | `/api/recipes/library` | List saved; `?tag=fast` filters |
| `POST` | `/api/recipes/library` | Save favourite |
| `GET` | `/api/recipes/library/:id` | Single item |
| `PATCH` | `/api/recipes/library/:id` | Update title, tags, payload, image |
| `DELETE` | `/api/recipes/library/:id` | Remove |

Feature flag: **`recipes`** (Settings → Feature Access).

---

## Model routing

| Step | Resolver | Settings key |
|---|---|---|
| Suggest + expand (text) | `getModelsForUser()` → **`standard`** | `default_model` / first in `vault_models` |
| Dish photo | **`graphicsImageService.generateImage()`** | **`graphics_model`** (Settings → AI & Chat) |

No hardcoded model ids for text. Images reuse the same FAL endpoint and `graphics_model` as the Graphics app (`FAL_API_KEY` on Railway).

---

## Environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | Recipe suggest + expand |
| `FAL_API_KEY` | Dish image generation (via Graphics model routing) |
| `SEARCH_API_KEY` | Video/article links on expand (Brave/Serper/SerpAPI via `webSearchService`) |

Dish images use **`graphics_model`** from Settings → AI & Chat (same as the Graphics app), not a separate recipe model.

---

## Tags

Built-in picker options: breakfast, lunch, dinner, snack, curry, pasta, rice, soup, salad, fast, slow, vegetarian, vegan, leftovers, comfort, healthy. Stored as PostgreSQL `TEXT[]` on the `recipes` row; filter with `?tag=`.
