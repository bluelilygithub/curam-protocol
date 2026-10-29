using System.Text.Json;
using System.Text.Json.Nodes;
using VaultShelf.Host.Clipboard;

namespace VaultShelf.Host.Settings;

internal sealed class AppSettings
{
    public string Hotkey { get; set; } = "Ctrl+Shift+Space";
    /// <summary>Vault's own theme id and font name (client/src/themes.js). The page knows the full tables; the shell only keeps what it was told, after a plain-characters check.</summary>
    public string Theme { get; set; } = "warm-sand";
    public string Font { get; set; } = "DM Sans";
    public bool StartOnBoot { get; set; }
    public bool AutoDismiss { get; set; } = true;
    public string BaseUrl { get; set; } = "";
    public bool IgnorePasswords { get; set; } = true;
    public int RetentionItems { get; set; } = 100;
    public int AutoClearHours { get; set; }
    public List<string> ExcludedApps { get; set; } = new();
    public Dictionary<string, bool> Actions { get; set; } = new() { ["finance"] = true, ["notes"] = true, ["redact"] = true, ["crm"] = true };
}

/// <summary>The rules for each setting, the same ones the page applies (src/lib/settings.ts and hotkey.ts), because the shell must not trust the page.</summary>
internal static class SettingsRules
{
    public const int RetentionMin = 10, RetentionMax = 200;
    public static readonly int[] AutoClearChoices = { 0, 1, 4, 8, 24, 72, 168 };
    private static readonly string[] Reserved =
    {
        "Ctrl+C", "Ctrl+V", "Ctrl+X", "Ctrl+Z", "Ctrl+Y", "Ctrl+A", "Ctrl+S", "Ctrl+W", "Ctrl+Q", "Alt+F4", "Alt+Tab", "Ctrl+Alt+Delete", "Ctrl+Shift+Esc",
        "Win+L", "Win+D", "Win+E", "Win+R", "Win+V", "Win+Space",
    };

    /// <summary>A theme id is lower-case words joined by hyphens (warm-sand, dark-slate). Which ids exist is Vault's table, which the page holds; an unknown one just shows the default.</summary>
    public static bool IsThemeId(string s) => System.Text.RegularExpressions.Regex.IsMatch(s, @"^[a-z][a-z0-9-]{0,31}$");
    public static bool IsFontName(string s) => System.Text.RegularExpressions.Regex.IsMatch(s, @"^[A-Za-z][A-Za-z0-9 ]{0,39}$");

    public static int ClampRetention(int n) => Math.Min(RetentionMax, Math.Max(RetentionMin, n));

    /// <summary>null when the shortcut can be used, otherwise a sentence saying why not.</summary>
    public static string? HotkeyProblem(string hotkey)
    {
        var parts = hotkey.Split('+');
        if (parts.Length == 0 || parts.Any(p => p.Length == 0)) return "That shortcut is not valid.";
        var mods = parts[..^1];
        if (mods.Any(m => m is not ("Ctrl" or "Alt" or "Shift" or "Win")) || mods.Distinct().Count() != mods.Length) return "That shortcut is not valid.";
        if (!HotkeyParser.TryParse(hotkey, out _, out _)) return mods.Length == 0 ? "Hold Ctrl, Alt or Win as well, or the shortcut would fire while you type." : "That shortcut is not valid.";
        if (mods.Length == 0 && !(parts[0].Length is 2 or 3 && parts[0][0] == 'F')) return "Hold Ctrl, Alt or Win as well, or the shortcut would fire while you type.";
        if (mods.Length == 1 && mods[0] == "Shift") return "Hold Ctrl, Alt or Win as well, or the shortcut would fire while you type.";
        if (Reserved.Any(r => string.Equals(r, hotkey, StringComparison.OrdinalIgnoreCase))) return "Windows or most apps already use that one. Try another.";
        return null;
    }

    /// <summary>Only the origin of an https address is kept (http only for a server on this PC); no login in it, no path.</summary>
    public static (bool ok, string value) NormalizeBaseUrl(string raw)
    {
        string text = raw.Trim();
        if (text.Length == 0) return (true, "");   // "no address yet" is allowed: that is the starting state
        string withScheme = System.Text.RegularExpressions.Regex.IsMatch(text, @"^[a-z][a-z0-9+.\-]*://", System.Text.RegularExpressions.RegexOptions.IgnoreCase) ? text : "https://" + text;
        if (!Uri.TryCreate(withScheme, UriKind.Absolute, out var u)) return (false, "That does not look like a web address.");
        if (!string.IsNullOrEmpty(u.UserInfo)) return (false, "Leave the name and password out of the address.");
        bool local = u.Host is "localhost" or "127.0.0.1" or "[::1]" or "::1";
        if (u.Scheme == Uri.UriSchemeHttp && !local) return (false, "The address must start with https:// so the key cannot be read on the way.");
        if (u.Scheme != Uri.UriSchemeHttps && !(u.Scheme == Uri.UriSchemeHttp && local)) return (false, "The address must start with https://.");
        if (!u.Host.Contains('.') && !local) return (false, "That does not look like a full web address.");
        return (true, u.GetLeftPart(UriPartial.Authority));
    }

    /// <summary>"KeePass" -> "keepass.exe"; null when it is not a plain program file name.</summary>
    public static string? NormalizeApp(string raw)
    {
        string t = raw.Trim().ToLowerInvariant();
        string withExt = t.EndsWith(".exe", StringComparison.Ordinal) ? t : t + ".exe";
        return System.Text.RegularExpressions.Regex.IsMatch(withExt, @"^[a-z0-9][a-z0-9 _.()+\-]{0,63}\.exe$") && !withExt.Contains("..") ? withExt : null;
    }
}

