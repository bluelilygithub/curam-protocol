using static VaultShelf.Host.NativeMethods;

namespace VaultShelf.Host;

/// <summary>
/// Remembers which window had the focus when the tray opened, and gives it back when the tray closes, so the person carries on typing where they were.
/// Windows only lets the foreground process (or one that just received input, such as the handler of a registered hotkey) take the foreground,
/// so each step has a plain attempt and a fallback, and reports which one worked: the self-test records that.
/// </summary>
internal sealed class FocusKeeper
{
    public IntPtr Previous { get; private set; }

    /// <summary>Call as soon as the hotkey fires, before any window of ours is shown.</summary>
    public void Remember() => Previous = GetForegroundWindow();

    /// <summary>Make <paramref name="window"/> the active window. Returns true when it is the foreground window afterwards.</summary>
    public (bool ok, string how) Activate(IntPtr window)
    {
        if (SetForegroundWindow(window) && GetForegroundWindow() == window) return (true, "direct");
        // an Alt key press makes Windows treat our process as having received input, which lifts the foreground lock
        keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
        if (SetForegroundWindow(window) && GetForegroundWindow() == window) return (true, "alt-trick");
        if (AttachAndForeground(window)) return (true, "attach-input");
        return (false, "failed");
    }

    /// <summary>Give the focus back to the window remembered by <see cref="Remember"/>. Never throws; says whether it worked.</summary>
    public (bool ok, string how) RestorePrevious()
    {
        var target = Previous;
        if (target == IntPtr.Zero || !IsWindow(target)) return (false, "previous window is gone");
        if (IsIconic(target)) ShowWindow(target, SW_RESTORE);
        if (SetForegroundWindow(target) && GetForegroundWindow() == target) return (true, "direct");
        keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY, UIntPtr.Zero);
        keybd_event(VK_MENU, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, UIntPtr.Zero);
        if (SetForegroundWindow(target) && GetForegroundWindow() == target) return (true, "alt-trick");
        if (AttachAndForeground(target)) return (true, "attach-input");
        // an app running as administrator cannot be given the focus by an ordinary process (UIPI); nothing more can be done
        return (false, "refused (the previous window may be running as administrator)");
    }

    private static bool AttachAndForeground(IntPtr window)
    {
        var fg = GetForegroundWindow();
        uint fgThread = fg == IntPtr.Zero ? 0 : GetWindowThreadProcessId(fg, out _);
        uint me = GetCurrentThreadId();
        bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
        try { BringWindowToTop(window); SetForegroundWindow(window); }
        finally { if (attached) AttachThreadInput(me, fgThread, false); }
        return GetForegroundWindow() == window;
    }
}
