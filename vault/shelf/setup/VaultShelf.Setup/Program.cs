using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace VaultShelf.Setup;

/// <summary>
/// VaultShelfSetup.exe: installs Vault Shelf for the person running it. No administrator is needed: everything goes in their own account.
/// It is a plain file copier. The program's files travel inside this file; once they are copied, the program registers itself
/// (<c>VaultShelf.exe --register</c>), so the installer holds no knowledge of Windows settings.
///   VaultShelfSetup.exe              install (asks first, tells the result)
///   VaultShelfSetup.exe /S           install without asking or telling
///   VaultShelfSetup.exe /dir=PATH    install somewhere else
///   VaultShelfSetup.exe /nostart     do not start the program afterwards
///   VaultShelfSetup.exe /uninstall   remove it (add /S for silent, /purge to delete the copy history too)
/// </summary>
internal static class Program
{
    private const string Exe = InstallFolder.ProgramFile;

    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = Has(args, "/S") || Has(args, "--silent"), noStart = Has(args, "/nostart"), uninstall = Has(args, "/uninstall"), purge = Has(args, "/purge");
        string? dirArg = args.Select(a => a.StartsWith("/dir=", StringComparison.OrdinalIgnoreCase) ? a[5..].Trim('"') : null).FirstOrDefault(a => a is not null);
        try
        {
            if (uninstall) return Uninstall(silent, purge);
            return InstallAsync(dirArg, silent, noStart).GetAwaiter().GetResult();
        }
        catch (Exception e)
        {
            Say(silent, "Vault Shelf could not be installed.\n\n" + Plain(e), error: true);
            return 1;
        }
    }

    private static bool Has(string[] args, string flag) => args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));

    private static async Task<int> InstallAsync(string? dirArg, bool silent, bool noStart)
    {
        string dir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dirArg ?? InstallFolder.DefaultDir));
        if (InstallFolder.Problem(dir) is { } problem) { Say(silent, problem, error: true); return 2; }
        if (!silent && MessageBox("Install Vault Shelf for you?\n\nIt goes in your own account: no administrator is needed.\n\n" + dir, "Vault Shelf setup", ok: true, ask: true) != Yes) return 3;

        if (!WebView2Runtime.IsInstalled())
        {
            if (await WebView2Runtime.InstallAsync() is { } why) { Say(silent, why, error: true); return 4; }
        }

        using var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")
            ?? throw new InvalidOperationException("This installer has no program inside it. Download it again.");

        StopRunningCopies(dir);
        if (File.Exists(Path.Combine(dir, Exe))) ClearEarlierInstall(dir);   // an update: the old files go, so none are left behind
        Directory.CreateDirectory(dir);
        SafeZip.Extract(payload, dir);
        if (!File.Exists(Path.Combine(dir, Exe)) || !File.Exists(Path.Combine(dir, "shelf", "index.html"))) throw new InvalidDataException("The installed files are incomplete. Download the installer again.");

        int code = Run(Path.Combine(dir, Exe), "--register", wait: true);
        if (code != 0) { Say(silent, "The files were copied but Windows would not take the registration (code " + code + ").", error: true); return 5; }
        // started through Explorer so it is not a child of this installer: a deployment tool that waits for the installer's whole process tree would otherwise wait for ever
        if (!noStart) using (Process.Start(new ProcessStartInfo("explorer.exe") { ArgumentList = { Path.Combine(dir, Exe) }, UseShellExecute = false })) { }
        Say(silent, "Vault Shelf is installed.\n\nLook for its icon near the clock. Press Ctrl+Shift+Space to open it, then open Settings in the shelf to connect it to Vault.");
        return 0;
    }

    private static int Uninstall(bool silent, bool purge)
    {
        string? dir;
        using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\VaultShelf")) dir = k?.GetValue("InstallLocation") as string;
        string exe = dir is null ? "" : Path.Combine(dir, Exe);
        if (dir is null || !File.Exists(exe)) { Say(silent, "Vault Shelf is not installed for this account."); return 0; }
        var args = "--unregister" + (silent ? " --silent" : "") + (purge ? " --purge" : "");
        return Run(exe, args, wait: true);
    }

    private static void StopRunningCopies(string dir)
    {
        foreach (var p in Process.GetProcessesByName("VaultShelf"))
        {
            try
            {
                string? other = Path.GetDirectoryName(p.MainModule?.FileName);
                if (other is not null && string.Equals(Path.TrimEndingDirectorySeparator(other), dir, StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(5000); }
            }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { /* not ours, or already gone */ }
            finally { p.Dispose(); }
        }
    }

    private static void ClearEarlierInstall(string dir)
    {
        // only entries inside the folder, never the folder's parents; the folder was already shown to hold this program
        foreach (var f in Directory.EnumerateFiles(dir)) File.Delete(f);
        foreach (var d in Directory.EnumerateDirectories(dir)) Directory.Delete(d, recursive: true);
    }

    private static int Run(string exe, string args, bool wait)
    {
        var psi = new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(exe)! };
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Could not start the program.");
        if (!wait) return 0;
        if (!p.WaitForExit(60_000)) { try { p.Kill(); } catch (InvalidOperationException) { } return -1; }
        return p.ExitCode;
    }

    private static string Plain(Exception e) => e switch
    {
        UnauthorizedAccessException => "Windows would not let the installer write there. Close Vault Shelf and try again, or choose another folder with /dir=.",
        IOException => "A file could not be written. Close Vault Shelf (right-click its tray icon, Exit) and try again.",
        InvalidDataException => e.Message,
        InvalidOperationException => e.Message,
        _ => "Something unexpected went wrong (" + e.GetType().Name + ").",
    };

    // ---- the only dialogs: plain Windows message boxes (no windows library, so the installer stays small)
    private const int Yes = 6;
    private static void Say(bool silent, string text, bool error = false) { if (!silent) MessageBox(text, "Vault Shelf setup", ok: true, ask: false, error); }
    private static int MessageBox(string text, string title, bool ok, bool ask, bool error = false)
    {
        uint flags = ask ? 0x24u /* yes/no + question */ : (error ? 0x10u : 0x40u);
        return MessageBoxW(IntPtr.Zero, text, title, flags);
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
}
