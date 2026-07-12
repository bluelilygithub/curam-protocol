# product-scout

CLI tool for **unbiased purchasing decisions**: fetch Amazon search results, score with your configured LLM, and cross-check non-Amazon alternatives.

Also available inside **Curam Vault** at `/product-scout` (uses the same pipeline via the Node API).

## Workflow

1. **Amazon search** — Rainforest API returns top 8–10 plain search results (title, price, rating, reviews, feature bullets).
2. **LLM scoring** — compares all candidates on **value** (features vs price), returns structured JSON top 3.
3. **Cross-market check** — web search for alternatives outside Amazon (Brave / Serper / SerpAPI).
4. **Output** — markdown table + external links, or `--json` for raw data.

## Setup

```bash
cd product-scout
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your keys
```

## Required API keys

| Key | Purpose |
|-----|---------|
| `RAINFOREST_API_KEY` | Amazon search/product data ([Rainforest API](https://www.rainforestapi.com/)) |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | LLM comparison (see `LLM_PROVIDER`) |
| `SEARCH_API_KEY` | Cross-market web search (optional but recommended) |

Vault uses the same `SEARCH_API_KEY` / `SEARCH_PROVIDER` as chat `@search`.

### LLM configuration

Set in `.env`:

```env
LLM_PROVIDER=anthropic          # anthropic | openai | openai_compatible
LLM_MODEL=claude-sonnet-4-20250514
ANTHROPIC_API_KEY=sk-ant-...
```

For OpenAI or a local OpenAI-compatible server (Ollama, LM Studio):

```env
LLM_PROVIDER=openai_compatible
LLM_MODEL=gpt-4o
OPENAI_API_KEY=...
OPENAI_BASE_URL=http://localhost:11434/v1   # optional
```

## Usage

```bash
python main.py "wireless noise cancelling earbuds under $150"
python main.py "standing desk mat" --json
```

## Project layout

| File | Role |
|------|------|
| `main.py` | CLI entrypoint |
| `amazon.py` | Rainforest API search |
| `compare.py` | LLM scoring + structured JSON |
| `websearch.py` | Cross-market search |
| `llm.py` | Provider-agnostic `generate()` / `generate_json()` |

## Vault integration

- **UI:** Apps → **Product Scout** (`/product-scout`)
- **API:** `POST /api/product-scout/run` `{ "query": "..." }`
- **Env (Railway):** add `RAINFOREST_API_KEY` alongside existing `ANTHROPIC_API_KEY` and `SEARCH_API_KEY`

See `docs/product-scout.md` in the Vault repo root.

## Errors

- Missing keys → clear message naming the env var
- Empty Amazon results → exit 1
- Rainforest 429 → rate limit message
- Invalid LLM JSON → shows parse error snippet
