using System.Runtime.InteropServices;
using System.Text;

namespace VaultShelf.Host.Security;

/// <summary>
/// The Vault ingest key lives in Windows Credential Manager (Control Panel, Credential Manager, Windows Credentials), where Windows encrypts it for the signed-in
/// user. It is never written to a file or setting, and the page never receives it: only whether one is saved.
/// </summary>
internal sealed class CredentialStore
{
    public const string DefaultTarget = "VaultShelf/ingest-key";
    private const int CRED_TYPE_GENERIC = 1;
    private const int CRED_PERSIST_LOCAL_MACHINE = 2;   // kept across sign-outs on this PC, not roamed to other PCs

    private readonly string _target;
    public CredentialStore(string target = DefaultTarget) => _target = target;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct CREDENTIAL
    {
        public uint Flags; public uint Type; public string TargetName; public string? Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes; public string? TargetAlias; public string? UserName;
    }

    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr buffer);

    public void Write(string secret)
    {
        var bytes = Encoding.UTF8.GetBytes(secret);
        var blob = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, blob, bytes.Length);
            var cred = new CREDENTIAL
            {
                Type = CRED_TYPE_GENERIC, TargetName = _target, UserName = "Vault Shelf", Comment = "Vault Shelf ingest key",
                CredentialBlobSize = (uint)bytes.Length, CredentialBlob = blob, Persist = CRED_PERSIST_LOCAL_MACHINE,
            };
            if (!CredWrite(ref cred, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            Array.Clear(bytes);
            for (int i = 0; i < bytes.Length; i++) Marshal.WriteByte(blob, i, 0);   // do not leave the key in freed memory
            Marshal.FreeHGlobal(blob);
        }
    }

    /// <summary>The saved key, or null. Only the code that sends to Vault should call this.</summary>
    public string? Read()
    {
        if (!CredRead(_target, CRED_TYPE_GENERIC, 0, out var ptr)) return null;
        try
        {
            var cred = Marshal.PtrToStructure<CREDENTIAL>(ptr);
            if (cred.CredentialBlob == IntPtr.Zero || cred.CredentialBlobSize == 0) return null;
            var bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, bytes.Length);
            try { return Encoding.UTF8.GetString(bytes); } finally { Array.Clear(bytes); }
        }
        finally { CredFree(ptr); }
    }

    public bool Exists() => Read() is { Length: > 0 };
    public void Delete() => CredDelete(_target, CRED_TYPE_GENERIC, 0);
}
