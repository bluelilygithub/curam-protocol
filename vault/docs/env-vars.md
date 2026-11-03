# Environment variables

Moved out of CLAUDE.md.

| Var | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude |
| `GEMINI_API_KEY` | Gemini + embeddings |
| `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` | Gmail, Calendar, Drive OAuth |
| `ENCRYPTION_KEY` | Encrypts stored OAuth tokens — **do not lose** |
| `DATABASE_URL` | PostgreSQL connection |
| `UPLOAD_DIR` | Railway volume mount path |
| `ATTACHMENT_QUOTA_MB` | Per-user total storage cap for touchpoint/task attachments (default 500) — `server/utils/attachments.js` |
| `FIN_DOC_MAX_MB` / `FIN_DOC_QUOTA_MB` | Finance → Documents — largest single upload (default 20) and total per user (default 1000); files live under `UPLOAD_DIR/finance-docs/<userId>/` (`server/routes/financeDocuments.js`) |
| `APP_URL` | Public URL (OAuth redirects, password reset emails) |
| `SEED_EMAIL` / `SEED_PASSWORD` | Auto-created user on first boot |
| `INVITE_CODE` | **No longer used.** Public sign-up was closed 2026-10-16: `POST /api/auth/register` always returns 403. Accounts are created by an admin (Admin page, `POST /api/admin/users`) or a Wellbeing invite. |
| `FINNHUB_API_KEY` | Shares — NYSE/NASDAQ quotes + company news (free tier, no IP block on Railway) |
| `ALPHA_VANTAGE_API_KEY` | Shares — ASX quotes (free tier: 25 req/day; cron polls 2×/day + 15 min cache for UI) |
| `DOMSCAN_API_KEY` | Domain & Brand — DomScan API (10,000 free credits/month); used by `server/routes/domains.js` |
| `RAINFOREST_API_KEY` | Product Scout — Amazon search/product data via Rainforest API |
| `AMAZON_DOMAIN` | Product Scout — Amazon locale (default `amazon.com.au`) |
| `FAL_API_KEY` | Graphics, Video Tools (generate fallback), Recipes (dish photos) |
| `REPLICATE_API_TOKEN` | Video Tools — preferred AI clip generation (`minimax/hailuo-2.3`); also Graphics upscale/bg |
| `VIDEO_GENERATE_PROVIDER` | Force `replicate` or `fal` for video generate |
| `VIDEO_REPLICATE_MODEL` | Replicate text-to-video model (default `minimax/hailuo-2.3`) |
| `VIDEO_GENERATE_MODEL` | Video Tools — FAL model id (default `fal-ai/minimax/video-01-live`) |
| `VIDEO_MAX_UPLOAD_MB` | Video Tools — upload cap for ffmpeg routes (default 80) |
| `MUSIC_PROVIDER` / `MUSIC_REPLICATE_MODEL` / `MUSIC_REPLICATE_MODEL_VERSION` / `MUSIC_REPLICATE_VERSION` | Music — backend (default `replicate`; `fake` = test synth), Replicate model (default `meta/musicgen`), the model's `model_version` input (default `stereo-large`), and an optional pinned Replicate version id (default: latest, looked up once); uses `REPLICATE_API_TOKEN` |
| `VOICE_PROVIDER` / `VOICE_REPLICATE_MODEL` / `VOICE_REPLICATE_VERSION` | Music voiceover — TTS backend (default `replicate`; `fake` = test tone), Replicate model (default `jaaari/kokoro-82m`), optional pinned version id; uses `REPLICATE_API_TOKEN` |
| `MUSIC_MAX_VIDEO_SEC` / `MUSIC_JOB_TTL_MIN` / `MUSIC_MAX_CLIP_SECONDS` | Music — longest video accepted (default 300), how long finished jobs/files are kept (default 90 min), longest single generated clip (default 30) |
| `ISOLATE_REPLICATE_MODEL` / `ISOLATE_REPLICATE_VERSION` | Video Tools → Isolate voice — Replicate Demucs model(s), comma separated and tried in order (defaults `ryan5453/demucs`, `cjwbw/demucs`, `iboostai/demucs-api`; inputs built from each model's published schema) and optional pinned version id (single model only); uses `REPLICATE_API_TOKEN`. AI option is hidden when the token is missing |
| `VIDEO_MAX_CONCURRENT_JOBS` / `VIDEO_MAX_QUEUED_JOBS` | Video Tools — global ffmpeg concurrency gate (defaults 2 running / 8 queued, then 503 "busy") — `server/services/videoJobGate.js` |
| `VIDEO_FFMPEG_TIMEOUT_MS` | Video Tools — ffmpeg job timeout (default 480000) |
| `VIDEO_LIBRARY_QUOTA_MB` | Video Tools — per-user saved-library cap (default 1000) |
| `LOCAL_WHISPER_LANGUAGE` | Video Tools — local whisper-cli transcribe language (default `en`) |
| `FONTS_PYTHON_BIN` | Font Customizer — Python binary for `server/services/fonts/` subprocess (default tries `python3` then `python`); needs `server/services/fonts/requirements.txt` installed |
| `GRAPHICS_DAILY_COST_CAP_USD` / `GRAPHICS_MAX_PAID_IN_FLIGHT` / `GRAPHICS_MAX_MEGAPIXELS` / `GRAPHICS_MAX_UPSCALE_MP` / `GRAPHICS_MAX_WORKERS` | Graphics safety nets (`server/middleware/graphicsLimits.js`, `server/services/graphicsWorker.js`): rolling 24h AI spend cap per person (default 5, 0 = off), simultaneous paid jobs per person (2), largest accepted image (64 MP), largest upscale output (64 MP), pixel worker threads (2). See `docs/graphics-tools.md` |
| `GITHUB_TOKEN` | Font Customizer — optional, raises the Google Fonts repo license-check lookup from 60/hr to 5000/hr |
| `CELLAR_LITE_FRAME_ANCESTORS` | Cellar Planner lite (`/cellar-lite/`, public static page) — origins allowed to embed it in an iframe, space-separated (e.g. `https://www.example.com.au`). Unset = only Vault can frame it. Invalid entries ignored. `server/routes/cellarLiteRouter.js` |
| `PAGESPEED_API_KEY` | HTML Lighthouse — PageSpeed Insights API (optional; anonymous quota is small) |
| `GSC_REDIRECT_URI` | Search Console OAuth callback (default `{APP_URL}/api/gsc/callback`) |
| `SENTRY_DSN` | Error tracking — unset disables Sentry entirely (no-op). See **`docs/observability.md`** |
| `SENTRY_AUTH_TOKEN` | Admin dashboard Sentry overview panel (read-only issues/stats pull). Unset = panel links out to Sentry instead of showing data. |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Org/project slugs for the Sentry API calls above. Default `curam-ai` / `python-flask`. |
| `SENTRY_TRACES_SAMPLE_RATE` | Sentry performance trace sample rate (default `0.1`); only relevant if `SENTRY_DSN` is set |
| `LOG_LEVEL` | pino log level (default `info`) |
| `NOMINATIM_CONTACT` | Garden Planner place lookup — optional email or URL appended to the User-Agent so OpenStreetMap can reach whoever runs this (their usage policy asks for an identifying agent). `APP_URL` is included automatically. |
| `ALA_API_KEY` | Garden Planner plant photos — Atlas of Living Australia (server only; the ALA source stays off until set) |
| `ALLOW_NONCOMMERCIAL` | Garden Planner photos — default false; true admits CC BY-NC photos (never for cut-outs) |
| `ALLOWED_LICENCES` | Garden Planner photos — optional comma-separated canonical licence codes replacing the default allow-list |
| `MAPTILER_API_KEY` | Garden Planner satellite map — MapTiler `satellite-v2` tiles, fetched by the server (`/api/map-tiles`), never exposed to the browser. Unset = the map option says it is not set up. Check MapTiler plan terms (free plan is non-commercial). |
| `ROUTE_TRACER_MAPTILER_KEY` | Route Tracer — a SECOND MapTiler key used in the browser (style JSON, tiles, sprites, glyphs go straight to MapTiler). Restrict it by HTTP referrer to the Vault domain + localhost in the MapTiler dashboard. Served to the app by `GET /api/route-tracks/config`; unset = the page says the map key is not set up. Separate from `MAPTILER_API_KEY` (server side). |
| `ORS_API_KEY` | Route Tracer "Plan route" — OpenRouteService API key (openrouteservice.org, free Standard plan about 2,000 directions/day and 40/min). Server side only; the browser never sees it or calls the service. Unset = the Plan route button is greyed out. Per-user and global rate limits in `server/services/routePlanner.js`. |
| `NOMINATIM_REVERSE_URL` | Route Tracer place names for A and B (reverse lookup) — override the endpoint; default is `NOMINATIM_URL` with `/search` swapped for `/reverse`. Same one-a-second queue, memory-only cache. |
| `NOMINATIM_URL` | Garden Planner place lookup — override the geocoder endpoint (default the public `nominatim.openstreetmap.org/search`; point at a self-hosted Nominatim for heavy use) |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USER_AGENT` | Topic Research — Reddit source (app-only OAuth). Off until both id and secret are set; Reddit now approves access before issuing keys. User agent defaults to `topic-research/0.1 (Curam Vault)`. See `docs/topic-research.md` |
| `SERP_PROVIDER` / `SERP_API_KEY` | Topic Research — Google results provider (`serper` is the only one built; `serpapi`/`dataforseo` are not). Also chosen in Topic Research Settings. A workspace `SEARCH_API_KEY` that is a Serper key works without these. Off until set |
| `TOPIC_RESEARCH_EXTRACT_LIMIT` / `TOPIC_RESEARCH_EXTRACT_BUDGET_MS` | Topic Research — how many of a search's best pages are read (default 12, 0 = none) and the time allowed for reading them (default 25000 ms). Pages are fetched with robots.txt obeyed, two seconds apart per site |
| `MONTHLY_BUDGET_USD` | Topic Research — default monthly spending limit in US dollars when a person has not set one (default 20, `0` = no limit). At the limit paid searches pause and new briefs are refused. Set per person in Topic Research -> Settings. `server/services/topicResearch/settings.js` |
| `SHELF_QUOTA_MB` | Vault Shelf — storage cap per person for unfiled CRM captures and Shelf rows in the Invoice Review queue (default 200). Pictures sent to Notes / CRM notes use the normal `ATTACHMENT_QUOTA_MB` instead. `server/routes/quickIngestRouter.js` |
| `SHELF_INSTALLER_MAX_MB` | Vault Shelf — largest installer an admin may upload (default 200). Kept on the upload volume. `server/routes/quickIngestRouter.js` |
| `BRAVE_PRICE_PER_QUERY_USD` / `SERP_PRICE_PER_QUERY_USD` | Topic Research — price of one Brave / Serper query for the per-run cost estimate (default 0: set real prices or the M5 monthly budget stop has nothing to count). Topic Research's Brave source reuses the existing `SEARCH_API_KEY` when it is a Brave key |

---

