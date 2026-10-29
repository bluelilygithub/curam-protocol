using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace VaultShelf.Host.Imaging;

/// <summary>Turns a copied picture into the two things the shelf keeps: the original as PNG (for sending to Vault) and a small preview (at most 300px wide).</summary>
internal static class ImageEncoder
{
    public const int ThumbMaxWidth = 300;
    public const int MaxOriginalBytes = 10 * 1024 * 1024;

    public sealed record Encoded(byte[]? OriginalPng, byte[] ThumbPng, int Width, int Height, long OriginalSize, bool TooLarge);

    public static byte[] ToPng(Image image)
    {
        using var ms = new MemoryStream();
        image.Save(ms, ImageFormat.Png);
        return ms.ToArray();
    }

    /// <summary>
    /// From PNG bytes (kept exactly as the source app made them, so transparency survives). An original over 10 MB is not kept (only its preview), and
    /// <see cref="Encoded.TooLarge"/> says so.
    /// </summary>
    public static Encoded FromPng(byte[] png)
    {
        using var ms = new MemoryStream(png);
        using var image = Image.FromStream(ms, useEmbeddedColorManagement: false, validateImageData: true);
        return Build(image, png);
    }

    /// <summary>
    /// From a bitmap taken from the clipboard's DIB format. Screenshots often leave the alpha channel at zero, which would make the picture invisible, so it is
    /// flattened onto white first.
    /// </summary>
    public static Encoded FromDib(Bitmap bitmap)
    {
        using var flat = new Bitmap(bitmap.Width, bitmap.Height, PixelFormat.Format24bppRgb);
        flat.SetResolution(bitmap.HorizontalResolution, bitmap.VerticalResolution);
        using (var g = Graphics.FromImage(flat)) { g.Clear(Color.White); g.DrawImageUnscaled(bitmap, 0, 0); }
        return Build(flat, ToPng(flat));
    }

    private static Encoded Build(Image image, byte[] png)
    {
        int w = image.Width, h = image.Height;
        byte[] thumb = Thumbnail(image);
        bool tooLarge = png.Length > MaxOriginalBytes;
        return new Encoded(tooLarge ? null : png, thumb, w, h, png.Length, tooLarge);
    }

    public static byte[] Thumbnail(Image image)
    {
        if (image.Width <= ThumbMaxWidth) return ToPng(image);
        int tw = ThumbMaxWidth, th = Math.Max(1, (int)Math.Round(image.Height * (double)ThumbMaxWidth / image.Width));
        using var t = new Bitmap(tw, th, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(t))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.CompositingQuality = CompositingQuality.HighQuality;
            g.DrawImage(image, 0, 0, tw, th);
        }
        return ToPng(t);
    }

    public static (int w, int h) Size(byte[] png)
    {
        using var ms = new MemoryStream(png);
        using var image = Image.FromStream(ms, false, false);
        return (image.Width, image.Height);
    }
}
