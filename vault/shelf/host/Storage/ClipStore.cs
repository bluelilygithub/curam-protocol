using Microsoft.Data.Sqlite;

namespace VaultShelf.Host.Storage;

internal enum ClipKind { Text, Html, Svg, Image }

/// <summary>What the capture code hands over to be stored. Text is already secret-masked; pictures are already encoded.</summary>
internal sealed record NewClip(ClipKind Kind, string? Text, byte[]? OriginalPng, byte[]? ThumbPng, string? SourceApp, bool Masked, bool Truncated, int Width, int Height, long SizeBytes);

/// <summary>One row for the list: what a card needs. The preview is already decrypted and at most <see cref="ClipStore.PreviewChars"/> long.</summary>
internal sealed record ClipRecord(string Id, ClipKind Kind, long CreatedAt, string? SourceApp, long SizeBytes, string Preview, bool Truncated, bool Masked, int Width, int Height, bool HasOriginal);

/// <summary>
/// The history: a SQLite file (history.db) plus one encrypted file per picture (blobs\). Every piece of content (preview text, full text, the picture and its
/// preview) is encrypted with DPAPI first (<see cref="BlobCrypto"/>); only metadata that is not the content is in the clear: kind, time, size, the program it
/// came from, and the masked/truncated flags. Deleted rows are overwritten (secure_delete) and their picture files removed.
/// </summary>
internal sealed class ClipStore : IDisposable
{
    public const int PreviewChars = 400;
    public const int MaxStoredChars = 500_000;

    private readonly string _blobs;
    private readonly SqliteConnection _db;
    private readonly object _gate = new();

