using System.Text;
using System.Text.RegularExpressions;

namespace VaultShelf.Host.Masking;

/// <summary>
/// Finds passwords, API keys, tokens and private keys in copied text and replaces them BEFORE anything is stored, so the real secret never reaches the
/// disk, the page, or Vault. The clip is kept (so you can still see what you copied) with the secret hidden, and is marked masked: a masked clip can be read
/// but is never sent anywhere. Patterns are for well-known shapes with low false-positive rates; a plain sentence must come through unchanged.
/// </summary>
internal static class SecretScanner
{
    public const string Mask = "••••••••";
    public const int MaxScanChars = 1_000_000;
    public const string Unchecked = "[hidden: this text could not be checked for secrets]";

    public sealed record Result(string Text, bool Masked, IReadOnlyList<string> Kinds);

    private sealed record Rule(string Kind, Regex Pattern, string? Group = null, string? Replacement = null);

    private static readonly TimeSpan Timeout = TimeSpan.FromMilliseconds(500);
    private static Regex R(string pattern, RegexOptions extra = RegexOptions.None) => new(pattern, RegexOptions.CultureInvariant | extra, Timeout);

    private static readonly Rule[] Rules =
    {
        // private keys: the whole block (or, if the copy was cut short, everything from the header on)
        new("private key", R(@"-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)"), Replacement: "[private key hidden]"),
        new("API key", R(@"\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b")),                  // Stripe
        new("API key", R(@"\bwhsec_[A-Za-z0-9]{16,}\b")),
        new("API key", R(@"\bsk-ant-[A-Za-z0-9_\-]{20,}")),                                    // Anthropic
        new("API key", R(@"\bsk-(?:proj-)?[A-Za-z0-9_\-]{32,}")),                              // OpenAI-style
        new("GitHub token", R(@"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b")),
        new("GitHub token", R(@"\bgithub_pat_[A-Za-z0-9_]{40,}\b")),
        new("Slack token", R(@"\bxox[baprs]-[A-Za-z0-9\-]{10,}")),
        new("AWS key", R(@"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
        new("Google API key", R(@"\bAIza[0-9A-Za-z_\-]{35}\b")),
        new("npm token", R(@"\bnpm_[A-Za-z0-9]{36}\b")),
        new("SendGrid key", R(@"\bSG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}\b")),
        new("Vault Shelf key", R(@"\bvsh_[0-9a-f]{64}\b")),
        new("JWT", R(@"\beyJ[A-Za-z0-9_\-]{8,}\.eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")),
        // an Authorization header or a bearer token: hide the credential, keep the word so it still reads as what it was
        new("authorization", R(@"(?i)\b(?:Authorization\s*:\s*)?(?:Basic|Bearer|Token)\s+(?<v>[A-Za-z0-9\-._~+/]{16,}=*)"), Group: "v"),
        // a web address with a login in it: https://user:password@host
        new("password in address", R(@"(?i)\b[a-z][a-z0-9+.\-]*://[^/\s:@]+:(?<v>[^/\s@]{3,})@"), Group: "v"),
        // password = ..., "api_key": ..., DB_PASSWORD=..., db.secret: ..., clientSecret: ...  (the name may have a prefix or suffix joined by _ . or -, but a word that
        // merely CONTAINS a keyword, like "secretary", is not a name). The value is a quoted string or a run of at least six characters.
        new("password or key", R(@"(?i)(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_.\-])*(?:password|passwd|pwd|passphrase|secret|apikey|api[_\-]?key|access[_\-]?token|auth[_\-]?token|refresh[_\-]?token|private[_\-]?key|client[_\-]?secret|aws_secret_access_key)(?:[_.\-][A-Za-z0-9]+)*(?![A-Za-z0-9])[""']?\s*[:=]\s*(?<v>""[^""\r\n]{4,}""|'[^'\r\n]{4,}'|[^\s"",;']{6,})"), Group: "v"),
        // the same names written in camelCase: clientSecret, dbPassword, apiKey
        new("password or key", R(@"(?<=[a-z])(?:Password|Passwd|Secret|ApiKey|AccessToken|AuthToken|RefreshToken|PrivateKey)(?![A-Za-z0-9])[""']?\s*[:=]\s*(?<v>""[^""\r\n]{4,}""|'[^'\r\n]{4,}'|[^\s"",;']{6,})"), Group: "v"),
    };

    public static Result Scan(string text)
    {
        if (string.IsNullOrEmpty(text)) return new Result(text ?? "", false, Array.Empty<string>());
        string work = text.Length > MaxScanChars ? text[..MaxScanChars] : text;
        var spans = new List<(int Start, int End, string Kind, string? Replacement)>();
        foreach (var rule in Rules)
        {
            MatchCollection matches;
            // fail closed: if a pattern cannot finish in time on this text, nothing can be said about what is in it, so none of it is kept
            try { matches = rule.Pattern.Matches(work); matches.Count.ToString(); }
            catch (RegexMatchTimeoutException) { return new Result(Unchecked, true, new[] { "could not be checked" }); }
            foreach (Match m in matches)
            {
                var g = rule.Group is null ? m : m.Groups[rule.Group];
                if (!g.Success || g.Length == 0) continue;
                spans.Add((g.Index, g.Index + g.Length, rule.Kind, rule.Replacement));
            }
        }
        if (spans.Count == 0) return new Result(text, false, Array.Empty<string>());

        // overlapping finds (a JWT inside an Authorization header) become one hidden span
        spans.Sort((a, b) => a.Start != b.Start ? a.Start.CompareTo(b.Start) : b.End.CompareTo(a.End));
        var sb = new StringBuilder(work.Length);
        var kinds = new List<string>();
        int at = 0;
        foreach (var s in spans)
        {
            if (s.Start < at) { if (s.End > at) { /* a longer find that starts inside an earlier one: keep the earlier cover */ } continue; }
            sb.Append(work, at, s.Start - at).Append(s.Replacement ?? Mask);
            at = s.End;
            if (!kinds.Contains(s.Kind)) kinds.Add(s.Kind);
        }
        sb.Append(work, at, work.Length - at);
        if (text.Length > MaxScanChars) sb.Append(text, MaxScanChars, text.Length - MaxScanChars); // beyond the scan limit: kept as it was (the cap on what is stored is applied by the caller)
        return new Result(sb.ToString(), true, kinds);
    }
}
