using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace VaultShelf.Host;

/// <summary>
/// The tray window. A fresh one is created every time the shelf opens and thrown away when it closes: while the shelf is not open there is no
/// web browser running at all, which is how the idle memory target is met. It shows the built page (../dist) from a private virtual host name,
/// refuses to go anywhere else, and gives the page nothing but the Bridge.
/// </summary>
internal sealed class ShelfWindow : Form
{
    public const string HostName = "shelf.local";

    /// <summary>
    /// Browser switches, chosen by measuring (docs/vault-shelf.md, M2 spike): with the defaults the shelf used about 115 MB and took 2.8 s to draw; with these about
    /// 70 MB and 0.75 s. No GPU process (a plain page does not need one), no background networking, update checks or SmartScreen lookups (each can stall the
    /// first page for seconds and none has a job in a window that shows one local file), one renderer.
    /// </summary>
    public const string DefaultBrowserArgs =
        "--disable-gpu --disable-background-networking --disable-component-update --disable-sync " +
        "--disable-features=Translate,OptimizationHints,msSmartScreenProtection --renderer-process-limit=1 --disable-site-isolation-trials";
    private static CoreWebView2Environment? _env;

    private readonly Bridge _bridge;
    private readonly string _dist;
    private readonly string _userData;
    private readonly string? _browserArgs;
    private readonly string _query;
    private WebView2? _view;

    /// <summary>Completes when the page has loaded and drawn its first cards.</summary>
    public TaskCompletionSource<bool> Ready { get; } = new();
    public Stopwatch SinceOpen { get; } = Stopwatch.StartNew();
    public long MsToWindowShown { get; private set; }
    /// <summary>Milliseconds since the window was created, at each step of starting the page (for the self-test).</summary>
    public Dictionary<string, long> Marks { get; } = new();
    private void Mark(string name) => Marks[name] = SinceOpen.ElapsedMilliseconds;
    /// <summary>How many script pop-ups the page tried to open. Should stay 0, whatever was copied.</summary>
    public int DialogCount { get; private set; }

    /// <summary>Run a script in the page and return its JSON result (used by the self-test; nothing else calls this).</summary>
    public async Task<string> EvalAsync(string js) => _view?.CoreWebView2 is { } core ? await core.ExecuteScriptAsync(js) : "null";

    public ShelfWindow(Bridge bridge, string distFolder, string userDataFolder, string? browserArgs = null, string query = "")
    {
        _bridge = bridge; _dist = distFolder; _userData = userDataFolder; _browserArgs = browserArgs ?? DefaultBrowserArgs; _query = query;
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        StartPosition = FormStartPosition.Manual;
        KeyPreview = false;
        BackColor = SystemColors.Control;
        var area = Screen.FromPoint(Cursor.Position).WorkingArea;
        int w = Math.Min(area.Width - 24, 1600), h = 400;
        Bounds = new Rectangle(area.Left + (area.Width - w) / 2, area.Bottom - h - 12, w, h);
        Shown += (_, _) => MsToWindowShown = SinceOpen.ElapsedMilliseconds;
    }

    protected override bool ShowWithoutActivation => false;

    protected override CreateParams CreateParams
    {
        get { var cp = base.CreateParams; cp.ExStyle |= 0x80; return cp; } // WS_EX_TOOLWINDOW: not in Alt+Tab
    }

    /// <summary>Starts the web view and loads the page. Call after the window is shown.</summary>
    public async Task LoadAsync()
    {
        try
        {
            Mark("loadStart");
            _env ??= await CoreWebView2Environment.CreateAsync(null, _userData, new CoreWebView2EnvironmentOptions { AdditionalBrowserArguments = _browserArgs });
            Mark("environmentReady");
            _view = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.Transparent };
            Controls.Add(_view);
            await _view.EnsureCoreWebView2Async(_env);
            Mark("browserStarted");
            var core = _view.CoreWebView2;

            var s = core.Settings;
            s.AreDevToolsEnabled = false;
            s.AreDefaultContextMenusEnabled = false;
            s.AreDefaultScriptDialogsEnabled = false;
            s.AreBrowserAcceleratorKeysEnabled = false;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsSwipeNavigationEnabled = false;

            core.SetVirtualHostNameToFolderMapping(HostName, _dist, CoreWebView2HostResourceAccessKind.Deny);
            // the page may load only from its own folder: any other address, new window or download is refused
            core.NavigationStarting += (_, e) => { if (!IsOurs(e.Uri)) e.Cancel = true; };
            core.NewWindowRequested += (_, e) => e.Handled = true;
            core.DownloadStarting += (_, e) => e.Cancel = true;
            core.PermissionRequested += (_, e) => e.State = CoreWebView2PermissionState.Deny;
            core.WebMessageReceived += OnMessage;
            core.ScriptDialogOpening += (_, _) => DialogCount++;     // an alert()/confirm() from a clip: counted (and never shown)
            await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.PageScript);

            var done = new TaskCompletionSource();
            core.NavigationCompleted += (_, _) => done.TrySetResult();
            core.Navigate($"https://{HostName}/index.html{_query}");
            await done.Task;
            Mark("pageLoaded");
            _view.Focus();
            _ = WaitForCardsAsync(core);
        }
        catch (Exception e)
        {
            Ready.TrySetException(e);
        }
    }

    private static bool IsOurs(string uri) => uri.StartsWith($"https://{HostName}/", StringComparison.OrdinalIgnoreCase) || uri.StartsWith("about:blank", StringComparison.OrdinalIgnoreCase);

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // only our own page may talk to the shell
        if (!IsOurs(e.Source)) return;
        string json = e.WebMessageAsJson;                      // read before waiting: the event arguments are only valid inside the event
        string? reply = await _bridge.HandleAsync(json);       // sending to Vault can take a few seconds; the window stays responsive
        if (reply is not null && _view?.CoreWebView2 is { } core) core.PostWebMessageAsJson(reply);   // the window may have closed meanwhile: then there is nobody to tell
    }

    private async Task WaitForCardsAsync(CoreWebView2 core)
    {
        try
        {
            for (int i = 0; i < 100; i++)
            {
                string n = await core.ExecuteScriptAsync("document.querySelectorAll('[role=option]').length");
                if (int.TryParse(n, out int cards) && cards > 0) { Mark("cardsDrawn"); Ready.TrySetResult(true); return; }
                await Task.Delay(30);
            }
            Ready.TrySetResult(false);
        }
        catch (Exception e) { Ready.TrySetException(e); }
    }

    public void PostEvent(string name) => _view?.CoreWebView2?.PostWebMessageAsJson(Bridge.EventMessage(name));

    /// <summary>Close the window and end the web view. Hides first so nothing flickers while the browser shuts down.</summary>
    public void Destroy()
    {
        Hide();
        if (_view is not null) { Controls.Remove(_view); _view.Dispose(); _view = null; }
        Close();
        Dispose();
    }
}
