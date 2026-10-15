# Standalone desktop acceptance

This guide describes the bounded local acceptance for the FluxNode fixes tracked in
[issue #16](https://github.com/Freshair129/fluxnode-dev/issues/16). It separates frontend unit
coverage, native IPC/MCP behavior, and real FFmpeg export. A synthetic ComfyUI-shaped HTTP fixture
returns a PNG generated locally with FFmpeg; this exercises FluxNode's integration and persistence
code without claiming real ComfyUI, Ollama, model, or GPU generation.

## Frontend checks

Run from the repository root with the pinned Node installation available on this machine:

```powershell
npm run lint
npx tsc -b
npm test
npm run build
```

The focused `src/store/project-store.workflow-result.test.ts` tests use mocked IPC only at the
file-copy and media-probe boundaries. They run the real Zustand materialization logic and cover
same-result idempotency, a second distinct prompt result, timeline/asset association, and a
project switch while a copy is pending. They do not replace the native acceptance below.

## Windows debug acceptance build

The Windows debug acceptance uses the normal platform resource mapping from
`src-tauri/tauri.windows.conf.json`. The ignored Whisper files are staged by the repository's
checksum-verifying `scripts/fetch-whisper.ps1` (whisper.cpp v1.8.6 and `ggml-base.en.bin`); the
script runs `whisper-cli --help` but does not load the model. The app build overrides only the
acceptance identifier and product name so its app data and WebView profile remain isolated. It
does not create an installer, signed update, or release package.

```powershell
$out = 'G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode\native-<unique-id>'
New-Item -ItemType Directory -Path $out -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path "$out\tmp" -ErrorAction Stop | Out-Null
$env:TEMP = "$out\tmp"
$env:TMP = "$out\tmp"
$env:CARGO_BUILD_JOBS = '1'
$env:FLUXNODE_FFMPEG_DIR = 'G:\AI-Studio\tools\ffmpeg\ffmpeg-9.0.2-essentials_build\bin'
$env:TAURI_CONFIG = '{"identifier":"com.fluxnode.acceptance","productName":"FluxNode Acceptance"}'
npm run build
cargo build --manifest-path src-tauri\Cargo.toml --locked --features tauri/custom-protocol
New-Item -ItemType Directory -Path "$out\app" -ErrorAction Stop | Out-Null
Copy-Item src-tauri\target\debug\fluxnode.exe "$out\app\fluxnode-acceptance.exe"
```

Use a new output directory for every run. Do not reuse an earlier profile or fixture directory.
`TAURI_CONFIG` gives the test app a distinct app identifier/product name. The runners also create
their temporary directory and WebView2 profile before launching native processes. Project files,
generated PNGs, and MP4 output stay under the supplied verification directory.

## Native workflows

The real MCP client runner starts the native executable with `--mcp`, performs the initialize
handshake and tool discovery, verifies read-only denial and frontend-action unavailability, then
starts a separate explicitly write-enabled process whose preference/project writes are confined to
the verification root:

```powershell
$python = 'G:\AI-Studio\tools\python\cpython-3.11-windows-x86_64-none\python.exe'
$node = 'G:\AI-Studio\tools\node-v24.19.0-win-x64\node.exe'
& $python scripts\acceptance\mcp_smoke.py `
  --application "$out\app\fluxnode-acceptance.exe" `
  --output "$out\mcp" `
  --acceptance-identifier 'com.fluxnode.acceptance'
```

The native desktop runner starts a real WebDriver session and uses the rendered workflow UI to
click **Generate** and **Add to timeline**. A local fixture implements only `/system_stats`,
`/prompt`, `/history`, and `/view`. The runner checks same-result UI deduplication, creates two
distinct prompt results, verifies their assets, timeline clips, and workflow lineage through the
native project WAL and app reload, then starts the production FFmpeg render command. It checks the
resulting MP4 with ffprobe and decodes a pixel to confirm the fixture image is present in the
export:

```powershell
& $python scripts\acceptance\standalone_native_smoke.py `
  --application "$out\app\fluxnode-acceptance.exe" `
  --driver 'G:\AI-Studio\tools\webdriver\tauri-driver-2.1.0\target\release\tauri-driver.exe' `
  --edge-driver 'G:\AI-Studio\tools\webdriver\edge-155.0.4283.45\msedgedriver.exe' `
  --ffmpeg "$env:FLUXNODE_FFMPEG_DIR\ffmpeg.exe" `
  --ffprobe "$env:FLUXNODE_FFMPEG_DIR\ffprobe.exe" `
  --node $node `
  --output "$out\desktop" `
  --acceptance-identifier 'com.fluxnode.acceptance'
```

The desktop fixture starts from a Vite-SSR serialization of the current `createDefaultProject()`
schema, then replaces only workflow, asset, timeline, and render fixture data. This avoids false
failures from hand-authored project JSON missing required metadata. The MCP runner checks for
visible non-helper app windows; Tauri may create a small visible `Tao Thread Event Target` helper
window with no application content.

These checks exercise the native workflow buttons, actual Tauri commands, project WAL recovery,
project reopen, and the local FFmpeg encoder. The ComfyUI response and PNG are deterministic local
fixtures; this does not verify live ComfyUI model execution, Ollama inference or VRAM handoff. GPU
verification remains gated until the device is released.

## Local result recorded 2026-10-15

The final acceptance executable was built from the dirty fix worktree with the normal Windows Tauri
resource mapping and the frontend bundle embedded. Whisper resources were staged from pinned,
checksum-verified inputs by scripts/fetch-whisper.ps1; its CLI help succeeded, but no model
inference ran. The app build overlay changed only the acceptance identifier and product name; it
did not set bundle.resources to null. This is a debug acceptance build, not an installer.

Executable:
G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode\native-clippyfix-20261015\app\fluxnode-acceptance.exe

SHA-256: 7b70b866fd66d9446ec40ea8d815a9df804f6ee2863e0490ace15518c7ad736e

Source/artifact provenance:
G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode\native-clippyfix-20261015\source-artifact-provenance-final.json

The MCP receipt has 8 passing checks and the native desktop receipt has 11. Both, their logs, and
the cleanup receipt are under
G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode\native-clippyfix-20261015:

- mcp/receipt.json records initialize, tool listing, read-only execution, default write denial,
  frontend-action unavailability, and explicit-write persistence. The real client saw 30 backend
  tools and no frontend-owned timeline actions. A 16x16 Tao helper window was classified as a
  native event helper, not an application window.
- desktop/receipt.json records native UI materialization of two distinct synthetic Comfy-shaped
  image results, same-result deduplication, project save/reopen and persisted asset/timeline
  lineage, then production FFmpeg export. ffprobe found MPEG-4 at 160x120 for 8.8 seconds; an
  FFmpeg decode at 0.5 seconds returned the red fixture pixel RGB [251,1,0].
- cleanup-receipt-final-20261015.json records no FluxNode app/WebView process, WebDriver process,
  or fixture listener remaining. The PowerShell cleanup probe itself was the only command line
  that matched the run path. Acceptance app data and project/media/export files remain isolated
  under their verification paths.

The fixture is a deterministic local HTTP server implementing /system_stats, /prompt, /history,
and /view. These results establish the native integration path and export for a synthetic fixture.
They do not establish live ComfyUI execution, Ollama inference, or model generation. The GPU
reservation was respected.

The current local Rust verification is recorded in
G:\AI-Studio\verification\2026-10-15-readiness-fixes\fluxnode: 99 Rust tests passed, one
Whisper inference test was filtered; cargo fmt --check and normal-resource cargo clippy both
passed. The CI Clippy step is now mandatory, but no post-change remote CI run exists because the
fixes remain local.


## Release boundary

This debug build uses the Windows Whisper resource map, but does not verify MSI/NSIS packaging,
update signing, or cross-platform release readiness. The sidecar `--help` check does not exercise
speech recognition or prove model inference; no Whisper inference or GPU workload is part of this
acceptance.
