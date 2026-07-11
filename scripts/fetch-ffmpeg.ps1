<#
.SYNOPSIS
  Downloads an LGPL FFmpeg build and stages ffmpeg/ffprobe as Tauri sidecars.

.DESCRIPTION
  FluxNode ships closed-source, so we deliberately use the *LGPL* FFmpeg build
  (no GPL software encoders like libx264/libx265). H.264/H.265 output is produced
  via hardware encoders (NVENC / QSV / AMF), which are not GPL. Software paths
  cover VP9 / AV1 / ProRes / GIF / PNG.

  The binaries are NOT committed (see .gitignore: src-tauri/binaries/). Run this
  script after cloning, and in CI before `tauri build`.

  Cross-platform: pass -Triple/-Url for the target you need. Archive format is
  inferred from the URL (.zip via Expand-Archive, anything else via `tar`, which
  is present on both GitHub-hosted Linux runners and Windows 10+/PowerShell 7).
  The .exe suffix on staged binaries is added only for windows-* triples,
  matching Tauri's own sidecar naming convention.

  Source: https://github.com/BtbN/FFmpeg-Builds ("latest").
#>
param(
  [string]$Triple = 'x86_64-pc-windows-msvc',
  [string]$Url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'src-tauri/binaries'
# NOTE: do not name this `$isWindows` — in PowerShell 7 (pwsh, used by CI on Linux/macOS)
# `$IsWindows` is a read-only automatic variable and assigning to it throws a WriteError.
# Variable names are case-insensitive, so `$isWindows` collides with it. Windows PowerShell
# 5.1 has no such automatic variable, which is why this only failed in CI.
$tripleIsWindows = $Triple -like '*windows*'
$exeSuffix = if ($tripleIsWindows) { '.exe' } else { '' }
$archiveExt = if ($Url -match '\.tar\.[a-z0-9]+$') { $Matches[0] } else { [IO.Path]::GetExtension($Url) }
# $env:TEMP is Windows-only; on the Linux/macOS pwsh runners it's unset, so Join-Path would
# throw on a null path. [IO.Path]::GetTempPath() is cross-platform: %TEMP% on Windows,
# $TMPDIR (or /tmp) elsewhere.
$tmpRoot = [System.IO.Path]::GetTempPath()
$tmpArchive = Join-Path $tmpRoot "fluxnode-ffmpeg-lgpl$archiveExt"
$tmpDir = Join-Path $tmpRoot 'fluxnode-ffmpeg-extract'

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

Write-Host "Downloading LGPL FFmpeg build for $Triple..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $Url -OutFile $tmpArchive

Write-Host "Extracting..." -ForegroundColor Cyan
if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
if ($archiveExt -eq '.zip') {
  Expand-Archive -Path $tmpArchive -DestinationPath $tmpDir -Force
} else {
  # tar handles .tar.xz/.tar.gz alike; ships on GitHub-hosted ubuntu runners and
  # Windows 10+ (bsdtar) / PowerShell 7 environments.
  tar -xf $tmpArchive -C $tmpDir
  if ($LASTEXITCODE -ne 0) { throw "tar extraction failed with exit code $LASTEXITCODE" }
}

foreach ($exe in @('ffmpeg', 'ffprobe')) {
  $found = Get-ChildItem -Path $tmpDir -Recurse -Filter "$exe$exeSuffix" |
    Where-Object { -not $_.PSIsContainer } | Select-Object -First 1
  if (-not $found) { throw "Could not find $exe$exeSuffix in the downloaded archive" }
  $dest = Join-Path $binDir "$exe-$Triple$exeSuffix"
  Copy-Item -Path $found.FullName -Destination $dest -Force
  if (-not $tripleIsWindows) { chmod +x $dest }
  Write-Host "  -> $dest" -ForegroundColor Green
}

Remove-Item -Force $tmpArchive
Remove-Item -Recurse -Force $tmpDir

Write-Host "Done. Sidecars staged in src-tauri/binaries/" -ForegroundColor Cyan
& (Join-Path $binDir "ffmpeg-$Triple$exeSuffix") -hide_banner -version | Select-Object -First 1
