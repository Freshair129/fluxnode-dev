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

  Source: https://github.com/BtbN/FFmpeg-Builds (win64-lgpl, "latest").
#>
param(
  [string]$Triple = 'x86_64-pc-windows-msvc',
  [string]$Url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$binDir = Join-Path $root 'src-tauri/binaries'
$tmpZip = Join-Path $env:TEMP 'fluxnode-ffmpeg-lgpl.zip'
$tmpDir = Join-Path $env:TEMP 'fluxnode-ffmpeg-extract'

New-Item -ItemType Directory -Force -Path $binDir | Out-Null

Write-Host "Downloading LGPL FFmpeg build..." -ForegroundColor Cyan
Invoke-WebRequest -Uri $Url -OutFile $tmpZip

Write-Host "Extracting..." -ForegroundColor Cyan
if (Test-Path $tmpDir) { Remove-Item -Recurse -Force $tmpDir }
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

foreach ($exe in @('ffmpeg', 'ffprobe')) {
  $found = Get-ChildItem -Path $tmpDir -Recurse -Filter "$exe.exe" | Select-Object -First 1
  if (-not $found) { throw "Could not find $exe.exe in the downloaded archive" }
  $dest = Join-Path $binDir "$exe-$Triple.exe"
  Copy-Item -Path $found.FullName -Destination $dest -Force
  Write-Host "  -> $dest" -ForegroundColor Green
}

Remove-Item -Force $tmpZip
Remove-Item -Recurse -Force $tmpDir

Write-Host "Done. Sidecars staged in src-tauri/binaries/" -ForegroundColor Cyan
& (Join-Path $binDir "ffmpeg-$Triple.exe") -hide_banner -version | Select-Object -First 1
