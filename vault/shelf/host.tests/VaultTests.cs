using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using VaultShelf.Host.Clipboard;
using VaultShelf.Host.Imaging;
using VaultShelf.Host.Security;
using VaultShelf.Host.Settings;
using VaultShelf.Host.Storage;
using VaultShelf.Host.Vault;
using Xunit;

namespace VaultShelf.Host.Tests;

internal sealed record Sent(HttpMethod Method, string Url, string? Auth, string? ContentType, byte[] Body, string UserAgent);

/// <summary>A stand-in for the network: records every request and answers from a function.</summary>
internal sealed class FakeNet : HttpMessageHandler
{
    public List<Sent> Requests { get; } = new();
    public Func<Sent, HttpResponseMessage> Answer { get; set; } = _ => Json(HttpStatusCode.OK, """{"ok":true}""");
    public static HttpResponseMessage Json(HttpStatusCode code, string json) => new(code) { Content = new StringContent(json, Encoding.UTF8, "application/json") };

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        byte[] body = request.Content is null ? Array.Empty<byte>() : await request.Content.ReadAsByteArrayAsync(ct);
        var sent = new Sent(request.Method, request.RequestUri!.ToString(), request.Headers.Authorization?.ToString(), request.Content?.Headers.ContentType?.ToString(), body, request.Headers.UserAgent.ToString());
        Requests.Add(sent);
        return Answer(sent);
    }
}

internal static class V
{
    public const string Key = "vsh_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    public const string Url = "https://vault.example.com";
    public static string Verify(string scopes = "\"notes:write\",\"crm:write\",\"redact:check\"", string unavailable = "[{\"scope\":\"finance:write\",\"reason\":\"Finance is switched off for your account.\"}]")
        => $"{{\"ok\":true,\"keyLabel\":\"Work laptop\",\"account\":\"me@example.com\",\"scopes\":[{scopes}],\"unavailable\":{unavailable},\"limits\":{{}}}}";

    public static ClipRecord Text(ClipStore store, string text, bool masked = false, string app = "outlook.exe", ClipKind kind = ClipKind.Text)
    {
        string id = store.Add(new NewClip(kind, text, null, null, app, masked, false, 0, 0, Encoding.UTF8.GetByteCount(text)));
        return store.Get(id)!;
    }

    public static (ClipRecord clip, byte[] png) Picture(ClipStore store, bool keepOriginal = true)
    {
        using var bmp = new System.Drawing.Bitmap(120, 80);
        byte[] png = ImageEncoder.ToPng(bmp);
        string id = store.Add(new NewClip(ClipKind.Image, null, keepOriginal ? png : null, png, "snip.exe", false, !keepOriginal, 120, 80, png.Length));
        return (store.Get(id)!, png);
    }
}

public class VaultClientTests
{
    private static (VaultClient client, FakeNet net) Make() { var net = new FakeNet(); return (new VaultClient(net), net); }

