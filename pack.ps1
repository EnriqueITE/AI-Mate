Param(
  [string]$OutDir = "."
)

$ErrorActionPreference = "Stop"

# Read version from manifest
$manifest = Get-Content -Raw -Path "manifest.json" | ConvertFrom-Json
$name = "ai-mate"
$version = $manifest.version
if (-not $version) { $version = "0.0.0" }

$destZip = Join-Path $OutDir "$name-$version.zip"
$destXpi = Join-Path $OutDir "$name-$version.xpi"
if (Test-Path $destZip) { Remove-Item $destZip -Force }
if (Test-Path $destXpi) { Remove-Item $destXpi -Force }

# Stage files to preserve folder structure while excluding build artefacts
$tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ("ai-mate-pack-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmpDir | Out-Null

$items = Get-ChildItem -Force | Where-Object {
  $_.Name -notmatch '^\.git$' -and
  $_.Name -notmatch '^_tmp' -and
  $_.Name -notmatch '^ai-mate-\d+\.\d+\.\d+\.xpi$' -and
  $_.Name -notmatch '^ai-mate-\d+\.\d+\.\d+\.zip$'
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
Rename-Item -Path $destZip -NewName $destXpi
Write-Host "Packed -> $destXpi"
