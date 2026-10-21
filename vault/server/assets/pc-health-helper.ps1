<#
.SYNOPSIS
  Vault PC Health helper. READ-ONLY by default: it looks at this PC and sends a report to your Vault. Unless you start it with
  -AllowCleanup it never deletes, moves, renames, edits, compresses or cleans anything, and it writes no files.

.DESCRIPTION
  Run this on the PC you want checked (Windows PowerShell 5.1 or later). It asks your Vault, every 30 seconds, whether you have
  pressed "Run a scan" on the PC Health page. When you have, it measures:
    - disk space per drive, memory and processor use, and which programs use the most of each
    - the largest files, the biggest folders, log files, crash dumps, temp/cache folders and other things left behind
  and posts the result to your Vault only. The scanning part only uses Get-CimInstance, Get-Process, read-only .NET directory
  listings and one HTTPS call to the server you give it.

  SAFE CLEAN-UP (off unless you add -AllowCleanup): when you have switched items on and confirmed them on the PC Health page, the
  helper can empty four rebuildable folders and nothing else: your Temp folder (files older than a day), and the npm, pip and Yarn
  download caches. The locations are written in this script (Vault only sends which of the four names to clean, never a path), it
  refuses any location that is not exactly the expected one, never follows shortcuts or junctions, skips anything in use, and
  reports what it removed. Look for the section marked SAFE CLEAN-UP below; nothing outside it can delete anything.

.PARAMETER Server  Your Vault address, e.g. https://vault.curam-ai.com.au
.PARAMETER Token   The helper token from the PC Health page (or set the PC_HEALTH_TOKEN environment variable instead).
.PARAMETER Once    Check for a waiting scan once and stop (instead of waiting for scans).
.PARAMETER Interval  Seconds between checks (default 30).
.PARAMETER AllowCleanup  Let this helper carry out the Safe clean-up you request in Vault. Without it nothing is ever deleted.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\pc-health-helper.ps1 -Server https://vault.curam-ai.com.au -Token <token>
#>
param(
  [Parameter(Mandatory = $true)][string]$Server,
  [string]$Token = $env:PC_HEALTH_TOKEN,
  [switch]$Once,
  [switch]$AllowCleanup,
  [ValidateRange(10, 600)][int]$Interval = 30
)

$HelperVersion = '1.1'
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

if (-not $Token) { Write-Host 'No token. Pass -Token or set PC_HEALTH_TOKEN.'; exit 2 }
$Server = $Server.TrimEnd('/')
if ($Server -notmatch '^https://' -and $Server -notmatch '^http://(localhost|127\.0\.0\.1)(:\d+)?$') {
  Write-Host 'The server address must start with https:// (http:// is only allowed for localhost).'; exit 2
}
$Headers = @{ Authorization = "Bearer $Token" }

