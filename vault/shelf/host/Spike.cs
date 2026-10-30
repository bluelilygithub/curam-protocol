using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using VaultShelf.Host.Clipboard;
using static VaultShelf.Host.NativeMethods;

namespace VaultShelf.Host;

/// <summary>
/// The M2 measuring spike (run with --spike &lt;folder&gt;). It drives the REAL app the way a person does: opens Notepad, presses the global hotkey
/// with injected key presses, waits for the shelf, presses Esc, and records after each step: memory (host + its WebView2 processes), time, whether
/// the shelf really got the keyboard focus, whether Notepad got it back, whether the browser processes went away, and whether a hostile clip ran script.
/// </summary>
internal sealed class Spike
{
    private const ushort VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_F11 = 0x7A, VK_ESCAPE = 0x1B;   // the test shortcut is Ctrl+Alt+Shift+F11
    private const int Cycles = 5;

    private readonly TrayApp _app;
    private readonly Options _opts;
    private readonly string _out;
    private readonly List<string> _log = new();

    public Spike(TrayApp app, Options opts, string outDir) { _app = app; _opts = opts; _out = outDir; Directory.CreateDirectory(outDir); }

    private void Say(string s) { _log.Add($"{DateTime.Now:HH:mm:ss.fff}  {s}"); }

    private static void Chord(params ushort[] keys)
    {
        var inputs = new List<INPUT>();
        foreach (var k in keys) inputs.Add(Key(k, up: false));
        foreach (var k in keys.Reverse()) inputs.Add(Key(k, up: true));
        SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf<INPUT>());
    }
    private static INPUT Key(ushort vk, bool up) => new() { type = 1, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = up ? 2u : 0u } } };

    private static async Task<IntPtr> StartNotepadAsync()
    {
        var p = Process.Start(new ProcessStartInfo("notepad.exe") { UseShellExecute = true })!;
        for (int i = 0; i < 100; i++)
        {
            await Task.Delay(50);
            p.Refresh();
            if (p.MainWindowHandle != IntPtr.Zero) return p.MainWindowHandle;
        }
        return IntPtr.Zero;
    }

