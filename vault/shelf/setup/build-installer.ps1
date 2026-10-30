# Builds shelf/setup/out/VaultShelfSetup.exe: one file that installs Vault Shelf for the person who runs it (no administrator needed).
# Needs the .NET 10 SDK (dotnet on PATH, or DOTNET_ROOT) and Node (for the tray page). Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File vault/shelf/setup/build-installer.ps1
$ErrorActionPreference = 'Stop'
$setup = $PSScriptRoot
$shelf = Split-Path $setup -Parent
$host_ = Join-Path $shelf 'host'
$work = Join-Path $setup 'obj\payload'
$zip = Join-Path $setup 'obj\payload.zip'
$out = Join-Path $setup 'out'

Write-Host '1/4 building the tray page'
Push-Location $shelf; npm run build; if ($LASTEXITCODE) { throw 'page build failed' }; Pop-Location

Write-Host '2/4 publishing the program (self-contained, so the PC needs no .NET)'
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
dotnet publish (Join-Path $host_ 'VaultShelf.Host.csproj') -c Release -r win-x64 --self-contained true -p:PublishReadyToRun=true -o $work
if ($LASTEXITCODE) { throw 'program publish failed' }
if (-not (Test-Path (Join-Path $work 'shelf\index.html'))) { throw 'the tray page was not copied into the publish folder' }
Get-ChildItem $work -Filter *.pdb | Remove-Item -Force

Write-Host '3/4 packing the files'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($work, $zip, [System.IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '4/4 building the installer'
New-Item -ItemType Directory -Force $out | Out-Null
$stage = Join-Path $setup 'obj\setup-publish'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
dotnet publish (Join-Path $setup 'VaultShelf.Setup\VaultShelf.Setup.csproj') -c Release -p:PayloadZip=$zip -o $stage
if ($LASTEXITCODE) { throw 'installer publish failed' }
Copy-Item (Join-Path $stage 'VaultShelfSetup.exe') (Join-Path $out 'VaultShelfSetup.exe') -Force
$f = Get-Item (Join-Path $out 'VaultShelfSetup.exe')
$hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
Write-Host ("Done: {0}  ({1:N1} MB)`nSHA-256: {2}" -f $f.FullName, ($f.Length / 1MB), $hash)
Write-Host 'Not code-signed: Windows SmartScreen will warn on first run ("More info", then "Run anyway") until it is signed with a certificate.'
