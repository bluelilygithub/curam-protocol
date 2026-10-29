# Vault Shelf host (M2): the Windows shell

C# / .NET 10 / WinForms + WebView2. It is the always-running part: a tray icon, the global hotkey, and the window that shows the tray page (`../dist`).
It owns everything sensitive (clipboard, encryption, the Vault key, the network); the page only talks to it through the bridge in `../README.md`.

**Built so far (the M2 spike):** tray icon and menu, global hotkey (`Ctrl+Shift+Space`), a window that **creates its web view on open and destroys it on dismiss**,
focus remembered and given back, click-away dismiss, the real page-to-shell message transport (`Bridge.cs`, answering with sample clips), and a self-test that measures
all of it. **Not built yet:** the clipboard listener and its exclusion flags, secret masking, the encrypted store (DPAPI + SQLite), sending to Vault (M4),
the Credential Manager key store, start-on-boot, the `vault-shelf://` handler, installer.

## Build and run

```
# one-time: the .NET SDK is in C:\Users\micha\.dotnet (installed with Microsoft's dotnet-install script, no admin rights)
export PATH="/c/Users/micha/.dotnet:$PATH"; export DOTNET_ROOT="C:\Users\micha\.dotnet"
cd vault/shelf && npm run build            # the page the host loads (shelf/dist)
cd host && dotnet build -c Release
bin/Release/net10.0-windows/VaultShelf.exe # tray icon appears; press Ctrl+Shift+Space
```

`nuget.config` points at nuget.org only (a fresh SDK install has no package source). WebView2 is pinned in the `.csproj`.

## The self-test

```
VaultShelf.exe --spike <folder> [--browser-args "<switches>"] [--no-trim]
```

It starts Notepad, presses the real hotkey with injected keys, waits for the shelf, checks keyboard focus, presses Esc, and checks that Notepad got the focus back.
It repeats this 5 times, then tests click-away with a second window, and writes a JSON report (memory of the host plus its WebView2 processes, timings, focus
results, whether the browser processes went away, and whether hostile clips ran script). **It takes over the keyboard for about a minute: do not type while it runs.**
Memory is the private working set (what Task Manager's Memory column shows), counted for the host and only the WebView2 processes in its own process tree.

## What is not verified (this PC is Windows 10 22H2, build 19045)

- **Mica / Acrylic** need Windows 11. The window is a plain solid one here, and `--disable-gpu` (used for memory) has not been tried with a transparent Mica window.
- A previous window running **as administrator** cannot be given the focus back by an ordinary process (Windows UIPI); the code reports it instead of failing silently.
- A PC with **no WebView2 runtime** (Windows 10 without it) needs Microsoft's Evergreen installer; the installer step is not written yet.
- The framework-dependent build needs the .NET runtime on the PC; the shipped build will be self-contained (larger on disk, no effect on memory).
