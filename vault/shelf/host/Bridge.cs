using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using VaultShelf.Host.Clipboard;
using VaultShelf.Host.Security;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;

namespace VaultShelf.Host;

/// <summary>
/// The shell's side of the contract in ../README.md. The page calls window.shelfNative.invoke(command, args); the transport (PageScript) carries it over
/// WebView2 messages and this class answers from the real history and settings. The Vault key is never returned (only whether one is saved), and sending to
/// Vault (verify, save_connection, dispatch) is the next milestone: those answer that it is not built yet.
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

    private readonly ClipStore _store;
    private readonly SettingsStore _settings;
    private readonly CredentialStore _credentials;
    private readonly StartupRegistration _startup;
    private readonly ClipboardMonitor _monitor;
    private readonly Func<string, bool> _applyHotkey;

    /// <summary>The page asked the shell to hide the tray (Esc, or after sending to Vault).</summary>
    public event Action? HideRequested;
    /// <summary>The list changed because of something the page did (delete, clear); the page is told to reload.</summary>
    public event Action? ClipsChanged;

    public Bridge(ClipStore store, SettingsStore settings, CredentialStore credentials, StartupRegistration startup, ClipboardMonitor monitor, Func<string, bool> applyHotkey)
    {
        _store = store; _settings = settings; _credentials = credentials; _startup = startup; _monitor = monitor; _applyHotkey = applyHotkey;
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

    /// <summary>Handle one message from the page and return the JSON reply to post back, or null when it is not a request.</summary>
    public string? Handle(string json)
    {
        JsonNode? msg;
        try { msg = JsonNode.Parse(json); } catch (JsonException) { return null; }
        if (msg is not JsonObject obj || obj["id"] is not JsonValue idNode || obj["command"] is not JsonValue cmdNode) return null;
        long id = idNode.GetValue<long>();
        string command = cmdNode.GetValue<string>();
        var args = obj["args"] as JsonObject ?? new JsonObject();
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
                "verify" => new JsonObject { ["ok"] = false, ["scopes"] = new JsonArray(), ["unavailable"] = new JsonArray(), ["error"] = _credentials.Exists() ? "Checking the key with Vault is not built yet." : "No key saved yet." },
                "save_connection" => new JsonObject { ["ok"] = false, ["scopes"] = new JsonArray(), ["unavailable"] = new JsonArray(), ["error"] = "Connecting to Vault is not built yet." },
                "dispatch" => new JsonObject { ["ok"] = false, ["error"] = "Sending to Vault is not built yet." },
                _ => throw new InvalidOperationException($"Unknown command: {command}"),
            };
            return new JsonObject { ["type"] = "reply", ["id"] = id, ["result"] = result }.ToJsonString();
        }
        catch (Exception e)
        {
            return new JsonObject { ["type"] = "reply", ["id"] = id, ["error"] = e.Message }.ToJsonString();
        }
    }

    private static JsonNode? Run(Action a) { a(); return null; }

    public static string EventMessage(string name) => new JsonObject { ["type"] = "event", ["name"] = name }.ToJsonString();
}
