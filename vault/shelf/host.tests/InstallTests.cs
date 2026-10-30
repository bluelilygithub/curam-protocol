using Microsoft.Win32;
using VaultShelf.Host.Install;
using Xunit;

namespace VaultShelf.Host.Tests;

public class ProtocolUrlTests
{
    [Theory]
    [InlineData("vault-shelf://open")]
    [InlineData("vault-shelf://open/")]
    [InlineData("VAULT-SHELF://OPEN")]
    [InlineData("  vault-shelf://open  ")]
    public void The_one_request_that_is_allowed(string url) => Assert.True(ProtocolUrl.IsOpenRequest(url));

    [Theory]
    [InlineData(null)] [InlineData("")] [InlineData("   ")]
    [InlineData("vault-shelf://open?x=1")]
    [InlineData("vault-shelf://open#frag")]
    [InlineData("vault-shelf://open/evil")]
    [InlineData("vault-shelf://open/../x")]
    [InlineData("vault-shelf://open:80")]
    [InlineData("vault-shelf://user@open")]
    [InlineData("vault-shelf://opener")]
    [InlineData("vault-shelf://settings")]
    [InlineData("vault-shelf:open")]
    [InlineData("vault-shelf:///open")]
    [InlineData("vault-shelf://open%00")]
    [InlineData("vault-shelf://open\" --dist \"C:\\evil")]
    [InlineData("vault-shelf://open --register")]
    [InlineData("https://open")]
    [InlineData("file:///C:/Windows/System32/calc.exe")]
    [InlineData("open")]
    public void Anything_else_is_ignored(string? url) => Assert.False(ProtocolUrl.IsOpenRequest(url));

    [Fact]
    public void A_very_long_link_is_ignored() => Assert.False(ProtocolUrl.IsOpenRequest("vault-shelf://open" + new string('/', 5000)));

    [Fact]
    public void Starting_with_a_link_or_for_install_needs_no_page_and_reads_the_flags()
    {
        var o = Options.Parse(new[] { "--open", "vault-shelf://open", "--dist", "C:\\x" });
        Assert.Equal("vault-shelf://open", o.OpenUrl); Assert.False(o.Register); Assert.False(o.Unregister);
        var r = Options.Parse(new[] { "--register" });                     // no --dist and no built page next to the test: must not throw
        Assert.True(r.Register);
        var u = Options.Parse(new[] { "--unregister", "--silent", "--purge" });
        Assert.True(u.Unregister && u.Silent && u.Purge);
        Assert.Throws<IndexOutOfRangeException>(() => Options.Parse(new[] { "--open" }));   // a link with nothing after it is a reported error, not a guess
    }
}

public class OpenSignalTests
{
    [Fact]
    public void A_second_start_can_ask_the_running_copy_to_open_and_nothing_travels_with_the_request()
    {
        string name = "Local\\VaultShelf.Test." + Guid.NewGuid().ToString("N");
        var got = new SemaphoreSlim(0);
        using (OpenSignal.Listen(name, () => got.Release()))
        {
            Assert.True(OpenSignal.Raise(name));
            Assert.True(got.Wait(3000), "the running copy was asked");
            Assert.True(OpenSignal.Raise(name)); Assert.True(got.Wait(3000), "and again");
        }
    }

    [Fact]
    public void With_no_running_copy_the_request_says_so() => Assert.False(OpenSignal.Raise("Local\\VaultShelf.Test.Nobody." + Guid.NewGuid().ToString("N")));

    [Fact]
    public void A_failing_handler_does_not_stop_later_requests()
    {
        string name = "Local\\VaultShelf.Test." + Guid.NewGuid().ToString("N");
        int calls = 0; var second = new SemaphoreSlim(0);
        using (OpenSignal.Listen(name, () => { if (Interlocked.Increment(ref calls) == 1) throw new InvalidOperationException("boom"); second.Release(); }))
        {
            OpenSignal.Raise(name); Thread.Sleep(300);
            OpenSignal.Raise(name);
            Assert.True(second.Wait(3000));
        }
    }
}

