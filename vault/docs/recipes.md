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

### Nutrition disclaimer

Every nutrition block (`estimatedCaloriesPerServing`, benefits/cautions/summary) is pure LLM output with **zero real nutritional-database backing**. A persistent disclaimer ("AI-estimated, not measured — for a real dietary need, verify with a nutrition label or dietitian.") is shown wherever nutrition is displayed — the expanded recipe panel and the saved-recipe viewer. Client component: `NutritionDisclaimer` in `RecipesPage.jsx` (this app has no shared `Callout` component — `UserGuidePage.jsx`'s is local to that file — so a lightweight equivalent matching its visual style lives here).

### Dietary & allergy restrictions

Unlike pantry staples, dietary restrictions previously existed only as free-text notes the model may or may not honor. A structured, deterministic system now backs the common cases:

- `server/services/recipeDietary.js` — `DIETARY_RESTRICTIONS`: vegetarian, vegan, gluten-free, dairy-free, nut-free, shellfish-free, egg-free, each with a practical (not exhaustive) keyword/ingredient exclusion list.
- **Prompt constraint** — `buildRestrictionPromptBlock()` injects the active restrictions as non-negotiable hard constraints into `buildSuggestPrompt`/`buildExpandPrompt`/`buildNamedSuggestPrompt`/`buildNamedExpandPrompt`.
- **Deterministic safety check** — `checkIngredientsAgainstRestrictions()` scans the model's own returned ingredient list against the keyword sets *after* generation and returns a `restrictionWarnings` array (`[{ restriction, ingredient, matchedTerm }]`) on `expand`/`named/expand` responses — this is the actual safety value: catching cases where the AI didn't fully comply, not trusting it blindly. Shown in the client as a red `RestrictionWarnings` banner.
- **Client** — `RestrictionPicker` renders a multi-select pill set (falls back to a hardcoded list mirroring the server ids/labels before `/api/recipes/status` loads) on both Leftover recipes and Recipe-by-name forms. Selected restrictions are sent as `restrictions: string[]` on `suggest`/`expand`/`named/suggest`/`named/expand` and round-tripped through the response so regenerating (selecting a card/tier) keeps them.
- **Honesty framing**: this is a **best-effort keyword filter, not a certified allergen database** — copy throughout says so explicitly.

### Serving-size scaling

An expanded recipe shows a **+/− servings stepper** (`ServingsStepper`). Scaling is deterministic and client-side — no second AI call:

- `client/src/utils/recipeScaling.js` — `scaleAmountString()`/`scaleIngredients()`, a lightweight leading-number-plus-unit parser (mixed numbers, fractions, decimals). Deliberately **not** a shared import of `recipeGroceryService.js`'s `parseQuantityFromLine`/`normalizeQuantity` — those exist to match ingredients against store product titles (normalizing to grams/ml for pricing); this only needs to scale a displayed amount.
- Only the `ingredients` array's `amount` field scales; **steps/instructions text is left as-is** — the UI notes "Ingredient amounts scale automatically; adjust cooking times/steps by eye for large changes."
- **Grocery pricing respects scaling**: `RecipeDetailPanel`'s "Get prices" button passes the currently-displayed (scaled) ingredients and serving count to `POST /api/recipes/grocery/price`, not the original AI-returned amounts.

### Meal plans

Combine several saved recipes into one merged, priced shopping list — previously grocery pricing only worked per single recipe or one ad-hoc list.

- **Tables**: `recipe_meal_plans` (id, userId, title, createdAt, updatedAt) and `recipe_meal_plan_items` (planId FK cascade delete, recipeId FK to `recipes` nullable — survives the recipe being deleted, title snapshot, servings, position).
- **Server**: `server/services/recipeMealPlans.js` — CRUD plus `priceMealPlan()`, which (a) scales each item's saved ingredients by `chosenServings / originalServings` (via `server/services/recipeQuantity.js`, a server-side twin of the client scaling util), (b) **merges duplicate ingredients across recipes** (`mergeIngredientLists()` — same-unit quantities sum into one line; mismatched units/qualifiers keep both amounts joined with `+` rather than guessing an equivalence), then (c) calls the existing `priceIngredients()` from `recipeGroceryService.js` **once** on the merged list — no forked pricing implementation.
- **Client**: new **Meal plan** tool (Shop group) — checkbox-select saved recipes with a per-recipe servings stepper, name and save a plan, view/delete saved plans, and **Price this plan** reuses `GroceryPriceResults` (same component the single-recipe and ad-hoc flows use).

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/recipes/status` | AI, image gen, web search availability + pantry staples + `dietaryRestrictions` list |
| `POST` | `/api/recipes/suggest` | `{ ingredients, notes?, restrictions? }` → four cards |
| `POST` | `/api/recipes/expand` | `{ recipe, ingredients, notes?, restrictions? }` → full recipe + links + `restrictionWarnings` |
| `POST` | `/api/recipes/named/suggest` | `{ name, notes?, restrictions? }` → Basic / Advanced / Master cards |
| `POST` | `/api/recipes/named/expand` | `{ name, tier, recipe, notes?, restrictions? }` → full recipe + swaps + image + `restrictionWarnings` |
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
| `GET` | `/api/recipes/meal-plans` | List saved meal plans (title, item count) |
| `POST` | `/api/recipes/meal-plans` | `{ title, items: [{ recipeId, servings }] }` → create a plan |
| `GET` | `/api/recipes/meal-plans/:id` | Single plan with items |
| `DELETE` | `/api/recipes/meal-plans/:id` | Remove a plan (cascades items) |
| `DELETE` | `/api/recipes/meal-plans/:id/items/:itemId` | Remove one recipe from a plan |
| `POST` | `/api/recipes/meal-plans/:id/price` | Scale + merge every recipe's ingredients, price once via the shared grocery pipeline |

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
