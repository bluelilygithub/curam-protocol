# Local Setup Issues — Michael's Machine

## Environment
- OS: Windows 10 Pro for Workstations
- Node.js: v24.14.0
- npm: v11.9.0

## Workaround (Always Available)
Use Railway URL (`https://curam-vault.up.railway.app`) for all Vault testing.
Flask site works locally on port 5000 (`python main.py`).

---

## The Core Problem
`better-sqlite3` requires a native compiled binary. Node v24 on Windows has no pre-built binary for it. Every attempt to run the Vault locally fails because of this.

---

## Attempt History

### Attempt 1 — Compile better-sqlite3 from source
**What:** Install Visual Studio C++ Build Tools so node-gyp can compile better-sqlite3.
**Why it failed:** The rebuild process appeared to hang with no output. Agent also repeatedly ran rebuild from the wrong directory (project root instead of vault/), wasting time with vacuous "success" messages.
**Side effects:** VS Build Tools 2026 installed on machine. Machine restart was required.

### Attempt 2 — node-sqlite3-wasm (pure WASM, no compilation)
**What:** Replace `better-sqlite3` with `node-sqlite3-wasm` and `bcrypt` with `bcryptjs`.
**Why it failed:** `node-sqlite3-wasm` installed successfully but crashed at runtime with `SQLite3Error: unable to open database file`. The package uses a custom Windows file system layer that does not work correctly. Trying forward-slash path normalisation made no difference.
**Side effects:** Codebase is currently in a broken state — `better-sqlite3` removed, `node-sqlite3-wasm` installed but non-functional.

### What is still good from Attempt 2
- `bcrypt` → `bcryptjs` swap works and should be kept
- `npm_config_shell` env var permanently set — npm shell issue is resolved
- Always run npm from Start menu PowerShell, never Cursor terminal

---

## Current Codebase State
- `vault/package.json` — `better-sqlite3` removed, `node-sqlite3-wasm` present (broken), `bcryptjs` present (working)
- `vault/server/db.js` — rewritten for node-sqlite3-wasm (broken, needs to change again)
- `vault/server/routes/auth.js` — uses `bcryptjs` (correct, keep this)
- Railway deployment unaffected — has its own node_modules

---

## Next Suggestion — sql.js

**What it is:** The most widely used WASM SQLite library. Used in millions of projects. No native compilation. No known Windows issues.

**Why it wasn't tried first:** Agent chose node-sqlite3-wasm instead. That was wrong.

**The one real difference from better-sqlite3:** sql.js initialises asynchronously. The server startup code in `server/index.js` needs to wait for the DB before starting. This is about 10 lines of change and is a well-understood pattern.

**Why this is different from the previous attempt:** node-sqlite3-wasm failed because of a broken Windows VFS — an unknown runtime bug. sql.js has no custom VFS — it uses the standard Node.js `fs` module directly. The async init problem is a known, visible code problem, not a hidden runtime bug.

**Honest caveat:** This has not been tried yet. It may still fail. If it does, the fallback is Option A.

---

## Fallback — Downgrade Node to v22 LTS
- better-sqlite3 has pre-built binaries for Node v22 — no compilation, guaranteed to work
- Uninstall Node v24 via Windows Settings
- Install Node v22 LTS from nodejs.org
- Revert package.json to use better-sqlite3, run npm install
- Risk: previously broke Claude Code when Node version changed
