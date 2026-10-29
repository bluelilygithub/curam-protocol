namespace VaultShelf.Host;

internal sealed record Options(string Dist, string UserData, string? BrowserArgs, string? SpikeOut, bool NoTrim)
{
    public static Options Parse(string[] args)
    {
        string? dist = null, userData = null, browserArgs = null, spike = null;
        bool noTrim = false;
        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--dist": dist = args[++i]; break;
                case "--user-data": userData = args[++i]; break;
                case "--browser-args": browserArgs = args[++i]; break;
                case "--spike": spike = args[++i]; break;
                case "--no-trim": noTrim = true; break;
            }
        }
        userData ??= Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "VaultShelf", "webview2");
        return new Options(dist ?? FindDist(), userData, browserArgs, spike, noTrim);
    }

    /// <summary>The built page: next to the program, or in shelf/dist when run from the source tree.</summary>
    private static string FindDist()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            foreach (var rel in new[] { "shelf", "dist", Path.Combine("shelf", "dist") })
            {
                var candidate = Path.Combine(dir.FullName, rel);
                if (File.Exists(Path.Combine(candidate, "index.html"))) return candidate;
            }
        }
        throw new DirectoryNotFoundException("Could not find the built shelf page (shelf/dist/index.html). Run `npm run build` in vault/shelf.");
    }
}

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        var opts = Options.Parse(args);
        // one copy at a time (the spike has its own name so it can run beside the real app)
        using var mutex = new Mutex(true, opts.SpikeOut is null ? "Local\\VaultShelf" : "Local\\VaultShelf.Spike", out bool first);
        if (!first) return 0;

        ApplicationConfiguration.Initialize();
        var app = new TrayApp(opts.Dist, opts.UserData, opts.BrowserArgs) { TrimAfterClose = !opts.NoTrim };
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        app.HookBridge(SynchronizationContext.Current!);
        if (opts.SpikeOut is not null)
        {
            var spike = new Spike(app, opts, opts.SpikeOut);
            var timer = new System.Windows.Forms.Timer { Interval = 300 };
            timer.Tick += async (_, _) => { timer.Stop(); await spike.RunAsync(); app.ExitThread(); };
            timer.Start();
        }
        Application.Run(app);
        return 0;
    }
}
