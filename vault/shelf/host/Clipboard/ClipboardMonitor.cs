using System.Drawing;
using System.Runtime;
using System.Security.Cryptography;
using System.Text;
using VaultShelf.Host.Imaging;
using VaultShelf.Host.Masking;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;
using static VaultShelf.Host.Clipboard.ClipboardNative;

namespace VaultShelf.Host.Clipboard;

/// <summary>What happened to one clipboard change. Never carries the content (it is logged and shown in tests).</summary>
internal sealed record CaptureOutcome(bool Captured, string Reason, string? ClipId = null, ClipKind? Kind = null, bool Masked = false, IReadOnlyList<string>? SecretKinds = null, string? Owner = null);

/// <summary>
/// Watches the clipboard (AddClipboardFormatListener) and keeps what is copied, in this order of care:
///  1. password-manager markers ("do not keep"), paused state and the excluded-programs list are checked BEFORE any content is read;
///  2. text is scanned for secrets and they are replaced BEFORE anything is stored;
///  3. only then is it encrypted and written. Pictures keep their original (up to 10 MB) and a small preview.
/// A message-only window; nothing is drawn.
/// </summary>
internal sealed class ClipboardMonitor : NativeWindow, IDisposable
{
    private readonly ClipStore _store;
    private readonly Func<AppSettings> _settings;
    private readonly System.Windows.Forms.Timer _debounce = new() { Interval = 40 };
    private uint _ignoreSeq, _lastSeq;
    private string? _lastHash, _pendingOwner;
    private int _retries;
    private bool _listening;

    public bool Paused { get; set; }
    public event Action<CaptureOutcome>? Processed;

    public ClipboardMonitor(ClipStore store, Func<AppSettings> settings)
    {
        _store = store; _settings = settings;
        CreateHandle(new CreateParams { Parent = new IntPtr(-3) });   // HWND_MESSAGE
        _listening = AddClipboardFormatListener(Handle);
        _debounce.Tick += (_, _) => { _debounce.Stop(); Run(); };
    }

    public bool Listening => _listening;

