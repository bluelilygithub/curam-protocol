using System.Text;

namespace VaultShelf.Host.Clipboard;

/// <summary>Reads the "HTML Format" clipboard format: a text header with byte offsets, then the page. Returns just the copied fragment.</summary>
internal static class CfHtml
{
    public static string? Extract(byte[] data)
    {
        if (data.Length == 0) return null;
        int end = Array.IndexOf(data, (byte)0);            // the format is NUL-terminated
        string all = Encoding.UTF8.GetString(data, 0, end < 0 ? data.Length : end);

        int? start = Offset(all, "StartFragment:"), stop = Offset(all, "EndFragment:");
        if (start is int s && stop is int e && s >= 0 && e > s)
        {
            // offsets count BYTES in the UTF-8 text
            var bytes = Encoding.UTF8.GetBytes(all);
            if (e <= bytes.Length) return Encoding.UTF8.GetString(bytes, s, e - s);
        }
        const string a = "<!--StartFragment-->", b = "<!--EndFragment-->";
        int ia = all.IndexOf(a, StringComparison.Ordinal), ib = all.IndexOf(b, StringComparison.Ordinal);
        if (ia >= 0 && ib > ia) return all.Substring(ia + a.Length, ib - ia - a.Length);
        int body = all.IndexOf("<html", StringComparison.OrdinalIgnoreCase);
        return body >= 0 ? all[body..] : null;
    }

    private static int? Offset(string header, string name)
    {
        int i = header.IndexOf(name, StringComparison.Ordinal);
        if (i < 0) return null;
        int from = i + name.Length, to = from;
        while (to < header.Length && char.IsAsciiDigit(header[to])) to++;
        return int.TryParse(header.AsSpan(from, to - from), out int v) ? v : null;
    }
}
