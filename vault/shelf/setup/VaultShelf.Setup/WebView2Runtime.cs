using System.Diagnostics;
using System.Security.Cryptography.X509Certificates;
using Microsoft.Win32;

namespace VaultShelf.Setup;

/// <summary>The shelf window is drawn by Microsoft's WebView2 runtime. Windows 11 and recent Windows 10 have it; if this PC does not, Microsoft's own installer is fetched.</summary>
internal static class WebView2Runtime
{
    private const string ClientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
    // Microsoft's fixed address for the small "Evergreen bootstrapper"
    private const string BootstrapperUrl = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

    public static bool IsInstalled()
    {
        foreach (var (hive, view, path) in new[]
        {
            (RegistryHive.LocalMachine, RegistryView.Registry32, $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{ClientId}"),
            (RegistryHive.LocalMachine, RegistryView.Registry64, $@"SOFTWARE\Microsoft\EdgeUpdate\Clients\{ClientId}"),
            (RegistryHive.CurrentUser, RegistryView.Default, $@"Software\Microsoft\EdgeUpdate\Clients\{ClientId}"),
        })
        {
            try
            {
                using var k = RegistryKey.OpenBaseKey(hive, view).OpenSubKey(path);
                if (VersionLooksReal(k?.GetValue("pv") as string)) return true;
            }
            catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or IOException) { /* try the next place */ }
        }
        return false;
    }

    public static bool VersionLooksReal(string? pv) => !string.IsNullOrWhiteSpace(pv) && pv != "0.0.0.0" && Version.TryParse(pv, out _);

    /// <summary>True only for a file carrying an embedded signature from Microsoft Corporation. Used to check what was downloaded before it is run.</summary>
    public static bool IsSignedByMicrosoft(string path)
    {
        try
        {
#pragma warning disable SYSLIB0057 // CreateFromSignedFile is the one call that reads an embedded Authenticode signature; the chain is checked separately below
            using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
            using var chain = new X509Chain();
            chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;   // offline-friendly; the publisher name and a valid chain are what matter here
            bool valid = chain.Build(cert);
            return valid && cert.Subject.Contains("O=Microsoft Corporation", StringComparison.Ordinal);
        }
        catch (Exception e) when (e is System.Security.Cryptography.CryptographicException or IOException or UnauthorizedAccessException) { return false; }
    }

    /// <summary>Download and run Microsoft's installer. Returns null when it worked, or a sentence saying what to do.</summary>
    public static async Task<string?> InstallAsync()
    {
        string file = Path.Combine(Path.GetTempPath(), "MicrosoftEdgeWebview2Setup-" + Guid.NewGuid().ToString("N") + ".exe");
        try
        {
            using (var http = new HttpClient { Timeout = TimeSpan.FromMinutes(3) })
            using (var res = await http.GetAsync(BootstrapperUrl))
            {
                if (!res.IsSuccessStatusCode) return "Could not download Microsoft's WebView2 component. Check the internet connection and run the installer again.";
                await using var fs = File.Create(file);
                await res.Content.CopyToAsync(fs);
            }
            if (!IsSignedByMicrosoft(file)) return "What was downloaded did not carry Microsoft's signature, so it was not run. Try again, or install \"WebView2 Runtime\" from Microsoft's website.";
            var psi = new ProcessStartInfo(file, "/silent /install") { UseShellExecute = false, CreateNoWindow = true };
            using var p = Process.Start(psi);
            if (p is null) return "Could not start Microsoft's WebView2 installer.";
            if (!p.WaitForExit(300_000)) { try { p.Kill(); } catch (InvalidOperationException) { } return "Microsoft's WebView2 installer took too long."; }
            return IsInstalled() ? null : "Microsoft's WebView2 installer did not finish. Install \"WebView2 Runtime\" from Microsoft's website, then run this installer again.";
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or IOException or UnauthorizedAccessException)
        {
            return "Could not get Microsoft's WebView2 component (" + e.GetType().Name + "). Check the internet connection and run the installer again.";
        }
        finally { try { File.Delete(file); } catch (IOException) { } catch (UnauthorizedAccessException) { } }
    }
}