    /// <summary>Call right after the shell itself puts something on the clipboard (copy back from the shelf), so it is not captured again.</summary>
    public void IgnoreCurrentContent() => _ignoreSeq = GetClipboardSequenceNumber();

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_CLIPBOARDUPDATE)
        {
            uint seq = GetClipboardSequenceNumber();
            if (seq != _lastSeq && seq != _ignoreSeq)
            {
                _lastSeq = seq;
                _pendingOwner = OwnerExe();          // who copied: only valid right now, before the next copy
                _retries = 0;
                _debounce.Stop(); _debounce.Start(); // many apps put several formats on in a row: wait for them to finish
            }
        }
        base.WndProc(ref m);
    }

    private void Run()
    {
        var outcome = ProcessNow(_pendingOwner);
        if (outcome.Reason == "busy" && _retries++ < 3) { _debounce.Interval = 150; _debounce.Start(); return; }
        _debounce.Interval = 40;
        Processed?.Invoke(outcome);
    }

    /// <summary>Read the clipboard now and keep it if it should be kept. Public so the self-test can drive it directly.</summary>
    public CaptureOutcome ProcessNow(string? owner)
    {
        try { return Capture(owner); }
        catch (Exception e) when (e is System.Runtime.InteropServices.ExternalException or InvalidOperationException or IOException or CryptographicException or ArgumentException or Microsoft.Data.Sqlite.SqliteException)
        {
            return new CaptureOutcome(false, "error: " + e.GetType().Name, Owner: owner);   // the type only: a message could quote the content
        }
    }

    private CaptureOutcome Capture(string? owner)
    {
        var settings = _settings();
        string? text = null; byte[]? html = null, png = null, svg = null; bool hasDib = false, hasFiles = false;
        bool exclude, viewerIgnore; int? canInclude, canUpload;
        var names = new List<string>();

        if (!OpenWithRetry(Handle)) return new CaptureOutcome(false, "busy", Owner: owner);
        try
        {
            for (uint f = EnumClipboardFormats(0); f != 0; f = EnumClipboardFormats(f))
            {
                if (f < 0xC000) continue;
                var sb = new StringBuilder(128);
                if (GetClipboardFormatName(f, sb, sb.Capacity) > 0) names.Add(sb.ToString());
            }
            exclude = IsClipboardFormatAvailable(FmtExcludeMonitor);
            viewerIgnore = IsClipboardFormatAvailable(FmtViewerIgnore);
            canInclude = ReadDword(FmtCanInclude);
            canUpload = ReadDword(FmtCanUpload);

            // 1. decide from the markers alone: nothing of the content is touched for a clip that must not be kept
            var info = new ClipboardInfo(names, exclude, viewerIgnore, canInclude, canUpload, owner);
            var drop = ClipboardFilter.Decide(info, Paused, settings.IgnorePasswords, settings.ExcludedApps);
            if (drop != DropReason.None) return new CaptureOutcome(false, drop.ToString(), Owner: owner);

            text = ReadUnicodeText();
            if (string.IsNullOrEmpty(text)) { html = ReadBytes(FmtHtml, 16L * 1024 * 1024); }
            svg = ReadBytes(FmtSvg, 8L * 1024 * 1024);
            if (string.IsNullOrEmpty(text) && html is null) png = ReadBytes(FmtPng, 64L * 1024 * 1024);
            hasDib = IsClipboardFormatAvailable(CF_DIB) || IsClipboardFormatAvailable(CF_DIBV5);
            hasFiles = IsClipboardFormatAvailable(CF_HDROP);
        }
        finally { CloseClipboard(); }

        NewClip? clip;
        string kindForHash;
        if (!string.IsNullOrEmpty(text) || svg is not null || html is not null)
        {
            ClipKind kind; string body;
            if (svg is not null && svg.Length > 0) { kind = ClipKind.Svg; body = Encoding.UTF8.GetString(svg).TrimEnd('\0'); }
            else if (!string.IsNullOrEmpty(text)) { body = text!; kind = body.TrimStart().StartsWith("<svg", StringComparison.OrdinalIgnoreCase) ? ClipKind.Svg : ClipKind.Text; }
            else { body = CfHtml.Extract(html!) ?? ""; kind = ClipKind.Html; }
            if (string.IsNullOrWhiteSpace(body)) return new CaptureOutcome(false, "Empty", Owner: owner);

            bool truncated = body.Length > ClipStore.MaxStoredChars;
            if (truncated) body = body[..ClipStore.MaxStoredChars];
            var scan = SecretScanner.Scan(body);          // 2. secrets are replaced before anything is stored
            clip = new NewClip(kind, scan.Text, null, null, owner, scan.Masked, truncated, 0, 0, Encoding.UTF8.GetByteCount(scan.Text));
            kindForHash = kind + ":" + scan.Text;
            if (Same(kindForHash)) return new CaptureOutcome(false, "Duplicate", Owner: owner);
            return Store(clip, kindForHash, scan.Kinds, owner, settings);
        }

        if (png is not null || hasDib)
        {
            ImageEncoder.Encoded enc;
            if (png is not null) enc = ImageEncoder.FromPng(png);
            else
            {
                using var bmp = System.Windows.Forms.Clipboard.GetImage() as Bitmap;
                if (bmp is null) return new CaptureOutcome(false, "Unreadable", Owner: owner);
                enc = ImageEncoder.FromDib(bmp);
            }
            kindForHash = "image:" + Convert.ToHexString(SHA256.HashData(enc.ThumbPng)) + ":" + enc.OriginalSize;
            clip = new NewClip(ClipKind.Image, null, enc.OriginalPng, enc.ThumbPng, owner, false, enc.TooLarge, enc.Width, enc.Height, enc.OriginalSize);
            var outcome = Same(kindForHash) ? new CaptureOutcome(false, "Duplicate", Owner: owner) : Store(clip, kindForHash, Array.Empty<string>(), owner, settings);
            // a big picture was in memory several times over: give it back now
            GCSettings.LargeObjectHeapCompactionMode = GCLargeObjectHeapCompactionMode.CompactOnce;
            GC.Collect();
            return outcome;
        }
        return new CaptureOutcome(false, hasFiles ? "FilesNotSupported" : "NothingReadable", Owner: owner);
    }

    private bool Same(string key) => _lastHash == Hash(key);
    private static string Hash(string s) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(s)));

    private CaptureOutcome Store(NewClip clip, string key, IReadOnlyList<string> secretKinds, string? owner, AppSettings settings)
    {
        string id = _store.Add(clip);
        _lastHash = Hash(key);
        _store.Prune(settings.RetentionItems, settings.AutoClearHours, DateTimeOffset.UtcNow);
        return new CaptureOutcome(true, "Captured", id, clip.Kind, clip.Masked, secretKinds, owner);
    }

    public void Dispose()
    {
        _debounce.Dispose();
        if (Handle != IntPtr.Zero) { if (_listening) RemoveClipboardFormatListener(Handle); DestroyHandle(); }
    }
}
