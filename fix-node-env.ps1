Write-Host ""
Write-Host "=== Node Environment Fix Script ===" -ForegroundColor Cyan

Write-Host ""
Write-Host "[1] Scanning HKCU\Environment..." -ForegroundColor Yellow
$hkcuPath = "HKCU:\Environment"
$badKeys = @("npm_config_shell", "SHELL", "npm_config_script_shell")
$foundAny = $false

foreach ($key in $badKeys) {
    $val = (Get-ItemProperty -Path $hkcuPath -Name $key -ErrorAction SilentlyContinue).$key
    if ($val) {
        Write-Host "  FOUND: $key = $val" -ForegroundColor Red
        $foundAny = $true
        $confirm = Read-Host "  Delete this entry? (y/n)"
        if ($confirm -eq "y") {
            Remove-ItemProperty -Path $hkcuPath -Name $key -ErrorAction SilentlyContinue
            Write-Host "  Deleted $key" -ForegroundColor Green
        }
    } else {
        Write-Host "  OK: $key not set" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[2] Scanning HKLM System environment..." -ForegroundColor Yellow
$hklmPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"

foreach ($key in $badKeys) {
    $val = (Get-ItemProperty -Path $hklmPath -Name $key -ErrorAction SilentlyContinue).$key
    if ($val) {
        Write-Host "  FOUND: $key = $val" -ForegroundColor Red
        Write-Host "  (Requires admin to delete - run PowerShell as Administrator)" -ForegroundColor Yellow
        $foundAny = $true
    } else {
        Write-Host "  OK: $key not set" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "[3] Checking PATH for suspicious entries..." -ForegroundColor Yellow
$userPath = [System.Environment]::GetEnvironmentVariable("PATH", "User")
$sysPath  = [System.Environment]::GetEnvironmentVariable("PATH", "Machine")
$allPaths = ($userPath + ";" + $sysPath) -split ";" | Where-Object { $_ -ne "" }
$suspicious = $allPaths | Where-Object { $_ -match "local.bin" -or $_ -match "scoop" -or $_ -match "pipx" }

if ($suspicious) {
    Write-Host "  Suspicious PATH entries found:" -ForegroundColor Yellow
    $suspicious | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  No suspicious PATH entries found" -ForegroundColor Green
}

Write-Host ""
Write-Host "[4] Node.js status..." -ForegroundColor Yellow
$nodeVer = & node --version 2>&1
$npmVer  = & npm --version 2>&1
Write-Host "  node: $nodeVer" -ForegroundColor Cyan
Write-Host "  npm:  $npmVer" -ForegroundColor Cyan

Write-Host ""
Write-Host "=== Summary ===" -ForegroundColor Cyan
if ($foundAny) {
    Write-Host "Bad registry entries were found." -ForegroundColor Yellow
    Write-Host "NEXT STEP: Restart your PC, then test npm in a fresh Command Prompt." -ForegroundColor White
} else {
    Write-Host "No bad registry entries found." -ForegroundColor Yellow
    Write-Host "NEXT STEP: Uninstall Node.js, then reinstall Node v22 LTS from nodejs.org" -ForegroundColor White
}

Write-Host ""
Read-Host "Press Enter to exit"
