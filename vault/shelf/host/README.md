# Vault Shelf host (M2): the Windows shell

C# / .NET 10 / WinForms + WebView2. It is the always-running part: a tray icon, the global hotkey, the clipboard listener, and the window that shows the tray page
(`../dist`). It owns everything sensitive (clipboard, encryption, the Vault key, the network); the page only talks to it through the bridge in `../README.md`.

## What is built

Tray icon and menu (Open, Settings, Pause monitoring, Clear history, Exit); the global hotkey; the on-demand window (the web view is **created on open and destroyed on
dismiss**); focus remembered and restored; click-away dismiss; the page-to-shell transport; and:

- **Clipboard listener** (`Clipboard/`). `AddClipboardFormatListener` in a message-only window. **Before any content is read** it checks the password-manager markers
  (`ExcludeClipboardContentFromMonitorProcessing`, `Clipboard Viewer Ignore`, `CanIncludeInClipboardHistory` = 0, `CanUploadToCloudClipboard` = 0), the paused state and the
  per-program exclusion list (the copying program is found from the clipboard owner window; it is only known while that program is still running, so the listener reads
  it at the moment of the change). It keeps text, HTML (just the copied fragment), SVG and pictures (a PNG is kept byte for byte so transparency survives; a plain bitmap is
  flattened onto white so a screenshot is not invisible). Text wins over a picture when an app puts both. Copied files are not kept.
- **Secret masking** (`Masking/SecretScanner.cs`). API keys (Stripe, Anthropic, OpenAI-style, GitHub, Slack, AWS, Google, npm, SendGrid), Vault Shelf keys, JWTs,
  bearer and basic headers, logins inside addresses, private-key blocks, and password/secret/key assignments (`password=`, `DB_PASSWORD=`, `db.secret:`, `clientSecret:`).
  The secret is replaced **before anything is stored**; the clip is marked masked, can be read but is never sent. If a pattern cannot finish in time on some text, the whole
  text is hidden instead (it fails closed).
- **Encrypted history** (`Storage/`). `history.db` (SQLite, secure_delete on) plus one file per picture. Every preview, text, picture and thumbnail is encrypted with **DPAPI**
  (current Windows user, plus an application entropy value) before it touches the disk. Only metadata that is not content is in the clear: kind, time, size, the program it
  came from, and the masked/truncated flags. It keeps the last N clips (10 to 200), clears by age (1 hour to 7 days), prunes when something is captured and every ten
  minutes, and removes picture files with no row at start.
- **Settings** (`Settings/`). `settings.json` (never the key; it includes the chosen Vault `theme` and `font`, which the shell passes to the page in its address so the first paint is right), checked with the same rules as the page; a damaged file means defaults. **Start with Windows** is a value in the
  current user's Run key. **Credential Manager** (`Security/CredentialStore.cs`) will hold the Vault key; it is written by the connection step in M4.

## Not built yet

Sending to Vault (M4: `verify`, `save_connection` and `dispatch` currently answer that they are not built), the `vault-shelf://` handler, the installer.

## Build and run

```
# the .NET SDK is in C:\Users\micha\.dotnet (installed with Microsoft's dotnet-install script, no admin rights)
export PATH="/c/Users/micha/.dotnet:$PATH"; export DOTNET_ROOT="C:\Users\micha\.dotnet"
cd vault/shelf && npm run build            # the page the host loads (shelf/dist)
cd host && dotnet build -c Release
bin/Release/net10.0-windows/VaultShelf.exe # tray icon appears; press Ctrl+Shift+Space
```

`nuget.config` points at nuget.org only (a fresh SDK install has no package source). WebView2 is pinned in the `.csproj`.

## Tests

```
cd vault/shelf/host.tests && dotnet test     # 172 tests
```

They use the real Windows pieces: DPAPI, Credential Manager (a throw-away target), the registry (a throw-away value), the SQLite file, and **the real clipboard, so running
them replaces whatever you have copied.** Among other things they check that nothing copied is readable in any file on disk, that a secret is nowhere on disk, and that
each password-manager marker drops a clip.

## The self-test

```
VaultShelf.exe --spike <folder> [--browser-args "<switches>"] [--no-trim]
```

It starts Notepad, presses the real hotkey with injected keys, waits for the shelf, checks keyboard focus, presses Esc, and checks that Notepad got the focus back. It repeats
this 5 times, tests click-away with a second window, then exercises the **live clipboard listener through the real message loop** (plain text, a secret, a password-manager
marker, paused, a duplicate, a picture, another program, an excluded program, copy-back) and writes a JSON report: memory of the host plus its WebView2 processes, timings,
focus results, whether the browser processes went away, and whether hostile clips ran script. **It takes over the keyboard for about a minute and replaces your clipboard:
do not type or copy while it runs.** It keeps its data in its own folder and never touches your real history, settings, registry entry or saved key.

Memory is the private working set (what Task Manager's Memory column shows), counted for the host and only the WebView2 processes in its own process tree.

## What is not verified (this PC is Windows 10 22H2, build 19045)

- **Mica / Acrylic** need Windows 11. The window is a plain solid one here, and `--disable-gpu` (used for memory) has not been tried with a transparent Mica window.
- A previous window running **as administrator** cannot be given the focus back by an ordinary process (Windows UIPI); the code reports it instead of failing silently.
- A PC with **no WebView2 runtime** (Windows 10 without it) needs Microsoft's Evergreen installer; the installer step is not written yet.
- The framework-dependent build needs the .NET runtime on the PC; the shipped build will be self-contained (larger on disk, no effect on memory).
- The secret scanner's **fail-closed path** (a pattern timing out) is not covered by a test: it cannot be triggered on demand.