    [Fact]
    public async Task Verify_sends_the_key_as_a_bearer_header_to_the_right_address_and_reads_the_answer()
    {
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, V.Verify());
        var r = await c.VerifyAsync("https://vault.example.com/some/page?x=1", V.Key);
        Assert.True(r.Ok); Assert.Equal(new[] { "notes:write", "crm:write", "redact:check" }, r.Scopes);
        Assert.Equal(("finance:write", "Finance is switched off for your account."), Assert.Single(r.Unavailable));
        Assert.Equal("me@example.com", r.Account); Assert.Equal("Work laptop", r.KeyLabel);
        var sent = Assert.Single(net.Requests);
        Assert.Equal(HttpMethod.Get, sent.Method); Assert.Equal("https://vault.example.com/api/quick-ingest/verify", sent.Url);   // only the address's origin is used
        Assert.Equal("Bearer " + V.Key, sent.Auth); Assert.StartsWith("VaultShelf/", sent.UserAgent);
    }

    [Theory]
    [InlineData("")] [InlineData("not-a-key")] [InlineData("vsh_short")] [InlineData("VSH_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")] [InlineData("sk-ant-api03-xyz")]
    public async Task A_key_of_the_wrong_shape_is_refused_before_any_network_call(string key)
    {
        var (c, net) = Make();
        Assert.False((await c.VerifyAsync(V.Url, key)).Ok);
        Assert.Empty(net.Requests);
    }

    [Theory]
    [InlineData("")] [InlineData("http://vault.example.com")] [InlineData("https://user:pw@vault.example.com")] [InlineData("ftp://vault.example.com")] [InlineData("nonsense")]
    public async Task An_address_that_is_not_safe_is_refused_before_any_network_call(string url)
    {
        var (c, net) = Make();
        Assert.False((await c.VerifyAsync(url, V.Key)).Ok);
        Assert.Empty(net.Requests);
    }

    [Fact]
    public async Task Plain_http_is_allowed_only_for_a_server_on_this_PC()
    {
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, V.Verify());
        Assert.True((await c.VerifyAsync("http://localhost:3001", V.Key)).Ok);
        Assert.Equal("http://localhost:3001/api/quick-ingest/verify", net.Requests[0].Url);
    }

    [Theory]
    [InlineData(401, """{"error":"This key was revoked in Vault. Make a new one.","code":"TOKEN_REVOKED"}""", "revoked")]
    [InlineData(401, """{"error":"Not authenticated"}""", "did not accept the key")]
    [InlineData(403, """{"error":"Vault Shelf is switched off for your account.","code":"SHELF_DISABLED"}""", "switched off")]
    [InlineData(404, """<html>Cannot GET</html>""", "does not look like your Vault")]
    [InlineData(500, """{"error":"SELECT * FROM secret_table failed"}""", "Vault had a problem")]
    [InlineData(502, "<html>Bad gateway</html>", "Vault had a problem")]
    public async Task Failures_are_explained_in_plain_words(int status, string body, string expected)
    {
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json((HttpStatusCode)status, body);
        var r = await c.VerifyAsync(V.Url, V.Key);
        Assert.False(r.Ok); Assert.Contains(expected, r.Error);
        Assert.DoesNotContain("SELECT", r.Error);          // a server's internal message is never shown
        Assert.DoesNotContain(V.Key, r.Error!);
    }

    [Fact]
    public async Task Network_problems_are_named_without_quoting_the_exception()
    {
        var (c, net) = Make();
        net.Answer = _ => throw new HttpRequestException("Name or service not known: secret-host.internal");
        var r1 = await c.VerifyAsync(V.Url, V.Key);
        Assert.Contains("Could not reach Vault", r1.Error); Assert.DoesNotContain("secret-host", r1.Error);
        net.Answer = _ => throw new TaskCanceledException("timeout");
        Assert.Contains("did not answer in time", (await c.VerifyAsync(V.Url, V.Key)).Error);
        net.Answer = _ => throw new HttpRequestException("ssl", new System.Security.Authentication.AuthenticationException("bad cert"));
        Assert.Contains("certificate", (await c.VerifyAsync(V.Url, V.Key)).Error);
    }

    [Fact]
    public async Task A_redirect_answer_is_a_failure_with_a_reason()
    {
        var (c, net) = Make();
        net.Answer = _ => { var r = new HttpResponseMessage(HttpStatusCode.Found); r.Headers.Location = new Uri("https://evil.example/steal"); return r; };
        var r = await c.VerifyAsync(V.Url, V.Key);
        Assert.False(r.Ok); Assert.Contains("somewhere else", r.Error);
        Assert.Single(net.Requests);
    }

    [Fact]
    public async Task The_real_client_never_follows_a_redirect_so_the_key_never_goes_to_a_second_address()
    {
        // two real local servers: the first redirects to the second; the second must never be contacted
        int hitsB = 0;
        using var b = new TcpListener(IPAddress.Loopback, 0); b.Start();
        using var a = new TcpListener(IPAddress.Loopback, 0); a.Start();
        int portB = ((IPEndPoint)b.LocalEndpoint).Port, portA = ((IPEndPoint)a.LocalEndpoint).Port;
        var serveB = Task.Run(async () => { try { while (true) { using var cl = await b.AcceptTcpClientAsync(); Interlocked.Increment(ref hitsB); } } catch (Exception e) when (e is ObjectDisposedException or SocketException or InvalidOperationException) { } });
        var seenAuthA = new TaskCompletionSource<string>();
        var serveA = Task.Run(async () =>
        {
            using var cl = await a.AcceptTcpClientAsync();
            using var ns = cl.GetStream();
            var buf = new byte[8192]; int n = await ns.ReadAsync(buf);
            seenAuthA.TrySetResult(Encoding.ASCII.GetString(buf, 0, n));
            var resp = Encoding.ASCII.GetBytes($"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{portB}/steal\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            await ns.WriteAsync(resp);
        });
        using var client = new VaultClient();   // the real handler
        var r = await client.VerifyAsync($"http://127.0.0.1:{portA}", V.Key);
        await Task.Delay(300);
        Assert.False(r.Ok); Assert.Contains("somewhere else", r.Error);
        Assert.Contains("Authorization: Bearer " + V.Key, await seenAuthA.Task);   // it did send the key, to the address the person entered
        Assert.Equal(0, Volatile.Read(ref hitsB));                                 // and to nobody else
        b.Stop(); a.Stop();
        await Task.WhenAny(serveB, Task.Delay(500)); await Task.WhenAny(serveA, Task.Delay(500));
    }

    // ---------------------------------------------------------------- sending a clip
    [Theory]
    [InlineData("notes", "/api/quick-ingest/notes")]
    [InlineData("finance", "/api/quick-ingest/finance")]
    [InlineData("crm", "/api/quick-ingest/crm")]
    public async Task A_text_clip_is_posted_as_JSON_with_its_own_id_so_a_retry_cannot_duplicate_it(string actionName, string path)
    {
        Assert.True(ActionIds.TryParse(actionName, out var action));
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var clip = V.Text(store, "Call Dana back about the quote");
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.Created, """{"ok":true,"id":7}""");
        var r = await c.DispatchAsync(V.Url, V.Key, action, clip, store);
        Assert.True(r.Ok); Assert.False(r.Duplicate);
        var sent = Assert.Single(net.Requests);
        Assert.Equal(HttpMethod.Post, sent.Method); Assert.Equal(V.Url + path, sent.Url); Assert.Equal("Bearer " + V.Key, sent.Auth);
        Assert.StartsWith("application/json", sent.ContentType);
        var body = JsonNode.Parse(sent.Body)!.AsObject();
        Assert.Equal("Call Dana back about the quote", body["text"]!.GetValue<string>());
        Assert.Equal(clip.Id, body["clipId"]!.GetValue<string>()); Assert.Equal("outlook.exe", body["sourceApp"]!.GetValue<string>());
        Assert.Matches("^[A-Za-z0-9_-]{8,64}$", clip.Id);   // the server's rule for a clip id
        // sending the same clip again uses the same id
        await c.DispatchAsync(V.Url, V.Key, action, clip, store);
        Assert.Equal(clip.Id, JsonNode.Parse(net.Requests[1].Body)!["clipId"]!.GetValue<string>());
    }

    [Fact]
    public async Task Already_there_is_a_success()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, """{"ok":true,"duplicate":true,"id":7}""");
        var r = await c.DispatchAsync(V.Url, V.Key, ActionId.Notes, V.Text(store, "x"), store);
        Assert.True(r.Ok); Assert.True(r.Duplicate);
    }

    [Fact]
    public async Task A_clip_with_a_secret_in_it_is_never_sent_and_nothing_goes_over_the_network()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        foreach (var action in new[] { ActionId.Notes, ActionId.Finance, ActionId.Crm, ActionId.Redact })
        {
            var r = await c.DispatchAsync(V.Url, V.Key, action, V.Text(store, "Bearer ••••••••", masked: true), store);
            Assert.False(r.Ok); Assert.Contains("never sent", r.Error);
        }
        Assert.Empty(net.Requests);
    }

    [Theory]
    [InlineData("notes", "/api/quick-ingest/notes")]
    [InlineData("finance", "/api/quick-ingest/finance")]
    [InlineData("crm", "/api/quick-ingest/crm")]
    public async Task A_picture_goes_up_as_the_ORIGINAL_png_in_a_multipart_form(string actionName, string path)
    {
        Assert.True(ActionIds.TryParse(actionName, out var action));
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (clip, png) = V.Picture(store);
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.Created, """{"ok":true,"id":3}""");
        Assert.True((await c.DispatchAsync(V.Url, V.Key, action, clip, store)).Ok);
        var sent = Assert.Single(net.Requests);
        Assert.Equal(V.Url + path, sent.Url); Assert.StartsWith("multipart/form-data", sent.ContentType);
        string form = Encoding.Latin1.GetString(sent.Body);
        Assert.Contains("name=clipId", form); Assert.Contains(clip.Id, form); Assert.Contains("name=sourceApp", form); Assert.Contains("snip.exe", form);
        Assert.Contains("name=file", form); Assert.Contains("image/png", form);
        Assert.True(IndexOf(sent.Body, png) >= 0, "the original PNG bytes are in the upload, whole");
    }

    private static int IndexOf(byte[] hay, byte[] needle)
    {
        for (int i = 0; i <= hay.Length - needle.Length; i++) { int j = 0; while (j < needle.Length && hay[i + j] == needle[j]) j++; if (j == needle.Length) return i; }
        return -1;
    }

    [Fact]
    public async Task A_picture_whose_original_was_too_big_to_keep_says_so_instead_of_sending_a_thumbnail()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (clip, _) = V.Picture(store, keepOriginal: false);
        var (c, net) = Make();
        var r = await c.DispatchAsync(V.Url, V.Key, ActionId.Finance, clip, store);
        Assert.False(r.Ok); Assert.Contains("10 MB", r.Error); Assert.Empty(net.Requests);
    }

    [Fact]
    public async Task Redaction_sends_only_the_text_and_returns_the_findings_it_is_given()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, """{"ok":true,"findings":[{"start":0,"end":14,"text":"jo@example.com","category":"email","confidence":0.95,"rationale":"Matched email address pattern"}],"counts":{"email":1},"truncated":false,"note":"This is a pattern scan."}""");
        var r = await c.DispatchAsync(V.Url, V.Key, ActionId.Redact, V.Text(store, "jo@example.com"), store);
        Assert.True(r.Ok); Assert.Equal("This is a pattern scan.", r.Note); Assert.False(r.Truncated);
        Assert.Equal("email", r.Findings![0]!["category"]!.GetValue<string>());
        var body = JsonNode.Parse(net.Requests[0].Body)!.AsObject();
        Assert.Equal(new[] { "text" }, body.Select(kv => kv.Key).ToArray());   // no clip id, no source program: nothing that is not needed
        var (pic, _) = V.Picture(store);
        Assert.Contains("Only text", (await c.DispatchAsync(V.Url, V.Key, ActionId.Redact, pic, store)).Error);
    }

    [Fact]
    public async Task Every_result_can_be_turned_into_the_JSON_the_page_receives_twice_over()
    {
        // regression: the findings array was still attached to the server's answer, so building the page's answer threw "NodeAlreadyHasParent"
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, """{"ok":true,"findings":[{"start":0,"end":14,"text":"jo@example.com","category":"email","confidence":0.95,"rationale":"x"}],"note":"n","truncated":true}""");
        var r = await c.DispatchAsync(V.Url, V.Key, ActionId.Redact, V.Text(store, "jo@example.com"), store);
        var json1 = r.ToJson().ToJsonString(); var json2 = r.ToJson().ToJsonString();     // twice: building it must not consume anything
        Assert.Equal(json1, json2);
        var o = JsonNode.Parse(json1)!.AsObject();
        Assert.True(o["ok"]!.GetValue<bool>()); Assert.True(o["truncated"]!.GetValue<bool>()); Assert.Equal("n", o["note"]!.GetValue<string>());
        Assert.Equal("jo@example.com", o["findings"]![0]!["text"]!.GetValue<string>());

        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, V.Verify());
        var v = await c.VerifyAsync(V.Url, V.Key);
        Assert.Equal(v.ToJson().ToJsonString(), v.ToJson().ToJsonString());
        Assert.Equal("finance:write", JsonNode.Parse(v.ToJson().ToJsonString())!["unavailable"]![0]!["scope"]!.GetValue<string>());
        Assert.False(JsonNode.Parse(DispatchOutcome.Fail("no").ToJson().ToJsonString())!["ok"]!.GetValue<bool>());
    }

    [Fact]
    public async Task A_text_longer_than_Vault_accepts_is_refused_here_with_the_limit_named()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        var r = await c.DispatchAsync(V.Url, V.Key, ActionId.Notes, V.Text(store, new string('x', VaultClient.MaxTextChars + 1)), store);
        Assert.False(r.Ok); Assert.Contains("200,000", r.Error); Assert.Empty(net.Requests);
    }

    [Theory]
    [InlineData(413, """{"error":"Vault Shelf storage is full (200 MB). File or delete some captures first.","code":"QUOTA"}""", "storage is full")]
    [InlineData(429, """{"error":"Too many requests. Slow down for a minute.","code":"RATE_LIMITED"}""", "Wait a minute")]
    [InlineData(409, """{"error":"This clip is still being saved. Try again in a moment.","code":"IN_PROGRESS"}""", "still being saved")]
    [InlineData(403, """{"error":"This part of Vault is switched off for your account.","code":"FEATURE_DISABLED"}""", "switched off")]
    [InlineData(403, """{"error":"This key does not allow \"Save as Note\".","code":"SCOPE_MISSING"}""", "does not allow")]
    [InlineData(400, """{"error":"There is nothing in this clip."}""", "nothing in this clip")]
    [InlineData(500, """{"error":"stack trace here"}""", "Vault had a problem")]
    public async Task The_servers_own_messages_for_limits_and_permissions_are_passed_on_and_internal_ones_are_not(int status, string body, string expected)
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        net.Answer = _ => FakeNet.Json((HttpStatusCode)status, body);
        var r = await c.DispatchAsync(V.Url, V.Key, ActionId.Notes, V.Text(store, "hello"), store);
        Assert.False(r.Ok); Assert.Contains(expected, r.Error); Assert.DoesNotContain("stack trace", r.Error);
    }

    [Fact]
    public async Task A_page_that_is_not_JSON_or_is_enormous_is_a_plain_failure_not_a_crash()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        var clip = V.Text(store, "hello");
        net.Answer = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("<html>captive portal</html>") };
        Assert.False((await c.DispatchAsync(V.Url, V.Key, ActionId.Notes, clip, store)).Ok);
        net.Answer = _ => new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(new string('x', 3 * 1024 * 1024)) };
        Assert.False((await c.DispatchAsync(V.Url, V.Key, ActionId.Notes, clip, store)).Ok);
        foreach (var odd in new[] { """{"ok":"yes"}""", """{"ok":1}""", """{"ok":null}""", """{"ok":true,"duplicate":"maybe"}""", """[1,2]""", "42", "null" })
        {
            net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, odd);
            var res = await c.DispatchAsync(V.Url, V.Key, ActionId.Notes, clip, store);   // none of these may throw
            Assert.Equal(odd == """{"ok":true,"duplicate":"maybe"}""", res.Ok);          // only a real true counts; "duplicate":"maybe" is simply not a duplicate
            Assert.False(res.Duplicate);
        }
        net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, """{"ok":true,"scopes":"notes","unavailable":5,"account":7}""");
        var v = await c.VerifyAsync(V.Url, V.Key);
        Assert.True(v.Ok); Assert.Empty(v.Scopes); Assert.Null(v.Account);                 // wrong types in an otherwise good answer are ignored, not fatal
    }

    [Fact]
    public async Task Sending_with_no_address_or_no_key_asks_for_them_without_touching_the_network()
    {
        using var root = new TempRoot(); using var store = new ClipStore(root.Path);
        var (c, net) = Make();
        var clip = V.Text(store, "hello");
        Assert.Contains("Settings", (await c.DispatchAsync("", V.Key, ActionId.Notes, clip, store)).Error);
        Assert.Contains("Settings", (await c.DispatchAsync(V.Url, "", ActionId.Notes, clip, store)).Error);
        Assert.Empty(net.Requests);
    }
}

