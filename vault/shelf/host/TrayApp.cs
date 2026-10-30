using System.Drawing.Drawing2D;
using VaultShelf.Host.Clipboard;
using VaultShelf.Host.Security;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;
using VaultShelf.Host.Vault;

namespace VaultShelf.Host;

/// <summary>
/// The always-running part: a tray icon, the global hotkey, the clipboard listener and the right-click menu. It owns no web browser: the shelf window (and
/// its WebView2) exists only between the hotkey press and the moment the shelf is dismissed.
/// </summary>
internal sealed class TrayApp : ApplicationContext
{
    private readonly string _dist, _userData;
    private readonly string? _browserArgs;
    private readonly NotifyIcon _tray;
    private readonly HotkeyWindow _hotkey = new();
    private readonly FocusKeeper _focus = new();
    private readonly Icon _icon;
    private readonly System.Windows.Forms.Timer _pruneTimer = new() { Interval = 10 * 60 * 1000 };
    private readonly ToolStripMenuItem _pauseItem;
    private string _activeHotkey;
    private bool _opening;

    public ClipStore Store { get; }
    public SettingsStore Settings { get; }
    public CredentialStore Credentials { get; }
    public StartupRegistration Startup { get; }
    public ClipboardMonitor Monitor { get; }
    public VaultClient Vault { get; }
    public Bridge Bridge { get; }
    public ShelfWindow? Window { get; private set; }
    public bool TrimAfterClose { get; set; } = true;
    public bool HotkeyRegistered { get; private set; }
    public (bool ok, string how) LastActivate { get; private set; }
    public (bool ok, string how) LastRestore { get; private set; }

    public TrayApp(string distFolder, string userDataFolder, string? browserArgs, string root, StartupRegistration? startup = null, CredentialStore? credentials = null)
    {
        _dist = distFolder; _userData = userDataFolder; _browserArgs = browserArgs;
        Store = new ClipStore(root);
        Settings = new SettingsStore(root);
        Credentials = credentials ?? new CredentialStore();
        Startup = startup ?? new StartupRegistration();
        Monitor = new ClipboardMonitor(Store, () => Settings.Current);
        AppLog.Write(Monitor.Listening ? "clipboard listener registered" : "clipboard listener could NOT be registered");
        Vault = new VaultClient();
        Bridge = new Bridge(Store, Settings, Credentials, Startup, Monitor, Vault, ApplyHotkey);

        _icon = MakeIcon();
        _activeHotkey = Settings.Current.Hotkey;
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open", null, async (_, _) => await OpenAsync());
        menu.Items.Add("Settings", null, async (_, _) => await OpenAsync());      // opens the shelf; it will go straight to Settings once that is wired
        _pauseItem = new ToolStripMenuItem("Pause monitoring") { CheckOnClick = true };
        _pauseItem.CheckedChanged += (_, _) => { Monitor.Paused = _pauseItem.Checked; UpdateTooltip(); };
        menu.Items.Add(_pauseItem);
        menu.Items.Add("Clear history", null, (_, _) => ConfirmClear());
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit", null, (_, _) => ExitThread());
        _tray = new NotifyIcon { Icon = _icon, ContextMenuStrip = menu, Visible = true };
        _tray.MouseClick += async (_, e) => { if (e.Button == MouseButtons.Left) await ToggleAsync(); };

        _hotkey.Pressed += async () => await ToggleAsync();
        HotkeyRegistered = _hotkey.Register(_activeHotkey);
        UpdateTooltip();
        AppLog.Write(HotkeyRegistered ? $"shortcut {_activeHotkey} registered" : $"shortcut {_activeHotkey} REFUSED: another program already uses it");
        if (!HotkeyRegistered)
        {
            // the commonest reason for "the shortcut does nothing": say so, where it will be seen
            _tray.ShowBalloonTip(10000, "Vault Shelf", $"{_activeHotkey} is already used by another program, so it will not open the shelf. Click this tray icon instead, or choose another shortcut in the shelf's Settings.", ToolTipIcon.Warning);
        }

        Monitor.Processed += outcome => { if (outcome.Captured) NotifyPage("clips_changed"); };
        Bridge.ClipsChanged += () => NotifyPage("clips_changed");

        // keep the history inside its limits: now, then every ten minutes
        Store.Prune(Settings.Current.RetentionItems, Settings.Current.AutoClearHours, DateTimeOffset.UtcNow);
        _pruneTimer.Tick += (_, _) => { if (Store.Prune(Settings.Current.RetentionItems, Settings.Current.AutoClearHours, DateTimeOffset.UtcNow) > 0) NotifyPage("clips_changed"); };
        _pruneTimer.Start();

        // "Start with Windows" is a setting; make the registry agree with it (and carry the current program path if the program moved)
        try { if (Settings.Current.StartOnBoot) Startup.Set(true); } catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException) { /* shown as unchanged the next time it is asked for */ }
    }

    private void UpdateTooltip() => _tray.Text = Monitor.Paused ? "Vault Shelf (paused)" : $"Vault Shelf ({_activeHotkey})";

    /// <summary>Change the global shortcut. False (and the old one kept) when another program already uses it.</summary>
    public bool ApplyHotkey(string hotkey)
    {
        if (!_hotkey.Register(hotkey)) { HotkeyRegistered = _hotkey.Register(_activeHotkey); return false; }
        _activeHotkey = hotkey; HotkeyRegistered = true; UpdateTooltip();
        return true;
    }

    private void NotifyPage(string name) => Window?.PostEvent(name);

    private void ConfirmClear()
    {
        if (MessageBox.Show("Clear everything on the shelf? This cannot be undone.", "Vault Shelf", MessageBoxButtons.YesNo, MessageBoxIcon.Warning, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return;
        Store.Clear();
        NotifyPage("clips_changed");
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
            // the chosen theme and font go in the page address, so the first paint already wears them (no flash of the default)
            var look = Settings.Current;
            var w = new ShelfWindow(Bridge, _dist, _userData, _browserArgs, $"?theme={Uri.EscapeDataString(look.Theme)}&font={Uri.EscapeDataString(look.Font)}");
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
        _pruneTimer.Dispose();
        Window?.Destroy();
        Window = null;
        _tray.Visible = false;
        _tray.Dispose();
        Monitor.Dispose();
        _hotkey.Dispose();
        Store.Dispose();
        Vault.Dispose();
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
