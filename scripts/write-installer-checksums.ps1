param(
  [string]$InstallerDirectory
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\tooling.ps1"

$repoRoot = Get-RepoRoot
if ([string]::IsNullOrWhiteSpace($InstallerDirectory)) {
  $InstallerDirectory = Join-Path $repoRoot "src-tauri\target\release\bundle\nsis"
} elseif (-not [IO.Path]::IsPathRooted($InstallerDirectory)) {
  $InstallerDirectory = Join-Path $repoRoot $InstallerDirectory
}

$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$tauriConfig = Get-Content -LiteralPath (Join-Path $repoRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$productName = [string]$tauriConfig.productName
if ([string]::IsNullOrWhiteSpace($version) -or [string]::IsNullOrWhiteSpace($productName)) {
  throw "Could not determine the expected installer name from package.json and tauri.conf.json."
}
$expectedInstallerName = "${productName}_${version}_x64-setup.exe"

$resolvedInstallerDirectory = (Resolve-Path -LiteralPath $InstallerDirectory -ErrorAction Stop).Path
$installers = @(
  Get-ChildItem -LiteralPath $resolvedInstallerDirectory -Filter "*.exe" -File -ErrorAction Stop
)

if ($installers.Count -ne 1 -or $installers[0].Name -ne $expectedInstallerName) {
  $foundNames = if ($installers.Count -eq 0) {
    "<none>"
  } else {
    ($installers.Name -join ", ")
  }
  throw "Expected only $expectedInstallerName in $resolvedInstallerDirectory, found: $foundNames. Remove stale installer artifacts and rebuild."
}

$installer = $installers[0]
$checksumPath = "$($installer.FullName).sha256"
$staleChecksums = @(
  Get-ChildItem -LiteralPath $resolvedInstallerDirectory -Filter "*.sha256" -File -ErrorAction Stop |
    Where-Object FullName -ne $checksumPath
)
if ($staleChecksums.Count -gt 0) {
  throw "Stale installer checksum file(s) found: $($staleChecksums.Name -join ', '). Remove them before release verification."
}

$ascii = [Text.ASCIIEncoding]::new()
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName).Hash.ToLowerInvariant()
$checksumLine = "$hash  $($installer.Name)`n"
[IO.File]::WriteAllText($checksumPath, $checksumLine, $ascii)
Write-Host "Wrote $checksumPath"
