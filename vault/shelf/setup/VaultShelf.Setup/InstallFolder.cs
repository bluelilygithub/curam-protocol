namespace VaultShelf.Setup;

internal static class InstallFolder
{
    public const string ProgramFile = "VaultShelf.exe";

    public static string DefaultDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "VaultShelf");

    /// <summary>
    /// Why this folder must not be installed into, or null when it is fine. It must be a real, absolute folder that is not a drive root, and it must either be
    /// empty/new or already hold an earlier install of this program. An update clears the old files first, so a wrong choice must never be able to wipe
    /// someone's documents.
    /// </summary>
    public static string? Problem(string dir)
    {
        if (string.IsNullOrWhiteSpace(dir) || !Path.IsPathFullyQualified(dir)) return "Choose a full folder path, for example C:\\Tools\\VaultShelf.";
        string full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(dir));
        if (string.Equals(full, Path.TrimEndingDirectorySeparator(Path.GetPathRoot(full) ?? ""), StringComparison.OrdinalIgnoreCase)) return "Choose a folder, not a whole drive.";
        if (Directory.Exists(full) && !File.Exists(Path.Combine(full, ProgramFile)) && Directory.EnumerateFileSystemEntries(full).Any())
            return "That folder already holds other files. Choose an empty or new folder, so nothing of yours is touched.";
        return null;
    }
}
