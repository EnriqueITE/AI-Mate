Param(
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"

# Read version from manifest
$manifest = Get-Content -Raw -Path "manifest.json" | ConvertFrom-Json
$name = "ai-mate"
$version = $manifest.version
if (-not $version) { $version = "0.0.0" }

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = "dist"
}

$resolvedOutDir = Resolve-Path -Path $OutDir -ErrorAction SilentlyContinue
if (-not $resolvedOutDir) {
  $resolvedOutDir = Join-Path -Path (Get-Location) -ChildPath $OutDir
  if (-not (Test-Path $resolvedOutDir)) {
    New-Item -ItemType Directory -Path $resolvedOutDir | Out-Null
  }
} else {
  $resolvedOutDir = $resolvedOutDir.Path
}

$destZip = Join-Path $resolvedOutDir "$name-$version.zip"
$destXpi = Join-Path $resolvedOutDir "$name-$version.xpi"
if (Test-Path $destZip) { Remove-Item $destZip -Force }
if (Test-Path $destXpi) { Remove-Item $destXpi -Force }

# Stage files to preserve folder structure while excluding build artefacts
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-mate-pack-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmpDir | Out-Null

$excludedPatterns = @(
  "pack.ps1",
  "dist",
  "README.md",
  "*.zip",
  "*.xpi",
  ".DS_Store",
  "Thumbs.db"
)

$items = Get-ChildItem -Force | Where-Object {
  $name = $_.Name
  $isExcluded = $false
  foreach ($pattern in $excludedPatterns) {
    if ($name -like $pattern) {
      $isExcluded = $true
      break
    }
  }

  -not $isExcluded -and
  $name -notmatch '^\.git$' -and
  $name -notmatch '^_tmp' -and
  $name -notmatch '^ai-mate-\d+\.\d+\.\d+\.xpi$' -and
  $name -notmatch '^ai-mate-\d+\.\d+\.\d+\.zip$'
}

foreach ($item in $items) {
  $target = Join-Path $tmpDir $item.Name
  if ($item.PSIsContainer) {
    Copy-Item -Path $item.FullName -Destination $target -Recurse -Force
  } else {
    Copy-Item -Path $item.FullName -Destination $target -Force
  }
}

$sourceItems = Get-ChildItem -Path $tmpDir -Force
if (-not $sourceItems) { throw "Nothing to package." }
Compress-Archive -Path ($sourceItems.FullName) -DestinationPath $destZip -Force

Remove-Item $tmpDir -Recurse -Force
$finalName = Split-Path $destXpi -Leaf
Rename-Item -Path $destZip -NewName $finalName
$finalPath = Join-Path $resolvedOutDir $finalName
Write-Host "Packed -> $finalPath"
