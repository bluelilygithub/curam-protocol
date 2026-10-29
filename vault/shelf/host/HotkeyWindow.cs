using static VaultShelf.Host.NativeMethods;

namespace VaultShelf.Host;

/// <summary>An invisible window whose only job is to receive the global hotkey message. It is not a Form: nothing is drawn and no web view exists.</summary>
internal sealed class HotkeyWindow : NativeWindow, IDisposable
{
    private const int Id = 0x5E1F;
    public event Action? Pressed;

    public HotkeyWindow() => CreateHandle(new CreateParams { Parent = new IntPtr(-3) }); // HWND_MESSAGE: a message-only window

    /// <summary>"Ctrl+Shift+Space" and friends. False when the text is not a valid shortcut or another program already owns it.</summary>
    public bool Register(string hotkey)
    {
        UnregisterHotKey(Handle, Id);
        return HotkeyParser.TryParse(hotkey, out uint mods, out uint vk) && RegisterHotKey(Handle, Id, mods | MOD_NOREPEAT, vk);
    }

    protected override void WndProc(ref Message m)
    {
        if (m.Msg == WM_HOTKEY && (int)m.WParam == Id) Pressed?.Invoke();
        base.WndProc(ref m);
    }

    public void Dispose()
    {
        if (Handle != IntPtr.Zero) { UnregisterHotKey(Handle, Id); DestroyHandle(); }
    }
}

internal static class HotkeyParser
{
    private static readonly Dictionary<string, uint> Named = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Space"] = 0x20, ["Enter"] = 0x0D, ["Tab"] = 0x09, ["Esc"] = 0x1B, ["Backspace"] = 0x08, ["Delete"] = 0x2E, ["Insert"] = 0x2D,
        ["Home"] = 0x24, ["End"] = 0x23, ["PageUp"] = 0x21, ["PageDown"] = 0x22, ["Up"] = 0x26, ["Down"] = 0x28, ["Left"] = 0x25, ["Right"] = 0x27,
    };

    /// <summary>The same combinations the page's recorder produces: Ctrl, Alt, Shift, Win in any order, then one key (A-Z, 0-9, F1-F24 or a name).</summary>
    public static bool TryParse(string text, out uint modifiers, out uint vk)
    {
        modifiers = 0; vk = 0;
        var parts = text.Split('+', StringSplitOptions.TrimEntries);
        if (parts.Length < 1 || parts.Any(p => p.Length == 0)) return false;
        for (int i = 0; i < parts.Length - 1; i++)
        {
            uint bit = parts[i].ToLowerInvariant() switch { "ctrl" => MOD_CONTROL, "alt" => MOD_ALT, "shift" => MOD_SHIFT, "win" => MOD_WIN, _ => 0 };
            if (bit == 0 || (modifiers & bit) != 0) return false;
            modifiers |= bit;
        }
        string key = parts[^1];
        if (Named.TryGetValue(key, out vk)) return modifiers != 0;
        if (key.Length == 1 && char.IsAsciiLetterOrDigit(key[0])) { vk = char.ToUpperInvariant(key[0]); return modifiers != 0; }
        if (key.Length is 2 or 3 && (key[0] is 'F' or 'f') && int.TryParse(key.AsSpan(1), out int f) && f is >= 1 and <= 24) { vk = (uint)(0x6F + f); return true; }
        return false;
    }
}
