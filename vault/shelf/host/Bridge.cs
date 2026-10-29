using System.Text.Json;
using System.Text.Json.Nodes;

namespace VaultShelf.Host;

/// <summary>
/// The shell's side of the contract in ../README.md. The page calls window.shelfNative.invoke(command, args); the transport (below) carries it over
/// WebView2 messages, and this class answers. At this stage the answers are placeholders (a hundred sample clips), so the window lifecycle, the
/// transport and the memory can be measured honestly; the clipboard store (M2) and Vault dispatch (M4) replace them.
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

    /// <summary>The page asked the shell to hide the tray (Esc, or after sending to Vault).</summary>
    public event Action? HideRequested;

    private readonly List<JsonObject> _clips = BuildSampleClips(100);

    private static List<JsonObject> BuildSampleClips(int count)
    {
        var list = new List<JsonObject>();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        for (int i = 0; i < count; i++)
        {
            string text = (i % 4) switch
            {
                0 => $"Reminder {i + 1}: send the revised drawing package for job {1000 + i}.",
                1 => $"https://example.com/jobs/{1000 + i}/files",
                2 => $"Ref,Qty\nR-{i},{i % 9 + 1}\nR-{i + 1},{(i + 3) % 9 + 1}",
                _ => $"#{(i * 2654435) & 0xffffff:x6}",
            };
            string kind = "text";
            // one SVG and one HTML clip, with script in them, so the built page's policy and sanitiser are exercised inside the real window too
            if (i == 4) { kind = "svg"; text = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 40 40\" width=\"80\" height=\"80\" onload=\"alert(1)\"><script>alert(2)</script><rect width=\"40\" height=\"40\" fill=\"#3b82f6\"/></svg>"; }
            if (i == 5) { kind = "html"; text = "<h2 onclick=\"alert(1)\">Summary</h2><p>Up <b>12%</b>. <a href=\"https://evil.example\">link</a></p><script>alert(2)</script><img src=\"https://evil.example/p.gif\">"; }
            list.Add(new JsonObject
            {
                ["id"] = $"clip-{i + 1:000}", ["kind"] = kind, ["createdAt"] = now - i * 420000L, ["sourceApp"] = "sample.exe",
                ["sizeBytes"] = text.Length, ["preview"] = text, ["truncated"] = false, ["masked"] = false,
            });
        }
        return list;
    }

    private static JsonObject DefaultSettings() => new()
    {
        ["hotkey"] = "Ctrl+Shift+Space", ["startOnBoot"] = false, ["autoDismiss"] = true, ["baseUrl"] = "", ["hasKey"] = false,
        ["ignorePasswords"] = true, ["retentionItems"] = 100, ["autoClearHours"] = 0, ["excludedApps"] = new JsonArray(),
        ["actions"] = new JsonObject { ["finance"] = true, ["notes"] = true, ["redact"] = true, ["crm"] = true },
    };

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
                "list_clips" => new JsonArray(_clips.Select(c => (JsonNode)c.DeepClone()).ToArray()),
                "get_clip" => GetClip(args["id"]?.GetValue<string>()),
                "get_settings" or "save_settings" => DefaultSettings(),
                "verify" => new JsonObject { ["ok"] = false, ["scopes"] = new JsonArray(), ["unavailable"] = new JsonArray(), ["error"] = "No key saved yet." },
                "save_connection" => new JsonObject { ["ok"] = false, ["scopes"] = new JsonArray(), ["unavailable"] = new JsonArray(), ["error"] = "Connecting to Vault is not built yet." },
                "dispatch" => new JsonObject { ["ok"] = false, ["error"] = "Sending to Vault is not built yet." },
                "copy_clip" or "delete_clip" or "clear_history" => null,
                "hide_shelf" => HideAndReturnNull(),
                _ => throw new InvalidOperationException($"Unknown command: {command}"),
            };
            return new JsonObject { ["type"] = "reply", ["id"] = id, ["result"] = result }.ToJsonString();
        }
        catch (Exception e)
        {
            return new JsonObject { ["type"] = "reply", ["id"] = id, ["error"] = e.Message }.ToJsonString();
        }
    }

    private JsonNode? HideAndReturnNull() { HideRequested?.Invoke(); return null; }

    private JsonNode? GetClip(string? id)
    {
        var c = _clips.FirstOrDefault(x => x["id"]?.GetValue<string>() == id);
        return c is null ? null : new JsonObject { ["id"] = id, ["kind"] = c["kind"]!.GetValue<string>(), ["text"] = c["preview"]!.GetValue<string>() };
    }

    public static string EventMessage(string name) => new JsonObject { ["type"] = "event", ["name"] = name }.ToJsonString();
}
