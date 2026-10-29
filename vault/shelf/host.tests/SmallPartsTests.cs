using System.Text;
using VaultShelf.Host.Clipboard;
using VaultShelf.Host.Settings;
using Xunit;

namespace VaultShelf.Host.Tests;

public class CfHtmlTests
{
    private static byte[] Make(string html, bool withOffsets = true)
    {
        // the real format: a text header with byte offsets, then the page, ending in NUL
        const string template = "Version:0.9\r\nStartHTML:{0:D10}\r\nEndHTML:{1:D10}\r\nStartFragment:{2:D10}\r\nEndFragment:{3:D10}\r\n";
        string pre = "<html><body><!--StartFragment-->", post = "<!--EndFragment--></body></html>";
        int header = string.Format(template, 0, 0, 0, 0).Length;
        int startHtml = header, startFrag = header + pre.Length;
        int endFrag = startFrag + Encoding.UTF8.GetByteCount(html);
        int endHtml = endFrag + post.Length;
        string text = (withOffsets ? string.Format(template, startHtml, endHtml, startFrag, endFrag) : "Version:0.9\r\n") + pre + html + post;
        return Encoding.UTF8.GetBytes(text + "\0");
    }

    [Fact] public void The_copied_fragment_is_returned_not_the_whole_page() => Assert.Equal("<b>Hello</b> world", CfHtml.Extract(Make("<b>Hello</b> world")));
    [Fact] public void Offsets_count_bytes_so_non_ascii_text_still_lines_up() => Assert.Equal("<p>café — 日本語</p>", CfHtml.Extract(Make("<p>café — 日本語</p>")));
    [Fact] public void Without_usable_offsets_the_fragment_markers_are_used() => Assert.Equal("<i>x</i>", CfHtml.Extract(Make("<i>x</i>", withOffsets: false)));
    [Fact] public void Nonsense_gives_null_not_an_exception() { Assert.Null(CfHtml.Extract(Array.Empty<byte>())); Assert.Null(CfHtml.Extract(Encoding.UTF8.GetBytes("not html at all\0"))); }
    [Fact] public void Offsets_pointing_outside_the_data_do_not_crash() => Assert.NotNull(CfHtml.Extract(Encoding.UTF8.GetBytes("StartFragment:0000009999\r\nEndFragment:0000009999\r\n<html>x</html>\0")));
}

public class ClipboardFilterTests
{
    private static ClipboardInfo Info(bool exclude = false, bool viewer = false, int? include = null, int? upload = null, string? owner = "chrome.exe")
        => new(Array.Empty<string>(), exclude, viewer, include, upload, owner);
    private static readonly string[] None = Array.Empty<string>();

    [Fact] public void An_ordinary_copy_is_kept() => Assert.Equal(DropReason.None, ClipboardFilter.Decide(Info(), false, true, None));
    [Fact] public void Paused_keeps_nothing() => Assert.Equal(DropReason.Paused, ClipboardFilter.Decide(Info(), true, true, None));

    [Theory]
    [InlineData(true, false, null, null)]
    [InlineData(false, true, null, null)]
    [InlineData(false, false, 0, null)]
    [InlineData(false, false, null, 0)]
    public void Each_password_manager_marker_drops_the_clip(bool exclude, bool viewer, int? include, int? upload)
        => Assert.Equal(DropReason.PasswordManagerFlag, ClipboardFilter.Decide(Info(exclude, viewer, include, upload), false, true, None));

    [Fact] public void A_history_flag_that_allows_it_does_not_drop() => Assert.Equal(DropReason.None, ClipboardFilter.Decide(Info(include: 1, upload: 1), false, true, None));
    [Fact] public void With_ignore_passwords_off_the_markers_are_not_honoured() => Assert.Equal(DropReason.None, ClipboardFilter.Decide(Info(exclude: true, viewer: true, include: 0), false, false, None));

    [Fact] public void An_excluded_program_is_dropped_whatever_the_case() => Assert.Equal(DropReason.ExcludedApp, ClipboardFilter.Decide(Info(owner: "keepass.exe"), false, true, new[] { "KeePass.exe" }));
    [Fact] public void A_different_program_is_kept() => Assert.Equal(DropReason.None, ClipboardFilter.Decide(Info(owner: "notepad.exe"), false, true, new[] { "keepass.exe" }));
    [Fact] public void An_unknown_owner_is_kept_unless_a_marker_says_otherwise() => Assert.Equal(DropReason.None, ClipboardFilter.Decide(Info(owner: null), false, true, new[] { "keepass.exe" }));
    [Fact] public void The_exclusion_list_works_even_when_ignore_passwords_is_off() => Assert.Equal(DropReason.ExcludedApp, ClipboardFilter.Decide(Info(owner: "1password.exe"), false, false, new[] { "1password.exe" }));
}

