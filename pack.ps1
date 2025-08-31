Param(
  [string]$OutDir = "."
)

$ErrorActionPreference = "Stop"

# Read version from manifest
$manifest = Get-Content -Raw -Path "manifest.json" | ConvertFrom-Json
$name = "ai-mate"
$version = $manifest.version
if (-not $version) { $version = "0.0.0" }

$dest = Join-Path $OutDir "$name-$version.xpi"
if (Test-Path $dest) { Remove-Item $dest -Force }

# Collect files excluding build artifacts and temp folders
$files = Get-ChildItem -Recurse -File |
  Where-Object {
    $_.FullName -notmatch "\\tmp_unpack(\\|$)" -and
    $_.Name -notmatch "\.xpi$" -and
    $_.FullName -notmatch "\\\.git(\\|$)"
  }

Compress-Archive -Path $files -DestinationPath $dest -Force
Write-Host "Packed -> $dest"