private async Task<CaptureOutcome?> WaitOutcome(Action trigger, int timeoutMs = 2500)
    {
        var tcs = new TaskCompletionSource<CaptureOutcome>();
        void Handler(CaptureOutcome o) => tcs.TrySetResult(o);
        _app.Monitor.Processed += Handler;
        try
        {
            trigger();
            var done = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs));
            return done == tcs.Task ? tcs.Task.Result : null;
        }
        finally { _app.Monitor.Processed -= Handler; }
    }

    private static void SetClipboard(Action<System.Windows.Forms.DataObject> fill)
    {
        var d = new System.Windows.Forms.DataObject();
        fill(d);
        System.Windows.Forms.Clipboard.SetDataObject(d, true, 10, 50);
    }

    /// <summary>The real listener through the real message loop: copy things the way programs do and see what the app does with each.</summary>
    private async Task<Dictionary<string, object?>> LiveClipboardAsync()
    {
        var r = new Dictionary<string, object?>();
        int before = _app.Store.Count();
        string token = "ghp" + "_" + string.Concat(Enumerable.Range(0, 36).Select(i => "aB3dE5gH7jK9mN1pQ"[i % 17]));

        var plain = await WaitOutcome(() => SetClipboard(d => d.SetText("live capture test " + Guid.NewGuid().ToString("N"))));
        r["plainTextCaptured"] = plain is { Captured: true };
        r["plainTextSource"] = plain?.Owner;

        var secret = await WaitOutcome(() => SetClipboard(d => d.SetText("remote set-url https://x:" + token + "@github.com/a/b")));
        r["secretCaptured"] = secret is { Captured: true };
        r["secretMasked"] = secret is { Masked: true };
        var stored = secret?.ClipId is { } sid ? _app.Store.GetText(sid) : null;
        r["secretNotStored"] = stored is not null && !stored.Contains(token);

        var marked = await WaitOutcome(() => SetClipboard(d => { d.SetText("a password from a manager"); d.SetData("ExcludeClipboardContentFromMonitorProcessing", false, new MemoryStream(new byte[] { 1, 0, 0, 0 })); }));
        r["passwordManagerClipDropped"] = marked is { Captured: false, Reason: "PasswordManagerFlag" };

        _app.Monitor.Paused = true;
        var paused = await WaitOutcome(() => SetClipboard(d => d.SetText("copied while paused")));
        r["pausedDropped"] = paused is { Captured: false, Reason: "Paused" };
        _app.Monitor.Paused = false;

        var dup = await WaitOutcome(() => SetClipboard(d => d.SetText("same twice")));
        var dup2 = await WaitOutcome(() => SetClipboard(d => d.SetText("same twice")));
        r["duplicateCapturedOnceOnly"] = dup is { Captured: true } && dup2 is not { Captured: true };

        using (var bmp = new System.Drawing.Bitmap(800, 500))
        {
            using (var g = System.Drawing.Graphics.FromImage(bmp)) g.Clear(System.Drawing.Color.SteelBlue);
            var img = await WaitOutcome(() => SetClipboard(d => d.SetImage(bmp)));
            r["pictureCaptured"] = img is { Captured: true, Kind: Storage.ClipKind.Image };
        }

        // another program: it must be seen as that program, and an excluded program must be dropped
        var ps = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"Set-Clipboard -Value 'copied by powershell'; Start-Sleep -Seconds 4\"") { CreateNoWindow = true, UseShellExecute = false })!;
        var fromPs = await Task.Run(async () => await WaitOutcomeFrom(ps, 6000));
        r["otherProgramCaptured"] = fromPs is { Captured: true };
        r["otherProgramNamed"] = fromPs?.Owner;
        try { ps.Kill(true); } catch (InvalidOperationException) { /* finished */ }

        _app.Settings.Current.ExcludedApps.Add("powershell.exe");
        var ps2 = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"Set-Clipboard -Value 'from an excluded program'; Start-Sleep -Seconds 4\"") { CreateNoWindow = true, UseShellExecute = false })!;
        var excluded = await WaitOutcomeFrom(ps2, 6000);
        r["excludedProgramDropped"] = excluded is { Captured: false, Reason: "ExcludedApp" };
        _app.Settings.Current.ExcludedApps.Remove("powershell.exe");
        try { ps2.Kill(true); } catch (InvalidOperationException) { /* finished */ }

        // the shelf puts a clip back on the clipboard: that must not be captured again
        var first = _app.Store.List().First(c => c.Kind == Storage.ClipKind.Text && !c.Masked);
        int countBefore = _app.Store.Count();
        var again = await WaitOutcome(() => _app.Bridge.Handle($"{{\"id\":1,\"command\":\"copy_clip\",\"args\":{{\"id\":\"{first.Id}\"}}}}"), 1500);
        r["copyBackNotCapturedAgain"] = again is null && _app.Store.Count() == countBefore;

        r["clipsAddedByTest"] = _app.Store.Count() - before;
        r["listenerRegistered"] = _app.Monitor.Listening;
        return r;
    }

    /// <summary>Wait for the monitor's next result (used where the copy is made by another process).</summary>
    private async Task<CaptureOutcome?> WaitOutcomeFrom(Process _, int timeoutMs)
    {
        var tcs = new TaskCompletionSource<CaptureOutcome>();
        void Handler(CaptureOutcome o) => tcs.TrySetResult(o);
        _app.Monitor.Processed += Handler;
        try { var done = await Task.WhenAny(tcs.Task, Task.Delay(timeoutMs)); return done == tcs.Task ? tcs.Task.Result : null; }
        finally { _app.Monitor.Processed -= Handler; }
    }

    private const string LookProbe = "JSON.stringify({ bg: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim(), primary: getComputedStyle(document.documentElement).getPropertyValue('--color-primary').trim(), scheme: document.documentElement.dataset.scheme, bodyFont: getComputedStyle(document.body).fontFamily, dmSansLoaded: [...document.fonts].some(f => f.family === 'DM Sans' && f.status === 'loaded'), interLoaded: [...document.fonts].some(f => f.family === 'Inter' && f.status === 'loaded'), fontsBlocked: [...document.fonts].some(f => f.status === 'error') })";

    private async Task<Dictionary<string, object?>> LookInRealWindowAsync(string theme, string font)
    {
        var r = new Dictionary<string, object?> { ["theme"] = theme, ["font"] = font };
        _app.Bridge.Handle($"{{\"id\":1,\"command\":\"save_settings\",\"args\":{{\"patch\":{{\"theme\":\"{theme}\",\"font\":\"{font}\"}}}}}}");
        await _app.OpenAsync();
        var win = _app.Window;
        if (win is null) { r["error"] = "the shelf did not open"; return r; }
        await Task.WhenAny(win.Ready.Task, Task.Delay(10000));
        await Task.Delay(1200);                                    // the web fonts load from the bundle once text is drawn in them
        string raw = await win.EvalAsync(LookProbe);              // a JSON string holding JSON
        r["probe"] = JsonSerializer.Deserialize<string>(raw);
        r["dialogs"] = win.DialogCount;
        _app.Close();
        await Task.Delay(500);
        return r;
    }

