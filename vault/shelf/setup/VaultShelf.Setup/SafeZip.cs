using System.IO.Compression;

namespace VaultShelf.Setup;

/// <summary>Unpacks the program's files from the installer without ever writing outside the chosen folder.</summary>
internal static class SafeZip
{
    public const long DefaultMaxBytes = 1L << 30;   // 1 GB: far more than the program, far less than a disk-filling bomb

    /// <summary>Where an entry would be written, or null when its name is not a plain relative path inside <paramref name="destDir"/>.</summary>
    public static string? TargetFor(string destDir, string entryName)
    {
        if (string.IsNullOrEmpty(entryName) || entryName.Contains('\0') || entryName.Contains(':')) return null;
        string name = entryName.Replace('\\', '/');
        if (name.StartsWith('/') || name.Split('/').Any(p => p == "..")) return null;
        string root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(destDir)) + Path.DirectorySeparatorChar;
        string full = Path.GetFullPath(Path.Combine(root, name));
        return full.StartsWith(root, StringComparison.OrdinalIgnoreCase) ? full : null;
    }

    /// <summary>Extract every file. Throws <see cref="InvalidDataException"/> for a name that escapes the folder or an archive that is too big; nothing is written for the rejected entry.</summary>
    public static int Extract(Stream zip, string destDir, long maxBytes = DefaultMaxBytes)
    {
        using var archive = new ZipArchive(zip, ZipArchiveMode.Read, leaveOpen: true);
        long total = 0;
        foreach (var e in archive.Entries) { total += e.Length; if (total > maxBytes) throw new InvalidDataException("The installer is larger than expected."); }
        int files = 0;
        foreach (var e in archive.Entries)
        {
            string? target = TargetFor(destDir, e.FullName);
            if (target is null) throw new InvalidDataException("The installer contains an unsafe file name.");
            if (e.FullName.EndsWith('/') || e.FullName.EndsWith('\\')) { Directory.CreateDirectory(target); continue; }
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            e.ExtractToFile(target, overwrite: true);
            files++;
        }
        return files;
    }
}