public class SettingsRulesTests
{
    [Theory]
    [InlineData("Ctrl+Shift+Space", null)] [InlineData("F9", null)] [InlineData("Alt+1", null)] [InlineData("Ctrl+Alt+K", null)] [InlineData("Win+Shift+S", null)]
    public void Usable_shortcuts(string hotkey, string? problem) => Assert.Equal(problem, SettingsRules.HotkeyProblem(hotkey));

    [Theory]
    [InlineData("A")] [InlineData("Shift+A")] [InlineData("Ctrl+C")] [InlineData("Ctrl+V")] [InlineData("Alt+F4")] [InlineData("Win+L")] [InlineData("Ctrl+Ctrl+X")]
    [InlineData("Super+X")] [InlineData("")] [InlineData("Ctrl+")] [InlineData("ctrl+v")] [InlineData("Ctrl+Shift+")] [InlineData("Ctrl+;")]
    public void Refused_shortcuts_have_a_reason(string hotkey) => Assert.False(string.IsNullOrEmpty(SettingsRules.HotkeyProblem(hotkey)), hotkey);

    [Theory]
    [InlineData("https://my-app.up.railway.app/settings?x=1#y", "https://my-app.up.railway.app")]
    [InlineData("my-app.up.railway.app", "https://my-app.up.railway.app")]
    [InlineData("  https://x.example.com:8443/  ", "https://x.example.com:8443")]
    [InlineData("http://localhost:3001", "http://localhost:3001")]
    [InlineData("http://127.0.0.1:3001/api", "http://127.0.0.1:3001")]
    [InlineData("", "")]
    public void Addresses_are_kept_as_their_origin(string raw, string expected)
    {
        var (ok, value) = SettingsRules.NormalizeBaseUrl(raw);
        Assert.True(ok); Assert.Equal(expected, value);
    }

    [Theory]
    [InlineData("http://my-app.example.com")] [InlineData("https://user:pw@my-app.example.com")] [InlineData("ftp://x.example.com")] [InlineData("javascript:alert(1)")]
    [InlineData("not a url")] [InlineData("https://nodot")] [InlineData("file:///c:/x")]
    public void Unsafe_or_odd_addresses_are_refused(string raw) => Assert.False(SettingsRules.NormalizeBaseUrl(raw).ok);

    [Theory]
    [InlineData("KeePass.exe", "keepass.exe")] [InlineData(" 1Password ", "1password.exe")] [InlineData("keepass", "keepass.exe")]
    public void Program_names_are_tidied(string raw, string expected) => Assert.Equal(expected, SettingsRules.NormalizeApp(raw));

    [Theory]
    [InlineData("C:\\Program Files\\x.exe")] [InlineData("..\\x.exe")] [InlineData("a/b.exe")] [InlineData("")] [InlineData(".exe")] [InlineData("x..exe")]
    public void Paths_are_not_program_names(string raw) => Assert.Null(SettingsRules.NormalizeApp(raw));

    [Fact] public void History_size_stays_in_range() => Assert.Equal(new[] { 10, 10, 100, 200 }, new[] { SettingsRules.ClampRetention(-5), SettingsRules.ClampRetention(10), SettingsRules.ClampRetention(100), SettingsRules.ClampRetention(9999) });
}

public class HotkeyParserTests
{
    [Theory]
    [InlineData("Ctrl+Shift+Space", 0x2u | 0x4u, 0x20u)]
    [InlineData("Alt+1", 0x1u, (uint)'1')]
    [InlineData("Ctrl+Alt+K", 0x2u | 0x1u, (uint)'K')]
    [InlineData("Win+Shift+S", 0x8u | 0x4u, (uint)'S')]
    [InlineData("F9", 0u, 0x78u)]
    [InlineData("Ctrl+F12", 0x2u, 0x7Bu)]
    public void Shortcuts_become_the_codes_Windows_wants(string text, uint mods, uint vk)
    {
        Assert.True(HotkeyParser.TryParse(text, out uint m, out uint k));
        Assert.Equal(mods, m); Assert.Equal(vk, k);
    }

    [Theory] [InlineData("")] [InlineData("Ctrl")] [InlineData("A")] [InlineData("Ctrl+Ctrl+A")] [InlineData("Hyper+A")] [InlineData("Ctrl+F25")] [InlineData("Ctrl++")]
    public void Nonsense_is_refused(string text) => Assert.False(HotkeyParser.TryParse(text, out _, out _));
}
