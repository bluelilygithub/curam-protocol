using System.Drawing;
using System.Drawing.Imaging;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using VaultShelf.Host.Imaging;
using VaultShelf.Host.Security;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;
using Xunit;

namespace VaultShelf.Host.Tests;

public sealed class TempRoot : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "vaultshelf-test-" + Guid.NewGuid().ToString("N"));
    public TempRoot() => Directory.CreateDirectory(Path);
    public void Dispose() { try { Directory.Delete(Path, true); } catch (IOException) { /* a file still open: the OS temp cleaner gets it */ } }
}

public class ClipStoreTests
{
    private static NewClip Text(string text, string app = "chrome.exe", bool masked = false) => new(ClipKind.Text, text, null, null, app, masked, false, 0, 0, Encoding.UTF8.GetByteCount(text));

    private static byte[] Png(int w, int h, Color color)
    {
        using var bmp = new Bitmap(w, h);
        using (var g = Graphics.FromImage(bmp)) g.Clear(color);
        return ImageEncoder.ToPng(bmp);
    }

    private static bool AnyFileContains(string root, string marker)
    {
        var utf8 = Encoding.UTF8.GetBytes(marker); var utf16 = Encoding.Unicode.GetBytes(marker);
        foreach (var f in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            byte[] bytes = File.ReadAllBytes(f);
            if (IndexOf(bytes, utf8) >= 0 || IndexOf(bytes, utf16) >= 0) return true;
        }
        return false;
    }
    private static int IndexOf(byte[] hay, byte[] needle)
    {
        for (int i = 0; i <= hay.Length - needle.Length; i++) { int j = 0; while (j < needle.Length && hay[i + j] == needle[j]) j++; if (j == needle.Length) return i; }
        return -1;
    }

    [Fact]
    public void What_was_copied_is_not_readable_in_any_file_on_disk()
    {
        using var root = new TempRoot();
        const string marker = "ZEBRA-QUARTZ-PLAINTEXT-12345";
        string id;
        using (var store = new ClipStore(root.Path)) { id = store.Add(Text("note: " + marker + " end", "notepad.exe")); }
        Assert.False(AnyFileContains(root.Path, marker), "the copied text is in a file in the clear");
        Assert.False(AnyFileContains(root.Path, "ZEBRA-QUARTZ"), "even part of it");
        using var again = new ClipStore(root.Path);
        Assert.Equal("note: " + marker + " end", again.GetText(id));   // and it still reads back through the store
        Assert.Equal("notepad.exe", again.Get(id)!.SourceApp);        // metadata that is not content stays readable
    }

    [Fact]
    public void A_picture_and_its_preview_are_encrypted_on_disk_and_read_back_intact()
    {
        using var root = new TempRoot();
        var original = Png(640, 480, Color.CornflowerBlue); var thumb = Png(300, 225, Color.CornflowerBlue);
        using var store = new ClipStore(root.Path);
        string id = store.Add(new NewClip(ClipKind.Image, null, original, thumb, "snip.exe", false, false, 640, 480, original.Length));
        foreach (var f in Directory.EnumerateFiles(Path.Combine(root.Path, "blobs")))
        {
            var disk = File.ReadAllBytes(f);
            Assert.NotEqual(0x89, disk[0]);   // not a PNG signature: it is DPAPI ciphertext
            Assert.Equal(-1, IndexOf(disk, Encoding.ASCII.GetBytes("IHDR")));
        }
        Assert.Equal(original, store.GetOriginalPng(id));
        Assert.Equal(thumb, store.GetThumbPng(id));
        var meta = store.Get(id)!;
        Assert.True(meta.HasOriginal); Assert.Equal(640, meta.Width); Assert.Equal("", meta.Preview);
    }

