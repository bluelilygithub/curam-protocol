using Microsoft.Win32;

namespace VaultShelf.Host.Install;

/// <summary>
/// What installing the app writes into the current person's Windows account (never the whole machine, so no administrator is needed): the
/// <c>vault-shelf://</c> link handler, the entry in Windows' Apps list (with its uninstall command) and a Start menu shortcut. Every location is a parameter
/// so the tests can use a throwaway one.
/// </summary>
internal sealed class Registration
{
    public const string UninstallKeyName = "VaultShelf";
    private readonly string _classesRoot, _uninstallRoot, _startMenuDir;

    public Registration(string? classesRoot = null, string? uninstallRoot = null, string? startMenuDir = null)
    {
        _classesRoot = classesRoot ?? @"Software\Classes";
        _uninstallRoot = uninstallRoot ?? @"Software\Microsoft\Windows\CurrentVersion\Uninstall";
        _startMenuDir = startMenuDir ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs));
    }

    public string ShortcutPath => Path.Combine(_startMenuDir, "Vault Shelf.lnk");
    public string OpenCommand(string exe) => $"\"{exe}\" --open \"%1\"";

    public void Register(string exePath, string version)
    {
        if (!File.Exists(exePath)) throw new FileNotFoundException("The program to register was not found.", exePath);
        string dir = Path.GetDirectoryName(exePath)!;

        using (var link = Registry.CurrentUser.CreateSubKey($@"{_classesRoot}\{ProtocolUrl.Scheme}"))
        {
            link.SetValue("", "URL:Vault Shelf");
            link.SetValue("URL Protocol", "");
            using var icon = link.CreateSubKey("DefaultIcon"); icon.SetValue("", $"\"{exePath}\",0");
            using var cmd = link.CreateSubKey(@"shell\open\command"); cmd.SetValue("", OpenCommand(exePath));
        }

        using (var u = Registry.CurrentUser.CreateSubKey($@"{_uninstallRoot}\{UninstallKeyName}"))
        {
            u.SetValue("DisplayName", "Vault Shelf");
            u.SetValue("DisplayVersion", version);
            u.SetValue("Publisher", "Blue Lily");
            u.SetValue("InstallLocation", dir);
            u.SetValue("DisplayIcon", exePath);
            u.SetValue("UninstallString", $"\"{exePath}\" --unregister");
            u.SetValue("QuietUninstallString", $"\"{exePath}\" --unregister --silent");
            u.SetValue("NoModify", 1, RegistryValueKind.DWord);
            u.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            try { u.SetValue("EstimatedSize", (int)(DirSizeBytes(dir) / 1024), RegistryValueKind.DWord); } catch (IOException) { /* only used for the size shown in the Apps list */ }
        }

        MakeShortcut(exePath, dir);
    }

    public void Unregister()
    {
        Registry.CurrentUser.DeleteSubKeyTree($@"{_classesRoot}\{ProtocolUrl.Scheme}", throwOnMissingSubKey: false);
        Registry.CurrentUser.DeleteSubKeyTree($@"{_uninstallRoot}\{UninstallKeyName}", throwOnMissingSubKey: false);
        try { if (File.Exists(ShortcutPath)) File.Delete(ShortcutPath); } catch (Exception e) when (e is IOException or UnauthorizedAccessException) { AppLog.Write("shortcut not removed: " + e.GetType().Name); }
    }

    /// <summary>The folder the app was installed to, as recorded when it was registered, or null when it is not.</summary>
    public string? InstalledLocation()
    {
        using var u = Registry.CurrentUser.OpenSubKey($@"{_uninstallRoot}\{UninstallKeyName}");
        return u?.GetValue("InstallLocation") as string;
    }

    public string? RegisteredOpenCommand()
    {
        using var k = Registry.CurrentUser.OpenSubKey($@"{_classesRoot}\{ProtocolUrl.Scheme}\shell\open\command");
        return k?.GetValue("") as string;
    }

    private void MakeShortcut(string exePath, string workDir)
    {
        Directory.CreateDirectory(_startMenuDir);
        var shell = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Windows could not make the shortcut.");
        dynamic sh = Activator.CreateInstance(shell)!;
        try
        {
            dynamic lnk = sh.CreateShortcut(ShortcutPath);
            lnk.TargetPath = exePath; lnk.Arguments = "--open vault-shelf://open"; lnk.WorkingDirectory = workDir; lnk.Description = "Vault Shelf: your clipboard history, sent to Vault";
            lnk.Save();
        }
        finally { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(sh); }
    }

    private static long DirSizeBytes(string dir) => new DirectoryInfo(dir).EnumerateFiles("*", SearchOption.AllDirectories).Sum(f => f.Length);
}

/// <summary>The rule for removing the program's own folder when it is uninstalled. Deleting a folder is the one destructive step, so it is strict.</summary>
internal static class UninstallPlan
{
    /// <summary>
    /// Only the exact folder the installer recorded, only if it holds the program, and never a drive root, a profile folder or a development tree.
    /// </summary>
    public static bool MayDelete(string? currentDir, string? registeredDir)
    {
        if (string.IsNullOrWhiteSpace(currentDir) || string.IsNullOrWhiteSpace(registeredDir)) return false;
        string a = Path.TrimEndingDirectorySeparator(Path.GetFullPath(currentDir)), b = Path.TrimEndingDirectorySeparator(Path.GetFullPath(registeredDir));
        if (!string.Equals(a, b, StringComparison.OrdinalIgnoreCase)) return false;
        if (Path.GetPathRoot(a)?.TrimEnd('\\').Equals(a, StringComparison.OrdinalIgnoreCase) == true) return false;
        string profile = Path.TrimEndingDirectorySeparator(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        if (string.Equals(a, profile, StringComparison.OrdinalIgnoreCase)) return false;
        if (!File.Exists(Path.Combine(a, "VaultShelf.exe")) || !File.Exists(Path.Combine(a, "shelf", "index.html"))) return false;
        // a source checkout has a project file above it: never delete that
        // (stop at the profile folder: a person may keep their own settings repository there)
        for (var d = new DirectoryInfo(a); d is not null && !string.Equals(Path.TrimEndingDirectorySeparator(d.FullName), profile, StringComparison.OrdinalIgnoreCase); d = d.Parent)
            if (d.EnumerateFiles("*.csproj").Any() || Directory.Exists(Path.Combine(d.FullName, ".git"))) return false;
        return true;
    }
}
