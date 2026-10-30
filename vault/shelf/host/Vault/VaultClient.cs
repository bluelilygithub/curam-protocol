using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;

namespace VaultShelf.Host.Vault;

internal sealed record VerifyOutcome(bool Ok, string[] Scopes, (string Scope, string Reason)[] Unavailable, string? Account, string? KeyLabel, string? Error)
{
    public static VerifyOutcome Fail(string error) => new(false, Array.Empty<string>(), Array.Empty<(string, string)>(), null, null, error);

    public JsonObject ToJson()
    {
        var o = new JsonObject
        {
            ["ok"] = Ok,
            ["scopes"] = new JsonArray(Scopes.Select(s => (JsonNode)JsonValue.Create(s)!).ToArray()),
            ["unavailable"] = new JsonArray(Unavailable.Select(u => (JsonNode)new JsonObject { ["scope"] = u.Scope, ["reason"] = u.Reason }).ToArray()),
        };
        if (Account is not null) o["account"] = Account;
        if (KeyLabel is not null) o["keyLabel"] = KeyLabel;
        if (Error is not null) o["error"] = Error;
        return o;
    }
}

internal sealed record DispatchOutcome(bool Ok, bool Duplicate = false, string? Error = null, JsonArray? Findings = null, string? Note = null, bool Truncated = false)
{
    public static DispatchOutcome Fail(string error) => new(false, Error: error);

    public JsonObject ToJson()
    {
        var o = new JsonObject { ["ok"] = Ok };
        if (Duplicate) o["duplicate"] = true;
        if (Error is not null) o["error"] = Error;
        if (Findings is not null) o["findings"] = Findings.DeepClone();   // a JSON node can have only one parent: copy, so this can be called any number of times
        if (Note is not null) o["note"] = Note;
        if (Truncated) o["truncated"] = true;
        return o;
    }
}

/// <summary>
/// Talks to the Vault server's ingest-only API (docs/vault-shelf.md). This is the ONLY code that ever holds the key, and it runs in the shell, never in the web page.
/// Rules it keeps: the address must be https (http only for a server on this PC); redirects are never followed (the key would go along); the key is sent only as a
/// Bearer header; nothing copied or secret is logged; failures are explained in plain words, never by quoting the server or the exception.
/// </summary>
internal sealed class VaultClient : IDisposable
{
    public const int MaxTextChars = 200_000;     // the server's limit for one text clip
    private const long MaxResponseBytes = 2 * 1024 * 1024;
    private static readonly Dictionary<ActionId, string> Routes = new()
    {
        [ActionId.Notes] = "/api/quick-ingest/notes", [ActionId.Finance] = "/api/quick-ingest/finance",
        [ActionId.Crm] = "/api/quick-ingest/crm", [ActionId.Redact] = "/api/quick-ingest/redact",
    };

    private readonly HttpClient _http;

    /// <param name="handler">For tests: a stand-in for the network. The real one never follows redirects.</param>
    public VaultClient(HttpMessageHandler? handler = null)
    {
        _http = new HttpClient(handler ?? new SocketsHttpHandler { AllowAutoRedirect = false, UseCookies = false, MaxConnectionsPerServer = 4 }) { Timeout = TimeSpan.FromSeconds(60) };
        _http.DefaultRequestHeaders.UserAgent.ParseAdd("VaultShelf/1.0");
    }

    private static string? Url(string baseUrl, string path)
    {
        var (ok, origin) = SettingsRules.NormalizeBaseUrl(baseUrl);
        return ok && origin.Length > 0 ? origin + path : null;
    }

