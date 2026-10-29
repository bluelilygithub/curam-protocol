using System.Runtime.InteropServices;
using System.Text;

namespace VaultShelf.Host.Clipboard;

/// <summary>Direct clipboard access. Reading with the Win32 calls (not the WinForms wrapper) lets the code see which formats are there, including the "do not keep" markers, without pulling any content.</summary>
internal static class ClipboardNative
{
    public const uint CF_UNICODETEXT = 13, CF_DIB = 8, CF_DIBV5 = 17, CF_HDROP = 15;
    public const int WM_CLIPBOARDUPDATE = 0x031D;

    [DllImport("user32.dll", SetLastError = true)] public static extern bool AddClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool RemoveClipboardFormatListener(IntPtr hwnd);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool OpenClipboard(IntPtr hWndNewOwner);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool CloseClipboard();
    [DllImport("user32.dll")] public static extern uint EnumClipboardFormats(uint format);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClipboardFormatName(uint format, StringBuilder name, int maxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll")] public static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] public static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("kernel32.dll")] public static extern IntPtr GlobalLock(IntPtr hMem);
    [DllImport("kernel32.dll")] public static extern bool GlobalUnlock(IntPtr hMem);
    [DllImport("kernel32.dll")] public static extern UIntPtr GlobalSize(IntPtr hMem);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder exeName, ref int size);

    public static readonly uint FmtHtml = RegisterClipboardFormat("HTML Format");
    public static readonly uint FmtPng = RegisterClipboardFormat("PNG");
    public static readonly uint FmtSvg = RegisterClipboardFormat("image/svg+xml");
    public static readonly uint FmtExcludeMonitor = RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing");
    public static readonly uint FmtViewerIgnore = RegisterClipboardFormat("Clipboard Viewer Ignore");
    public static readonly uint FmtCanInclude = RegisterClipboardFormat("CanIncludeInClipboardHistory");
    public static readonly uint FmtCanUpload = RegisterClipboardFormat("CanUploadToCloudClipboard");

    /// <summary>Another program may be holding the clipboard for a few milliseconds; try a handful of times before giving up.</summary>
    public static bool OpenWithRetry(IntPtr owner, int attempts = 6, int delayMs = 15)
    {
        for (int i = 0; i < attempts; i++)
        {
            if (OpenClipboard(owner)) return true;
            Thread.Sleep(delayMs);
        }
        return false;
    }

    /// <summary>Copy a global-memory format into a byte array (clipboard must be open). Null when the format is absent or empty.</summary>
    public static byte[]? ReadBytes(uint format, long maxBytes = 64L * 1024 * 1024)
    {
        if (format == 0 || !IsClipboardFormatAvailable(format)) return null;
        var h = GetClipboardData(format);
        if (h == IntPtr.Zero) return null;
        long size = (long)GlobalSize(h);
        if (size <= 0 || size > maxBytes) return null;
        var p = GlobalLock(h);
        if (p == IntPtr.Zero) return null;
        try { var b = new byte[size]; Marshal.Copy(p, b, 0, b.Length); return b; }
        finally { GlobalUnlock(h); }
    }

    public static string? ReadUnicodeText(int maxChars = 2_000_000)
    {
        if (!IsClipboardFormatAvailable(CF_UNICODETEXT)) return null;
        var h = GetClipboardData(CF_UNICODETEXT);
        if (h == IntPtr.Zero) return null;
        var p = GlobalLock(h);
        if (p == IntPtr.Zero) return null;
        try
        {
            int bytes = (int)Math.Min((long)GlobalSize(h), (long)maxChars * 2 + 2);
            string s = Marshal.PtrToStringUni(p, bytes / 2);
            int nul = s.IndexOf('\0');
            return nul >= 0 ? s[..nul] : s;
        }
        finally { GlobalUnlock(h); }
    }

    public static int? ReadDword(uint format)
    {
        var b = ReadBytes(format, 16);
        return b is { Length: >= 4 } ? BitConverter.ToInt32(b, 0) : null;
    }

    /// <summary>The program (exe file name, lower case) that last put something on the clipboard, or null.</summary>
    public static string? OwnerExe()
    {
        var hwnd = GetClipboardOwner();
        if (hwnd == IntPtr.Zero) return null;
        VaultShelf.Host.NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
        if (pid == 0) return null;
        var h = VaultShelf.Host.NativeMethods.OpenProcess(VaultShelf.Host.NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, (int)pid);
        if (h == IntPtr.Zero) return null;
        try
        {
            var sb = new StringBuilder(1024);
            int size = sb.Capacity;
            return QueryFullProcessImageName(h, 0, sb, ref size) ? Path.GetFileName(sb.ToString()).ToLowerInvariant() : null;
        }
        finally { VaultShelf.Host.NativeMethods.CloseHandle(h); }
    }
}
