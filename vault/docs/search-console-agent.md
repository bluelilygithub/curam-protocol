# Search · Google Search Console

Organic **query and page** data at **`/search-console`**. This is not the HTML crawl (`/seo`) and not Lighthouse (`/html`).

**Frontend:** `vault/client/src/pages/SearchConsolePage.jsx`  
**Backend:** `vault/server/routes/gsc.js` · `gscService.js`  
**Tables:** `gsc_tokens`, `gsc_snapshots`

---

## Flow

1. **Connect** — Google OAuth with `webmasters.readonly` plus email. Tokens are encrypted like Gmail.
2. **Property** — pick a Search Console site this account can access.
3. **Load 28 days** — Search Analytics for queries, pages, and query+page (cannibalisation shortlist). Data is delayed a few days; the window ends three days ago.

OAuth callback is public (`GET /api/gsc/callback`) and must be registered **before** `requireAuth` in `server/index.js`. Add the exact URI in Google Cloud authorised redirects. Gmail uses `GOOGLE_REDIRECT_URI`; Search Console uses **`GSC_REDIRECT_URI`** or `{APP_URL}/api/gsc/callback` (the **API** host on Railway, not the Vite port).

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/gsc/status` | Connected / configured / email |
| `GET` | `/api/gsc/auth` | `{ authUrl }` |
| `GET` | `/api/gsc/callback` | OAuth return (unauthenticated) |
| `POST` | `/api/gsc/disconnect` | Drop tokens |
| `GET` | `/api/gsc/sites` | Properties |
| `GET` | `/api/gsc/snapshot` | Latest stored report |
| `POST` | `/api/gsc/snapshot` | `{ siteUrl }` fetch + store |

Feature flag: **`searchConsole`**.
