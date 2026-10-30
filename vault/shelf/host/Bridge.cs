using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using VaultShelf.Host.Clipboard;
using VaultShelf.Host.Security;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;
using VaultShelf.Host.Vault;

namespace VaultShelf.Host;

/// <summary>
/// The shell's side of the contract in ../README.md. The page calls window.shelfNative.invoke(command, args); the transport (PageScript) carries it over
/// WebView2 messages and this class answers from the real history and settings. The Vault key is never returned (only whether one is saved); verify, save_connection
/// and dispatch talk to Vault from here, in the shell, so the key never exists in the page.
/// </summary>
internal sealed class Bridge
{
    /// <summary>The script injected into the page before it runs: defines window.shelfNative on top of chrome.webview.postMessage.</summary>
    public const string PageScript = """
        (() => {
          const pending = new Map(); const listeners = new Set(); let n = 0;
          window.chrome.webview.addEventListener('message', (e) => {
            const m = e.data;
            if (m && m.type === 'reply') { const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(m.error)) : p.resolve(m.result); } }
            else if (m && m.type === 'event') { listeners.forEach((l) => l(m.name)); }
          });
          Object.defineProperty(window, 'shelfNative', { value: Object.freeze({
            invoke(command, args) { return new Promise((resolve, reject) => { const id = ++n; pending.set(id, { resolve, reject }); window.chrome.webview.postMessage({ id, command, args: args || {} }); }); },
            on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
          }) });
        })();
        """;

    private static readonly HashSet<string> AsyncCommands = new() { "verify", "save_connection", "dispatch" };

    private readonly ClipStore _store;
    private readonly SettingsStore _settings;
    private readonly CredentialStore _credentials;
    private readonly StartupRegistration _startup;
    private readonly ClipboardMonitor _monitor;
    private readonly VaultClient _vault;
    private readonly Func<string, bool> _applyHotkey;

    /// <summary>The page asked the shell to hide the tray (Esc, or after sending to Vault).</summary>
    public event Action? HideRequested;
    /// <summary>The list changed because of something the page did (delete, clear); the page is told to reload.</summary>
    public event Action? ClipsChanged;

    public Bridge(ClipStore store, SettingsStore settings, CredentialStore credentials, StartupRegistration startup, ClipboardMonitor monitor, VaultClient vault, Func<string, bool> applyHotkey)
    {
        _store = store; _settings = settings; _credentials = credentials; _startup = startup; _monitor = monitor; _vault = vault; _applyHotkey = applyHotkey;
    }

    private static JsonObject Meta(ClipRecord c)
    {
        var o = new JsonObject
        {
            ["id"] = c.Id, ["kind"] = c.Kind.ToString().ToLowerInvariant(), ["createdAt"] = c.CreatedAt, ["sourceApp"] = c.SourceApp, ["sizeBytes"] = c.SizeBytes,
            ["preview"] = c.Preview, ["truncated"] = c.Kind != ClipKind.Image && c.SizeBytes > Encoding.UTF8.GetByteCount(c.Preview), ["masked"] = c.Masked,
        };
        if (c.Kind == ClipKind.Image) { o["width"] = c.Width; o["height"] = c.Height; }
        return o;
    }

    private JsonNode? GetClip(string? id)
    {
        if (id is null || _store.Get(id) is not { } c) return null;
        if (c.Kind == ClipKind.Image)
        {
            var thumb = _store.GetThumbPng(id);
            return thumb is null ? null : new JsonObject { ["id"] = id, ["kind"] = "image", ["mime"] = "image/png", ["dataUrl"] = "data:image/png;base64," + Convert.ToBase64String(thumb), ["width"] = c.Width, ["height"] = c.Height };
        }
        string? text = _store.GetText(id);
        return text is null ? null : new JsonObject { ["id"] = id, ["kind"] = c.Kind.ToString().ToLowerInvariant(), ["text"] = text };
    }

    private JsonObject CurrentSettings() => SettingsStore.ToJson(_settings.Current, hasKey: _credentials.Exists());

    private JsonObject SaveSettings(JsonObject patch)
    {
        var before = _settings.Current;
        var (next, problems) = _settings.Apply(patch);

        if (!string.Equals(next.Hotkey, before.Hotkey, StringComparison.Ordinal) && !_applyHotkey(next.Hotkey))
        {
            // another program already owns that shortcut: keep the one that works
            next.Hotkey = before.Hotkey; _applyHotkey(before.Hotkey); _settings.Save();
            problems.Add("Another program is already using that shortcut. Try a different one.");
        }
        if (next.StartOnBoot != before.StartOnBoot) { try { _startup.Set(next.StartOnBoot); } catch (Exception e) when (e is UnauthorizedAccessException or System.Security.SecurityException) { next.StartOnBoot = before.StartOnBoot; _settings.Save(); problems.Add("Windows would not let this be changed."); } }
        if (next.RetentionItems != before.RetentionItems || next.AutoClearHours != before.AutoClearHours)
        {
            if (_store.Prune(next.RetentionItems, next.AutoClearHours, DateTimeOffset.UtcNow) > 0) ClipsChanged?.Invoke();
        }
        if (problems.Count > 0) throw new InvalidOperationException(problems[0]);
        return CurrentSettings();
    }

    // ---------------------------------------------------------------- the commands that talk to Vault
    private async Task<JsonNode?> VerifyCommand()
    {
        string? key = _credentials.Read();
        if (string.IsNullOrEmpty(key)) return VerifyOutcome.Fail("No key saved yet.").ToJson();
        if (string.IsNullOrEmpty(_settings.Current.BaseUrl)) return VerifyOutcome.Fail("Enter your Vault address in Settings.").ToJson();
        return (await _vault.VerifyAsync(_settings.Current.BaseUrl, key)).ToJson();
    }