[Collection("Clipboard")]
public class BridgeConnectionTests
{
    private sealed class Rig : IDisposable
    {
        public TempRoot Root = new(); public ClipStore Store; public SettingsStore Settings; public CredentialStore Creds; public StartupRegistration Startup;
        public ClipboardMonitor Monitor; public FakeNet Net = new(); public Bridge Bridge;
        public Rig()
        {
            Store = new ClipStore(Root.Path); Settings = new SettingsStore(Root.Path);
            Creds = new CredentialStore("VaultShelf/test-bridge-" + Guid.NewGuid().ToString("N"));
            Startup = new StartupRegistration("VaultShelf.Test." + Guid.NewGuid().ToString("N"));
            Monitor = new ClipboardMonitor(Store, () => Settings.Current);
            Bridge = new Bridge(Store, Settings, Creds, Startup, Monitor, new VaultClient(Net), _ => true);
        }
        public async Task<JsonObject> Call(string command, string args = "{}")
        {
            string? reply = await Bridge.HandleAsync($"{{\"id\":1,\"command\":\"{command}\",\"args\":{args}}}");
            return JsonNode.Parse(reply!)!.AsObject();
        }
        public void Dispose() { Creds.Delete(); Monitor.Dispose(); Store.Dispose(); Root.Dispose(); }
    }

