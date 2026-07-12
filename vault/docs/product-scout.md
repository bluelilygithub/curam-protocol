# Product Scout

Unbiased purchasing agent: Amazon search → LLM value scoring → cross-market alternatives.

## Architecture

| Layer | Location |
|-------|----------|
| **CLI (Python)** | `product-scout/` — standalone `python main.py "query"` |
| **Vault API** | `POST /api/product-scout/run` → `productScoutService.js` |
| **UI** | `/product-scout` — Apps → Content tools → Product Scout |
| **History** | `product_scout_runs` table (JSONB result per run) |

Both CLI and Vault API implement the same pipeline:

1. **Rainforest API** — plain Amazon search (top 8–10), not sponsored picks
2. **LLM** — structured JSON comparison, top 3 by value score (`getModelsForUser` → `standard` tier in Vault)
3. **Web search** — external alternatives (`SEARCH_API_KEY`, same as chat `@search`)

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `RAINFOREST_API_KEY` | Yes | Amazon product/search data |
| `AMAZON_DOMAIN` | No | Default `amazon.com` (use `amazon.com.au` for AU) |
| `ANTHROPIC_API_KEY` | Yes* | LLM scoring (*or Gemini via vault_models) |
| `SEARCH_API_KEY` | Recommended | Cross-market step |
| `SEARCH_PROVIDER` | No | `brave` \| `serper` \| `serpapi` |

CLI-only LLM vars: see `product-scout/.env.example` (`LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY`, …).

## API

```
GET  /api/product-scout/config-check   — key presence (no secrets)
GET  /api/product-scout/runs           — recent runs for user
GET  /api/product-scout/runs/:id       — single run
POST /api/product-scout/run            — { "query": "..." }
```

Feature flag: `productScout` in Settings → Feature Access.

## Suggestions inbox

`productScout` emitter calls `SuggestionService.captureIf` when cross-market search returns no external results (`category: source`).

## CLI usage

```bash
cd product-scout
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py "standing desk mat" --json
```

See `product-scout/README.md` for full CLI docs.

## Design notes

- **Value score** — LLM judges features/specs vs price and review quality, not Amazon rank
- **Non-circular check** — web query excludes `amazon.com` / `amazon.com.au`
- **No hardcoded model** — Vault uses Settings; CLI uses `LLM_PROVIDER` env