function Send-Json($path, $body) {
  $json = if ($null -eq $body) { '{}' } else { $body | ConvertTo-Json -Depth 8 -Compress }
  Invoke-RestMethod -Method Post -Uri "$Server$path" -Headers $Headers -ContentType 'application/json; charset=utf-8' `
    -Body ([System.Text.Encoding]::UTF8.GetBytes($json)) -TimeoutSec 120
}

function Get-DirBytes([string]$path, [datetime]$deadline) {
  # Total size of everything under a folder (read-only listing). Returns 0 if it cannot be read.
  if (-not (Test-Path -LiteralPath $path -ErrorAction SilentlyContinue)) { return 0 }
  [double]$total = 0
  $stack = New-Object System.Collections.Generic.Stack[string]
  $stack.Push($path)
  while ($stack.Count -gt 0) {
    if ([datetime]::UtcNow -gt $deadline) { break }
    $dir = $stack.Pop()
    try {
      $di = New-Object System.IO.DirectoryInfo $dir
      foreach ($f in $di.EnumerateFiles()) { $total += $f.Length }
      foreach ($s in $di.EnumerateDirectories()) {
        if (-not ($s.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) { $stack.Push($s.FullName) }
      }
    } catch { }
  }
  return $total
}

function Get-Machine {
  $os = Get-CimInstance Win32_OperatingSystem
  $cpu = @(Get-CimInstance Win32_Processor)
  $load = ($cpu | Measure-Object -Property LoadPercentage -Average).Average
  [pscustomobject]@{
    hostname    = $env:COMPUTERNAME
    os          = "$($os.Caption) $($os.Version)"
    cpuName     = ($cpu[0].Name -replace '\s+', ' ').Trim()
    cores       = [int](($cpu | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum)
    cpuLoadPct  = [math]::Round([double]$load, 1)
    ramTotalMB  = [math]::Round($os.TotalVisibleMemorySize / 1024)
    ramFreeMB   = [math]::Round($os.FreePhysicalMemory / 1024)
    uptimeHours = [math]::Round(((Get-Date) - $os.LastBootUpTime).TotalHours, 1)
  }
}

function Get-Drives {
  @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    [pscustomobject]@{ name = $_.DeviceID; label = [string]$_.VolumeName; sizeGB = [math]::Round($_.Size / 1GB, 1); freeGB = [math]::Round($_.FreeSpace / 1GB, 1) }
  })
}

function Get-Procs([int]$cores) {
  # Two samples a few seconds apart: processor use per program name; memory is the working set now.
  $snap = {
    $h = @{}
    foreach ($p in (Get-Process)) {
      $cpu = 0.0; if ($null -ne $p.CPU) { $cpu = [double]$p.CPU }
      $h[$p.Id] = @{ Name = $p.ProcessName; Cpu = $cpu; Ram = [double]$p.WorkingSet64 }
    }
    $h
  }
  $a = & $snap; $sec = 5; Start-Sleep -Seconds $sec; $b = & $snap
  $byName = @{}
  foreach ($id in $b.Keys) {
    $n = $b[$id].Name
    if (-not $byName.ContainsKey($n)) { $byName[$n] = @{ count = 0; cpuSec = 0.0; ram = 0.0 } }
    $byName[$n].count += 1
    $byName[$n].ram += $b[$id].Ram
    if ($a.ContainsKey($id)) { $byName[$n].cpuSec += [math]::Max(0, $b[$id].Cpu - $a[$id].Cpu) }
  }
  $rows = foreach ($n in $byName.Keys) {
    [pscustomobject]@{
      name = $n; count = $byName[$n].count
      cpuPct = [math]::Round(($byName[$n].cpuSec / ($sec * [math]::Max(1, $cores))) * 100, 1)
      ramMB = [math]::Round($byName[$n].ram / 1MB)
    }
  }
  $topRam = $rows | Sort-Object ramMB -Descending | Select-Object -First 25
  $topCpu = $rows | Sort-Object cpuPct -Descending | Select-Object -First 15
  @(@($topRam) + @($topCpu) | Sort-Object name -Unique | Sort-Object ramMB -Descending)
}

function Get-StandardRoots {
  $roots = @($env:USERPROFILE, 'C:\Users\Public', 'C:\ProgramData', "$env:SystemRoot\Temp", "$env:SystemRoot\Logs", "$env:SystemRoot\Minidump")
  $roots | Where-Object { $_ -and (Test-Path -LiteralPath $_ -ErrorAction SilentlyContinue) } | Select-Object -Unique
}

function Remove-NestedRoots([string[]]$roots) {
  # Drop a root that sits inside another one, so nothing is counted twice.
  $clean = @($roots | ForEach-Object { $_.TrimEnd('\') } | Select-Object -Unique)
  @($clean | Where-Object { $r = $_; -not ($clean | Where-Object { $_ -ne $r -and $r.StartsWith($_ + '\', [StringComparison]::OrdinalIgnoreCase) }) })
}

function Invoke-Walk([string[]]$roots, [double]$largeBytes, [datetime]$deadline) {
  $sizes = @{}
  $large = New-Object System.Collections.Generic.List[object]
  $logFiles = New-Object System.Collections.Generic.List[object]
  $left = New-Object System.Collections.Generic.List[object]
  [double]$logTotal = 0; [long]$logCount = 0; [long]$files = 0; [long]$skipped = 0; $truncated = $false
  $logExt = @{ '.log' = 1; '.etl' = 1; '.trace' = 1 }
  $installExt = @{ '.exe' = 'installer'; '.msi' = 'installer'; '.iso' = 'disk-image'; '.img' = 'disk-image'; '.vhd' = 'disk-image'; '.vhdx' = 'disk-image' }
  foreach ($root in $roots) {
    $stack = New-Object System.Collections.Generic.Stack[object]
    $stack.Push(@{ Dir = $root; Up = @($root); Depth = 0 })
    while ($stack.Count -gt 0) {
      if ([datetime]::UtcNow -gt $deadline) { $truncated = $true; break }
      $f = $stack.Pop()
      try {
        $di = New-Object System.IO.DirectoryInfo $f.Dir
        $inDownloads = $f.Dir -like '*\Downloads*'
        foreach ($file in $di.EnumerateFiles()) {
          $len = [double]$file.Length; $files++
          foreach ($k in $f.Up) { $sizes[$k] = [double]$sizes[$k] + $len }
          $ext = $file.Extension.ToLowerInvariant()
          if ($len -ge $largeBytes) {
            $large.Add([pscustomobject]@{ path = $file.FullName; sizeMB = [math]::Round($len / 1MB, 1); modified = $file.LastWriteTimeUtc.ToString('o') })
          }
          if ($logExt.ContainsKey($ext)) {
            $logTotal += $len; $logCount++
            if ($len -ge 1MB) { $logFiles.Add([pscustomobject]@{ path = $file.FullName; sizeMB = [math]::Round($len / 1MB, 1); modified = $file.LastWriteTimeUtc.ToString('o') }) }
          } elseif ($ext -eq '.dmp' -and $len -ge 1MB) {
            $left.Add([pscustomobject]@{ kind = 'crash-dump'; path = $file.FullName; sizeMB = [math]::Round($len / 1MB, 1); note = 'Memory or crash dump written by Windows or a program.' })
          } elseif ($inDownloads -and $installExt.ContainsKey($ext) -and $len -ge 50MB) {
            $left.Add([pscustomobject]@{ kind = $installExt[$ext]; path = $file.FullName; sizeMB = [math]::Round($len / 1MB, 1); note = 'In a Downloads folder; often no longer needed once installed.' })
          }
        }
        foreach ($sub in $di.EnumerateDirectories()) {
          if ($sub.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
          $up = $f.Up
          if ($f.Depth -lt 3) { $up = @($f.Up) + $sub.FullName }
          $stack.Push(@{ Dir = $sub.FullName; Up = $up; Depth = $f.Depth + 1 })
        }
      } catch { $skipped++ }
    }
  }
  $folders = $sizes.GetEnumerator() | Sort-Object { $_.Value } -Descending | Select-Object -First 300 |
    ForEach-Object { [pscustomobject]@{ path = $_.Key; sizeMB = [math]::Round($_.Value / 1MB, 1) } }
  [pscustomobject]@{
    large = @($large | Sort-Object sizeMB -Descending | Select-Object -First 200)
    folders = @($folders)
    logs = [pscustomobject]@{ totalMB = [math]::Round($logTotal / 1MB, 1); count = $logCount; files = @($logFiles | Sort-Object sizeMB -Descending | Select-Object -First 200) }
    leftovers = @($left | Sort-Object sizeMB -Descending | Select-Object -First 100)
    files = $files; skipped = $skipped; truncated = $truncated
  }
}

function Get-KnownPlaces([datetime]$deadline) {
  $places = @(
    @{ kind = 'temp'; path = $env:TEMP; note = 'Your temporary files folder.' },
    @{ kind = 'temp'; path = "$env:SystemRoot\Temp"; note = 'Windows temporary files.' },
    @{ kind = 'old-windows'; path = "$env:SystemDrive\Windows.old"; note = 'Left by a Windows upgrade; Windows removes it by itself after about a month.' },
    @{ kind = 'cache'; path = "$env:SystemRoot\SoftwareDistribution\Download"; note = 'Windows Update downloads.' },
    @{ kind = 'recycle-bin'; path = "$env:SystemDrive\`$Recycle.Bin"; note = 'Deleted files not yet emptied. May be undercounted: other accounts'' bins are not readable.' },
    @{ kind = 'crash-dump'; path = "$env:LOCALAPPDATA\CrashDumps"; note = 'Program crash dumps.' },
    @{ kind = 'crash-dump'; path = "$env:ProgramData\Microsoft\Windows\WER"; note = 'Windows error reports.' },
    @{ kind = 'package-cache'; path = "$env:LOCALAPPDATA\npm-cache"; note = 'npm download cache.' },
    @{ kind = 'package-cache'; path = "$env:LOCALAPPDATA\pip\Cache"; note = 'pip download cache.' },
    @{ kind = 'package-cache'; path = "$env:LOCALAPPDATA\Yarn\Cache"; note = 'Yarn download cache.' },
    @{ kind = 'package-cache'; path = "$env:USERPROFILE\.nuget\packages"; note = 'NuGet package cache.' },
    @{ kind = 'cache'; path = "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache"; note = 'Chrome browser cache.' },
    @{ kind = 'cache'; path = "$env:LOCALAPPDATA\Microsoft\Edge\User Data\Default\Cache"; note = 'Edge browser cache.' }
  )
  $found = foreach ($p in $places) {
    if (-not $p.path) { continue }
    $b = Get-DirBytes $p.path $deadline
    if ($b -ge 50MB) { [pscustomobject]@{ kind = $p.kind; path = $p.path; sizeMB = [math]::Round($b / 1MB, 1); note = $p.note } }
  }
  foreach ($sys in @("$env:SystemDrive\hiberfil.sys", "$env:SystemDrive\pagefile.sys", "$env:SystemDrive\swapfile.sys", "$env:SystemRoot\MEMORY.DMP")) {
    $item = Get-Item -LiteralPath $sys -Force -ErrorAction SilentlyContinue
    if ($item -and $item.Length -ge 50MB) {
      $found += [pscustomobject]@{ kind = 'system-file'; path = $sys; sizeMB = [math]::Round($item.Length / 1MB, 1); note = 'Managed by Windows (hibernation, virtual memory or a crash dump).' }
    }
  }
  @($found)
}

function Invoke-Scan($options) {
  $started = Get-Date
  $minutes = [math]::Min(30, [math]::Max(1, [int]$options.minutes))
  $deadline = [datetime]::UtcNow.AddMinutes($minutes)
  $largeBytes = [math]::Min(5000, [math]::Max(50, [int]$options.largeFileMB)) * 1MB

  $machine = Get-Machine
  $drives = @(Get-Drives)
  $procs = @(Get-Procs $machine.cores)

  if ($options.wholeDrive) { $roots = @("$env:SystemDrive\") }
  elseif ($options.roots -and @($options.roots).Count -gt 0) {
    # Only folders that exist on a local drive; anything else the server sent is ignored.
    $roots = @($options.roots | Where-Object { $_ -match '^[A-Za-z]:\\' -and (Test-Path -LiteralPath $_ -PathType Container -ErrorAction SilentlyContinue) })
  } else { $roots = @(Get-StandardRoots) }
  $roots = @(Remove-NestedRoots $roots)

  $walk = Invoke-Walk $roots $largeBytes $deadline
  $known = Get-KnownPlaces $deadline
  $leftovers = @(@($known) + @($walk.leftovers) | Where-Object { $_ })

  [pscustomobject]@{
    helperVersion = $HelperVersion
    machine = $machine
    drives = $drives
    processes = $procs
    largeFiles = $walk.large
    folders = $walk.folders
    logs = $walk.logs
    leftovers = $leftovers
    scan = [pscustomobject]@{ roots = $roots; seconds = [int]((Get-Date) - $started).TotalSeconds; truncated = [bool]$walk.truncated; skipped = $walk.skipped; filesSeen = $walk.files }
  }
}

# ==== BEGIN SAFE CLEAN-UP ====================================================================================================
# The ONLY code in this script that deletes anything. It runs only when the helper was started with -AllowCleanup, only for the four
# names below, and only on the locations written here (never a path from Vault). Files are removed one by one with .NET's File.Delete
# (no recursive delete, so a junction can never be followed into another folder), empty folders with Directory.Delete(path, $false).
function Get-CleanTargets {
  $local = $env:LOCALAPPDATA
  @{
    'temp-user'  = @{ Root = $env:TEMP;                         MinAgeDays = 1; Expect = '^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp$' }
    'npm-cache'  = @{ Root = (Join-Path $local 'npm-cache');    MinAgeDays = 0; Expect = '^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\npm-cache$' }
    'pip-cache'  = @{ Root = (Join-Path $local 'pip\Cache');    MinAgeDays = 0; Expect = '^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\pip\\Cache$' }
    'yarn-cache' = @{ Root = (Join-Path $local 'Yarn\Cache');   MinAgeDays = 0; Expect = '^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Yarn\\Cache$' }
  }
}

function Clear-OneFolder([string]$root, [double]$minAgeDays) {
  $cutoff = (Get-Date).AddDays(-$minAgeDays)
  [double]$freed = 0; [long]$removed = 0; [long]$skipped = 0
  $dirs = New-Object System.Collections.Generic.List[string]
  $stack = New-Object System.Collections.Generic.Stack[string]
  $stack.Push($root)
  while ($stack.Count -gt 0) {
    $dir = $stack.Pop(); $dirs.Add($dir)
    try {
      $di = New-Object System.IO.DirectoryInfo $dir
      foreach ($f in $di.EnumerateFiles()) {
        # a link is never followed or removed; a file changed more recently than the cutoff is left alone
        if (($f.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or $f.LastWriteTime -gt $cutoff) { $skipped++; continue }
        try { $len = [double]$f.Length; [System.IO.File]::Delete($f.FullName); $freed += $len; $removed++ } catch { $skipped++ }
      }
      foreach ($s in $di.EnumerateDirectories()) {
        if ($s.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { $skipped++; continue }
        $stack.Push($s.FullName)
      }
    } catch { $skipped++ }
  }
  # now-empty folders, deepest first, never the root itself; Directory.Delete(path, $false) refuses a folder that still has anything in it
  for ($i = $dirs.Count - 1; $i -ge 1; $i--) {
    try { if ((New-Object System.IO.DirectoryInfo $dirs[$i]).CreationTime -le $cutoff) { [System.IO.Directory]::Delete($dirs[$i], $false) } } catch { }
  }
  [pscustomobject]@{ freedMB = [math]::Round($freed / 1MB, 1); filesRemoved = $removed; skipped = $skipped }
}

function Invoke-Cleanup($items) {
  $targets = Get-CleanTargets
  $results = foreach ($id in @($items)) {
    $t = $targets[[string]$id]
    if (-not $t) { [pscustomobject]@{ id = [string]$id; ok = $false; freedMB = 0; filesRemoved = 0; skipped = 0; note = 'Not on this helper''s list, so it was ignored.' }; continue }
    try {
      $full = [System.IO.Path]::GetFullPath([string]$t.Root).TrimEnd('\')
      if ($full -notmatch $t.Expect) { [pscustomobject]@{ id = [string]$id; ok = $false; freedMB = 0; filesRemoved = 0; skipped = 0; note = "Refused: $full is not the expected location."}; continue }
      if (-not (Test-Path -LiteralPath $full -PathType Container)) { [pscustomobject]@{ id = [string]$id; ok = $true; freedMB = 0; filesRemoved = 0; skipped = 0; note = 'Folder not found, nothing to clean.' }; continue }
      if ((Get-Item -LiteralPath $full -Force).Attributes -band [System.IO.FileAttributes]::ReparsePoint) { [pscustomobject]@{ id = [string]$id; ok = $false; freedMB = 0; filesRemoved = 0; skipped = 0; note = 'Refused: the folder is a link.' }; continue }
      $r = Clear-OneFolder $full ([double]$t.MinAgeDays)
      [pscustomobject]@{ id = [string]$id; ok = $true; freedMB = $r.freedMB; filesRemoved = $r.filesRemoved; skipped = $r.skipped; note = $(if ($r.skipped -gt 0) { 'Some items were in use or too new and were left alone.' } else { '' }) }
    } catch {
      [pscustomobject]@{ id = [string]$id; ok = $false; freedMB = 0; filesRemoved = 0; skipped = 0; note = [string]$_.Exception.Message }
    }
  }
  [pscustomobject]@{ results = @($results) }
}
# ==== END SAFE CLEAN-UP ======================================================================================================

Write-Host "Vault PC Health helper $HelperVersion ($(if ($AllowCleanup) { 'READ-ONLY scans; Safe clean-up ALLOWED' } else { 'read-only' })). Server: $Server"
do {
  try {
    $reply = Send-Json '/api/pc-helper/poll' @{ helperVersion = $HelperVersion; hostname = $env:COMPUTERNAME; canClean = [bool]$AllowCleanup }
    if ($reply.cleanup -and $AllowCleanup) {
      Write-Host "$(Get-Date -Format T) Clean-up $($reply.cleanup.id) confirmed in Vault: $(@($reply.cleanup.items) -join ', ')"
      try {
        $out = Invoke-Cleanup $reply.cleanup.items
        $null = Send-Json "/api/pc-helper/cleanups/$($reply.cleanup.id)/result" $out
        Write-Host "$(Get-Date -Format T) Clean-up done: $([math]::Round((@($out.results) | Measure-Object -Property freedMB -Sum).Sum, 1)) MB removed."
      } catch {
        Write-Host "Clean-up failed: $($_.Exception.Message)"
        try { $null = Send-Json "/api/pc-helper/cleanups/$($reply.cleanup.id)/fail" @{ error = [string]$_.Exception.Message } } catch { }
      }
    }
    if ($reply.scan) {
      Write-Host "$(Get-Date -Format T) Scan $($reply.scan.id) requested. Looking at this PC (nothing will be changed)..."
      try {
        $report = Invoke-Scan $reply.scan.options
        $null = Send-Json "/api/pc-helper/scans/$($reply.scan.id)/report" $report
        Write-Host "$(Get-Date -Format T) Report sent. Open PC Health in Vault to read it."
      } catch {
        Write-Host "Scan failed: $($_.Exception.Message)"
        try { $null = Send-Json "/api/pc-helper/scans/$($reply.scan.id)/fail" @{ error = [string]$_.Exception.Message } } catch { }
      }
    }
  } catch {
    Write-Host "$(Get-Date -Format T) Could not reach Vault: $($_.Exception.Message)"
  }
  if (-not $Once) { Start-Sleep -Seconds $Interval }
} while (-not $Once)
