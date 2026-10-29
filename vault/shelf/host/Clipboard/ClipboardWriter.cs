using System.Drawing;
using System.Runtime.InteropServices;
using VaultShelf.Host.Storage;

namespace VaultShelf.Host.Clipboard;

/// <summary>Puts a stored clip back on the clipboard ("Copy" and Enter in the shelf). The monitor is told to ignore it, so it is not captured a second time.</summary>
internal static class ClipboardWriter
{
    public static bool CopyBack(ClipStore store, ClipRecord clip, ClipboardMonitor monitor)
    {
        try
        {
            var data = new System.Windows.Forms.DataObject();
            if (clip.Kind == ClipKind.Image)
            {
                var original = store.GetOriginalPng(clip.Id) ?? store.GetThumbPng(clip.Id);
                if (original is null) return false;
                using var ms = new MemoryStream(original);
                using var img = new Bitmap(ms);
                data.SetData("PNG", false, new MemoryStream(original));   // keeps transparency for programs that read PNG
                data.SetImage(new Bitmap(img));                           // and the ordinary bitmap for the rest
            }
            else
            {
                string? text = store.GetText(clip.Id);
                if (text is null) return false;   // note: a masked clip puts back the MASKED text; the real secret was never stored
                data.SetText(text, System.Windows.Forms.TextDataFormat.UnicodeText);
            }
            System.Windows.Forms.Clipboard.SetDataObject(data, copy: true, retryTimes: 5, retryDelay: 20);
            monitor.IgnoreCurrentContent();
            return true;
        }
        catch (Exception e) when (e is ExternalException or ArgumentException or InvalidOperationException or System.Security.Cryptography.CryptographicException) { return false; }
    }
}
