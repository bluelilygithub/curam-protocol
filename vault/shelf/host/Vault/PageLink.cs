using System.Text.RegularExpressions;

namespace VaultShelf.Host.Vault;

/// <summary>
/// Builds the address the quick launcher opens in the browser: the person's own Vault address plus a page path chosen by the page. The shell does not trust
/// the page, so the path must be a plain in-site path (letters, digits, / - _ and an optional simple ?name=value query); anything that could lead to another
/// site or program ("//", a scheme, a dot, a backslash, a space) gives null.
/// </summary>
internal static class PageLink
{
    private static readonly Regex Path = new(@"^/[A-Za-z0-9/_\-]*(\?[A-Za-z0-9_\-]+=[A-Za-z0-9_\-]+(&[A-Za-z0-9_\-]+=[A-Za-z0-9_\-]+)*)?$", RegexOptions.Compiled);

    public static string? Build(string baseUrl, string? path)
    {
        if (string.IsNullOrEmpty(baseUrl) || path is null || path.Length > 200 || path.Contains("//") || !Path.IsMatch(path)) return null;
        var (ok, origin) = Settings.SettingsRules.NormalizeBaseUrl(baseUrl);
        return ok && origin.Length > 0 ? origin + path : null;
    }
}