    // ---------------------------------------------------------------- verify
    public async Task<VerifyOutcome> VerifyAsync(string baseUrl, string key, CancellationToken ct = default)
    {
        string? url = Url(baseUrl, "/api/quick-ingest/verify");
        if (url is null) return VerifyOutcome.Fail("Enter your Vault address (it must start with https://).");
        if (!KeyLooksRight(key)) return VerifyOutcome.Fail("That is not a Vault Shelf key. It starts with vsh_ and is made in Vault, Settings, Vault Shelf.");
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        var (status, body, netError) = await SendAsync(req, key, ct);
        if (netError is not null) return VerifyOutcome.Fail(netError);
        if (status == HttpStatusCode.OK && IsTrue(body?["ok"]))
        {
            var scopes = (body["scopes"] as JsonArray)?.Select(n => Str(n) ?? "").Where(s => s.Length > 0).ToArray() ?? Array.Empty<string>();
            var unavailable = (body["unavailable"] as JsonArray)?.OfType<JsonObject>()
                .Select(o => (Str(o["scope"]) ?? "", Str(o["reason"]) ?? "")).Where(u => u.Item1.Length > 0).ToArray() ?? Array.Empty<(string, string)>();
            return new VerifyOutcome(true, scopes, unavailable, Str(body["account"]), Str(body["keyLabel"]), null);
        }
        return VerifyOutcome.Fail(Explain(status, body));
    }

    /// <summary>True only for a real JSON true. An answer is untrusted: "yes", 1 or a missing field is not a success, and must not throw.</summary>
    private static bool IsTrue(JsonNode? node) => node is JsonValue v && v.TryGetValue<bool>(out var b) && b;

    public static bool KeyLooksRight(string key) => System.Text.RegularExpressions.Regex.IsMatch(key ?? "", "^vsh_[0-9a-f]{64}$");

    // ---------------------------------------------------------------- send one clip
    public async Task<DispatchOutcome> DispatchAsync(string baseUrl, string key, ActionId action, ClipRecord clip, ClipStore store, CancellationToken ct = default)
    {
        // checked here, before any network: these never leave the PC
        if (clip.Masked) return DispatchOutcome.Fail("This copy had a secret in it, so it is never sent anywhere.");
        string? url = Url(baseUrl, Routes[action]);
        if (url is null) return DispatchOutcome.Fail("Add your Vault address and key in Settings first.");
        if (!KeyLooksRight(key)) return DispatchOutcome.Fail("Add your Vault key in Settings first.");

        HttpContent content;
        if (clip.Kind == ClipKind.Image)
        {
            if (action == ActionId.Redact) return DispatchOutcome.Fail("Only text can be checked for sensitive details.");
            var png = store.GetOriginalPng(clip.Id);
            if (png is null) return DispatchOutcome.Fail("This picture was over 10 MB, so only a small preview was kept and it cannot be sent.");
            var form = new MultipartFormDataContent { { new StringContent(clip.Id), "clipId" } };
            if (!string.IsNullOrEmpty(clip.SourceApp)) form.Add(new StringContent(clip.SourceApp), "sourceApp");
            var file = new ByteArrayContent(png);
            file.Headers.ContentType = new MediaTypeHeaderValue("image/png");
            form.Add(file, "file", "clip.png");
            content = form;
        }
        else
        {
            string? text = store.GetText(clip.Id);
            if (string.IsNullOrWhiteSpace(text)) return DispatchOutcome.Fail("That copy is no longer on the shelf.");
            if (text.Length > MaxTextChars) return DispatchOutcome.Fail($"This copy is longer than Vault accepts ({MaxTextChars:N0} characters).");
            var o = new JsonObject { ["text"] = text };
            if (action != ActionId.Redact) { o["clipId"] = clip.Id; if (!string.IsNullOrEmpty(clip.SourceApp)) o["sourceApp"] = clip.SourceApp; }
            content = new StringContent(o.ToJsonString(), Encoding.UTF8, "application/json");
        }

        using var req = new HttpRequestMessage(HttpMethod.Post, url) { Content = content };
        var (status, body, netError) = await SendAsync(req, key, ct);
        if (netError is not null) return DispatchOutcome.Fail(netError);
        if (status is HttpStatusCode.OK or HttpStatusCode.Created && IsTrue(body?["ok"]))
        {
            if (action == ActionId.Redact)
                return new DispatchOutcome(true, Findings: (body["findings"] as JsonArray)?.DeepClone() as JsonArray ?? new JsonArray(), Note: Str(body["note"]), Truncated: IsTrue(body["truncated"]));
            return new DispatchOutcome(true, Duplicate: IsTrue(body["duplicate"]));
        }
        return DispatchOutcome.Fail(Explain(status, body));
    }

