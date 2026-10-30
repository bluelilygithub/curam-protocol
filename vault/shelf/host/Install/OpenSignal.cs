namespace VaultShelf.Host.Install;

/// <summary>
/// "Open the shelf" for a copy of the app that is already running. A second program start (from a vault-shelf://open link) raises a named event and exits;
/// the running copy, waiting on that event, opens its shelf. The event carries nothing, so there is nothing to forge.
/// </summary>
internal static class OpenSignal
{
    public static string NameFor(bool selfTest) => selfTest ? "Local\\VaultShelf.Spike.Open" : "Local\\VaultShelf.Open";

    /// <summary>Ask a running copy to open its shelf. False when none is listening.</summary>
    public static bool Raise(string name)
    {
        try
        {
            using var handle = EventWaitHandle.OpenExisting(name);
            return handle.Set();
        }
        catch (Exception e) when (e is WaitHandleCannotBeOpenedException or UnauthorizedAccessException or IOException) { return false; }
    }

    /// <summary>Wait, on a background thread, for requests. Dispose the result to stop listening.</summary>
    public static IDisposable Listen(string name, Action onOpen)
    {
        var handle = new EventWaitHandle(false, EventResetMode.AutoReset, name);
        var stop = new ManualResetEventSlim(false);
        var thread = new Thread(() =>
        {
            var waits = new WaitHandle[] { handle, stop.WaitHandle };
            while (WaitHandle.WaitAny(waits) == 0)
            {
                try { onOpen(); } catch (Exception e) { AppLog.Write("open request failed: " + e.GetType().Name); }
            }
        }) { IsBackground = true, Name = "VaultShelf open requests" };
        thread.Start();
        return new Listener(handle, stop, thread);
    }

    private sealed class Listener : IDisposable
    {
        private readonly EventWaitHandle _handle; private readonly ManualResetEventSlim _stop; private readonly Thread _thread;
        public Listener(EventWaitHandle h, ManualResetEventSlim s, Thread t) { _handle = h; _stop = s; _thread = t; }
        public void Dispose() { _stop.Set(); _thread.Join(1000); _handle.Dispose(); _stop.Dispose(); }
    }
}
