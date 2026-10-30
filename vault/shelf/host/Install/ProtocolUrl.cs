namespace VaultShelf.Host.Install;

/// <summary>
/// The address Windows hands to the app when a web page (or anything else) opens a <c>vault-shelf://</c> link. There is exactly one thing such a link
/// may ask for: open the shelf. It carries no data, so a hostile page cannot pass the app anything. Anything else is ignored.
/// </summary>
internal static class ProtocolUrl
{
    public const string Scheme = "vault-shelf";
    public const string Open = "vault-shelf://open";

    public static bool IsOpenRequest(string? url)
    {
        if (string.IsNullOrWhiteSpace(url) || url.Length > 64) return false;
        // compare the text itself rather than a parsed form, so nothing odd survives a parser's leniency (a query, a fragment, a port, a name, a path, escapes)
        string t = url.Trim();
        if (t.EndsWith('/')) t = t[..^1];
        return string.Equals(t, Open, StringComparison.OrdinalIgnoreCase);
    }
}
