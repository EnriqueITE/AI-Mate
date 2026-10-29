Param(
  [string]$OutDir = "dist"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$manifestPath = Join-Path $sourceRoot "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
$version = [string]$manifest.version
if ($version -notmatch '^\d+(?:\.\d+){1,3}$') {
  throw "The manifest must contain a valid numeric release version."
}

# Only runtime assets and distribution notices belong in the XPI.
$packageFiles = @(
  "manifest.json",
  "reply-core.js",
  "model-config.js",
  "background.js",
  "popup.html",
  "popup.css",
  "popup.js",
  "options.html",
  "options.js",
  "reader-popup.html",
  "reader-popup.css",
  "reader-popup.js",
  "Logo.png",
  "icons/icon-16.png",
  "icons/icon-24.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-96.png",
  "icons/icon-128.png",
  "lib/dompurify.min.js",
  "lib/DOMPurify.LICENSE",
  "LICENSE",
  "NOTICE",
  "PRIVACY.md",
  "VENDOR"
)

foreach ($relativePath in $packageFiles) {
  $sourcePath = Join-Path $sourceRoot $relativePath
  if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
    throw "Required package file is missing: $relativePath"
  }
}

if ([string]::IsNullOrWhiteSpace($OutDir)) {
  $OutDir = "dist"
}
if ([System.IO.Path]::IsPathRooted($OutDir)) {
  $packageOutDir = [System.IO.Path]::GetFullPath($OutDir)
} else {
  $packageOutDir = [System.IO.Path]::GetFullPath((Join-Path $sourceRoot $OutDir))
}
[System.IO.Directory]::CreateDirectory($packageOutDir) | Out-Null

$destXpi = Join-Path $packageOutDir "ai-mate-$version.xpi"
# A sibling temporary file allows an atomic rename/replace after the archive closes.
$temporaryXpi = Join-Path $packageOutDir (".ai-mate-" + [guid]::NewGuid().ToString("N") + ".tmp")
Add-Type -AssemblyName System.IO.Compression

try {
  $archiveStream = [System.IO.File]::Open($temporaryXpi, [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  try {
    $archive = [System.IO.Compression.ZipArchive]::new($archiveStream,
      [System.IO.Compression.ZipArchiveMode]::Create, $true)
    try {
      foreach ($relativePath in $packageFiles) {
        $entry = $archive.CreateEntry($relativePath.Replace('\', '/'),
          [System.IO.Compression.CompressionLevel]::Optimal)
        $entryStream = $entry.Open()
        try {
          $sourceStream = [System.IO.File]::OpenRead((Join-Path $sourceRoot $relativePath))
          try {
            $sourceStream.CopyTo($entryStream)
          } finally {
            $sourceStream.Dispose()
          }
        } finally {
          $entryStream.Dispose()
        }
      }
    } finally {
      $archive.Dispose()
    }
  } finally {
    $archiveStream.Dispose()
  }

  if ([System.IO.File]::Exists($destXpi)) {
    [System.IO.File]::Replace($temporaryXpi, $destXpi, [System.Management.Automation.Language.NullString]::Value)
  } else {
    [System.IO.File]::Move($temporaryXpi, $destXpi)
  }
} finally {
  if ([System.IO.File]::Exists($temporaryXpi)) {
    [System.IO.File]::Delete($temporaryXpi)
  }
}

Write-Host "Packed -> $destXpi"
