namespace VaultShelf.Host.Clipboard;

/// <summary>What was on the clipboard besides the content: the markers apps use to say "do not keep this", and who put it there.</summary>
internal sealed record ClipboardInfo(
    IReadOnlyCollection<string> FormatNames,
    bool ExcludeFromMonitorProcessing,   // "ExcludeClipboardContentFromMonitorProcessing": password managers set this
    bool ViewerIgnore,                   // "Clipboard Viewer Ignore": the older marker, same meaning
    int? CanIncludeInHistory,            // "CanIncludeInClipboardHistory": 0 = must not be kept
    int? CanUploadToCloud,               // "CanUploadToCloudClipboard": 0 = must not leave this PC
    string? OwnerExe);                   // the program that put it there, lower case, e.g. "keepass.exe"

internal enum DropReason { None, Paused, PasswordManagerFlag, ExcludedApp, Empty }

/// <summary>The decision, separated from the clipboard so every case can be tested without one.</summary>
internal static class ClipboardFilter
{
    public static DropReason Decide(ClipboardInfo info, bool paused, bool ignorePasswords, IReadOnlyCollection<string> excludedApps)
    {
        if (paused) return DropReason.Paused;
        if (ignorePasswords && (info.ExcludeFromMonitorProcessing || info.ViewerIgnore || info.CanIncludeInHistory == 0 || info.CanUploadToCloud == 0))
            return DropReason.PasswordManagerFlag;
        if (info.OwnerExe is { Length: > 0 } exe && excludedApps.Any(a => string.Equals(a, exe, StringComparison.OrdinalIgnoreCase)))
            return DropReason.ExcludedApp;
        return DropReason.None;
    }
}