public class RegistrationTests : IDisposable
{
    private readonly string _root = @"Software\VaultShelf.Test\" + Guid.NewGuid().ToString("N");
    private readonly TempRoot _temp = new();
    private readonly string _startMenu;
    private readonly string _installDir;

    public RegistrationTests()
    {
        _startMenu = Path.Combine(_temp.Path, "Start Menu");
        _installDir = Path.Combine(_temp.Path, "Vault's Shelf (test)");     // spaces and an apostrophe on purpose
        Directory.CreateDirectory(Path.Combine(_installDir, "shelf"));
        File.WriteAllText(Path.Combine(_installDir, "VaultShelf.exe"), "x");
        File.WriteAllText(Path.Combine(_installDir, "shelf", "index.html"), "x");
    }
    private Registration Make() => new(_root + @"\Classes", _root + @"\Uninstall", _startMenu);
    private string Exe => Path.Combine(_installDir, "VaultShelf.exe");
    public void Dispose() { Registry.CurrentUser.DeleteSubKeyTree(_root.Substring(0, _root.LastIndexOf('\\')), false); _temp.Dispose(); }

    [Fact]
    public void Register_writes_the_link_handler_the_apps_list_entry_and_the_shortcut()
    {
        Sta.Run(() =>
        {
            var r = Make(); r.Register(Exe, "1.2.3");
            Assert.Equal($"\"{Exe}\" --open \"%1\"", r.RegisteredOpenCommand());
            using (var link = Registry.CurrentUser.OpenSubKey(_root + @"\Classes\vault-shelf"))
            {
                Assert.Equal("URL:Vault Shelf", link!.GetValue("")); Assert.Equal("", link.GetValue("URL Protocol"));
            }
            using (var u = Registry.CurrentUser.OpenSubKey(_root + @"\Uninstall\VaultShelf"))
            {
                Assert.Equal("Vault Shelf", u!.GetValue("DisplayName")); Assert.Equal("1.2.3", u.GetValue("DisplayVersion"));
                Assert.Equal(_installDir, u.GetValue("InstallLocation")); Assert.Equal($"\"{Exe}\" --unregister", u.GetValue("UninstallString"));
                Assert.Equal($"\"{Exe}\" --unregister --silent", u.GetValue("QuietUninstallString"));
                Assert.Equal(1, u.GetValue("NoModify"));
            }
            Assert.Equal(_installDir, r.InstalledLocation());
            Assert.True(File.Exists(r.ShortcutPath));
        });
    }

    [Fact]
    public void Registering_again_updates_it_and_never_duplicates()
    {
        Sta.Run(() =>
        {
            var r = Make(); r.Register(Exe, "1.0.0"); r.Register(Exe, "1.1.0");
            using var u = Registry.CurrentUser.OpenSubKey(_root + @"\Uninstall\VaultShelf");
            Assert.Equal("1.1.0", u!.GetValue("DisplayVersion"));
            Assert.Single(Directory.GetFiles(_startMenu));
        });
    }

    [Fact]
    public void Unregister_removes_everything_it_added_and_nothing_else_and_can_run_twice()
    {
        Sta.Run(() =>
        {
            using (var other = Registry.CurrentUser.CreateSubKey(_root + @"\Classes\someone-else")) other.SetValue("", "keep");
            var r = Make(); Directory.CreateDirectory(_startMenu); File.WriteAllText(Path.Combine(_startMenu, "Other.lnk"), "x");
            r.Register(Exe, "1.0.0");
            r.Unregister();
            Assert.Null(r.RegisteredOpenCommand()); Assert.Null(r.InstalledLocation()); Assert.False(File.Exists(r.ShortcutPath));
            Assert.True(File.Exists(Path.Combine(_startMenu, "Other.lnk")), "another program's shortcut is untouched");
            using (var keep = Registry.CurrentUser.OpenSubKey(_root + @"\Classes\someone-else")) Assert.Equal("keep", keep!.GetValue(""));
            r.Unregister();                                                  // nothing left: still fine
            Assert.True(Directory.Exists(_installDir), "unregistering does not delete files: that is a separate, stricter step");
        });
    }

