# Recipes

Leftover-based recipe assistant at **`/recipes`**. List what you have in the fridge or pantry; the AI suggests four dish ideas, then expands your pick into full steps, nutrition notes, optional dish photo, and web links. Save favourites to a personal library with category tags.

**Frontend:** `vault/client/src/pages/RecipesPage.jsx`  
**Backend:** `vault/server/routes/recipes.js` · `vault/server/services/recipeService.js` · `vault/server/services/graphicsImageService.js` (dish photos — shared Graphics model routing)  
**Table:** `recipes` (JSONB `payload` + optional `imageDataUrl`)

---

## Flow

1. **Leftover recipes** — enter ingredients (e.g. canned tuna, mushrooms, pasta, milk, rice, eggplant) and optional notes (servings, preferences, no oven, etc.).
2. **Suggest** — `POST /api/recipes/suggest` returns **four recipe cards** (title, summary, time, meal type, tags). Pantry staples are always assumed: **salt, pepper, olive oil**.
3. **Pick one** — `POST /api/recipes/expand` returns full **ingredients**, numbered **steps**, **nutrition** (summary, benefits, cautions, rough calories), **links** from web search (YouTube videos + similar articles), and an **auto-generated dish photo** when Graphics image generation is configured.
4. **Dish photo** — generated automatically during expand via **`graphicsImageService`** (admin **`graphics_model`** + `FAL_API_KEY`). Use `POST /api/recipes/image` only to regenerate.
5. **Save** — `POST /api/recipes/library` with chosen **tags** (breakfast, lunch, dinner, curry, pasta, fast, slow, etc.).

### Recipe by name

1. Enter a **dish name** (e.g. Green Curry) and optional notes.
2. **Show levels** — `POST /api/recipes/named/suggest` returns **Basic**, **Advanced**, and **Master** preview cards.
3. **Pick a level** — `POST /api/recipes/named/expand` returns full recipe with **accessible ingredient alternatives** for exotic items, auto dish photo, nutrition, and links.
4. **Save** — same library flow with tags.

### Grocery prices (Australia)

1. From any open recipe (leftovers or by name), tap **Get prices** in the **Grocery prices** section under the recipe — no page change, no second tool.
2. `POST /api/recipes/grocery/price` looks up each ingredient via **live product search** (Google Shopping via Serper/SerpApi, or organic `site:coles.com.au` / `site:woolworths.com.au` search as fallback) — no AI guessing, no text model required. Each priced row links back to its source listing.
3. Items with no matching listing show **"Not found"** plus a direct link to search that store manually — never a fabricated price.
4. **Shop → Grocery prices** (Shop group) is the same tool for a manual, ad-hoc shopping list not tied to a recipe.

A hit only counts as a store match when the result's own URL is on `coles.com.au`/`woolworths.com.au`, or its `source` field names that store exactly — matching on title text alone was accepting unrelated listings (comparison sites, "vs" articles) that merely mentioned the store name. The store **total** is one consistent per-item pick (`recipePrice` if the quantity was comparable to the pack, else the pack `checkoutPrice`) summed once — it no longer sums `recipePrice` and `checkoutPrice` as two separate pools, which used to drop or double-count rows and make the total not match the line items shown.

**Form-mismatch guard:** a generic scoring penalty (`FORM_MISMATCH_WORDS` in `recipeGroceryService.js`) knocks down any matched title containing powder/dried/dehydrated/concentrate/granules/instant/condensed/evaporated/crystals/extract/essence unless the ingredient line itself asked for that form — covers new cases (milk powder, stock concentrate, etc) without a hand-written avoid rule per ingredient. Milk additionally excludes lactose-free/a2/plant-milk lines (product-line variants, not physical form).

**Pantry staples skipped:** salt, pepper, and olive oil (`PANTRY_STAPLES` in `recipeService.js`) are assumed already on hand and never priced — `isPantryStapleLine()` in `recipeGroceryService.js` excludes them before the search runs (bell pepper etc still price normally). The panel's note line says which staples were skipped.