/// <summary>
/// The person's settings, in settings.json beside the history. The Vault KEY is never in here (it is in Windows Credential Manager); the address is not a secret.
/// A damaged or missing file means defaults, never a crash.
/// </summary>
internal sealed class SettingsStore
{
    private readonly string _file;
    public AppSettings Current { get; private set; }

    public SettingsStore(string root)
    {
        Directory.CreateDirectory(root);
        _file = Path.Combine(root, "settings.json");
        Current = Load();
    }

    private AppSettings Load()
    {
        try
        {
            if (File.Exists(_file) && JsonNode.Parse(File.ReadAllText(_file)) is JsonObject o) return FromJson(o, new AppSettings(), out _);
        }
        catch (Exception e) when (e is IOException or JsonException or UnauthorizedAccessException) { /* damaged: start again with defaults */ }
        return new AppSettings();
    }

    public void Save()
    {
        string tmp = _file + ".tmp";
        File.WriteAllText(tmp, ToJson(Current).ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, _file, overwrite: true);   // never leave a half-written file
    }

    /// <summary>The settings as JSON. <paramref name="hasKey"/> is only given for the page (whether a key is saved); it is a fact about Credential Manager, never written to the file.</summary>
    public static JsonObject ToJson(AppSettings s, bool? hasKey = null)
    {
        var o = new JsonObject
        {
        ["hotkey"] = s.Hotkey, ["theme"] = s.Theme, ["font"] = s.Font, ["startOnBoot"] = s.StartOnBoot, ["autoDismiss"] = s.AutoDismiss, ["baseUrl"] = s.BaseUrl,
        ["ignorePasswords"] = s.IgnorePasswords, ["retentionItems"] = s.RetentionItems, ["autoClearHours"] = s.AutoClearHours,
        ["excludedApps"] = new JsonArray(s.ExcludedApps.Select(a => (JsonNode)JsonValue.Create(a)!).ToArray()),
        ["actions"] = new JsonObject(s.Actions.Select(kv => new KeyValuePair<string, JsonNode?>(kv.Key, JsonValue.Create(kv.Value)))),
        };
        if (hasKey is bool k) o["hasKey"] = k;
        return o;
    }

    /// <summary>
    /// Apply the fields present in <paramref name="patch"/> on top of <paramref name="start"/>. Unknown fields are ignored; a field with the wrong type or an
    /// unacceptable value leaves the old value and adds a sentence to <paramref name="problems"/>.
    /// </summary>
    public static AppSettings FromJson(JsonObject patch, AppSettings start, out List<string> problems)
    {
        problems = new List<string>();
        var s = new AppSettings
        {
            Hotkey = start.Hotkey, Theme = start.Theme, Font = start.Font, StartOnBoot = start.StartOnBoot, AutoDismiss = start.AutoDismiss, BaseUrl = start.BaseUrl, IgnorePasswords = start.IgnorePasswords,
            RetentionItems = start.RetentionItems, AutoClearHours = start.AutoClearHours, ExcludedApps = new List<string>(start.ExcludedApps), Actions = new Dictionary<string, bool>(start.Actions),
        };
        bool? Bool(string k) => patch[k] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : null;
        int? Int(string k) => patch[k] is JsonValue v && v.TryGetValue<int>(out var n) ? n : null;
        string? Str(string k) => patch[k] is JsonValue v && v.TryGetValue<string>(out var t) ? t : null;

        if (Str("hotkey") is { } hk) { var p = SettingsRules.HotkeyProblem(hk); if (p is null) s.Hotkey = hk; else problems.Add(p); }
        if (Str("theme") is { } th) { if (SettingsRules.IsThemeId(th)) s.Theme = th; else problems.Add("That theme name is not valid."); }
        if (Str("font") is { } fo) { if (SettingsRules.IsFontName(fo)) s.Font = fo; else problems.Add("That font name is not valid."); }
        if (Bool("startOnBoot") is { } sb) s.StartOnBoot = sb;
        if (Bool("autoDismiss") is { } ad) s.AutoDismiss = ad;
        if (Bool("ignorePasswords") is { } ip) s.IgnorePasswords = ip;
        if (Int("retentionItems") is { } ri) s.RetentionItems = SettingsRules.ClampRetention(ri);
        if (Int("autoClearHours") is { } ac) { if (SettingsRules.AutoClearChoices.Contains(ac)) s.AutoClearHours = ac; else problems.Add("That clean-up time is not one of the choices."); }
        if (Str("baseUrl") is { } bu) { var (ok, v) = SettingsRules.NormalizeBaseUrl(bu); if (ok) s.BaseUrl = v; else problems.Add(v); }
        if (patch["excludedApps"] is JsonArray apps)
        {
            var list = new List<string>();
            foreach (var n in apps)
            {
                string? a = n is JsonValue v && v.TryGetValue<string>(out var t) ? SettingsRules.NormalizeApp(t) : null;
                if (a is null) { problems.Add("A program name was not a plain file name like keepass.exe."); continue; }
                if (!list.Contains(a)) list.Add(a);
            }
            s.ExcludedApps = list.Take(200).ToList();
        }
        if (patch["actions"] is JsonObject acts)
            foreach (var key in new[] { "finance", "notes", "redact", "crm" })
                if (acts[key] is JsonValue v && v.TryGetValue<bool>(out var on)) s.Actions[key] = on;
        return s;
    }

    /// <summary>Apply a patch from the page and save. Returns the new settings and any problems with what was asked.</summary>
    public (AppSettings settings, List<string> problems) Apply(JsonObject patch)
    {
        var next = FromJson(patch, Current, out var problems);
        Current = next;
        Save();
        return (next, problems);
    }
}