    [Fact]
    public void A_picture_without_an_original_keeps_only_its_preview()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        string id = store.Add(new NewClip(ClipKind.Image, null, null, Png(300, 200, Color.Red), "x.exe", false, true, 4000, 2667, 20_000_000));
        Assert.False(store.Get(id)!.HasOriginal);
        Assert.Null(store.GetOriginalPng(id));
        Assert.NotNull(store.GetThumbPng(id));
    }

    [Fact]
    public void The_list_is_newest_first_with_decrypted_previews_cut_to_400_characters()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var now = DateTimeOffset.UtcNow;
        store.Add(Text("oldest"), now.AddMinutes(-3));
        store.Add(Text(new string('x', 1000)), now.AddMinutes(-1));
        store.Add(Text("newest"), now);
        var list = store.List();
        Assert.Equal(new[] { "newest", new string('x', 400), "oldest" }, list.Select(c => c.Preview));
        Assert.Equal(new string('x', 1000), store.GetText(list[1].Id));   // the full text is still all there
    }

    [Fact]
    public void Ids_are_valid_Vault_clip_ids_and_unique()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var ids = Enumerable.Range(0, 300).Select(i => store.Add(Text("clip " + i))).ToList();
        Assert.Equal(300, ids.Distinct().Count());
        Assert.All(ids, id => Assert.Matches(new Regex("^[A-Za-z0-9_-]{8,64}$"), id));
    }

    [Fact]
    public void Keeping_the_last_N_removes_the_oldest_and_their_picture_files()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var now = DateTimeOffset.UtcNow;
        var oldImage = store.Add(new NewClip(ClipKind.Image, null, Png(50, 50, Color.Gray), Png(50, 50, Color.Gray), "a.exe", false, false, 50, 50, 100), now.AddMinutes(-30));
        for (int i = 0; i < 12; i++) store.Add(Text("clip " + i), now.AddMinutes(-20 + i));
        Assert.Equal(3, store.Prune(10, 0, now));
        Assert.Equal(10, store.Count());
        Assert.DoesNotContain(store.List(), c => c.Id == oldImage);
        Assert.Empty(Directory.GetFiles(Path.Combine(root.Path, "blobs")));
    }

    [Fact]
    public void Auto_clear_removes_what_is_older_than_the_chosen_hours()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var now = DateTimeOffset.UtcNow;
        store.Add(Text("two days old"), now.AddHours(-48)); store.Add(Text("three hours old"), now.AddHours(-3)); store.Add(Text("fresh"), now);
        Assert.Equal(1, store.Prune(100, 24, now));
        Assert.Equal(new[] { "fresh", "three hours old" }, store.List().Select(c => c.Preview));
        Assert.Equal(1, store.Prune(100, 1, now));                      // 1 hour: the three-hour-old one goes too
        Assert.Equal(0, store.Prune(100, 0, now.AddYears(5)));          // 0 = no age limit
        Assert.Single(store.List());
    }

    [Fact]
    public void Deleting_and_clearing_leave_no_trace_of_the_content()
    {
        using var root = new TempRoot();
        const string marker = "SECRETISH-CONTENT-98765";
        using (var store = new ClipStore(root.Path))
        {
            string keep = store.Add(Text("keep me"));
            string gone = store.Add(Text(marker));
            string pic = store.Add(new NewClip(ClipKind.Image, null, Png(40, 40, Color.Green), Png(40, 40, Color.Green), "a.exe", false, false, 40, 40, 99));
            Assert.True(store.Delete(gone)); Assert.False(store.Delete(gone));
            Assert.True(store.Delete(pic));
            Assert.Empty(Directory.GetFiles(Path.Combine(root.Path, "blobs")));
            Assert.Equal(keep, Assert.Single(store.List()).Id);
            store.Clear();
            Assert.Equal(0, store.Count());
        }
        Assert.False(AnyFileContains(root.Path, marker));
    }

    [Fact]
    public void A_picture_file_with_no_row_is_swept_away_at_start()
    {
        using var root = new TempRoot();
        using (var s = new ClipStore(root.Path)) s.Add(Text("x"));
        File.WriteAllBytes(Path.Combine(root.Path, "blobs", "orphan.orig"), new byte[] { 1, 2, 3 });
        using var again = new ClipStore(root.Path);
        Assert.Empty(Directory.GetFiles(Path.Combine(root.Path, "blobs")));
    }

    [Fact]
    public void A_clip_that_cannot_be_decrypted_does_not_break_the_list()
    {
        // for example: history copied from another Windows account. It shows with an empty preview instead of crashing.
        using var root = new TempRoot();
        using (var s = new ClipStore(root.Path)) s.Add(Text("hello"));
        using var db = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={Path.Combine(root.Path, "history.db")};Pooling=False");
        db.Open();
        using (var cmd = db.CreateCommand()) { cmd.CommandText = "UPDATE clips SET preview = x'0102030405'"; cmd.ExecuteNonQuery(); }
        db.Close();
        using var again = new ClipStore(root.Path);
        Assert.Equal("", Assert.Single(again.List()).Preview);
    }

    [Fact]
    public void Masked_and_truncated_flags_and_sizes_are_kept()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        string id = store.Add(new NewClip(ClipKind.Text, "token ••••••••", null, null, "postman.exe", true, true, 0, 0, 12345));
        var c = store.Get(id)!;
        Assert.True(c.Masked); Assert.True(c.Truncated); Assert.Equal(12345, c.SizeBytes); Assert.Equal(ClipKind.Text, c.Kind);
    }

    [Fact]
    public void Html_and_svg_kinds_round_trip()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        string h = store.Add(new NewClip(ClipKind.Html, "<p>x</p>", null, null, "chrome.exe", false, false, 0, 0, 8));
        string s = store.Add(new NewClip(ClipKind.Svg, "<svg/>", null, null, "figma.exe", false, false, 0, 0, 6));
        Assert.Equal(ClipKind.Html, store.Get(h)!.Kind); Assert.Equal("<svg/>", store.GetText(s));
    }
}

