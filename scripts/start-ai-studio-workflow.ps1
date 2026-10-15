param(
    [switch]$ServicesOnly,
    [string]$FluxNodeExe = '',
    [string]$LalinSource = 'G:\AI-Studio\development\lalin-api-gpu-release-20261015\apps\api'
)
$ErrorActionPreference = 'Stop'
$studioRoot = 'G:\AI-Studio'
$hubRoot = "$studioRoot\development\local-llm-hub"
$lalinInstalled = "$studioRoot\Lalin-Studio"
$comfyExe = "$studioRoot\Comfy\Comfy Desktop.exe"
$comfyPython = "$studioRoot\ComfyUI_windows_portable\python_embeded\python.exe"
$logs = "$studioRoot\logs\workflow-studio"
$config = "$studioRoot\config\workflow-studio"
New-Item -ItemType Directory -Force -Path $logs, $config | Out-Null
$runId = Get-Date -Format 'yyyyMMdd-HHmmss-fff'

function Listener([int]$Port) {
    $found = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
    $owners = @($found.OwningProcess | Select-Object -Unique)
    if ($owners.Count -gt 1) { throw "Multiple services own port $Port; inspect before launch." }
    if ($owners.Count -eq 1) { return [int]$owners[0] }
    return $null
}

function Get-ProcessRecord([int]$ProcessId) {
    Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction Stop
}

function Assert-PythonOwner([int]$Port, [string]$ExpectedPython, [string]$CommandPattern) {
    $ownerId = Listener $Port
    if ($null -eq $ownerId) { throw "Service on port $Port is not listening." }
    $record = Get-ProcessRecord $ownerId
    $pythonMatches = $record.ExecutablePath -eq $ExpectedPython
    # Windows venv python.exe is a redirector. Accept its verified direct child
    # only when pyvenv.cfg identifies the child's exact base interpreter.
    if (-not $pythonMatches) {
        $venvConfig = Join-Path (Split-Path (Split-Path $ExpectedPython)) 'pyvenv.cfg'
        if (Test-Path -LiteralPath $venvConfig) {
            $homeLine = Get-Content -LiteralPath $venvConfig | Where-Object { $_ -match '^home\s*=\s*' } | Select-Object -First 1
            if ($homeLine) {
                $basePython = Join-Path ($homeLine -replace '^home\s*=\s*', '') 'python.exe'
                $parent = Get-ProcessRecord $record.ParentProcessId
                $pythonMatches = $parent.ExecutablePath -eq $ExpectedPython -and $record.ExecutablePath -eq $basePython -and $parent.CommandLine -match $CommandPattern
            }
        }
    }
    if (-not $pythonMatches -or $record.CommandLine -notmatch $CommandPattern) {
        throw "Port $Port belongs to an unexpected process; no service was stopped."
    }
    return $ownerId
}

function Wait-Json([string]$Uri, [hashtable]$Headers = @{}, [int]$TimeoutSeconds = 90) {
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        try { return Invoke-RestMethod -Uri $Uri -Headers $Headers -TimeoutSec 3 }
        catch { Start-Sleep -Milliseconds 750 }
    } while ((Get-Date) -lt $deadline)
    throw "Service did not become ready: $Uri. See $logs."
}

# One private token is inherited by Hub and FluxNode; it is never printed or
# included in the nonsecret launch receipt. Existing token files are preserved.
$tokenPath = Join-Path $config 'hub-token.txt'
if (-not (Test-Path -LiteralPath $tokenPath)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $secret = [Convert]::ToBase64String($bytes)
    [IO.File]::WriteAllText($tokenPath, $secret, [Text.UTF8Encoding]::new($false))
    $acl = Get-Acl -LiteralPath $tokenPath
    $acl.SetAccessRuleProtection($true, $false)
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $tokenPath -AclObject $acl
}
$env:LOCAL_LLM_HUB_TOKEN = [IO.File]::ReadAllText($tokenPath).Trim()
if ($env:LOCAL_LLM_HUB_TOKEN.Length -lt 32) { throw 'Private Hub token file is invalid.' }
$headers = @{ Authorization = 'Bearer ' + $env:LOCAL_LLM_HUB_TOKEN }
$env:LOCAL_LLM_HUB_URL = 'http://127.0.0.1:8787'
$env:FLUXNODE_LALIN_URL = 'http://127.0.0.1:8756'
$env:FLUXNODE_COMFY_URL = 'http://127.0.0.1:8188'
$env:FLUXNODE_COMFY_CLEAN_SESSION = '0'
$env:FLUXNODE_GPU_MIN_FREE_VRAM_MB = '9216'
$env:HF_HOME = "$studioRoot\cache\huggingface"
$env:TORCH_HOME = "$studioRoot\cache\torch"
$env:XDG_CACHE_HOME = "$studioRoot\cache"
$env:HF_HUB_DISABLE_SYMLINKS_WARNING = '1'
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:TEMP = "$studioRoot\temp"
$env:TMP = $env:TEMP
$workflowPath = "$studioRoot\tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin;$studioRoot\tools\node-v24.19.0-win-x64;C:\Users\suanr\.cargo\bin;" + $env:PATH
$env:PATH = $workflowPath

