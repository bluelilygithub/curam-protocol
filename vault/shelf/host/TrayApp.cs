using System.Drawing.Drawing2D;

namespace VaultShelf.Host;

/// <summary>
/// The always-running part: a tray icon, the global hotkey and the right-click menu. It owns no web browser: the shelf window (and its WebView2)
/// exists only between the hotkey press and the moment the shelf is dismissed.
/// </summary>
internal sealed class TrayApp : ApplicationContext
{
    private readonly string _dist, _userData;
    private readonly string? _browserArgs;
    private readonly NotifyIcon _tray;
    private readonly HotkeyWindow _hotkey = new();
    private readonly FocusKeeper _focus = new();
    private readonly Icon _icon;
    private bool _opening;

    public Bridge Bridge { get; } = new();
    public ShelfWindow? Window { get; private set; }
    public bool TrimAfterClose { get; set; } = true;
    public bool HotkeyRegistered { get; }
    public (bool ok, string how) LastActivate { get; private set; }
    public (bool ok, string how) LastRestore { get; private set; }
    public Action<string>? Log { get; set; }

    public TrayApp(string distFolder, string userDataFolder, string? browserArgs, string hotkey = "Ctrl+Shift+Space")
    {
        _dist = distFolder; _userData = userDataFolder; _browserArgs = browserArgs;
        _icon = MakeIcon();
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, async (_, _) => await OpenAsync());
        menu.Items.Add("Settings", null, async (_, _) => await OpenAsync());      // opens the shelf; it will go straight to Settings once that is wired (M4)
        menu.Items.Add(new ToolStripMenuItem("Pause monitoring") { CheckOnClick = true });  // wired to the clipboard listener in the next step
        menu.Items.Add("Clear history", null, (_, _) => { /* wired to the store in the next step */ });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        _tray = new NotifyIcon { Icon = _icon, Text = $"Vault Shelf ({hotkey})", ContextMenuStrip = menu, Visible = true };
        _tray.MouseClick += async (_, e) => { if (e.Button == MouseButtons.Left) await ToggleAsync(); };

        _hotkey.Pressed += async () => await ToggleAsync();
        HotkeyRegistered = _hotkey.Register(hotkey);
    }

    public async Task ToggleAsync()
    {
        if (Window is not null) Close(); else await OpenAsync();
    }

    public async Task OpenAsync()
    {
        if (Window is not null || _opening) return;
        _opening = true;
        try
        {
            _focus.Remember();                                  // before any window of ours exists
            var w = new ShelfWindow(Bridge, _dist, _userData, _browserArgs);
            Window = w;
            w.Show();
            LastActivate = _focus.Activate(w.Handle);
            // click-away: another window was chosen, so close, and leave the focus where the person put it (do not pull it back to the old window)
            w.Deactivate += (_, _) => { if (Window == w && w.SinceOpen.ElapsedMilliseconds > 400) w.BeginInvoke(() => { if (Window == w) Close(restoreFocus: false); }); };
            await w.LoadAsync();
        }
        finally { _opening = false; }
    }

    /// <summary>Hide the shelf, give the focus back, then end the web view. Safe to call more than once.</summary>
    public void Close(bool restoreFocus = true)
    {
        var w = Window;
        if (w is null) return;
        Window = null;
        w.Hide();                                               // first: nothing flickers, and Windows can pick the previous window
        LastRestore = restoreFocus ? _focus.RestorePrevious() : (true, "not asked (the person chose another window)");
        w.Destroy();
        if (TrimAfterClose) _ = TrimLaterAsync();
    }

    private static async Task TrimLaterAsync()
    {
        await Task.Delay(2000);                                 // let the browser processes finish shutting down first
        MemoryProbe.Trim();
    }

    /// <summary>The page asked to hide: do it after the message handler has returned (a web view must not be destroyed from inside its own event).</summary>
    public void HookBridge(SynchronizationContext ui) => Bridge.HideRequested += () => ui.Post(_ => Close(), null);

    protected override void ExitThreadCore()
    {
        Window?.Destroy();
        Window = null;
        _tray.Visible = false;
        _tray.Dispose();
        _hotkey.Dispose();
        _icon.Dispose();
        base.ExitThreadCore();
    }

    private static Icon MakeIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using var bg = new SolidBrush(Color.FromArgb(0, 95, 184));
            using var path = new GraphicsPath();
            path.AddArc(1, 1, 10, 10, 180, 90); path.AddArc(21, 1, 10, 10, 270, 90); path.AddArc(21, 21, 10, 10, 0, 90); path.AddArc(1, 21, 10, 10, 90, 90);
            path.CloseFigure();
            g.FillPath(bg, path);
            using var white = new SolidBrush(Color.White);
            g.FillRectangle(white, 7, 9, 18, 3); g.FillRectangle(white, 7, 15, 18, 3); g.FillRectangle(white, 7, 21, 11, 3);
        }
        var hIcon = bmp.GetHicon();
        using var temp = Icon.FromHandle(hIcon);
        var copy = (Icon)temp.Clone();                          // own copy, so the handle below can be released
        DestroyIcon(hIcon);
        return copy;
    }

    [System.Runtime.InteropServices.DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr h);
}
