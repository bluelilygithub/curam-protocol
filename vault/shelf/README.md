# Vault Shelf: the tray UI (M3)

The React page that the native Windows shell shows when you press the hotkey: filter chips, a shelf of recent copies, a preview pane, the quick-action buttons
and Settings. Context and the Vault server side: `../docs/vault-shelf.md`.

This folder is **only the page**. It does not read the clipboard, hold the Vault key, encrypt anything or touch the network. All of that belongs to the native
shell (milestones M2 and M4), which loads this page in a WebView2 window and answers the calls below.

## Run it

```
cd vault/shelf
npm install
npm run dev        # http://127.0.0.1:5177/  with SAMPLE DATA (development only)
npm test           # 32 unit tests (classification, tables, the sanitiser, windowing, hotkeys, settings rules)
npm run typecheck
npm run build      # dist/: what the shell loads. Contains no sample data, and a strict Content-Security-Policy
npm run e2e        # drives the real UI in Chrome (start `npm run dev` first); `node scripts/e2e.mjs <screenshotDir>` saves pictures
```

Without a shell, the dev server uses `src/bridge/mock.ts` (100 sample clips, including hostile ones: an SVG with script, HTML with a tracking pixel, a secret).
The built page has no mock: with no shell it shows "Vault Shelf opens from the Windows app".

## What the page shows (and how)

| Clip | Shown as |
|---|---|
| Plain text | wrapped text |
| Code (JS, TS, Python, SQL, JSON, CSS, HTML/XML) | syntax-coloured, language named, no font ligatures, exactly as copied |
| Hex colour (`#rgb`, `#rrggbb`, with alpha) | swatch plus HEX / RGB / HSL |
| One link | the address as text (never opened from the tray) |
| CSV / TSV / semicolon / pipe / markdown table | grid with a header row, quote-aware, first 200 rows |
| Picture | the 300px thumbnail (`data:` URL), never the original |
| SVG | **sanitised** (DOMPurify: no script, handlers, `foreignObject`, animation, outside references), then drawn as an `<img>` from a `blob:` URL that is revoked when the preview closes |
| HTML | **sanitised** (no script, style blocks, forms, links, remote pictures), then shown in `<iframe sandbox="">` with `default-src 'none'` |
| A clip the shell masked | read-only, with a notice; every send button is disabled |

Only the cards in or beside view exist in the page (`lib/virtual.ts`), and at most 12 picture thumbnails are held at once (`hooks.ts`). The full content of a clip is
fetched only when it is opened and is cleared as soon as another is chosen.

Keys: arrows / Home / End choose, `1` to `9` pick, **Enter copies and closes**, Delete removes, Esc backs out (settings, redaction view, then the tray).

## The contract with the shell

The shell sets `window.shelfNative = { invoke(command, args) -> Promise, on(listener) -> unsubscribe }` before the page loads (Tauri: a thin script mapping this to
`invoke` and `listen`; WebView2 .NET: `AddHostObjectToScript` or `postMessage`). `src/bridge/types.ts` is the typed version; `src/bridge/native.ts` checks every
answer's shape. **Commands** (`args` -> answer):

| Command | Args | Answer |
|---|---|---|
| `list_clips` | none | `ClipMeta[]`, newest first. `preview` is at most 400 characters and **already secret-masked** |
| `get_clip` | `{ id }` | `{ id, kind: 'text'\|'html'\|'svg', text }` or `{ id, kind: 'image', mime, dataUrl, width, height }` (`dataUrl` = PNG/JPEG/GIF/WebP, at most 300px wide), or `null` |
| `dispatch` | `{ action: 'finance'\|'notes'\|'redact'\|'crm', id }` | `{ ok, duplicate?, error?, findings?, note?, truncated? }` |
| `copy_clip` | `{ id }` | nothing. Puts it on the clipboard without capturing it again |
| `delete_clip` / `clear_history` | `{ id }` / none | nothing |
| `hide_shelf` | none | nothing. Hide, **destroy the webview**, give the previous window its focus back |
| `verify` | none | `GET /api/quick-ingest/verify` as `{ ok, scopes, unavailable, account?, keyLabel?, error? }` |
| `get_settings` / `save_settings` | none / `{ patch }` | the full `Settings` (never includes the key, only `hasKey`) |
| `save_connection` | `{ baseUrl, key }` | like `verify`. The shell checks the key with Vault, and **only if it is good** stores it in Windows Credential Manager |

**Events** the shell sends: `show` (the tray was opened: the page resets to the newest copy) and `clips_changed` (reload the list).

`dispatch` is done **in the shell** (HTTP from native code with the key from Credential Manager), so the key never exists in the webview. The page asks only for an
action on a clip id. Dispatch must follow `../docs/vault-shelf.md`: a `clipId` per clip for safe retries, the secret check again before sending, and the shell
refuses to send a masked clip even if asked.

## For the shell builder (M2 / M4), what the page assumes

- The window is transparent (Mica or Acrylic). The page marks `<html data-hosted>` and paints no background of its own.
- `show` is sent each time the tray opens; the page expects a fresh webview each time (creating it on open and destroying it on dismiss is how the 35 MB idle goal is met).
- `get_clip` for a picture returns the small copy; the original stays encrypted in the shell and is what `dispatch` uploads.
- Nothing the page receives is trusted: text is rendered as text, SVG/HTML go through the sanitiser, a picture must be a `data:image/(png|jpeg|gif|webp);base64` URL.
