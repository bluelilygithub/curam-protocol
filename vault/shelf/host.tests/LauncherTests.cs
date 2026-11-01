using System.Text.Json.Nodes;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Vault;
using Xunit;

namespace VaultShelf.Host.Tests;

public class LauncherSettingsTests
{
    private static AppSettings Apply(string json, out List<string> problems) => SettingsStore.FromJson((JsonObject)JsonNode.Parse(json)!, new AppSettings(), out problems);

    [Fact]
    public void Defaults_are_a_second_shortcut_and_four_tools()
    {
        var s = new AppSettings();
        Assert.Equal("Ctrl+Alt+Space", s.LauncherHotkey);
        Assert.Equal(new[] { "clients", "finance", "shares", "youtube" }, s.LauncherTiles);
        Assert.Equal(4, s.LauncherColumns);
    }

    [Fact]
    public void Columns_are_kept_between_two_and_six()
    {
        Assert.Equal(6, Apply("""{"launcherColumns": 40}""", out _).LauncherColumns);
        Assert.Equal(2, Apply("""{"launcherColumns": 0}""", out _).LauncherColumns);
        Assert.Equal(3, Apply("""{"launcherColumns": 3}""", out _).LauncherColumns);
    }

    [Fact]
    public void Tiles_are_plain_words_without_repeats()
    {
        var s = Apply("""{"launcherTiles": ["notes","notes","clientProjects","habits-mission"]}""", out var problems);
        Assert.Equal(new[] { "notes", "clientProjects", "habits-mission" }, s.LauncherTiles);
        Assert.Empty(problems);
    }

    [Fact]
    public void A_tile_name_that_is_not_a_plain_word_is_refused()
    {
        var s = Apply("""{"launcherTiles": ["notes","../x","a b","http://evil"]}""", out var problems);
        Assert.Equal(new[] { "notes" }, s.LauncherTiles);
        Assert.Equal(3, problems.Count);
    }

    [Fact]
    public void The_launcher_shortcut_cannot_be_the_shelf_shortcut_or_a_bad_one()
    {
        var same = Apply("""{"launcherHotkey": "Ctrl+Shift+Space"}""", out var p1);
        Assert.Equal("Ctrl+Alt+Space", same.LauncherHotkey); Assert.Single(p1);
        var bare = Apply("""{"launcherHotkey": "Space"}""", out var p2);
        Assert.Equal("Ctrl+Alt+Space", bare.LauncherHotkey); Assert.Single(p2);
        var fn = Apply("""{"launcherHotkey": "Ctrl+Fn+Space"}""", out var p3);
        Assert.Equal("Ctrl+Alt+Space", fn.LauncherHotkey); Assert.Single(p3);
        Assert.Equal("Ctrl+Alt+K", Apply("""{"launcherHotkey": "Ctrl+Alt+K"}""", out _).LauncherHotkey);
    }

    [Fact]
    public void The_settings_reach_the_page_and_come_back_the_same()
    {
        var json = SettingsStore.ToJson(new AppSettings { LauncherColumns = 3, LauncherTiles = new() { "notes" } });
        Assert.Equal(3, json["launcherColumns"]!.GetValue<int>());
        Assert.Equal("notes", json["launcherTiles"]![0]!.GetValue<string>());
        Assert.Equal("Ctrl+Alt+Space", json["launcherHotkey"]!.GetValue<string>());
    }
}

public class PageLinkTests
{
    [Theory]
    [InlineData("https://vault.example.com", "/clients", "https://vault.example.com/clients")]
    [InlineData("https://vault.example.com/", "/goals?section=mission", "https://vault.example.com/goals?section=mission")]
    [InlineData("http://localhost:5173", "/tasks?view=matrix", "http://localhost:5173/tasks?view=matrix")]
    public void A_plain_page_path_joins_the_saved_address(string baseUrl, string path, string expected) => Assert.Equal(expected, PageLink.Build(baseUrl, path));

    [Theory]
    [InlineData("//evil.com")]
    [InlineData("/..\\x")]
    [InlineData("/a/../b")]
    [InlineData("https://evil.com")]
    [InlineData("/x y")]
    [InlineData("/x#frag")]
    [InlineData("javascript:alert(1)")]
    [InlineData("")]
    [InlineData("clients")]
    public void Anything_that_could_leave_the_site_is_refused(string path) => Assert.Null(PageLink.Build("https://vault.example.com", path));

    [Fact]
    public void No_saved_address_or_a_non_https_one_gives_nothing()
    {
        Assert.Null(PageLink.Build("", "/clients"));
        Assert.Null(PageLink.Build("http://vault.example.com", "/clients"));
        Assert.Null(PageLink.Build("https://vault.example.com", null));
    }
}
