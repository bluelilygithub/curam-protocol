using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.ExceptionServices;
using System.Text;
using VaultShelf.Host.Clipboard;
using VaultShelf.Host.Imaging;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;
using Xunit;

namespace VaultShelf.Host.Tests;

// These tests use the REAL Windows clipboard, so they replace whatever you have copied while they run, and they must not run side by side.
[CollectionDefinition("Clipboard", DisableParallelization = true)]
public class ClipboardCollection { }

internal static class Sta
{
    /// <summary>Run on a single-threaded-apartment thread (the clipboard and the monitor's window need one).</summary>
    public static void Run(Action action)
    {
        Exception? error = null;
        var t = new Thread(() => { try { action(); } catch (Exception e) { error = e; } });
        t.SetApartmentState(ApartmentState.STA);
        t.Start(); t.Join();
        if (error is not null) ExceptionDispatchInfo.Capture(error).Throw();
    }
}

internal sealed class Harness : IDisposable
{
    public TempRoot Root { get; } = new();
    public ClipStore Store { get; }
    public AppSettings Settings { get; } = new();
    public ClipboardMonitor Monitor { get; }

    public Harness()
    {
        Store = new ClipStore(Root.Path);
        Monitor = new ClipboardMonitor(Store, () => Settings);
    }

    public CaptureOutcome Capture(string? owner = "chrome.exe") => Monitor.ProcessNow(owner);

    /// <summary>Put these formats on the clipboard in one go, the way an app does.</summary>
    public static void Set(Action<DataObject> fill)
    {
        var d = new DataObject();
        fill(d);
        for (int attempt = 0; ; attempt++)
        {
            try { System.Windows.Forms.Clipboard.SetDataObject(d, copy: true, retryTimes: 10, retryDelay: 50); return; }
            catch (System.Runtime.InteropServices.ExternalException) when (attempt < 5) { Thread.Sleep(100); }
        }
    }
    public static void SetText(string text) => Set(d => d.SetText(text));
    public static void Flag(DataObject d, string format, int value) => d.SetData(format, false, new MemoryStream(BitConverter.GetBytes(value)));
    public static void Marker(DataObject d, string format) => d.SetData(format, false, new MemoryStream(new byte[] { 1, 0, 0, 0 }));

    public void Dispose() { Monitor.Dispose(); Store.Dispose(); Root.Dispose(); }
}

[Collection("Clipboard")]
public class ClipboardMonitorTests
{
    private static string A(int n) => new('a', n);
    private static string Mixed(int n) => string.Concat(Enumerable.Range(0, n).Select(i => "aB3dE5gH7jK9mN1pQ"[i % 17]));