    // ---------------------------------------------------------------- plumbing
    private async Task<(HttpStatusCode status, JsonObject? body, string? netError)> SendAsync(HttpRequestMessage req, string key, CancellationToken ct)
    {
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
        try
        {
            using var res = await _http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
            var body = await ReadBodyAsync(res, ct);
            return (res.StatusCode, body, null);
        }
        catch (TaskCanceledException) { return (0, null, "Vault did not answer in time. Try again."); }
        catch (HttpRequestException e) when (e.InnerException is System.Security.Authentication.AuthenticationException)
        { return (0, null, "The secure connection to Vault could not be trusted (certificate problem). Check the address."); }
        catch (HttpRequestException) { return (0, null, "Could not reach Vault. Check the address and your internet connection."); }
        catch (OperationCanceledException) { return (0, null, "Cancelled."); }
    }

    private static async Task<JsonObject?> ReadBodyAsync(HttpResponseMessage res, CancellationToken ct)
    {
        await using var s = await res.Content.ReadAsStreamAsync(ct);
        using var ms = new MemoryStream();
        var buf = new byte[16 * 1024]; int n;
        while ((n = await s.ReadAsync(buf, ct)) > 0) { ms.Write(buf, 0, n); if (ms.Length > MaxResponseBytes) return null; }   // a huge answer is not a Vault answer
        try { return JsonNode.Parse(ms.ToArray()) as JsonObject; } catch (JsonException) { return null; }
    }

    /// <summary>Words for the person. The server's own message is used only where it is written for this app (keys, limits); otherwise our own.</summary>
    private static string? Str(JsonNode? n) => n is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    internal static string Explain(HttpStatusCode status, JsonObject? body)
    {
        string? server = Str(body?["error"]);
        string? code = Str(body?["code"]);
        int s = (int)status;
        if (s is >= 300 and < 400) return "Vault sent the request somewhere else, which is refused for safety. Check that the address is exactly your Vault address.";
        return s switch
        {
            401 => code is "TOKEN_REVOKED" or "TOKEN_EXPIRED" && server is not null ? server : "Vault did not accept the key. Check it, or make a new one in Vault, Settings, Vault Shelf.",
            403 when server is not null => server,
            403 => "This key is not allowed to do that.",
            404 => "That address does not look like your Vault (or Vault Shelf is not available there).",
            409 => server ?? "Vault is still saving this copy. Try again in a moment.",
            413 => server ?? "Vault says this copy is too large.",
            400 or 415 => server ?? "Vault could not use this copy.",
            429 => (server ?? "Too many requests.") + " Wait a minute and try again.",
            >= 500 => "Vault had a problem. Try again in a moment.",
            _ => "Vault did not accept that. Try again.",
        };
    }

    public void Dispose() => _http.Dispose();
}

/// <summary>The four things a clip can be sent to, with the names the page uses.</summary>
internal enum ActionId { Notes, Finance, Crm, Redact }

internal static class ActionIds
{
    public static bool TryParse(string? text, out ActionId action)
    {
        switch (text)
        {
            case "notes": action = ActionId.Notes; return true;
            case "finance": action = ActionId.Finance; return true;
            case "crm": action = ActionId.Crm; return true;
            case "redact": action = ActionId.Redact; return true;
            default: action = default; return false;
        }
    }
}
