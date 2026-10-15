param(
    [string]$EvidenceRoot = 'G:\AI-Studio\verification\narrated-scene-live-acceptance'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$hubBase = 'http://127.0.0.1:8787'
$comfyBase = 'http://127.0.0.1:8188'
$lalinBase = 'http://127.0.0.1:8756'
$tokenPath = 'G:\AI-Studio\config\workflow-studio\hub-token.txt'
$ownedDesktopPath = 'G:\AI-Studio\config\workflow-studio\owned-comfy-desktop.json'
$launchDirectory = 'G:\AI-Studio\logs\workflow-studio'
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'
$runDirectory = Join-Path $EvidenceRoot $runId
$appDataDirectory = Join-Path $runDirectory 'appdata'

function Get-ListenerProcessId([int]$Port) {
    $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
    if ($listeners.Count -ne 1) {
        throw "Expected one loopback listener on port $Port; found $($listeners.Count)."
    }
    return [int]$listeners[0].OwningProcess
}

function Get-Json([string]$Url, [hashtable]$Headers = @{}) {
    return Invoke-RestMethod -Uri $Url -Headers $Headers -TimeoutSec 12
}

New-Item -ItemType Directory -Force -Path $runDirectory, $appDataDirectory | Out-Null

$hubToken = (Get-Content -LiteralPath $tokenPath -Raw).Trim()
if ($hubToken.Length -lt 32) { throw 'Hub token file is missing or invalid.' }
$authorization = @{ Authorization = "Bearer $hubToken" }

$comfyPid = Get-ListenerProcessId 8188
$lalinPid = Get-ListenerProcessId 8756
$hubPid = Get-ListenerProcessId 8787
$comfyOwner = Get-Content -LiteralPath $ownedDesktopPath -Raw | ConvertFrom-Json
$desktopProcess = Get-Process -Id ([int]$comfyOwner.pid) -ErrorAction SilentlyContinue
if ($null -eq $desktopProcess) { throw 'The recorded owned Comfy Desktop process is not running.' }

$comfyProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $comfyPid"
if ($null -eq $comfyProcess) { throw 'Could not inspect the Comfy API process.' }
$apiParent = [int]$comfyProcess.ParentProcessId
$isDesktopChild = $false
for ($depth = 0; $depth -lt 8 -and $apiParent -gt 0; $depth++) {
    if ($apiParent -eq [int]$comfyOwner.pid) { $isDesktopChild = $true; break }
    $parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $apiParent"
    if ($null -eq $parentProcess) { break }
    $apiParent = [int]$parentProcess.ParentProcessId
}
if (-not $isDesktopChild) { throw 'The current Comfy API process is not descended from the recorded Comfy Desktop process.' }

$launchReceipts = Get-ChildItem -LiteralPath $launchDirectory -Filter '*-launch.json' -File |
    ForEach-Object {
        try { Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json } catch { $null }
    } |
    Where-Object { $_ -and $_.comfyFreshOwnedSession -eq $true -and [int]$_.comfyPid -eq $comfyPid }
if (-not $launchReceipts) { throw 'No trusted fresh-session launcher receipt matches the current Comfy API PID.' }
$launchReceipt = $launchReceipts | Select-Object -First 1

$hubStatus = Get-Json "$hubBase/v1/gpu/leases/status" $authorization
if ($hubStatus.telemetry_available -ne $true -or @($hubStatus.devices).Count -ne 1) {
    throw 'GPU Hub telemetry is unavailable or does not report exactly one GPU.'
}
$device = $hubStatus.devices[0]
if ($device.state -ne 'free' -or ($device.lease_state -and $device.lease_state -ne 'released')) {
    throw "GPU Hub is not free (state=$($device.state), lease_state=$($device.lease_state))."
}
if ([int]$device.free_vram_mb -lt 9216) { throw "GPU has only $($device.free_vram_mb) MiB free; at least 9216 MiB is required." }

$comfyQueue = Get-Json "$comfyBase/queue"
if (@($comfyQueue.queue_running).Count -ne 0 -or @($comfyQueue.queue_pending).Count -ne 0) {
    throw 'Comfy has another running or queued job.'
}
$lalinStatus = Get-Json "$lalinBase/runtime/status"
if ($lalinStatus.activity.state -ne 'idle') { throw "Lalin is not idle (state=$($lalinStatus.activity.state))." }
if ($lalinStatus.runtime.devices.tts.requested -eq 'cpu') { throw 'Lalin TTS is configured to CPU.' }
$voices = Get-Json "$lalinBase/voices"
if (-not (@($voices.voices) | Where-Object { $_.id -eq 'b8c819fd489f' })) {
    throw 'The selected Thai Lalin voice is no longer available.'
}

$oldEnvironment = @{}
foreach ($name in @(
        'FLUXNODE_LIVE_APP_DATA_DIR', 'LOCAL_LLM_HUB_TOKEN', 'LOCAL_LLM_HUB_URL',
        'FLUXNODE_COMFY_URL', 'FLUXNODE_LALIN_URL',
        'FLUXNODE_COMFY_CLEAN_SESSION', 'FLUXNODE_GPU_MIN_FREE_VRAM_MB'
    )) {
    $oldEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    $env:FLUXNODE_LIVE_APP_DATA_DIR = $appDataDirectory
    $env:LOCAL_LLM_HUB_TOKEN = $hubToken
    $env:LOCAL_LLM_HUB_URL = $hubBase
    $env:FLUXNODE_COMFY_URL = $comfyBase
    $env:FLUXNODE_LALIN_URL = $lalinBase
    $env:FLUXNODE_COMFY_CLEAN_SESSION = '1'
    $env:FLUXNODE_GPU_MIN_FREE_VRAM_MB = '9216'

    $cargoArgs = @(
        'test', '--manifest-path', (Join-Path $repoRoot 'src-tauri\Cargo.toml'),
        '--lib',
        'narrated_scene::tests::live_narrated_scene_generates_real_local_image_and_tts',
        '--', '--ignored', '--nocapture', '--test-threads=1'
    )
    $cargoOutput = & cargo @cargoArgs 2>&1 | Tee-Object -FilePath (Join-Path $runDirectory 'cargo-live-acceptance.log')
    if ($LASTEXITCODE -ne 0) { throw "FluxNode live acceptance test exited with code $LASTEXITCODE." }

    $resultLine = $cargoOutput | ForEach-Object { [string]$_ } | Where-Object { $_ -like 'LIVE_NARRATED_SCENE_RESULT=*' } | Select-Object -Last 1
    if (-not $resultLine) { throw 'Rust live test passed but did not emit a narrated-scene result record.' }
    $result = $resultLine.Substring('LIVE_NARRATED_SCENE_RESULT='.Length) | ConvertFrom-Json
    $imageSource = [string]$result.imagePath
    $audioSource = [string]$result.audioPath
    $imageEvidence = Join-Path $runDirectory 'scene.png'
    $audioEvidence = Join-Path $runDirectory 'narration.wav'
    Copy-Item -LiteralPath $imageSource -Destination $imageEvidence
    Copy-Item -LiteralPath $audioSource -Destination $audioEvidence

    $postHubStatus = Get-Json "$hubBase/v1/gpu/leases/status" $authorization
    $postHubDevice = $postHubStatus.devices[0]
    if ($postHubStatus.telemetry_available -ne $true -or
        $postHubDevice.state -ne 'free' -or
        $null -ne $postHubDevice.lease_id) {
        throw 'The workflow returned media but the shared Hub did not confirm a free GPU lease afterward.'
    }
    $postComfyQueue = Get-Json "$comfyBase/queue"
    $postLalinStatus = Get-Json "$lalinBase/runtime/status"
    if (@($postComfyQueue.queue_running).Count -ne 0 -or @($postComfyQueue.queue_pending).Count -ne 0) {
        throw 'Comfy has a queued or running job after the live workflow.'
    }
    if ($postLalinStatus.activity.state -ne 'idle') {
        throw "Lalin is not idle after the live workflow (state=$($postLalinStatus.activity.state))."
    }

    $imageHash = (Get-FileHash -LiteralPath $imageEvidence -Algorithm SHA256).Hash.ToLowerInvariant()
    $audioHash = (Get-FileHash -LiteralPath $audioEvidence -Algorithm SHA256).Hash.ToLowerInvariant()
    $evidence = [ordered]@{
        createdAt = (Get-Date).ToUniversalTime().ToString('o')
        workflow = 'FluxNode Rust narrated-scene backend: Comfy Qwen Image 2.1 Turbo -> GPU Hub release -> Lalin F5-TTS -> GPU Hub release'
        runId = $result.runId
        comfyPromptId = $result.comfyPromptId
        lalinJobId = $result.lalinJobId
        gpuUuid = $result.gpuUuid
        freeVramMb = [ordered]@{
            comfyBefore = $result.comfyFreeVramBeforeMb
            comfyAfter = $result.comfyFreeVramAfterMb
            lalinBefore = $result.lalinFreeVramBeforeMb
            lalinAfter = $result.lalinFreeVramAfterMb
        }
        lalinReleaseStatus = $result.lalinReleaseStatus
        lalinModel = $result.lalinModel
        postRun = [ordered]@{
            hubState = $postHubDevice.state
            hubLeaseId = $postHubDevice.lease_id
            hubFreeVramMb = $postHubDevice.free_vram_mb
            comfyRunning = @($postComfyQueue.queue_running).Count
            comfyPending = @($postComfyQueue.queue_pending).Count
            lalinActivity = $postLalinStatus.activity.state
        }
        image = [ordered]@{ path = $imageEvidence; bytes = (Get-Item $imageEvidence).Length; sha256 = $imageHash }
        audio = [ordered]@{ path = $audioEvidence; bytes = (Get-Item $audioEvidence).Length; sha256 = $audioHash }
        owners = [ordered]@{
            hubPid = $hubPid
            comfyApiPid = $comfyPid
            comfyDesktopPid = [int]$comfyOwner.pid
            lalinApiPid = $lalinPid
            trustedComfyLaunchReceipt = $launchReceipt.startedAt
        }
    }
    $evidence | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDirectory 'live-workflow-evidence.json') -Encoding utf8
    Write-Output "LIVE_EVIDENCE_DIRECTORY=$runDirectory"
    Write-Output "IMAGE_SHA256=$imageHash"
    Write-Output "AUDIO_SHA256=$audioHash"
    Write-Output "LALIN_RELEASE=$($result.lalinReleaseStatus)"
}
finally {
    foreach ($name in $oldEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $oldEnvironment[$name], 'Process')
    }
}