    [Fact]
    public void Ordinary_text_is_captured_with_where_it_came_from()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            Harness.SetText("Call Dana back about the quote");
            var o = h.Capture("outlook.exe");
            Assert.True(o.Captured, o.Reason);
            Assert.Equal(ClipKind.Text, o.Kind); Assert.False(o.Masked);
            var c = Assert.Single(h.Store.List());
            Assert.Equal("outlook.exe", c.SourceApp); Assert.Equal("Call Dana back about the quote", h.Store.GetText(c.Id));
        });
    }

    [Fact]
    public void A_secret_is_masked_before_it_is_stored_and_the_real_one_is_nowhere_on_disk()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            string token = "ghp" + "_" + Mixed(36);
            Harness.SetText("git remote set-url origin https://x:" + token + "@github.com/a/b.git");
            var o = h.Capture();
            Assert.True(o.Captured); Assert.True(o.Masked); Assert.Contains("GitHub token", o.SecretKinds!);
            var c = Assert.Single(h.Store.List());
            Assert.True(c.Masked);
            string stored = h.Store.GetText(c.Id)!;
            Assert.DoesNotContain(token, stored); Assert.Contains(SecretScanner_Mask, stored);
            h.Store.Dispose();
            foreach (var f in Directory.EnumerateFiles(h.Root.Path, "*", SearchOption.AllDirectories))
            {
                var bytes = File.ReadAllBytes(f);
                Assert.DoesNotContain(token, Encoding.UTF8.GetString(bytes)); Assert.DoesNotContain(token, Encoding.Unicode.GetString(bytes));
            }
        });
    }
    private const string SecretScanner_Mask = VaultShelf.Host.Masking.SecretScanner.Mask;

    [Theory]
    [InlineData("ExcludeClipboardContentFromMonitorProcessing")]
    [InlineData("Clipboard Viewer Ignore")]
    public void A_password_manager_marker_means_nothing_is_kept(string marker)
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            Harness.Set(d => { d.SetText("hunter2-super-secret-password"); Harness.Marker(d, marker); });
            var o = h.Capture("keepassxc.exe");
            Assert.False(o.Captured); Assert.Equal("PasswordManagerFlag", o.Reason);
            Assert.Equal(0, h.Store.Count());
        });
    }

    [Theory]
    [InlineData("CanIncludeInClipboardHistory", 0, false)]
    [InlineData("CanIncludeInClipboardHistory", 1, true)]
    [InlineData("CanUploadToCloudClipboard", 0, false)]
    [InlineData("CanUploadToCloudClipboard", 1, true)]
    public void The_history_and_cloud_flags_are_honoured(string flag, int value, bool kept)
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            Harness.Set(d => { d.SetText("some text " + flag + value); Harness.Flag(d, flag, value); });
            Assert.Equal(kept, h.Capture().Captured);
            Assert.Equal(kept ? 1 : 0, h.Store.Count());
        });
    }

    [Fact]
    public void With_ignore_passwords_switched_off_a_marked_clip_is_kept_but_still_masked()
    {
        Sta.Run(() =>
        {
            using var h = new Harness { Settings = { IgnorePasswords = false } };
            string token = "sk-" + "ant-api03-" + Mixed(40);
            Harness.Set(d => { d.SetText("key " + token); Harness.Marker(d, "ExcludeClipboardContentFromMonitorProcessing"); });
            var o = h.Capture();
            Assert.True(o.Captured); Assert.True(o.Masked);
            Assert.DoesNotContain(token, h.Store.GetText(h.Store.List()[0].Id)!);
        });
    }

    [Fact]
    public void Paused_keeps_nothing_and_resuming_keeps_again()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            h.Monitor.Paused = true;
            Harness.SetText("while paused");
            Assert.Equal("Paused", h.Capture().Reason); Assert.Equal(0, h.Store.Count());
            h.Monitor.Paused = false;
            Assert.True(h.Capture().Captured);
        });
    }

    [Fact]
    public void An_excluded_program_is_never_kept()
    {
        Sta.Run(() =>
        {
            using var h = new Harness { Settings = { ExcludedApps = { "keepass.exe" } } };
            Harness.SetText("from a program on the exclusion list");
            Assert.Equal("ExcludedApp", h.Capture("keepass.exe").Reason);
            Assert.Equal(0, h.Store.Count());
            Assert.True(h.Capture("chrome.exe").Captured);   // the same content from another program is fine
        });
    }

    [Fact]
    public void The_same_thing_copied_twice_in_a_row_is_kept_once_but_later_repeats_are_kept_again()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            Harness.SetText("alpha"); Assert.True(h.Capture().Captured);
            Assert.Equal("Duplicate", h.Capture().Reason);
            Harness.SetText("beta"); Assert.True(h.Capture().Captured);
            Harness.SetText("alpha"); Assert.True(h.Capture().Captured);
            Assert.Equal(3, h.Store.Count());
        });
    }

    [Fact]
    public void A_web_page_copy_with_only_HTML_keeps_the_copied_fragment()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            const string pre = "<html><body><!--StartFragment-->", post = "<!--EndFragment--></body></html>", frag = "<p>Quarterly <b>summary</b></p>";
            string header = "Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:{0:D10}\r\nEndFragment:{1:D10}\r\n";
            int hl = string.Format(header, 0, 0).Length;
            string full = string.Format(header, hl + pre.Length, hl + pre.Length + frag.Length) + pre + frag + post;
            Harness.Set(d => d.SetData("HTML Format", false, new MemoryStream(Encoding.UTF8.GetBytes(full + "\0"))));
            var o = h.Capture();
            Assert.True(o.Captured, o.Reason); Assert.Equal(ClipKind.Html, o.Kind);
            Assert.Equal(frag, h.Store.GetText(h.Store.List()[0].Id));
        });
    }

    [Fact]
    public void Text_that_is_an_SVG_drawing_is_kept_as_one()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            Harness.SetText("<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\"><rect width=\"5\" height=\"5\"/></svg>");
            Assert.Equal(ClipKind.Svg, h.Capture().Kind);
        });
    }

    [Fact]
    public void A_copied_picture_is_kept_with_its_original_and_a_300_pixel_preview()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            using var bmp = new Bitmap(900, 600);
            using (var g = Graphics.FromImage(bmp)) { g.Clear(Color.SeaGreen); g.FillEllipse(Brushes.White, 100, 100, 300, 300); }
            Harness.Set(d => d.SetImage(bmp));
            var o = h.Capture("snippingtool.exe");
            Assert.True(o.Captured, o.Reason); Assert.Equal(ClipKind.Image, o.Kind);
            var c = Assert.Single(h.Store.List());
            Assert.Equal((900, 600), (c.Width, c.Height)); Assert.True(c.HasOriginal);
            Assert.Equal(300, ImageEncoder.Size(h.Store.GetThumbPng(c.Id)!).w);
            Assert.NotNull(h.Store.GetOriginalPng(c.Id));
        });
    }

    [Fact]
    public void A_PNG_on_the_clipboard_is_kept_byte_for_byte_so_transparency_survives()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            using var bmp = new Bitmap(40, 30, PixelFormat.Format32bppArgb);
            for (int x = 0; x < 40; x++) for (int y = 0; y < 30; y++) bmp.SetPixel(x, y, Color.FromArgb(128, 10, 20, 30));
            byte[] png = ImageEncoder.ToPng(bmp);
            Harness.Set(d => d.SetData("PNG", false, new MemoryStream(png)));
            var o = h.Capture();
            Assert.True(o.Captured, o.Reason);
            Assert.Equal(png, h.Store.GetOriginalPng(h.Store.List()[0].Id));
        });
    }

    [Fact]
    public void Text_wins_when_an_app_puts_both_text_and_a_picture_on_the_clipboard()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            using var bmp = new Bitmap(20, 20);
            Harness.Set(d => { d.SetText("Name\tQty\nBolt\t4"); d.SetImage(bmp); });   // what a spreadsheet does
            Assert.Equal(ClipKind.Text, h.Capture().Kind);
        });
    }

    [Fact]
    public void Copied_files_empty_text_and_an_empty_clipboard_are_not_kept()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            string file = Path.Combine(h.Root.Path, "a.txt"); File.WriteAllText(file, "x");
            Harness.Set(d => d.SetFileDropList(new System.Collections.Specialized.StringCollection { file }));
            Assert.Equal("FilesNotSupported", h.Capture().Reason);
            Harness.SetText("   \r\n  ");
            Assert.Equal("Empty", h.Capture().Reason);
            System.Windows.Forms.Clipboard.Clear();
            Assert.False(h.Capture().Captured);
            Assert.Equal(0, h.Store.Count());
        });
    }

    [Fact]
    public void A_huge_copy_is_cut_to_the_store_limit_and_flagged()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            Harness.SetText(new string('x', ClipStore.MaxStoredChars + 50_000));
            var o = h.Capture();
            Assert.True(o.Captured, o.Reason);
            var c = h.Store.List()[0];
            Assert.True(c.Truncated);
            Assert.Equal(ClipStore.MaxStoredChars, h.Store.GetText(c.Id)!.Length);
        });
    }

    [Fact]
    public void Unicode_and_line_endings_survive()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            const string text = "café — 日本語 🙂\r\nsecond line\ttabbed";
            Harness.SetText(text);
            h.Capture();
            Assert.Equal(text, h.Store.GetText(h.Store.List()[0].Id));
        });
    }

    [Fact]
    public void Only_the_chosen_number_of_clips_is_kept_as_new_ones_arrive()
    {
        Sta.Run(() =>
        {
            using var h = new Harness { Settings = { RetentionItems = 10 } };
            for (int i = 0; i < 14; i++) { Harness.SetText("clip number " + i); Assert.True(h.Capture().Captured); }
            Assert.Equal(10, h.Store.Count());
            Assert.Equal("clip number 13", h.Store.List()[0].Preview);
        });
    }

    [Fact]
    public void Copying_back_from_the_shelf_puts_the_text_on_the_clipboard_and_a_masked_clip_stays_masked()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            string idPlain = h.Store.Add(new NewClip(ClipKind.Text, "put me back", null, null, "a.exe", false, false, 0, 0, 11));
            Assert.True(ClipboardWriter.CopyBack(h.Store, h.Store.Get(idPlain)!, h.Monitor));
            Assert.Equal("put me back", System.Windows.Forms.Clipboard.GetText());
            string idMasked = h.Store.Add(new NewClip(ClipKind.Text, "Bearer ••••••••", null, null, "a.exe", true, false, 0, 0, 20));
            Assert.True(ClipboardWriter.CopyBack(h.Store, h.Store.Get(idMasked)!, h.Monitor));
            Assert.Equal("Bearer ••••••••", System.Windows.Forms.Clipboard.GetText());
        });
    }

    [Fact]
    public void Copying_a_picture_back_gives_both_PNG_and_a_bitmap()
    {
        Sta.Run(() =>
        {
            using var h = new Harness();
            using var bmp = new Bitmap(64, 48);
            byte[] png = ImageEncoder.ToPng(bmp);
            string id = h.Store.Add(new NewClip(ClipKind.Image, null, png, png, "a.exe", false, false, 64, 48, png.Length));
            Assert.True(ClipboardWriter.CopyBack(h.Store, h.Store.Get(id)!, h.Monitor));
            Assert.True(System.Windows.Forms.Clipboard.ContainsImage());
            Assert.True(System.Windows.Forms.Clipboard.GetDataObject()!.GetDataPresent("PNG"));
        });
    }

    [Fact]
    public void The_program_that_copied_is_found_while_it_is_still_running()
    {
        Sta.Run(() =>
        {
            var ps = Process.Start(new ProcessStartInfo("powershell.exe", "-NoProfile -WindowStyle Hidden -Command \"Set-Clipboard -Value 'from powershell'; Start-Sleep -Seconds 6\"") { CreateNoWindow = true, UseShellExecute = false })!;
            try
            {
                string? owner = null;
                for (int i = 0; i < 60 && owner is null; i++) { Thread.Sleep(100); if (System.Windows.Forms.Clipboard.GetText() == "from powershell") owner = ClipboardNative.OwnerExe(); }
                Assert.Equal("powershell.exe", owner);
            }
            finally { try { ps.Kill(true); } catch (InvalidOperationException) { /* already finished */ } }
        });
    }
}