    /// <summary>
    /// Check an address and key with Vault, and only if Vault accepts them save the key (to Credential Manager) and the address (to settings). Leaving the key
    /// box empty re-checks the saved key against a new address.
    /// </summary>
    private async Task<JsonNode?> SaveConnectionCommand(JsonObject args)
    {
        var (ok, url) = SettingsRules.NormalizeBaseUrl(args["baseUrl"]?.GetValue<string>() ?? "");
        if (!ok) return VerifyOutcome.Fail(url).ToJson();
        if (url.Length == 0) return VerifyOutcome.Fail("Enter your Vault address.").ToJson();
        string key = (args["key"]?.GetValue<string>() ?? "").Trim();
        bool reuse = key.Length == 0;
        if (reuse) key = _credentials.Read() ?? "";
        if (key.Length == 0) return VerifyOutcome.Fail("Paste your Vault key (Vault, Settings, Vault Shelf).").ToJson();

        var result = await _vault.VerifyAsync(url, key);
        if (result.Ok)
        {
            if (!reuse) _credentials.Write(key);
            _settings.Apply(new JsonObject { ["baseUrl"] = url });
            AppLog.Write($"connected to {url} ({result.Scopes.Length} permissions)");
        }
        else AppLog.Write("connection check failed: " + (reuse ? "saved key" : "new key"));
        return result.ToJson();
    }

    private async Task<JsonNode?> DispatchCommand(JsonObject args)
    {
        if (!ActionIds.TryParse(args["action"]?.GetValue<string>(), out var action)) return DispatchOutcome.Fail("Vault Shelf does not know that action.").ToJson();
        string? id = args["id"]?.GetValue<string>();
        var clip = id is null ? null : _store.Get(id);
        if (clip is null) return DispatchOutcome.Fail("That copy is no longer on the shelf.").ToJson();
        string? key = _credentials.Read();
        var outcome = await _vault.DispatchAsync(_settings.Current.BaseUrl, key ?? "", action, clip, _store);
        AppLog.Write($"send {action}: {(outcome.Ok ? (outcome.Duplicate ? "already there" : "ok") : "not sent")}");   // never what was sent
        return outcome.ToJson();
    }

    /// <summary>Handle one message from the page that needs no waiting. The Vault commands are answered by <see cref="HandleAsync"/>.</summary>
    public string? Handle(string json)
    {
        if (!TryParse(json, out long id, out string command, out var args)) return null;
        try
        {
            JsonNode? result = command switch
            {
                "list_clips" => new JsonArray(_store.List(Math.Max(10, _settings.Current.RetentionItems)).Select(c => (JsonNode)Meta(c)).ToArray()),
                "get_clip" => GetClip(args["id"]?.GetValue<string>()),
                "get_settings" => CurrentSettings(),
                "save_settings" => SaveSettings(args["patch"] as JsonObject ?? new JsonObject()),
                "delete_clip" => Run(() => { if (args["id"]?.GetValue<string>() is { } cid) _store.Delete(cid); ClipsChanged?.Invoke(); }),
                "clear_history" => Run(() => { _store.Clear(); ClipsChanged?.Invoke(); }),
                "copy_clip" => Run(() => { if (args["id"]?.GetValue<string>() is { } cid && _store.Get(cid) is { } c) ClipboardWriter.CopyBack(_store, c, _monitor); }),
                "hide_shelf" => Run(() => HideRequested?.Invoke()),
                _ when AsyncCommands.Contains(command) => throw new InvalidOperationException("That command needs HandleAsync."),
                _ => throw new InvalidOperationException($"Unknown command: {command}"),
            };
            return Reply(id, result);
        }
        catch (Exception e) { return Error(id, e.Message); }
    }

    /// <summary>Handle any message, waiting for Vault where needed.</summary>
    public async Task<string?> HandleAsync(string json)
    {
        if (!TryParse(json, out long id, out string command, out var args)) return null;
        if (!AsyncCommands.Contains(command)) return Handle(json);
        try
        {
            JsonNode? result = command switch
            {
                "verify" => await VerifyCommand(),
                "save_connection" => await SaveConnectionCommand(args),
                _ => await DispatchCommand(args),
            };
            return Reply(id, result);
        }
        catch (Exception e)
        {
            AppLog.Write($"{command} failed: {e.GetType().Name}");     // the type only; the message could quote something
            return Error(id, "Something went wrong talking to Vault. Try again.");
        }
    }

    private static bool TryParse(string json, out long id, out string command, out JsonObject args)
    {
        id = 0; command = ""; args = new JsonObject();
        JsonNode? msg;
        try { msg = JsonNode.Parse(json); } catch (JsonException) { return false; }
        if (msg is not JsonObject obj || obj["id"] is not JsonValue idNode || obj["command"] is not JsonValue cmdNode) return false;
        try { id = idNode.GetValue<long>(); command = cmdNode.GetValue<string>(); } catch (Exception e) when (e is InvalidOperationException or FormatException) { return false; }
        args = obj["args"] as JsonObject ?? new JsonObject();
        return true;
    }

    private static string Reply(long id, JsonNode? result) => new JsonObject { ["type"] = "reply", ["id"] = id, ["result"] = result }.ToJsonString();
    private static string Error(long id, string message) => new JsonObject { ["type"] = "reply", ["id"] = id, ["error"] = message }.ToJsonString();
    private static JsonNode? Run(Action a) { a(); return null; }

    public static string EventMessage(string name) => new JsonObject { ["type"] = "event", ["name"] = name }.ToJsonString();
}
