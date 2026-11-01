# Vault Shelf: releasing and installing a new version (runbook)

Written 2026-11-02 after the quick-launcher release, which took far longer than it should have because none of this was written down. Follow it in order. Everything here was done for real on the owner's PC (Windows 11) unless marked "not verified".

## The three places a copy of the installer can be, and what each one does

| Place | What it is | How the Open Shelf button uses it |
|---|---|---|
| **Vault upload** | Settings -> Vault Shelf -> "Open Shelf button and installer (admin)" -> Upload / Replace installer. Stored on the server at `UPLOAD_DIR/shelf-installer/`. | **Wins** when present. |
| **Outside address** | The https address in the box below it (the owner uses `https://setup-vault.curam-ai.com.au/VaultShelfSetup.exe`, filled by FTP). | Used **only when nothing is uploaded to Vault**. |
| **The build folder on the dev PC** | `vault/shelf/setup/out/VaultShelfSetup.exe` | Not served to anyone. Best file to install from on the dev PC (see problem 3). |

The two upload places are alternatives, not steps: one is enough. Updating the outside address's file does **not** change anything on the Vault form, and the form saying "Nothing uploaded yet" while an outside address is set is normal.

## Release steps

1. **Check the code.** In `vault/shelf`: `npx tsc --noEmit` and `npm test`. In `vault/shelf/host.tests`: `dotnet test`. (Two tests in `tests/theme.test.ts` have failed since before the launcher work: they still expect the old primary colour `#CC785C`. Not a release blocker; fix them when next in there.)
2. **Build the installer** (PowerShell, from anywhere):
   ```
   $env:DOTNET_ROOT="C:\Users\micha\.dotnet"; $env:PATH="C:\Users\micha\.dotnet;$env:PATH"
   powershell -ExecutionPolicy Bypass -File "C:\Users\micha\Local Sites\curam-protocol\vault\shelf\setup\build-installer.ps1"
   ```
   It builds the page, publishes the program self-contained, packs it and writes `shelf/setup/out/VaultShelfSetup.exe` (about 60 MB). **Copy the SHA-256 it prints**: it is the only reliable way to tell old from new later.
3. **Put the file where people download it** (either or both):
   - Vault form: Replace installer, choose the file from `shelf/setup/out`. The box then shows a size, date and **fingerprint, which must equal the SHA-256 from step 2**. Pressing "Replace installer" only opens a file picker; it never uploads by itself and never "recognises" a file.
   - Outside address: upload by FTP over the old file (same name, `VaultShelfSetup.exe`).
4. **Prove the right file is live** (do not trust the page or your memory):
   ```
   curl -sL -o x.exe https://setup-vault.curam-ai.com.au/VaultShelfSetup.exe ; sha256sum x.exe
   ```
   Compare with step 2. If it differs, the file has not landed or something is caching it: wait, re-check size and `Last-Modified` with `curl -sI`, and upload again if needed. (On 2026-11-02 the first check showed the old file because it ran before the FTP finished; a few minutes later it matched.)
5. **Install it on the dev PC** (next section). Pushing code to `staging` / `version-7` only deploys the Vault website; it never updates the Windows app.

## Installing on a PC

1. **Quit the running Shelf first**: tray icon (near the clock, maybe under the ^ arrow) -> Exit. To be sure it quit, in PowerShell: `Get-Process VaultShelf | Select Id, Path`.
2. Run `VaultShelfSetup.exe`. It installs per user to `%LOCALAPPDATA%\Programs\VaultShelf`, no administrator needed. The copy history is kept.
3. **Verify** in `%LOCALAPPDATA%\VaultShelf\vaultshelf.log`. A good start ends with these lines (the launcher line exists from the quick-launcher release on):
   ```
   registered 1.0.0 at ...\Programs\VaultShelf
   starting (data: ...; page: ...\Programs\VaultShelf\shelf)
   shortcut Ctrl+Shift+Space registered
   launcher shortcut Ctrl+Alt+Space registered
   ```
   Then press the shortcut(s) and check the window opens.

## Problems met on 2026-11-02, and the fix for each

**1. "Replace installer just asks me to upload the file again."** Working as designed: Replace is the upload button, relabelled once a file exists. Nothing was wrong. The check is the fingerprint under "Installer file". (Possible improvement: have the box say whether the stored file matches the last build.)

**2. FTP upload "changed nothing" on the Vault form.** The form only reflects the **Vault upload**. The outside address is a separate fallback. See the table above.

**3. Blue Windows screen with only "Don't run".** The downloaded file carries the internet "Mark of the Web", and the installer is **not code-signed**. Fixes, in order:
- `Unblock-File "$env:USERPROFILE\Downloads\VaultShelfSetup.exe"` in PowerShell. Windows 11's right-click Properties often has no Unblock tick, so use this. It worked here.
- Or install from the build folder `shelf/setup/out`, which has no internet mark.
- If it still blocks with no "More info" link, suspect **Smart App Control** (Start, search "Smart App Control"). When it is On, unsigned programs are blocked outright, and it cannot be switched back on later without reinstalling Windows. **Not verified on this PC** (the unblock alone was enough). The permanent fix is to sign the installer with a code-signing certificate (not done, costs money).

**4. Installer finished but the new shortcut did nothing.** The old Shelf was still running (here a developer copy, `vault/shelf/host/publish/VaultShelf.exe`, started 30 Oct), so the freshly installed one logged `start ignored: Vault Shelf is already running` and exited. Only one copy may run. Fix: stop the old process (`Stop-Process -Id <id>`, id from `Get-Process VaultShelf`), start `%LOCALAPPDATA%\Programs\VaultShelf\VaultShelf.exe`, and re-read the log. **Always check the `Path` of the running process**: if it is not under `...\Programs\VaultShelf` you are not running the installed copy. Do not run a copy from `host/publish` as the daily Shelf.

**5. Is the upload kept on the server?** The Vault upload lives on `UPLOAD_DIR`. If Railway has no volume mounted there, it disappears at the next deploy (the form returns to "Nothing uploaded yet"). **Not verified on Railway.** If it vanishes, mount a volume at `UPLOAD_DIR` or rely on the outside address.

**6. The shortcut can never be Ctrl+Fn+Space.** Windows never receives the Fn key (the keyboard handles it itself). The default launcher shortcut is Ctrl+Alt+Space; change it in the Shelf's Settings -> Quick launcher.

## Quick diagnosis

| Symptom | Look at | Likely cause |
|---|---|---|
| New shortcut does nothing | log: `start ignored`? path from `Get-Process VaultShelf` | old copy still running (problem 4) |
| Log says `launcher shortcut ... REFUSED` | tray balloon, log | another program owns that combination: pick another in Settings |
| Blue "Don't run" | file properties, Smart App Control | problem 3 |
| Download gives the old version | `curl -sI` size and `Last-Modified`, SHA-256 | file not landed or cached (step 4) |
| Form says "Nothing uploaded yet" | is an outside address set? was there a deploy since the upload? | problem 2 or 5 |
| A launcher tile opens an error page | Vault address in Settings -> Vault connection | empty or wrong address, or the tool is switched off for that account |

See also `docs/vault-shelf.md` (design, installer, quick launcher) and `vault/shelf/host/README.md` (build and run, the shortcut log).