    public ClipStore(string root)
    {
        Directory.CreateDirectory(root);
        _blobs = Path.Combine(root, "blobs");
        Directory.CreateDirectory(_blobs);
        _db = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Path.Combine(root, "history.db"), Pooling = false }.ToString());
        _db.Open();
        Exec("PRAGMA secure_delete = ON");
        Exec("""
            CREATE TABLE IF NOT EXISTS clips (
              id          TEXT PRIMARY KEY,
              kind        TEXT NOT NULL,
              createdAt   INTEGER NOT NULL,
              sourceApp   TEXT,
              sizeBytes   INTEGER NOT NULL,
              masked      INTEGER NOT NULL,
              truncated   INTEGER NOT NULL,
              width       INTEGER NOT NULL,
              height      INTEGER NOT NULL,
              hasOriginal INTEGER NOT NULL,
              preview     BLOB NOT NULL,
              body        BLOB
            )
            """);
        Exec("CREATE INDEX IF NOT EXISTS idx_clips_created ON clips(createdAt DESC)");
        SweepOrphans();
    }

    private void Exec(string sql, params (string, object?)[] args)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args) cmd.Parameters.AddWithValue(n, v ?? DBNull.Value);
        cmd.ExecuteNonQuery();
    }

    private string File(string id, string ext) => Path.Combine(_blobs, id + ext);
    private static string KindText(ClipKind k) => k.ToString().ToLowerInvariant();
    private static ClipKind ParseKind(string s) => Enum.TryParse<ClipKind>(s, true, out var k) ? k : ClipKind.Text;

    /// <summary>A sortable, unique id that is also a valid Vault clip id (letters, digits, - and _; 8 to 64 characters).</summary>
    private static string NewId() => $"c{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds():x12}-{Random.Shared.Next():x8}";

    public string Add(NewClip clip, DateTimeOffset? at = null)
    {
        lock (_gate)
        {
            string id = NewId();
            long created = (at ?? DateTimeOffset.UtcNow).ToUnixTimeMilliseconds();
            string text = clip.Text ?? "";
            string preview = clip.Kind == ClipKind.Image ? "" : (text.Length > PreviewChars ? text[..PreviewChars] : text);
            byte[]? body = clip.Kind == ClipKind.Image ? null : BlobCrypto.ProtectText(text);
            bool hasOriginal = clip.Kind == ClipKind.Image && clip.OriginalPng is not null;
            try
            {
                if (clip.Kind == ClipKind.Image)
                {
                    if (clip.ThumbPng is null) throw new ArgumentException("a picture needs a preview");
                    System.IO.File.WriteAllBytes(File(id, ".thumb"), BlobCrypto.Protect(clip.ThumbPng));
                    if (hasOriginal) System.IO.File.WriteAllBytes(File(id, ".orig"), BlobCrypto.Protect(clip.OriginalPng!));
                }
                Exec("""
                    INSERT INTO clips (id, kind, createdAt, sourceApp, sizeBytes, masked, truncated, width, height, hasOriginal, preview, body)
                    VALUES ($id, $kind, $at, $app, $size, $masked, $trunc, $w, $h, $orig, $preview, $body)
                    """,
                    ("$id", id), ("$kind", KindText(clip.Kind)), ("$at", created), ("$app", clip.SourceApp), ("$size", clip.SizeBytes),
                    ("$masked", clip.Masked ? 1 : 0), ("$trunc", clip.Truncated ? 1 : 0), ("$w", clip.Width), ("$h", clip.Height),
                    ("$orig", hasOriginal ? 1 : 0), ("$preview", BlobCrypto.ProtectText(preview)), ("$body", body));
            }
            catch
            {
                DeleteFiles(id);   // a half-written picture must not be left behind
                throw;
            }
            return id;
        }
    }

    public List<ClipRecord> List(int max = 200)
    {
        lock (_gate)
        {
            var list = new List<ClipRecord>();
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "SELECT id, kind, createdAt, sourceApp, sizeBytes, masked, truncated, width, height, hasOriginal, preview FROM clips ORDER BY createdAt DESC, id DESC LIMIT $max";
            cmd.Parameters.AddWithValue("$max", max);
            using var r = cmd.ExecuteReader();
            while (r.Read())
            {
                string preview;
                try { preview = BlobCrypto.UnprotectText((byte[])r["preview"]); } catch (System.Security.Cryptography.CryptographicException) { preview = ""; }
                list.Add(new ClipRecord(r.GetString(0), ParseKind(r.GetString(1)), r.GetInt64(2), r.IsDBNull(3) ? null : r.GetString(3), r.GetInt64(4),
                    preview, r.GetInt32(6) == 1, r.GetInt32(5) == 1, r.GetInt32(7), r.GetInt32(8), r.GetInt32(9) == 1));
            }
            return list;
        }
    }

    /// <summary>The full text of a text, HTML or SVG clip, or null.</summary>
    public string? GetText(string id)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "SELECT body FROM clips WHERE id = $id AND kind <> 'image'";
            cmd.Parameters.AddWithValue("$id", id);
            return cmd.ExecuteScalar() is byte[] b ? BlobCrypto.UnprotectText(b) : null;
        }
    }

    public ClipRecord? Get(string id) => List(10_000).FirstOrDefault(c => c.Id == id);

    public byte[]? GetThumbPng(string id) => ReadBlob(File(id, ".thumb"));
    public byte[]? GetOriginalPng(string id) => ReadBlob(File(id, ".orig"));

    private static byte[]? ReadBlob(string path)
    {
        if (!System.IO.File.Exists(path)) return null;
        try { return BlobCrypto.Unprotect(System.IO.File.ReadAllBytes(path)); } catch (System.Security.Cryptography.CryptographicException) { return null; }
    }

    public int Count()
    {
        lock (_gate) { using var cmd = _db.CreateCommand(); cmd.CommandText = "SELECT COUNT(*) FROM clips"; return Convert.ToInt32(cmd.ExecuteScalar()); }
    }

    public bool Delete(string id)
    {
        lock (_gate)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = "DELETE FROM clips WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            bool removed = cmd.ExecuteNonQuery() > 0;
            DeleteFiles(id);
            return removed;
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            Exec("DELETE FROM clips");
            foreach (var f in Directory.EnumerateFiles(_blobs)) TryDelete(f);
        }
    }

    /// <summary>
    /// Keep at most <paramref name="maxItems"/> clips and none older than <paramref name="autoClearHours"/> hours (0 = no age limit). Oldest go first.
    /// Returns how many were removed.
    /// </summary>
    public int Prune(int maxItems, int autoClearHours, DateTimeOffset now)
    {
        lock (_gate)
        {
            var doomed = new List<string>();
            using (var cmd = _db.CreateCommand())
            {
                cmd.CommandText = "SELECT id, createdAt FROM clips ORDER BY createdAt DESC, id DESC";
                using var r = cmd.ExecuteReader();
                int index = 0;
                long cutoff = autoClearHours > 0 ? now.AddHours(-autoClearHours).ToUnixTimeMilliseconds() : long.MinValue;
                while (r.Read())
                {
                    index++;
                    if (index > maxItems || r.GetInt64(1) < cutoff) doomed.Add(r.GetString(0));
                }
            }
            foreach (var id in doomed) Delete(id);
            return doomed.Count;
        }
    }

    private void DeleteFiles(string id) { TryDelete(File(id, ".thumb")); TryDelete(File(id, ".orig")); }
    private static void TryDelete(string path) { try { System.IO.File.Delete(path); } catch (IOException) { /* in use; the start-up sweep removes it later */ } }

    /// <summary>Remove picture files that have no row (left by a crash between writing the file and the row).</summary>
    private void SweepOrphans()
    {
        var known = new HashSet<string>();
        using (var cmd = _db.CreateCommand())
        {
            cmd.CommandText = "SELECT id FROM clips";
            using var r = cmd.ExecuteReader();
            while (r.Read()) known.Add(r.GetString(0));
        }
        foreach (var f in Directory.EnumerateFiles(_blobs))
            if (!known.Contains(Path.GetFileNameWithoutExtension(f))) TryDelete(f);
    }

    public void Dispose() => _db.Dispose();
}