public class SettingsStoreTests
{
    [Fact]
    public void A_new_install_has_the_documented_defaults()
    {
        using var root = new TempRoot();
        var s = new SettingsStore(root.Path).Current;
        Assert.Equal("warm-sand", s.Theme); Assert.Equal("DM Sans", s.Font);   // the same defaults as a new Vault
        Assert.Equal("Ctrl+Shift+Space", s.Hotkey); Assert.True(s.AutoDismiss); Assert.True(s.IgnorePasswords); Assert.False(s.StartOnBoot);
        Assert.Equal(100, s.RetentionItems); Assert.Equal(0, s.AutoClearHours); Assert.Empty(s.ExcludedApps); Assert.All(s.Actions.Values, v => Assert.True(v));
    }

    [Fact]
    public void Changes_are_saved_and_survive_a_restart()
    {
        using var root = new TempRoot();
        var store = new SettingsStore(root.Path);
        var (_, problems) = store.Apply(JsonNode.Parse("""{"hotkey":"Ctrl+Alt+K","retentionItems":50,"excludedApps":["KeePass","1password.exe"],"actions":{"finance":false},"baseUrl":"https://v.example.com/x","autoClearHours":24}""")!.AsObject());
        Assert.Empty(problems);
        var back = new SettingsStore(root.Path).Current;
        Assert.Equal("Ctrl+Alt+K", back.Hotkey); Assert.Equal(50, back.RetentionItems); Assert.Equal(24, back.AutoClearHours);
        Assert.Equal(new[] { "keepass.exe", "1password.exe" }, back.ExcludedApps); Assert.False(back.Actions["finance"]); Assert.True(back.Actions["notes"]);
        Assert.Equal("https://v.example.com", back.BaseUrl);
    }

    [Fact]
    public void The_theme_and_font_are_saved_and_odd_names_are_refused()
    {
        using var root = new TempRoot();
        var store = new SettingsStore(root.Path);
        var (ok, problems) = store.Apply(JsonNode.Parse("""{"theme":"dark-slate","font":"JetBrains Mono"}""")!.AsObject());
        Assert.Empty(problems); Assert.Equal("dark-slate", ok.Theme); Assert.Equal("JetBrains Mono", ok.Font);
        var back = new SettingsStore(root.Path).Current;
        Assert.Equal("dark-slate", back.Theme); Assert.Equal("JetBrains Mono", back.Font);
        var (bad, issues) = store.Apply(JsonNode.Parse("""{"theme":"<script>alert(1)</script>","font":"x'; DROP TABLE"}""")!.AsObject());
        Assert.Equal(2, issues.Count);
        Assert.Equal("dark-slate", bad.Theme); Assert.Equal("JetBrains Mono", bad.Font);   // the old values stay
        Assert.Equal(2, store.Apply(JsonNode.Parse("""{"theme":"","font":"1Font"}""")!.AsObject()).problems.Count);
    }

