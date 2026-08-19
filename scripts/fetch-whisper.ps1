<#
.SYNOPSIS
  Downloads, verifies, and stages the Windows x64 whisper.cpp sidecar and English base model.

.DESCRIPTION
  The executable, its DLL dependencies, and model are intentionally gitignored. This script pins
  upstream inputs by SHA-256 before copying them into src-tauri/binaries/whisper, where Tauri bundles
  them together as resources. Run before a Windows Tauri release build or local STT verification.
#>
param(
  [string]$ReleaseUrl = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.6/whisper-bin-x64.zip',
  [string]$ReleaseSha256 = 'B07EA0B1B4115A38E1A7B07DEBF581F0B77D999925F8ACB8F39D322B0BA0A822',
  [string]$ModelUrl = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin?download=true',
  [string]$ModelSha256 = 'A03779C86DF3323075F5E796CB2CE5029F00EC8869EEE3FDFB897AFE36C6D002'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$stageDir = Join-Path $root 'src-tauri/binaries/whisper'
$archive = Join-Path ([IO.Path]::GetTempPath()) ('fluxnode-whisper-' + [guid]::NewGuid() + '.zip')
$extractDir = Join-Path ([IO.Path]::GetTempPath()) ('fluxnode-whisper-' + [guid]::NewGuid())
$model = Join-Path ([IO.Path]::GetTempPath()) ('fluxnode-ggml-base.en-' + [guid]::NewGuid() + '.bin')

function Assert-Sha256([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
  if ($actual -ne $Expected) { throw "SHA-256 mismatch for $Path. Expected $Expected; got $actual" }
}

try {
  New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
  Write-Host 'Downloading whisper.cpp v1.8.6...' -ForegroundColor Cyan
  & curl.exe --fail --location --output $archive $ReleaseUrl
  if ($LASTEXITCODE -ne 0) { throw "download failed for $ReleaseUrl" }
  Assert-Sha256 $archive $ReleaseSha256
  Expand-Archive -LiteralPath $archive -DestinationPath $extractDir
  $cli = Get-ChildItem -LiteralPath $extractDir -Recurse -File -Filter 'whisper-cli.exe' | Select-Object -First 1
  if (-not $cli) { throw 'Release archive does not contain whisper-cli.exe' }
  Copy-Item -LiteralPath $cli.FullName -Destination (Join-Path $stageDir 'whisper-cli.exe') -Force
  $dlls = Get-ChildItem -LiteralPath $cli.DirectoryName -File -Filter '*.dll'
  if (-not $dlls) { throw 'Release archive contains no runtime DLLs beside whisper-cli.exe' }
  foreach ($dll in $dlls) {
    Copy-Item -LiteralPath $dll.FullName -Destination (Join-Path $stageDir $dll.Name) -Force
  }
  Write-Host 'Downloading ggml-base.en model...' -ForegroundColor Cyan
  & curl.exe --fail --location --output $model $ModelUrl
  if ($LASTEXITCODE -ne 0) { throw "download failed for $ModelUrl" }
  Assert-Sha256 $model $ModelSha256
  Copy-Item -LiteralPath $model -Destination (Join-Path $stageDir 'ggml-base.en.bin') -Force
  $cli = Join-Path $stageDir 'whisper-cli.exe'
  & $cli --help | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "whisper-cli --help exited with $LASTEXITCODE" }
  Write-Host "Whisper sidecar staged and verified at $stageDir" -ForegroundColor Green
} finally {
  if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
  if (Test-Path -LiteralPath $model) { Remove-Item -LiteralPath $model -Force }
  if (Test-Path -LiteralPath $extractDir) { Remove-Item -LiteralPath $extractDir -Recurse -Force }
}
