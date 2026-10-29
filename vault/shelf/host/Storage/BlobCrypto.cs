using System.Security.Cryptography;

namespace VaultShelf.Host.Storage;

/// <summary>
/// Everything copied is encrypted with Windows DPAPI (CryptProtectData, current-user scope) before it touches the disk. The key is the signed-in Windows
/// account's own: another user on the PC, or a stolen copy of the files, cannot read them. A fixed application "entropy" value is mixed in so another program
/// running as the same user cannot decrypt a blob just by calling DPAPI. (It cannot stop malware that runs as you and knows this value; nothing can.)
/// </summary>
internal static class BlobCrypto
{
    private static readonly byte[] Entropy = System.Text.Encoding.UTF8.GetBytes("VaultShelf.clip.v1");

    public static byte[] Protect(byte[] plain) => ProtectedData.Protect(plain, Entropy, DataProtectionScope.CurrentUser);
    public static byte[] Unprotect(byte[] cipher) => ProtectedData.Unprotect(cipher, Entropy, DataProtectionScope.CurrentUser);

    public static byte[] ProtectText(string text) => Protect(System.Text.Encoding.UTF8.GetBytes(text));
    public static string UnprotectText(byte[] cipher) => System.Text.Encoding.UTF8.GetString(Unprotect(cipher));
}