$hubPython = "$hubRoot\.venv\Scripts\python.exe"
if ($null -eq (Listener 8787)) {
    $env:PYTHONPATH = "$hubRoot\runtime"
    $hub = Start-Process -FilePath $hubPython -ArgumentList @('-m', 'local_llm_hub.cli', '--config', "$hubRoot\config", 'serve') -WorkingDirectory $hubRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\$runId-hub.stdout.log" -RedirectStandardError "$logs\$runId-hub.stderr.log"
    Write-Output "Started Hub process $($hub.Id)."
}
$hubHealth = Wait-Json "$env:LOCAL_LLM_HUB_URL/health"
if ($hubHealth.service -ne 'local-llm-hub' -or $hubHealth.status -ne 'ok') { throw 'Unexpected Hub health response.' }
$hubPid = Assert-PythonOwner 8787 $hubPython 'local_llm_hub\.cli'
$gpuStatus = Invoke-RestMethod "$env:LOCAL_LLM_HUB_URL/v1/gpu/leases/status" -Headers $headers -TimeoutSec 5
if ($null -eq $gpuStatus.devices) { throw 'Hub does not expose the required GPU lease API.' }

$lalinPython = "$lalinInstalled\apps\api\.venv\Scripts\python.exe"
$lalinHfHome = Join-Path "$lalinInstalled\runtime\data" "huggingface"
New-Item -ItemType Directory -Force -Path $lalinHfHome | Out-Null
if ($null -eq (Listener 8756)) {
    if (-not (Test-Path -LiteralPath "$LalinSource\app\main.py")) { throw "Lalin API source is missing: $LalinSource" }
    $env:PYTHONPATH = $LalinSource
    $env:GMUSIC_DATA_DIR = "$lalinInstalled\runtime\data"
    $arguments = @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8756')
    $installedEnv = "$lalinInstalled\apps\api\.env"
    if (Test-Path -LiteralPath $installedEnv) { $arguments += @('--env-file', $installedEnv) }
    $previousHfHome = $env:HF_HOME
    $env:HF_HOME = $lalinHfHome
    $env:PATH = "$lalinInstalled\apps\api\.venv\Lib\site-packages\torch\lib;" + $workflowPath
    try {
        $lalin = Start-Process -FilePath $lalinPython -ArgumentList $arguments -WorkingDirectory $LalinSource -WindowStyle Hidden -PassThru -RedirectStandardOutput "$logs\$runId-lalin.stdout.log" -RedirectStandardError "$logs\$runId-lalin.stderr.log"
    } finally {
        $env:PATH = $workflowPath
        if ($null -eq $previousHfHome) { Remove-Item Env:HF_HOME -ErrorAction SilentlyContinue }
        else { $env:HF_HOME = $previousHfHome }
    }
    Write-Output "Started Lalin API process $($lalin.Id)."
}
$lalinSchema = Wait-Json "$env:FLUXNODE_LALIN_URL/openapi.json"
if (($lalinSchema | ConvertTo-Json -Depth 50 -Compress) -notmatch 'release_gpu_model') {
    throw 'Existing Lalin API lacks the model-release contract. No process was stopped; use the repaired API before continuing.'
}
$lalinPid = Assert-PythonOwner 8756 $lalinPython 'uvicorn\s+app\.main:app'
Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue

$comfyWasStopped = $null -eq (Listener 8188)
$desktopStarted = $null
$ownedDesktopPath = Join-Path $config 'owned-comfy-desktop.json'
$ownedDesktop = $null
if (Test-Path -LiteralPath $ownedDesktopPath) {
    $savedDesktop = Get-Content -LiteralPath $ownedDesktopPath -Raw | ConvertFrom-Json
    $candidate = Get-CimInstance Win32_Process -Filter "ProcessId=$($savedDesktop.pid)" -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ExecutablePath -eq $comfyExe -and $candidate.CreationDate.ToUniversalTime().ToString('o') -eq $savedDesktop.createdAt) {
        $ownedDesktop = $candidate
    }
}
if ($comfyWasStopped) {
    $desktopProcesses = @(Get-CimInstance Win32_Process -Filter "name='Comfy Desktop.exe'")
    $comfyProcesses = @(Get-CimInstance Win32_Process -Filter "name='python.exe'" | Where-Object { $_.ExecutablePath -eq $comfyPython -and $_.CommandLine -match 'main\.py' })
    if (($desktopProcesses.Count -or $comfyProcesses.Count) -and -not $ownedDesktop) {
        throw 'Comfy Desktop or its runtime is already starting/running. Launch its Qwen instance and retry; no competing runtime was started.'
    }
    $desktopState = Join-Path $env:APPDATA 'Comfy Desktop'
    $installations = Get-Content -LiteralPath "$desktopState\installations.json" -Raw | ConvertFrom-Json
    $instance = @($installations | Where-Object { $_.id -eq 'inst-g-ai' -and $_.installPath -eq "$studioRoot\ComfyUI_windows_portable" })
    if ($instance.Count -ne 1) { throw 'Expected Desktop-managed Qwen instance was not found.' }
    if (-not $ownedDesktop) {
        $desktopStarted = Start-Process -FilePath $comfyExe -WorkingDirectory (Split-Path $comfyExe) -WindowStyle Normal -PassThru
        $ownedDesktop = Get-ProcessRecord $desktopStarted.Id
        @{pid=$desktopStarted.Id;createdAt=$ownedDesktop.CreationDate.ToUniversalTime().ToString('o');apiInitiallyStopped=$true} | ConvertTo-Json | Set-Content -LiteralPath $ownedDesktopPath -Encoding utf8
        Write-Output "Started Comfy Desktop process $($desktopStarted.Id)."
    }
    Write-Output 'In Comfy Desktop, click Launch for Qwen Image - G Drive. This launcher waits for its API; it does not start a competing runtime.'
}
$comfyHealth = Wait-Json "$env:FLUXNODE_COMFY_URL/system_stats" @{} 180
if ($null -eq $comfyHealth.system -or $null -eq $comfyHealth.devices) { throw 'Unexpected Comfy system-stats response.' }
$comfyPid = Assert-PythonOwner 8188 $comfyPython 'main\.py'
if ($null -ne $ownedDesktop) {
    $ancestor = Get-ProcessRecord $comfyPid
    $owned = $false
    for ($depth = 0; $depth -lt 12 -and $null -ne $ancestor; $depth++) {
        if ($ancestor.ProcessId -eq $ownedDesktop.ProcessId) { $owned = $true; break }
        if ($ancestor.ParentProcessId -eq 0) { break }
        $ancestor = Get-CimInstance Win32_Process -Filter "ProcessId=$($ancestor.ParentProcessId)" -ErrorAction SilentlyContinue
    }
    $history = Invoke-RestMethod "$env:FLUXNODE_COMFY_URL/history" -TimeoutSec 5
    $queue = Invoke-RestMethod "$env:FLUXNODE_COMFY_URL/queue" -TimeoutSec 5
    if ($owned -and @($history.PSObject.Properties).Count -eq 0 -and @($queue.queue_running).Count -eq 0 -and @($queue.queue_pending).Count -eq 0) {
        $env:FLUXNODE_COMFY_CLEAN_SESSION = '1'
    } else { throw 'Comfy clean-session ownership could not be established; model unloading is disabled.' }
}

$receipt = [ordered]@{ startedAt=(Get-Date).ToString('o'); hubPid=$hubPid; lalinPid=$lalinPid; comfyPid=$comfyPid; comfyFreshOwnedSession=($env:FLUXNODE_COMFY_CLEAN_SESSION -eq '1'); hubUrl=$env:LOCAL_LLM_HUB_URL; lalinUrl=$env:FLUXNODE_LALIN_URL; comfyUrl=$env:FLUXNODE_COMFY_URL; lalinSource=$LalinSource; tokenFile=$tokenPath }
if (-not $ServicesOnly) {
    if ([string]::IsNullOrWhiteSpace($FluxNodeExe) -or -not (Test-Path -LiteralPath $FluxNodeExe -PathType Leaf)) {
        throw 'Pass -FluxNodeExe with the newly built narrated-workflow executable. Services are ready; no stale binary was opened.'
    }
    $flux = Start-Process -FilePath $FluxNodeExe -WorkingDirectory (Split-Path $FluxNodeExe) -WindowStyle Normal -PassThru
    $receipt.fluxNodePid = $flux.Id
    $receipt.fluxNodeExe = $FluxNodeExe
}
$receipt | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath "$logs\$runId-launch.json" -Encoding utf8
$receipt | ConvertTo-Json -Depth 5
Write-Output 'Services ready. No generation job was submitted by this launcher.'
