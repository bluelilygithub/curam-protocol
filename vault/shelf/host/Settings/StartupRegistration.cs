using Microsoft.Win32;

namespace VaultShelf.Host.Settings;

/// <summary>
/// "Start with Windows": a value in the current user's Run key (HKCU, so no administrator rights and nothing for other accounts). It starts the program quietly
/// in the tray; the program never opens a window on its own.
/// </summary>
internal sealed class StartupRegistration
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private readonly string _valueName;
    public StartupRegistration(string valueName = "VaultShelf") => _valueName = valueName;

    public bool IsEnabled()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(_valueName) is string s && s.Length > 0;
    }

    public void Set(bool enabled, string? exePath = null)
    {
        using var key = Registry.CurrentUser.CreateSubKey(RunKey);
        if (enabled)
        {
            string exe = exePath ?? Environment.ProcessPath ?? throw new InvalidOperationException("The program's own path is not known.");
            key.SetValue(_valueName, $"\"{exe}\" --background");
        }
        else key.DeleteValue(_valueName, throwOnMissingValue: false);
    }

    public string? Command()
    {
        using var key = Registry.CurrentUser.OpenSubKey(RunKey);
        return key?.GetValue(_valueName) as string;
    }
}