private const string ButtonsProbe = "JSON.stringify([...document.querySelectorAll('[role=group] button')].map(b => ({ t: b.textContent.trim(), disabled: b.disabled })))";
    private const string ToastProbe = "(document.querySelector('[role=status]') || {}).innerText || ''";

    /// <summary>
    /// The whole chain in the real window, against a real Vault (only when VAULT_URL and VAULT_KEY are set): connect, open the shelf, see the buttons come alive
    /// after the key is checked, click each one, and read the confirmation the person would see. The test data lives in the self-test's own folders.
    /// </summary>
    private async Task<Dictionary<string, object?>> VaultFromWindowAsync(string url, string key)
    {
        var r = new Dictionary<string, object?>();
        string connect = await _app.Bridge.HandleAsync(System.Text.Json.JsonSerializer.Serialize(new { id = 1, command = "save_connection", args = new { baseUrl = url, key } })) ?? "";
        r["connected"] = connect.Contains("\"ok\":true");
        r["keyLeakedInAnswer"] = connect.Contains(key);
        var marker = "SHELF E2E " + Guid.NewGuid().ToString("N");
        _app.Store.Add(new Storage.NewClip(Storage.ClipKind.Text, marker, null, null, "spike.exe", false, false, 0, 0, marker.Length));
        r["marker"] = marker;

        var clicks = new (string label, string name)[] { ("Save as Note", "notes"), ("Attach to CRM", "crm"), ("Ingest to Finance", "finance"), ("Ask Redaction", "redact") };
        var toasts = new Dictionary<string, string>();
        bool first = true;
        foreach (var (label, name) in clicks)
        {
            await _app.OpenAsync();
            var win = _app.Window;
            if (win is null) { toasts[name] = "(the shelf did not open)"; continue; }
            await Task.WhenAny(win.Ready.Task, Task.Delay(10000));
            await Task.Delay(1800);                                    // the key is checked with Vault when the shelf opens; the buttons come alive after that
            if (first) { r["buttons"] = JsonSerializer.Deserialize<string>(await win.EvalAsync(ButtonsProbe)); first = false; }
            await win.EvalAsync($"([...document.querySelectorAll('[role=group] button')].find(b => b.textContent.includes('{label}')) || {{ click() {{}} }}).click()");
            string toast = "";
            for (int i = 0; i < 60 && toast.Length == 0 && !win.IsDisposed; i++)      // the confirmation shows for a couple of seconds, and sending closes the shelf shortly after
            {
                await Task.Delay(100);
                try { toast = JsonSerializer.Deserialize<string>(await win.EvalAsync(ToastProbe)) ?? ""; } catch (Exception e) when (e is JsonException or ObjectDisposedException or InvalidOperationException) { break; }
            }
            toasts[name] = toast + (win.IsDisposed ? " [the shelf closed itself]" : "") + (toast.Length == 0 ? " [no confirmation seen; foreground now: " + NativeMethods.TitleOf(GetForegroundWindow()) + "]" : "");
            await Task.Delay(1200);
            if (_app.Window is not null) _app.Close();                 // sending closes the shelf by itself after a moment; a check does not
            await Task.Delay(500);
        }
        r["toasts"] = toasts;
        return r;
    }

    public async Task RunAsync()
    {
        var result = new Dictionary<string, object?>
        {
            ["when"] = DateTime.Now.ToString("s"),
            ["os"] = Environment.OSVersion.VersionString,
            ["runtime"] = RuntimeInformation.FrameworkDescription,
            ["browserArgs"] = _opts.BrowserArgs ?? "(default)",
            ["trimAfterClose"] = _app.TrimAfterClose,
            ["hotkeyRegistered"] = _app.HotkeyRegistered,
            ["webView2Runtime"] = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString(),
        };
        var snapshots = new List<MemoryProbe.Snapshot>();
        var cycles = new List<Dictionary<string, object?>>();
        IntPtr notepad = IntPtr.Zero;
        try
        {
            // ---- 1. idle: the tray only, no web view
            await Task.Delay(3000);
            snapshots.Add(MemoryProbe.Take("idle after 3 s (tray only)"));
            await Task.Delay(7000);
            snapshots.Add(MemoryProbe.Take("idle after 10 s (tray only)"));
            MemoryProbe.Trim();
            await Task.Delay(500);
            snapshots.Add(MemoryProbe.Take("idle after memory trim"));
            Say($"idle: host {snapshots[^1].HostMb:F1} MB, web view processes {snapshots[^1].WebViewProcesses}");

            // ---- 2. open / dismiss cycles with the real hotkey and a real other window
            notepad = await StartNotepadAsync();
            Say($"notepad window {notepad}");
            if (notepad == IntPtr.Zero) throw new InvalidOperationException("could not start Notepad");
            var keeper = new FocusKeeper();

            for (int n = 1; n <= Cycles; n++)
            {
                var c = new Dictionary<string, object?> { ["cycle"] = n };
                cycles.Add(c);
                keeper.Activate(notepad);
                await Task.Delay(400);
                bool preOk = GetForegroundWindow() == notepad;
                c["notepadWasForeground"] = preOk;
                if (!preOk) { c["skipped"] = "could not put Notepad in front first, so keys were not sent (they would have gone to another program)"; continue; }

                var sw = Stopwatch.StartNew();
                Chord(VK_CONTROL, VK_MENU, VK_SHIFT, VK_F11);
                while (_app.Window is null && sw.ElapsedMilliseconds < 3000) await Task.Delay(5);
                var win = _app.Window;
                if (win is null) { c["error"] = "the hotkey did not open the shelf"; continue; }
                while (!win.Visible && sw.ElapsedMilliseconds < 3000) await Task.Delay(5);
                c["msHotkeyToWindowVisible"] = sw.ElapsedMilliseconds;
                bool cards = await Task.WhenAny(win.Ready.Task, Task.Delay(10000)) == win.Ready.Task && win.Ready.Task.IsCompletedSuccessfully && win.Ready.Task.Result;
                c["msHotkeyToCardsDrawn"] = sw.ElapsedMilliseconds;
                c["cardsDrawn"] = cards;
                if (!cards) c["startupMarksWhenStalled"] = new Dictionary<string, long>(win.Marks);
                c["activate"] = $"{_app.LastActivate.ok} ({_app.LastActivate.how})";
                await Task.Delay(250);
                if (win.IsDisposed) { c["error"] = "the shelf closed by itself: another window took the focus while the test ran"; c["foregroundNow"] = NativeMethods.TitleOf(GetForegroundWindow()); c["marksBeforeClose"] = new Dictionary<string, long>(win.Marks); await Task.Delay(500); continue; }
                c["shelfHasKeyboardFocus"] = GetForegroundWindow() == win.Handle;
                c["startupMarksMs"] = new Dictionary<string, long>(win.Marks);

                if (n == 3 && cards)
                {
                    // hostile clips inside the real window with the built page's policy: pick the SVG, then the HTML clip, and look at what the page made of them
                    await win.EvalAsync("document.querySelectorAll('[role=option]')[4]?.click()");
                    await Task.Delay(500);
                    c["svgDrawnAsBlobImage"] = (await win.EvalAsync("document.querySelector('section[aria-label=Preview] img')?.src.startsWith('blob:') === true")) == "true";
                    await win.EvalAsync("document.querySelectorAll('[role=option]')[5]?.click()");
                    await Task.Delay(500);
                    c["htmlInSandboxedFrame"] = (await win.EvalAsync("(() => { const f = document.querySelector('section[aria-label=Preview] iframe'); return !!f && f.getAttribute('sandbox') === ''; })()")) == "true";
                    c["scriptDialogsFromHostileClips"] = win.DialogCount;
                }

                var open = MemoryProbe.Take($"cycle {n}: shelf open");
                snapshots.Add(open);
                c["openTotalMb"] = Math.Round(open.TotalMb, 1);
                c["openHostMb"] = Math.Round(open.HostMb, 1);
                c["openWebViewMb"] = Math.Round(open.WebViewMb, 1);
                c["openWebViewProcesses"] = open.WebViewProcesses;

                // dismiss the way a person does: Esc in the page, which asks the shell to hide
                sw.Restart();
                if (!win.IsDisposed && GetForegroundWindow() == win.Handle) Chord(VK_ESCAPE);
                else { c["escapeNotSentToShelf"] = true; c["foregroundWas"] = NativeMethods.TitleOf(GetForegroundWindow()) + " / " + GetForegroundWindow(); }
                while (_app.Window is not null && sw.ElapsedMilliseconds < 4000) await Task.Delay(5);
                c["msEscToClosed"] = sw.ElapsedMilliseconds;
                if (_app.Window is not null) { c["error"] = "Esc did not close the shelf; closed by the test"; _app.Close(); }
                await Task.Delay(250);
                var fg = GetForegroundWindow();
                c["notepadGotFocusBack"] = fg == notepad;
                c["restore"] = $"{_app.LastRestore.ok} ({_app.LastRestore.how})";
                if (fg != notepad) c["foregroundNowIs"] = NativeMethods.TitleOf(fg);

                await Task.Delay(1000);
                var after1 = MemoryProbe.Take($"cycle {n}: 1.2 s after close");
                snapshots.Add(after1);
                c["after1sWebViewProcesses"] = after1.WebViewProcesses;
                c["after1sTotalMb"] = Math.Round(after1.TotalMb, 1);
                Say($"cycle {n}: open {open.TotalMb:F1} MB (host {open.HostMb:F1} + web {open.WebViewMb:F1}), cards {cards}, focus in {c["shelfHasKeyboardFocus"]}, back {c["notepadGotFocusBack"]}");
            }

            // ---- 2b. click-away: open from one window, then choose a different window; the shelf must close and must NOT take the focus back
            var other = await StartNotepadAsync();
            if (other != IntPtr.Zero && other != notepad)
            {
                var ca = new Dictionary<string, object?> { ["cycle"] = "click-away" };
                cycles.Add(ca);
                keeper.Activate(notepad);
                await Task.Delay(400);
                if (GetForegroundWindow() == notepad)
                {
                    Chord(VK_CONTROL, VK_MENU, VK_SHIFT, VK_F11);
                    var sw2 = Stopwatch.StartNew();
                    while (_app.Window is null && sw2.ElapsedMilliseconds < 3000) await Task.Delay(5);
                    if (_app.Window is { } w2) { await Task.WhenAny(w2.Ready.Task, Task.Delay(10000)); await Task.Delay(500); }
                    ca["shelfOpened"] = _app.Window is not null;
                    keeper.Activate(other);                    // the person clicks a different window
                    sw2.Restart();
                    while (_app.Window is not null && sw2.ElapsedMilliseconds < 4000) await Task.Delay(5);
                    ca["msClickAwayToClosed"] = sw2.ElapsedMilliseconds;
                    ca["closedByItself"] = _app.Window is null;
                    await Task.Delay(300);
                    ca["chosenWindowKeptFocus"] = GetForegroundWindow() == other;
                    if (_app.Window is not null) _app.Close();
                }
                else ca["skipped"] = "could not put Notepad in front first";
                try { foreach (var p in Process.GetProcessesByName("notepad")) { if (p.MainWindowHandle == other) p.CloseMainWindow(); } } catch { /* already closed */ }
            }

            // ---- 3. after the last close: does the browser really go away, and does memory come back?
            foreach (var (label, wait) in new[] { ("after last close +3 s", 2000), ("after last close +10 s", 7000), ("after last close +20 s", 10000) })
            {
                await Task.Delay(wait);
                var s = MemoryProbe.Take(label);
                snapshots.Add(s);
                Say($"{label}: host {s.HostMb:F1} MB, web view processes {s.WebViewProcesses} ({s.WebViewMb:F1} MB)");
            }

            // ---- 4. the real clipboard listener, through the real message loop
            result["clipboardLive"] = await LiveClipboardAsync();
            Say("live clipboard: " + System.Text.Json.JsonSerializer.Serialize(result["clipboardLive"]));
            await Task.Delay(2000);
            snapshots.Add(MemoryProbe.Take("idle after clipboard activity"));

            // ---- 5. Vault's look inside the real window: the default theme, then a saved different theme and font, read by the page on its very first paint
            result["lookDefault"] = await LookInRealWindowAsync("warm-sand", "DM Sans");
            result["lookDarkInter"] = await LookInRealWindowAsync("dark-slate", "Inter");
            await LookInRealWindowAsync("warm-sand", "DM Sans");

            // ---- 6. the whole chain against a real Vault, if one was given
            if (Environment.GetEnvironmentVariable("VAULT_URL") is { Length: > 0 } vurl && Environment.GetEnvironmentVariable("VAULT_KEY") is { Length: > 0 } vkey)
                result["vaultFromRealWindow"] = await VaultFromWindowAsync(vurl, vkey);
        }
        catch (Exception e)
        {
            result["fatal"] = e.ToString();
            Say("FATAL " + e.Message);
        }
        finally
        {
            try { foreach (var p in Process.GetProcessesByName("notepad")) { if (p.MainWindowHandle == notepad) p.CloseMainWindow(); } } catch { /* it may already be closed */ }
            result["idleTarget35MbMet"] = snapshots.Count > 0 ? snapshots.Where(s => s.Label.StartsWith("idle")).All(s => s.TotalMb < 35) : null;
            result["activeTarget90MbMet"] = snapshots.Where(s => s.Label.Contains("shelf open")).All(s => s.TotalMb < 90);
            result["snapshots"] = snapshots.Select(s => new { s.Label, hostMb = Math.Round(s.HostMb, 1), webViewMb = Math.Round(s.WebViewMb, 1), totalMb = Math.Round(s.TotalMb, 1), webViewProcesses = s.WebViewProcesses }).ToList();
            result["cycles"] = cycles;
            result["log"] = _log;
            var name = $"spike-{DateTime.Now:HHmmss}-{(_opts.NoTrim ? "notrim" : "trim")}-{(_opts.BrowserArgs is null ? "defaultargs" : "customargs")}.json";
            File.WriteAllText(Path.Combine(_out, name), JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true }));
        }
    }
}