    [Fact]
    public void A_program_that_is_not_there_is_refused()
    {
        Sta.Run(() => Assert.Throws<FileNotFoundException>(() => Make().Register(Path.Combine(_installDir, "Nope.exe"), "1.0.0")));
        Assert.Null(Make().RegisteredOpenCommand());
    }

    [Fact]
    public void The_folder_may_only_be_deleted_when_it_is_exactly_the_recorded_one_and_really_the_program()
    {
        bool strayProject = Directory.EnumerateFiles(Path.GetTempPath(), "*.csproj").Any() || Directory.Exists(Path.Combine(Path.GetTempPath(), ".git"));
        if (!strayProject) Assert.True(UninstallPlan.MayDelete(_installDir, _installDir), "the installed folder, as recorded");
        Assert.True(!UninstallPlan.MayDelete(_installDir, _installDir + "x"));
        Assert.False(UninstallPlan.MayDelete(_installDir, null), "never registered: do not delete");
        Assert.False(UninstallPlan.MayDelete(null, _installDir));
        Assert.False(UninstallPlan.MayDelete(_installDir, Path.GetDirectoryName(_installDir)), "a different folder than the one running");
        Assert.False(UninstallPlan.MayDelete(Path.GetPathRoot(_installDir), Path.GetPathRoot(_installDir)), "never a drive root");
        Assert.False(UninstallPlan.MayDelete(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)), "never a profile");
        string notProgram = Path.Combine(_temp.Path, "NotTheProgram"); Directory.CreateDirectory(notProgram);
        Assert.False(UninstallPlan.MayDelete(notProgram, notProgram), "a folder without the program's files");
        string tree = Path.Combine(_temp.Path, "src"); Directory.CreateDirectory(Path.Combine(tree, "bin", "shelf")); File.WriteAllText(Path.Combine(tree, "App.csproj"), "<Project/>");
        File.WriteAllText(Path.Combine(tree, "bin", "VaultShelf.exe"), "x"); File.WriteAllText(Path.Combine(tree, "bin", "shelf", "index.html"), "x");
        Assert.False(UninstallPlan.MayDelete(Path.Combine(tree, "bin"), Path.Combine(tree, "bin")), "a source tree is never deleted");
    }
}

public class UninstallCommandTests
{
    [Fact]
    public void The_delete_command_keeps_a_path_with_spaces_in_one_piece()
    {
        string line = InstallCommands.DeleteCommandLine(@"C:\Users\Tom & Jerry\AppData\Local\Programs\Vault Shelf");
        // whole command in one pair of quotes, the folder in its own: what cmd.exe /c needs
        Assert.Equal(@"/c ""ping 127.0.0.1 -n 4 >nul & rmdir /s /q ""C:\Users\Tom & Jerry\AppData\Local\Programs\Vault Shelf"""" ", line.TrimEnd() + " ");
    }

    [Fact]
    public void The_delete_command_really_removes_a_folder_with_spaces_after_a_short_wait()
    {
        using var root = new TempRoot();
        string dir = Path.Combine(root.Path, "Vault Shelf (to delete)"); Directory.CreateDirectory(Path.Combine(dir, "shelf")); File.WriteAllText(Path.Combine(dir, "shelf", "a.txt"), "x");
        string neighbour = Path.Combine(root.Path, "neighbour.txt"); File.WriteAllText(neighbour, "keep");
        var psi = InstallCommands.DeleteStartInfo(dir);
        Assert.False(psi.WorkingDirectory.StartsWith(dir, StringComparison.OrdinalIgnoreCase), "the helper must not sit inside the folder it removes");
        using (var p = System.Diagnostics.Process.Start(psi)!) Assert.True(p.WaitForExit(15000));
        Assert.False(Directory.Exists(dir));
        Assert.True(File.Exists(neighbour), "only the one folder goes");
    }
}