    [Fact]
    public void Verify_without_a_key_or_address_says_what_is_missing()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            Assert.Equal("No key saved yet.", r.Call("verify").GetAwaiter().GetResult()["result"]!["error"]!.GetValue<string>());
            r.Creds.Write(V.Key);
            Assert.Contains("address", r.Call("verify").GetAwaiter().GetResult()["result"]!["error"]!.GetValue<string>());
            Assert.Empty(r.Net.Requests);
        });
    }

    [Fact]
    public void A_good_key_is_saved_to_Credential_Manager_and_the_address_to_settings_but_never_the_key_to_a_file()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            r.Net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, V.Verify());
            var reply = r.Call("save_connection", $"{{\"baseUrl\":\"https://vault.example.com/settings\",\"key\":\"  {V.Key}  \"}}").GetAwaiter().GetResult();
            var res = reply["result"]!.AsObject();
            Assert.True(res["ok"]!.GetValue<bool>()); Assert.Equal("me@example.com", res["account"]!.GetValue<string>());
            Assert.Equal(V.Key, r.Creds.Read());
            Assert.Equal("https://vault.example.com", r.Settings.Current.BaseUrl);
            Assert.True(r.Call("get_settings").GetAwaiter().GetResult()["result"]!["hasKey"]!.GetValue<bool>());
            foreach (var f in Directory.EnumerateFiles(r.Root.Path, "*", SearchOption.AllDirectories))
                Assert.DoesNotContain("0123456789abcdef0123456789abcdef", Encoding.UTF8.GetString(ReadShared(f)));   // the key is in no file of ours
            Assert.DoesNotContain(V.Key, reply.ToJsonString());                                                               // and the page's answer does not contain it
        });
    }

    private static byte[] ReadShared(string path)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);   // the database may still be open
        using var ms = new MemoryStream(); fs.CopyTo(ms); return ms.ToArray();
    }

    [Fact]
    public void A_key_Vault_refuses_is_not_saved_and_neither_is_the_address()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            r.Net.Answer = _ => FakeNet.Json(HttpStatusCode.Unauthorized, """{"error":"Not authenticated"}""");
            var res = r.Call("save_connection", $"{{\"baseUrl\":\"https://vault.example.com\",\"key\":\"{V.Key}\"}}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.False(res["ok"]!.GetValue<bool>());
            Assert.Null(r.Creds.Read()); Assert.Equal("", r.Settings.Current.BaseUrl);
        });
    }

    [Theory]
    [InlineData("https://vault.example.com", "nope")]
    [InlineData("http://vault.example.com", "vsh_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")]
    [InlineData("", "vsh_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef")]
    [InlineData("https://vault.example.com", "")]
    public void A_bad_address_or_key_is_refused_without_a_network_call_and_nothing_is_saved(string url, string key)
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            var res = r.Call("save_connection", $"{{\"baseUrl\":\"{url}\",\"key\":\"{key}\"}}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.False(res["ok"]!.GetValue<bool>()); Assert.False(string.IsNullOrEmpty(res["error"]!.GetValue<string>()));
            Assert.Empty(r.Net.Requests); Assert.Null(r.Creds.Read()); Assert.Equal("", r.Settings.Current.BaseUrl);
        });
    }

    [Fact]
    public void Leaving_the_key_empty_rechecks_the_saved_key_against_a_new_address()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            r.Creds.Write(V.Key);
            r.Net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, V.Verify());
            var res = r.Call("save_connection", "{\"baseUrl\":\"https://other.example.com\",\"key\":\"\"}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.True(res["ok"]!.GetValue<bool>());
            Assert.Equal("Bearer " + V.Key, r.Net.Requests[0].Auth); Assert.StartsWith("https://other.example.com/", r.Net.Requests[0].Url);
            Assert.Equal("https://other.example.com", r.Settings.Current.BaseUrl); Assert.Equal(V.Key, r.Creds.Read());
        });
    }

    [Fact]
    public void Sending_a_clip_uses_the_saved_key_and_address_and_answers_the_page_in_its_own_format()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            r.Creds.Write(V.Key); r.Settings.Apply(JsonNode.Parse("""{"baseUrl":"https://vault.example.com"}""")!.AsObject());
            var clip = V.Text(r.Store, "hello from the shelf");
            r.Net.Answer = _ => FakeNet.Json(HttpStatusCode.Created, """{"ok":true,"id":1}""");
            var ok = r.Call("dispatch", $"{{\"action\":\"notes\",\"id\":\"{clip.Id}\"}}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.True(ok["ok"]!.GetValue<bool>());
            Assert.Equal("Bearer " + V.Key, r.Net.Requests[0].Auth); Assert.Equal("https://vault.example.com/api/quick-ingest/notes", r.Net.Requests[0].Url);
            var unknown = r.Call("dispatch", $"{{\"action\":\"shred\",\"id\":\"{clip.Id}\"}}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.False(unknown["ok"]!.GetValue<bool>());
            var gone = r.Call("dispatch", "{\"action\":\"notes\",\"id\":\"nope\"}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.Contains("no longer", gone["error"]!.GetValue<string>());
            var masked = V.Text(r.Store, "x ••••••••", masked: true);
            var refused = r.Call("dispatch", $"{{\"action\":\"crm\",\"id\":\"{masked.Id}\"}}").GetAwaiter().GetResult()["result"]!.AsObject();
            Assert.Contains("never sent", refused["error"]!.GetValue<string>());
            Assert.Single(r.Net.Requests);   // only the first one went out
        });
    }

    [Fact]
    public void The_redaction_check_reaches_the_page_with_its_findings_and_an_internal_error_never_does()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            r.Creds.Write(V.Key); r.Settings.Apply(JsonNode.Parse("""{"baseUrl":"https://vault.example.com"}""")!.AsObject());
            var clip = V.Text(r.Store, "jo@example.com TFN 123 456 782");
            r.Net.Answer = _ => FakeNet.Json(HttpStatusCode.OK, """{"ok":true,"findings":[{"start":0,"end":14,"text":"jo@example.com","category":"email","confidence":0.95,"rationale":"x"},{"start":19,"end":30,"text":"123 456 782","category":"tax_file_number","confidence":0.95,"rationale":"y"}],"note":"pattern scan","truncated":false}""");
            var res = r.Call("dispatch", $"{{\"action\":\"redact\",\"id\":\"{clip.Id}\"}}").GetAwaiter().GetResult();
            Assert.Null(res["error"]);
            Assert.Equal(2, res["result"]!["findings"]!.AsArray().Count); Assert.Equal("pattern scan", res["result"]!["note"]!.GetValue<string>());
            // a failure inside the shell must reach the page as a plain sentence, not as the name of an exception
            r.Net.Answer = _ => throw new InvalidOperationException("NodeAlreadyHasParent");
            var bad = r.Call("dispatch", $"{{\"action\":\"notes\",\"id\":\"{clip.Id}\"}}").GetAwaiter().GetResult();
            var shown = (bad["error"] ?? bad["result"]!["error"])!.GetValue<string>();
            Assert.DoesNotContain("NodeAlreadyHasParent", shown); Assert.False(string.IsNullOrWhiteSpace(shown));
        });
    }

    [Fact]
    public void The_page_cannot_make_the_shell_do_a_Vault_call_through_the_non_waiting_path_and_garbage_is_ignored()
    {
        Sta.Run(() =>
        {
            using var r = new Rig();
            Assert.Contains("HandleAsync", JsonNode.Parse(r.Bridge.Handle("{\"id\":5,\"command\":\"dispatch\",\"args\":{}}")!)!["error"]!.GetValue<string>());
            Assert.Null(r.Bridge.Handle("not json")); Assert.Null(r.Bridge.Handle("{}")); Assert.Null(r.Bridge.Handle("{\"id\":\"x\",\"command\":1}"));
            Assert.Null(r.Bridge.HandleAsync("garbage").GetAwaiter().GetResult());
            Assert.Contains("Unknown command", JsonNode.Parse(r.Call("rm_rf", "{}").GetAwaiter().GetResult().ToJsonString())!["error"]!.GetValue<string>());
            Assert.Empty(r.Net.Requests);
        });
    }
}

