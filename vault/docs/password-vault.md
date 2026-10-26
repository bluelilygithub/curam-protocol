# Password Vault

`/password-vault`, flag `passwordVault` (**off by default**: an admin switches it on in Settings -> Feature Access; admins always have it). Research & Utilities group. A zero-knowledge place to keep logins, some linked to CRM clients. Same shape as the other tool pages: the shared `ToolSidebar` menu, (i) box, compass tour, guide chat, a tooltip on every control, a microphone on the non-secret text fields.

## The one rule

**The server never sees a master password, a key, or a readable entry.** The browser makes the key and does all the encrypting and decrypting. A database dump, a Railway log, a backup, a compromised admin or a bug in a route reveals only scrambled text. That is also why a forgotten master password cannot be recovered by anyone.

## How it is built

| Piece | File |
|---|---|
| Crypto: PBKDF2-SHA256 (600,000 rounds) -> AES-256-GCM key, fresh 12-byte nonce per save, non-extractable `CryptoKey` | `client/src/utils/vaultCrypto.mjs` |
| Generator (secure random, rejection sampling, no modulo bias) and the rough strength guess | `client/src/utils/passwordGen.mjs` |
| Lock state: the key lives **only in memory** (a Zustand store, never persisted); locks on idle (1/5/15/30 min, default 5), reload and sign-out | `client/src/store/passwordVaultStore.js` |
| Page, tools, hook | `client/src/pages/PasswordVaultPage.jsx`, `client/src/pages/passwordVault/` (`useVault.js` holds every call to the server) |
| Health check (weak / reused / old / no password), pure | `client/src/pages/passwordVault/vaultHealth.mjs` |
| API | `server/routes/passwordVault.js`, checks in `server/services/passwordVault/validate.js` |
| Tables | `password_vault_keys` (one per person: kdf, iterations, salt, check blob, `keyVersion`), `password_vault_entries` (`iv`, `ciphertext`, `keyVersion`, plain `"clientId"`) |
| Guide chat | `server/services/passwordVaultTutor.js`, `server/routes/passwordVaultTutor.js`, `client/src/pages/passwordVault/PasswordVaultTutorChat.jsx`, ids in `passwordVaultTools.mjs` |
| Recycle bin | `server/services/recycleBin/adapters/passwordVault.js` (kind `password-entry`) |

An entry's **title, username, address, password and notes are all inside the ciphertext**. The only plain field is `"clientId"` (so the client name can be shown and filtered); `ON DELETE SET NULL`, so deleting a client keeps the login. A blob is bound to its owner with AES-GCM additional data (`curam-vault:v1:<userId>`), so it cannot be moved into another person's vault.

The key settings are stored (`kdf`, `kdfIterations`, `salt`) so the method can be strengthened later (for example Argon2id) without breaking old vaults. PBKDF2 was chosen because it is built into every browser, so there is no extra library to trust or keep patched.

## API (`/api/password-vault`, behind `requireFeature('passwordVault')`)

`GET /status` · `POST /setup` · `GET /entries` · `POST /entries` · `PUT /entries/:id` · `PATCH /entries/:id/client` (works with no key) · `DELETE /entries/:id` (into the bin) · `POST /rekey` · `POST /reset` (needs the exact words `DELETE EVERYTHING`). Accountant logins cannot reach any of it (their allow-list is Finance and Shares only).

- **Change master password** (`/rekey`): the browser decrypts everything with the old key and re-encrypts with a new one, and the server swaps it all in one transaction, only if the entry list is exactly what the browser worked from (`LIST_CHANGED` otherwise) and the key version matches (`KEY_CHANGED`). `keyVersion` goes up by one.
- **Writes carry `keyVersion`**; a stale window gets 409 `KEY_CHANGED` and is locked, so an entry can never be saved under a key that is no longer current.
- **Recycle bin**: a deleted entry is kept as ciphertext for 30 days with `keyVersion`. After a master-password change the old key is gone, so a restore of an older item is refused with a plain sentence. A reset removes the person's bin items too.

## Rules for one login

**Make one** on a login opens `GeneratorModal`, which holds the same `GeneratorPanel` as the Password generator tool (length, lower/upper/numbers/symbols, look-alikes, and "never use these characters" for sites that reject some). "Keep these rules with this login" stores them as `genRules` **inside the encrypted entry**, so Make one starts from them next time. The remembered global choice (`vault:passwordGenOptions`) only seeds logins that have no rules.

## Moving it in the navigation

The tool is in the nav catalog (`client/src/config/appNavigation.js`, id `passwordVault`, Research & Utilities), so **Settings -> Navigation** can place it in any set or group. Until placed it sits under "Unsorted" in the first set.

## What it does not do (and the guide says so)

Autofill or filling sites, sharing a login with another person, one-time codes / passkeys, importing from or exporting to another manager, a breach check (it would mean sending the password somewhere), and any kind of recovery. Each person sees only their own vault; linking to a client is filing, not sharing.

## Things worth knowing

- Reloading the page locks the vault by design.
- No microphone on the password, master password or notes boxes (speech goes to a speech service). Title, username and search do have one.
- The clipboard is cleared 30 seconds after copying a password, only if it still holds that password.
- Local dev works; the API test needs the local Postgres (`DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser`).

## Tests

`npm run test:password-vault` (crypto, generator, health, validation; no database), `npm run test:password-vault-tutor` (guide), `npm run test:password-vault-api` (the real app and a local Postgres: switch, set-up, ciphertext only in the database, another person gets nothing, bin, change master password, erase).

## Not built yet

A **Passwords** section on the client's page (the list can be filtered to a client now, and `/password-vault?client=<id>` opens that view); Argon2id; a clipboard-free "reveal for 10 seconds"; import/export.