    [Fact]
    public void A_bad_value_is_refused_with_a_reason_and_the_old_value_kept()
    {
        using var root = new TempRoot();
        var store = new SettingsStore(root.Path);
        var (s, problems) = store.Apply(JsonNode.Parse("""{"hotkey":"Ctrl+C","baseUrl":"http://remote.example.com","autoClearHours":5,"excludedApps":["C:\\x.exe"]}""")!.AsObject());
        Assert.Equal(4, problems.Count);
        Assert.Equal("Ctrl+Shift+Space", s.Hotkey); Assert.Equal("", s.BaseUrl); Assert.Equal(0, s.AutoClearHours); Assert.Empty(s.ExcludedApps);
    }

    [Fact]
    public void The_history_size_is_clamped_and_wrong_types_and_unknown_fields_are_ignored()
    {
        using var root = new TempRoot();
        var store = new SettingsStore(root.Path);
        var (s, problems) = store.Apply(JsonNode.Parse("""{"retentionItems":9999,"startOnBoot":"yes","autoDismiss":null,"mystery":123,"hasKey":true,"actions":{"bogus":true}}""")!.AsObject());
        Assert.Empty(problems);
        Assert.Equal(200, s.RetentionItems); Assert.False(s.StartOnBoot); Assert.True(s.AutoDismiss);
        Assert.False(s.Actions.ContainsKey("bogus"));
    }

    [Fact]
    public void Duplicate_programs_are_listed_once()
    {
        using var root = new TempRoot();
        var (s, _) = new SettingsStore(root.Path).Apply(JsonNode.Parse("""{"excludedApps":["keepass","KeePass.exe","keepass.EXE"]}""")!.AsObject());
        Assert.Equal(new[] { "keepass.exe" }, s.ExcludedApps);
    }

    [Fact]
    public void A_damaged_or_empty_file_means_defaults_not_a_crash()
    {
        using var root = new TempRoot();
        foreach (var junk in new[] { "{ not json", "", "[1,2,3]", "null", "\0\0\0" })
        {
            File.WriteAllText(Path.Combine(root.Path, "settings.json"), junk);
            Assert.Equal("Ctrl+Shift+Space", new SettingsStore(root.Path).Current.Hotkey);
        }
    }

    [Fact]
    public void The_saved_file_never_holds_a_key_and_the_page_view_only_says_whether_one_exists()
    {
        using var root = new TempRoot();
        var store = new SettingsStore(root.Path);
        store.Apply(JsonNode.Parse("""{"baseUrl":"https://v.example.com"}""")!.AsObject());
        string file = File.ReadAllText(Path.Combine(root.Path, "settings.json"));
        Assert.DoesNotContain("vsh_", file); Assert.DoesNotContain("hasKey", file);
        Assert.True(SettingsStore.ToJson(store.Current, hasKey: true)["hasKey"]!.GetValue<bool>());
        Assert.False(SettingsStore.ToJson(store.Current, hasKey: false)["hasKey"]!.GetValue<bool>());
        Assert.Null(SettingsStore.ToJson(store.Current)["hasKey"]);   // not given = not written (this is what goes in the file)
        Assert.False(File.Exists(Path.Combine(root.Path, "settings.json.tmp")));
    }
}

public class CredentialStoreTests
{
    [Fact]
    public void A_key_goes_into_Windows_Credential_Manager_and_comes_back_and_can_be_removed()
    {
        var store = new CredentialStore("VaultShelf/test-" + Guid.NewGuid().ToString("N"));
        try
        {
            Assert.False(store.Exists()); Assert.Null(store.Read());
            string key = "vsh_" + string.Concat(Enumerable.Repeat("0123456789abcdef", 4));
            store.Write(key);
            Assert.True(store.Exists()); Assert.Equal(key, store.Read());
            store.Write("vsh_" + new string('b', 64));                     // replaced, not duplicated
            Assert.Equal("vsh_" + new string('b', 64), store.Read());
            store.Delete();
            Assert.False(store.Exists()); Assert.Null(store.Read());
            store.Delete();                                                // deleting nothing is fine
        }
        finally { store.Delete(); }
    }

