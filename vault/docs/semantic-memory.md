# Semantic memory

Vault personal memory uses embeddings for capture, deduplication, and semantic recall in chat.

## Overview

- **Table:** `memory` — `content`, `content_fingerprint`, `metadata`, `embedding vector(768)`, `embedding_source`, timestamps
- **Service:** `server/services/MemoryService.js`
- **Routes:** `server/routes/memory.js`
- **UI:** `/memory` (brain icon in top nav)

Memories are short factual notes — not full conversation logs. Claude can suggest saving them in chat; you can also add them manually on the Memory page.

## Embeddings

Resolved via `server/services/embeddingResolver.js`:

| Environment | Source |
|-------------|--------|
| `APP_ENV=local` | Ollama (`OLLAMA_EMBEDDING_MODEL`, default `nomic-embed-text`) |
| Production (Railway) | Gemini model from Settings → AI Models → **Embedding model** |

Rows store `embedding_source` so local and production vectors are not mixed. **Requires pgvector** on Postgres for vectors to persist; without it, list/search fall back to recent memories.

Local setup: `ollama pull nomic-embed-text`. Production: `GEMINI_API_KEY` on Railway.

## API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/memory` | List memories (triggers best-effort backfill of missing embeddings) |
| `POST` | `/api/memory` | Capture `{ content }` — dedupes by content fingerprint |
| `GET` | `/api/memory/search?q=` | Semantic search |
| `GET` | `/api/memory/stats` | Counts, embedding availability hint |
| `DELETE` | `/api/memory/:id` | Remove one memory |

## Chat integration

`buildSystemPrompt()` in `server/routes/chat.js` embeds the current user message and retrieves the **top 8** semantically relevant memories. If embeddings are unavailable, falls back to the most recent memories.

Replaces the old behaviour of injecting the last 30 memory rows on every turn.

## UI

- How-it-works section (local Ollama vs production Gemini)
- Stats line (total, searchable count, latest timestamp)
- Semantic search field
- Expandable memory rows with delete

## Related

- Embedding router (all RAG): `CHANGELOG.md` 2026-06-18 (2)
- User guide: `/guide` → Memory section
