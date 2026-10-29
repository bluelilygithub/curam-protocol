using System.Diagnostics;
using System.Runtime.InteropServices;
using static VaultShelf.Host.NativeMethods;

namespace VaultShelf.Host;

/// <summary>
/// Memory the way Task Manager's "Memory" column counts it: the PRIVATE working set (resident pages not shared with other processes).
/// A WebView2 window is several browser processes, so a reading is the host plus every msedgewebview2.exe in the host's own process tree
/// (other apps' WebView2 processes on the PC are not ours and are never counted).
/// </summary>
internal static class MemoryProbe
{
    public sealed record Proc(int Pid, string Name, long PrivateWs, long Ws);
    public sealed record Snapshot(string Label, long HostPrivateWs, long HostWs, int WebViewProcesses, long WebViewPrivateWs, long TotalPrivateWs, List<Proc> Children)
    {
        public double HostMb => HostPrivateWs / 1048576.0;
        public double WebViewMb => WebViewPrivateWs / 1048576.0;
        public double TotalMb => TotalPrivateWs / 1048576.0;
    }

    /// <summary>Private working set in bytes, or -1 when the process cannot be read.</summary>
    public static long PrivateWorkingSet(int pid)
    {
        var h = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, pid);
        if (h == IntPtr.Zero) return -1;
        try
        {
            int count = 8192;
            for (int attempt = 0; attempt < 8; attempt++)
            {
                int size = (count + 1) * IntPtr.Size;
                var buf = Marshal.AllocHGlobal(size);
                try
                {
                    bool ok = QueryWorkingSet(h, buf, size);
                    long n = Marshal.ReadIntPtr(buf).ToInt64();
                    if (ok)
                    {
                        long privatePages = 0;
                        for (long i = 1; i <= n; i++)
                        {
                            long entry = Marshal.ReadIntPtr(buf, (int)(i * IntPtr.Size)).ToInt64();
                            int shareCount = (int)((entry >> 5) & 0x7); // PSAPI_WORKING_SET_BLOCK.ShareCount
                            if (shareCount <= 1) privatePages++;
                        }
                        return privatePages * 4096;
                    }
                    if (Marshal.GetLastWin32Error() != 24) return -1; // ERROR_BAD_LENGTH: the buffer was too small, n says how many entries there are
                    count = (int)Math.Min(n + 1024, int.MaxValue / 16);
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            return -1;
        }
        finally { CloseHandle(h); }
    }

    public static int ParentOf(int pid)
    {
        var h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
        if (h == IntPtr.Zero) return -1;
        try
        {
            var info = new ProcessBasicInformation();
            return NtQueryInformationProcess(h, 0, ref info, Marshal.SizeOf<ProcessBasicInformation>(), out _) == 0 ? (int)info.InheritedFromUniqueProcessId : -1;
        }
        finally { CloseHandle(h); }
    }

    /// <summary>Every msedgewebview2.exe that descends from <paramref name="rootPid"/>.</summary>
    public static List<Proc> WebViewTree(int rootPid)
    {
        var found = new List<Proc>();
        foreach (var p in Process.GetProcessesByName("msedgewebview2"))
        {
            using (p)
            {
                int cur = p.Id;
                bool ours = false;
                for (int hops = 0; hops < 8 && cur > 0; hops++)
                {
                    cur = ParentOf(cur);
                    if (cur == rootPid) { ours = true; break; }
                }
                if (!ours) continue;
                long pws = PrivateWorkingSet(p.Id);
                long ws = 0;
                try { ws = p.WorkingSet64; } catch { /* exited between the two calls */ }
                found.Add(new Proc(p.Id, p.ProcessName, pws, ws));
            }
        }
        return found;
    }

    public static Snapshot Take(string label)
    {
        using var me = Process.GetCurrentProcess();
        long host = PrivateWorkingSet(me.Id);
        var kids = WebViewTree(me.Id);
        long web = kids.Where(k => k.PrivateWs > 0).Sum(k => k.PrivateWs);
        return new Snapshot(label, host, me.WorkingSet64, kids.Count, web, Math.Max(host, 0) + web, kids);
    }

    /// <summary>Let go of memory the process is not using (the same thing Task Manager's "free memory" does for one process).</summary>
    public static void Trim()
    {
        GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);
        GC.WaitForPendingFinalizers();
        GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);
        EmptyWorkingSet(Process.GetCurrentProcess().Handle);
    }

    [DllImport("psapi.dll")] private static extern bool EmptyWorkingSet(IntPtr hProcess);
}