**Correction glossary:** each priced row has a "This looks wrong" link. Typing what's wrong (e.g. *"that's a 12-pack, not 10"*) calls `POST /api/recipes/grocery/feedback`, which sends the note + ingredient + matched product to the `light` model (`recipeGroceryCorrections.js` → `learnFromFeedback`) to turn it into a structured rule — `avoid_keyword`, `prefer_keyword`, or `pack_override` — saved to `recipe_grocery_corrections` (workspace-shared, keyed by a generic `ingredientTerm` matched by substring against future ingredient lines), then immediately re-prices that one ingredient with the correction applied. `buildProductSpec()` folds saved keyword corrections into the same `avoidHints`/`variantHints` the built-in variant rules use; `resolvePackSize()` checks for a matching `pack_override` before parsing the title or falling back to a guessed default. A "Learned corrections" list under the results table shows and lets you remove saved rules. API: `GET /api/recipes/grocery/corrections`, `POST /api/recipes/grocery/feedback`, `DELETE /api/recipes/grocery/corrections/:id`. Table: `recipe_grocery_corrections`.

Requires **`SERPER_SEARCH_API_KEY`** on Railway (default provider **Serper**). Add **Shopping search** in **Settings → AI & Chat → AI Models** (provider Serper or SerpAPI) — same row pattern as other models, with **Key set / Key missing**. Chat **`SEARCH_API_KEY`** (e.g. Brave) stays separate for `@search`.

**My recipes** — browse saved items, filter by tag, expand to view steps, delete with inline confirm.

All long operations use the global **ProcessingModal**.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/recipes/status` | AI, image gen, web search availability + pantry staples |
| `POST` | `/api/recipes/suggest` | `{ ingredients, notes? }` → four cards |
| `POST` | `/api/recipes/expand` | `{ recipe, ingredients, notes? }` → full recipe + links |
| `POST` | `/api/recipes/named/suggest` | `{ name, notes? }` → Basic / Advanced / Master cards |
| `POST` | `/api/recipes/named/expand` | `{ name, tier, recipe, notes? }` → full recipe + swaps + image |
| `POST` | `/api/recipes/grocery/price` | `{ ingredients, recipeIngredients? }` → sourced Coles/Woolworths prices + links |
| `GET` | `/api/recipes/grocery/corrections` | List the learned correction glossary |
| `POST` | `/api/recipes/grocery/feedback` | `{ ingredient, store?, note, matchedProduct? }` → saves a correction + re-prices that ingredient |
| `DELETE` | `/api/recipes/grocery/corrections/:id` | Remove a learned correction |
| `POST` | `/api/recipes/image` | Regenerate dish photo `{ title, imagePrompt }` → `{ imageDataUrl }` |
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
| Suggest / tier preview (text) | `pickTextModel` → **`light`** (same tier as Video prompt expand) | `vault_models` chat models |
| Expand full recipe (text) | `pickTextModel` → **`standard`** with fallbacks | `default_model` / `vault_models` |
| Dish photo | **`graphicsImageService.generateImage()`** | **`graphics_model`** (Settings → AI & Chat) |

Image and video generation models (`fal`, `replicate`, etc.) in `vault_models` are excluded from text routing — same rules as chat. Dish photos use **`graphics_model`**, identical to the Graphics app.

---

## Environment

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` | Recipe suggest + expand |
| `FAL_API_KEY` | Dish image generation (via Graphics model routing) |
| `SEARCH_API_KEY` | Video/article links on expand (Brave/Serper/SerpAPI via `webSearchService`) |
| `SERPER_SEARCH_API_KEY` | **Grocery prices** — Serper Google Shopping. Set in Settings → AI & Chat (admin) or Railway env. |

Dish images use **`graphics_model`** from Settings → AI & Chat (same as the Graphics app), not a separate recipe model.

---

## Tags

Built-in picker options: breakfast, lunch, dinner, snack, curry, pasta, rice, soup, salad, fast, slow, vegetarian, vegan, leftovers, comfort, healthy. Stored as PostgreSQL `TEXT[]` on the `recipes` row; filter with `?tag=`.
