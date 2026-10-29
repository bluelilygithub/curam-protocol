using System.Diagnostics;
using VaultShelf.Host.Masking;
using Xunit;

namespace VaultShelf.Host.Tests;

// The "secrets" below are built from pieces at run time and are not real: no secret scanner should find a key in this source file.
public class SecretScannerTests
{
    private static string A(int n) => new('a', n);
    private static string Mixed(int n) => string.Concat(Enumerable.Range(0, n).Select(i => "aB3dE5gH7jK9mN1pQ"[i % 17]));

    // each case: what the clip says, and the secret itself (which must not survive anywhere in the result)
    private static object[] Case(string label, string before, string secret, string after = "") => new object[] { label, before + secret + after, secret };

    public static IEnumerable<object[]> Secrets() => new[]
    {
        Case("Stripe live key", "key: ", "sk_" + "live_" + A(24)),
        Case("Stripe test key", "", "sk_" + "test_" + Mixed(30)),
        Case("Anthropic key", "ANTHROPIC=", "sk-" + "ant-api03-" + Mixed(40)),
        Case("OpenAI-style key", "use ", "sk-" + Mixed(48), " now"),
        Case("GitHub token", "git push https://x:", "ghp" + "_" + Mixed(36), "@github.com"),
        Case("GitHub fine-grained token", "", "github_" + "pat_" + Mixed(60)),
        Case("Slack token", "", "xox" + "b-1234567890-" + Mixed(24)),
        Case("AWS access key", "AWS ", "AKIA" + "IOSFODNN7EXAMPLE"),
        Case("Google API key", "", "AIza" + Mixed(35)),
        Case("JWT", "token ", "eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + "." + Mixed(20)),
        Case("npm token", "//registry.npmjs.org/:_authToken=", "npm_" + Mixed(36)),
        Case("Vault Shelf key", "", "vsh" + "_" + string.Concat(Enumerable.Repeat("0123456789abcdef", 4))),
        Case("bearer header", "Authorization: Bearer ", Mixed(40)),
        Case("bare bearer", "curl -H 'Bearer ", Mixed(30), "'"),
        Case("basic header", "Authorization: Basic ", "dXNlcjpwYXNzd29yZDEyMzQ1Njc4"),
        Case("login in address", "postgres://admin:", "s3cretpass99", "@db.example.com:5432/app"),
        Case("password assignment", "password = ", "hunter2hunter2"),
        Case("env style password", "DB_PASSWORD=", "supersecretvalue"),
        Case("dotted name", "db.password: ", "correct-horse-battery"),
        Case("camelCase name", "{ clientSecret: \"", "abcd-1234-efgh-5678", "\" }"),
        Case("json api key", "{ \"api_key\": \"", "abcd1234efgh5678", "\" }"),
        Case("quoted secret", "client_secret: '", "xyz-123-456-789", "'"),
        Case("aws secret", "aws_secret_access_key = ", Mixed(40)),
        Case("long env name", "MY_SERVICE_API_KEY=", "k9x2m4n6p8q1r3s5"),
    };

    [Theory, MemberData(nameof(Secrets))]
    public void A_secret_is_replaced_and_the_clip_is_marked_masked(string label, string text, string secret)
    {
        var r = SecretScanner.Scan(text);
        Assert.True(r.Masked, label);
        Assert.Contains(SecretScanner.Mask, r.Text);
        Assert.NotEmpty(r.Kinds);
        Assert.DoesNotContain(secret, r.Text);
        Assert.DoesNotContain(secret[..Math.Min(secret.Length, 12)], r.Text);   // nor its first characters
    }

    [Fact]
    public void Surrounding_words_survive_so_the_clip_still_reads()
    {
        var r = SecretScanner.Scan("Authorization: Bearer " + Mixed(40) + "\nHost: api.example.com");
        Assert.StartsWith("Authorization: Bearer " + SecretScanner.Mask, r.Text);
        Assert.EndsWith("\nHost: api.example.com", r.Text);
        var url = SecretScanner.Scan("postgres://admin:s3cretpass99@db.example.com:5432/app");
        Assert.Equal("postgres://admin:" + SecretScanner.Mask + "@db.example.com:5432/app", url.Text);
    }

    [Fact]
    public void A_whole_private_key_block_becomes_one_note()
    {
        string body = string.Join("\n", Enumerable.Repeat(Mixed(64), 12));
        var r = SecretScanner.Scan("here:\n-----BEGIN " + "RSA PRIVATE KEY-----\n" + body + "\n-----END " + "RSA PRIVATE KEY-----\nthanks");
        Assert.Equal("here:\n[private key hidden]\nthanks", r.Text);
        Assert.Contains("private key", r.Kinds);
    }

    [Fact]
    public void A_private_key_cut_short_is_hidden_to_the_end()
    {
        var r = SecretScanner.Scan("-----BEGIN " + "OPENSSH PRIVATE KEY-----\n" + Mixed(200));
        Assert.Equal("[private key hidden]", r.Text);
    }

    [Fact]
    public void Several_secrets_in_one_clip_are_all_hidden_and_each_kind_is_listed_once()
    {
        string text = "a=" + "ghp" + "_" + Mixed(36) + " b=" + "ghp" + "_" + Mixed(37) + " c=" + "AKIA" + "IOSFODNN7EXAMPLE";
        var r = SecretScanner.Scan(text);
        Assert.Equal(3, r.Text.Split(SecretScanner.Mask).Length - 1);
        Assert.Equal(new[] { "GitHub token", "AWS key" }.OrderBy(x => x), r.Kinds.OrderBy(x => x));
    }

    [Fact]
    public void A_secret_found_twice_by_different_rules_is_hidden_once_not_garbled()
    {
        // a JWT inside an Authorization header matches two rules; the result must be one clean replacement
        string jwt = "eyJ" + "hbGciOiJIUzI1NiJ9" + "." + "eyJ" + "zdWIiOiIxMjM0NTY3ODkwIn0" + "." + Mixed(20);
        var r = SecretScanner.Scan("Authorization: Bearer " + jwt);
        Assert.Equal("Authorization: Bearer " + SecretScanner.Mask, r.Text);
    }

    [Theory]
    [InlineData("Meeting moved to Tuesday, please confirm.")]
    [InlineData("secretary: Hernandez will attend")]
    [InlineData("passwords: please rotate them every quarter")]
    [InlineData("keyboard = a tool for typing long text")]
    [InlineData("The password policy needs 12 characters and a symbol.")]
    [InlineData("Reset your password: click the link below.")]
    [InlineData("Bearer token required for this endpoint")]
    [InlineData("const token = getToken(); tokenizer = 42;")]
    [InlineData("https://example.com/path?x=1")]
    [InlineData("jo.smith@example.com or 0412 345 678")]
    [InlineData("commit a3f5c9e2b1d47806f5a1c2e3d4b5a69788796a5b fixed it")]
    [InlineData("sk-ant is a prefix and sk_live_ is another")]
    [InlineData("Card 4111 1111 1111 1111 expires 12/28")]
    [InlineData("def add(a, b):\n    return a + b")]
    [InlineData("名前: 田中 パスワード")]
    [InlineData("")]
    [InlineData("   ")]
    public void Ordinary_text_comes_through_unchanged_and_unmarked(string text)
    {
        var r = SecretScanner.Scan(text);
        Assert.False(r.Masked);
        Assert.Equal(text, r.Text);
        Assert.Empty(r.Kinds);
    }

    [Fact]
    public void A_huge_clip_is_scanned_quickly_and_its_tail_is_kept()
    {
        string text = string.Concat(Enumerable.Repeat("plain words about the project. ", 60_000)) + "tail-marker";   // about 1.8 million characters
        var sw = Stopwatch.StartNew();
        var r = SecretScanner.Scan(text);
        Assert.True(sw.ElapsedMilliseconds < 5000, $"took {sw.ElapsedMilliseconds} ms");
        Assert.False(r.Masked);
        Assert.EndsWith("tail-marker", r.Text);
    }

    [Fact]
    public void Hostile_input_cannot_make_the_scanner_hang()
    {
        var sw = Stopwatch.StartNew();
        SecretScanner.Scan("Bearer " + new string('a', 200_000) + "!");
        SecretScanner.Scan("password=" + new string('x', 500_000));
        SecretScanner.Scan(string.Concat(Enumerable.Repeat("-----BEGIN PRIVATE KEY----- ", 20_000)));
        SecretScanner.Scan(new string('"', 300_000) + "api_key");
        Assert.True(sw.ElapsedMilliseconds < 15_000, $"took {sw.ElapsedMilliseconds} ms");
    }
}
