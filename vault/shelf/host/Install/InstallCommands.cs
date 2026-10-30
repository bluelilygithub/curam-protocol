using System.Diagnostics;
using VaultShelf.Host.Security;
using VaultShelf.Host.Settings;

namespace VaultShelf.Host.Install;

/// <summary>
/// <c>VaultShelf.exe --register</c> and <c>--unregister</c>: what the setup program runs after it has copied the files, and what Windows runs from the
/// Apps list. The setup program stays a plain file copier; everything that touches the person's account is here, where it can be tested.
/// </summary>
internal static class InstallCommands
{
    public static string Version => (typeof(InstallCommands).Assembly.GetName().Version ?? new Version(1, 0, 0)).ToString(3);

    public static int RegisterSelf()
    {
        try
        {
            string exe = Environment.ProcessPath ?? "";
            if (!string.Equals(Path.GetFileName(exe), "VaultShelf.exe", StringComparison.OrdinalIgnoreCase)) { AppLog.Write("register refused: not run as VaultShelf.exe"); return 2; }
            new Registration().Register(exe, Version);
            AppLog.Write($"registered {Version} at {Path.GetDirectoryName(exe)}");
            return 0;
        }
        catch (Exception e) { AppLog.Write("register failed: " + e.GetType().Name); return 1; }
    }

    public static int UnregisterSelf(string dataRoot, bool silent, bool purge)
    {
        string exe = Environment.ProcessPath ?? "";
        string dir = Path.GetDirectoryName(exe) ?? "";
        var reg = new Registration();
        if (!silent && MessageBox.Show("Remove Vault Shelf from this PC?" + (purge ? "\n\nYour copy history on this PC will be deleted too." : "\n\nYour copy history stays on this PC, in case you install it again."),
                "Vault Shelf", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2) != DialogResult.Yes) return 3;
        try
        {
            string? registered = reg.InstalledLocation();          // read before it is removed: it decides whether the folder may be deleted
            StopOtherCopies(dir);
            try { new StartupRegistration().Set(false); } catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException) { /* nothing to undo */ }
            reg.Unregister();
            if (purge) { try { if (Directory.Exists(dataRoot)) Directory.Delete(dataRoot, true); } catch (IOException) { /* a file still in use: left behind, harmless */ } new CredentialStore().Delete(); }
            bool deleting = UninstallPlan.MayDelete(dir, registered);
            if (deleting) DeleteFolderAfterExit(dir);
            AppLog.Write($"unregistered; folder {(deleting ? "will be removed" : "left in place")}");
            if (!silent) MessageBox.Show("Vault Shelf was removed." + (purge ? "" : "\n\nYour copy history was kept on this PC."), "Vault Shelf", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception e)
        {
            AppLog.Write("unregister failed: " + e.GetType().Name);
            if (!silent) MessageBox.Show("Vault Shelf could not be fully removed.\n\nDetails are in " + (AppLog.Path ?? "its log file") + ".", "Vault Shelf", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return 1;
        }
    }

    /// <summary>End any other running copy that lives in this folder (a running program cannot be deleted or replaced).</summary>
    public static void StopOtherCopies(string dir)
    {
        foreach (var p in Process.GetProcessesByName("VaultShelf"))
        {
            try
            {
                if (p.Id == Environment.ProcessId) continue;
                string? other = Path.GetDirectoryName(p.MainModule?.FileName);
                if (other is not null && string.Equals(Path.TrimEndingDirectorySeparator(other), Path.TrimEndingDirectorySeparator(dir), StringComparison.OrdinalIgnoreCase)) { p.Kill(); p.WaitForExit(3000); }
            }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or NotSupportedException) { /* not ours, or already gone */ }
            finally { p.Dispose(); }
        }
    }

    /// <summary>
    /// The hidden command that removes the folder once this program has exited. cmd.exe has its own quoting: the whole command goes in one pair of quotes (which it
    /// strips) and the folder keeps its own, so a path with spaces works. A plain argument list would escape the inner quotes in a way cmd does not understand.
    /// </summary>
    public static string DeleteCommandLine(string dir) => $"/c \"ping 127.0.0.1 -n 4 >nul & rmdir /s /q \"{dir}\"\"";

    /// <summary>
    /// How to start that command. It must NOT start inside the folder it is deleting: a program's working folder cannot be removed while it is in use,
    /// and a child inherits its parent's (the installed program's) folder unless told otherwise. The temp folder is always there and never the target.
    /// </summary>
    public static ProcessStartInfo DeleteStartInfo(string dir) => new("cmd.exe")
    {
        CreateNoWindow = true, UseShellExecute = false, WindowStyle = ProcessWindowStyle.Hidden,
        WorkingDirectory = Path.GetTempPath(), Arguments = DeleteCommandLine(dir),
    };

    // this program's own files cannot be deleted while it runs: a hidden command waits a few seconds, then removes the folder
    private static void DeleteFolderAfterExit(string dir) => Process.Start(DeleteStartInfo(dir))?.Dispose();
}
