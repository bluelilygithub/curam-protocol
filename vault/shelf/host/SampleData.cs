using VaultShelf.Host.Storage;

namespace VaultShelf.Host;

/// <summary>Sample history for the self-test only (it never runs in the real app): 100 clips, newest first, including one SVG and one HTML clip with script in them.</summary>
internal static class SampleData
{
    public static void Seed(ClipStore store, int count)
    {
        var now = DateTimeOffset.UtcNow;
        for (int i = count - 1; i >= 0; i--)    // oldest first, so the ids and times run in order
        {
            string text = (i % 4) switch
            {
                0 => $"Reminder {i + 1}: send the revised drawing package for job {1000 + i}.",
                1 => $"https://example.com/jobs/{1000 + i}/files",
                2 => $"Ref,Qty\nR-{i},{i % 9 + 1}\nR-{i + 1},{(i + 3) % 9 + 1}",
                _ => $"#{(i * 2654435) & 0xffffff:x6}",
            };
            var kind = ClipKind.Text;
            if (i == 4) { kind = ClipKind.Svg; text = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" width=\"80\" height=\"80\" onload=\"alert(1)\"><script>alert(2)</script><rect width=\"40\" height=\"40\" fill=\"#3b82f6\"/></svg>"; }
            if (i == 5) { kind = ClipKind.Html; text = "<h2 onclick=\"alert(1)\">Summary</h2><p>Up <b>12%</b>. <a href=\"https://evil.example\">link</a></p><script>alert(2)</script><img src=\"https://evil.example/p.gif\">"; }
            store.Add(new NewClip(kind, text, null, null, "sample.exe", false, false, 0, 0, System.Text.Encoding.UTF8.GetByteCount(text)), now.AddMinutes(-7 * i));
        }
    }
}