    [Fact]
    public void Two_targets_do_not_see_each_other()
    {
        var a = new CredentialStore("VaultShelf/test-a-" + Guid.NewGuid().ToString("N")); var b = new CredentialStore("VaultShelf/test-b-" + Guid.NewGuid().ToString("N"));
        try { a.Write("one"); Assert.Null(b.Read()); Assert.Equal("one", a.Read()); } finally { a.Delete(); b.Delete(); }
    }
}

public class StartupRegistrationTests
{
    [Fact]
    public void Start_with_Windows_is_a_value_in_the_current_user_Run_key_and_can_be_turned_off()
    {
        var reg = new StartupRegistration("VaultShelf.Test." + Guid.NewGuid().ToString("N"));
        try
        {
            Assert.False(reg.IsEnabled());
            reg.Set(true, @"C:\Program Files\Vault Shelf\VaultShelf.exe");
            Assert.True(reg.IsEnabled());
            Assert.Equal("\"C:\\Program Files\\Vault Shelf\\VaultShelf.exe\" --background", reg.Command());   // quoted, so a path with spaces works
            reg.Set(false);
            Assert.False(reg.IsEnabled());
            reg.Set(false);                                                                                  // already off: fine
        }
        finally { reg.Set(false); }
    }
}

public class ImageEncoderTests
{
    private static byte[] Png(int w, int h, Color? fill = null, bool noise = false)
    {
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        if (noise)
        {
            var rnd = new Random(1); var bytes = new byte[w * h * 4]; rnd.NextBytes(bytes);
            var data = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
            System.Runtime.InteropServices.Marshal.Copy(bytes, 0, data.Scan0, bytes.Length); bmp.UnlockBits(data);
        }
        else using (var g = Graphics.FromImage(bmp)) g.Clear(fill ?? Color.Orange);
        return ImageEncoder.ToPng(bmp);
    }

    [Fact]
    public void A_wide_picture_gets_a_preview_300_pixels_wide_with_the_same_proportions()
    {
        var e = ImageEncoder.FromPng(Png(1200, 600));
        var (w, h) = ImageEncoder.Size(e.ThumbPng);
        Assert.Equal(300, w); Assert.Equal(150, h);
        Assert.Equal(1200, e.Width); Assert.Equal(600, e.Height); Assert.False(e.TooLarge); Assert.NotNull(e.OriginalPng);
    }

    [Fact]
    public void A_small_picture_is_not_enlarged() => Assert.Equal((120, 80), ImageEncoder.Size(ImageEncoder.FromPng(Png(120, 80)).ThumbPng));

    [Fact]
    public void The_original_png_bytes_are_kept_exactly()
    {
        var png = Png(500, 400, Color.Purple);
        Assert.Equal(png, ImageEncoder.FromPng(png).OriginalPng);
    }

    [Fact]
    public void An_original_over_10_MB_is_not_kept_but_its_preview_is()
    {
        var png = Png(2400, 2400, noise: true);   // random pixels do not compress
        Assert.True(png.Length > ImageEncoder.MaxOriginalBytes, $"test picture is only {png.Length} bytes");
        var e = ImageEncoder.FromPng(png);
        Assert.True(e.TooLarge); Assert.Null(e.OriginalPng); Assert.Equal(png.Length, e.OriginalSize);
        Assert.Equal(300, ImageEncoder.Size(e.ThumbPng).w);
    }

    [Fact]
    public void A_screenshot_with_no_alpha_is_not_turned_invisible()
    {
        // a clipboard bitmap whose alpha channel is all zero must still come out visible (flattened onto white)
        using var bmp = new Bitmap(60, 40, PixelFormat.Format32bppArgb);
        for (int x = 0; x < 60; x++) for (int y = 0; y < 40; y++) bmp.SetPixel(x, y, Color.FromArgb(0, 200, 30, 30));
        var e = ImageEncoder.FromDib(bmp);
        using var ms = new MemoryStream(e.OriginalPng!); using var back = new Bitmap(ms);
        Assert.Equal(255, back.GetPixel(10, 10).A);
    }

    [Fact] public void Garbage_is_refused_not_stored() => Assert.ThrowsAny<Exception>(() => ImageEncoder.FromPng(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }));
}