/// <summary>Runs only when VAULT_URL and VAULT_KEY are set: the real client against a real Vault (for example the local server).</summary>
public sealed class FactIfVaultAttribute : FactAttribute
{
    public FactIfVaultAttribute() { if (string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VAULT_URL")) || string.IsNullOrEmpty(Environment.GetEnvironmentVariable("VAULT_KEY"))) Skip = "Set VAULT_URL and VAULT_KEY to run this against a real Vault."; }
}

public class LiveVaultTests
{
    [FactIfVault]
    public async Task The_real_client_verifies_and_sends_every_kind_of_clip_to_a_real_Vault()
    {
        string url = Environment.GetEnvironmentVariable("VAULT_URL")!, key = Environment.GetEnvironmentVariable("VAULT_KEY")!;
        using var root = new TempRoot(); using var store = new ClipStore(root.Path); using var client = new VaultClient();
        var v = await client.VerifyAsync(url, key);
        Assert.True(v.Ok, v.Error); Assert.Contains("notes:write", v.Scopes);

        var text = V.Text(store, "SHELF LIVE TEST " + Guid.NewGuid().ToString("N"));
        var (pic, _) = V.Picture(store);
        foreach (var action in new[] { ActionId.Notes, ActionId.Crm, ActionId.Finance })
        {
            var first = await client.DispatchAsync(url, key, action, text, store);
            Assert.True(first.Ok, $"{action}: {first.Error}"); Assert.False(first.Duplicate, action + " first send");
            var again = await client.DispatchAsync(url, key, action, text, store);
            Assert.True(again.Ok && again.Duplicate, $"{action}: sending the same clip again must be recognised ({again.Error})");
            var picture = await client.DispatchAsync(url, key, action, pic, store);
            Assert.True(picture.Ok, $"{action} picture: {picture.Error}");
        }
        var scan = await client.DispatchAsync(url, key, ActionId.Redact, V.Text(store, "jo@example.com TFN 123 456 782"), store);
        Assert.True(scan.Ok, scan.Error); Assert.True(scan.Findings!.Count >= 2);
        var wrong = await client.VerifyAsync(url, "vsh_" + new string('0', 64));
        Assert.False(wrong.Ok);
    }
}
