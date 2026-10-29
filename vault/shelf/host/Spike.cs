using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;
using static VaultShelf.Host.NativeMethods;

namespace VaultShelf.Host;

/// <summary>
/// The M2 measuring spike (run with --spike &lt;folder&gt;). It drives the REAL app the way a person does: opens Notepad, presses the global hotkey
/// with injected key presses, waits for the shelf, presses Esc, and records after each step: memory (host + its WebView2 processes), time, whether
/// the shelf really got the keyboard focus, whether Notepad got it back, whether the browser processes went away, and whether a hostile clip ran script.
/// </summary>
internal sealed class Spike
{
    private const ushort VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_SPACE = 0x20, VK_ESCAPE = 0x1B;
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
                Chord(VK_CONTROL, VK_SHIFT, VK_SPACE);
                while (_app.Window is null && sw.ElapsedMilliseconds < 3000) await Task.Delay(5);
                var win = _app.Window;
                if (win is null) { c["error"] = "the hotkey did not open the shelf"; continue; }
                while (!win.Visible && sw.ElapsedMilliseconds < 3000) await Task.Delay(5);
                c["msHotkeyToWindowVisible"] = sw.ElapsedMilliseconds;
                bool cards = await Task.WhenAny(win.Ready.Task, Task.Delay(10000)) == win.Ready.Task && win.Ready.Task.IsCompletedSuccessfully && win.Ready.Task.Result;
                c["msHotkeyToCardsDrawn"] = sw.ElapsedMilliseconds;
                c["cardsDrawn"] = cards;
                c["activate"] = $"{_app.LastActivate.ok} ({_app.LastActivate.how})";
                await Task.Delay(250);
                c["shelfHasKeyboardFocus"] = GetForegroundWindow() == win.Handle;
                c["startupMarksMs"] = new Dictionary<string, long>(win.Marks);

                if (n == 1 && cards)
                {
                    // hostile clips inside the real window with the built page's policy: pick the SVG, then the HTML clip, and look at what the page made of them
                    await win.EvalAsync("document.querySelector('[data-clip-id=clip-005]')?.click()");
                    await Task.Delay(500);
                    c["svgDrawnAsBlobImage"] = (await win.EvalAsync("document.querySelector('section[aria-label=Preview] img')?.src.startsWith('blob:') === true")) == "true";
                    await win.EvalAsync("document.querySelector('[data-clip-id=clip-006]')?.click()");
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
                if (GetForegroundWindow() == win.Handle) Chord(VK_ESCAPE);
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
                    Chord(VK_CONTROL, VK_SHIFT, VK_SPACE);
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
