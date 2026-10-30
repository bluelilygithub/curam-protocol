namespace VaultShelf.Host;

/// <summary>
/// A small log (vaultshelf.log beside the history) so that "nothing happened" can always be answered. It records what happened (started, shortcut registered or refused,
/// a failure and its type), never anything that was copied: a clip's content must not appear here. Trimmed when it grows past 256 KB.
/// </summary>
internal static class AppLog
{
    private const long MaxBytes = 256 * 1024;
    private static readonly object Gate = new();
    private static string? _file;

    public static string? Path => _file;

    public static void Init(string root)
    {
        try { Directory.CreateDirectory(root); _file = System.IO.Path.Combine(root, "vaultshelf.log"); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { _file = null; }
    }

    public static void Write(string message)
    {
        if (_file is null) return;
        lock (Gate)
        {
            try
            {
                var info = new FileInfo(_file);
                if (info.Exists && info.Length > MaxBytes)
                {
                    var keep = File.ReadAllLines(_file).TakeLast(500);
                    File.WriteAllLines(_file, keep);
                }
                File.AppendAllText(_file, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss}  {message}{Environment.NewLine}");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException) { /* logging must never be the thing that breaks the app */ }
        }
    }
}
