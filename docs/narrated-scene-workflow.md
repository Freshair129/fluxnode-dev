# Narrated-scene workflow

This runbook covers the single local workflow that creates one image, one spoken narration, and a playable MP4 in a FluxNode project.

## Run it

1. From the repository root, start the local services and FluxNode with the checked-in AI-Studio workflow launcher:

   ```powershell
   & .\scripts\start-ai-studio-workflow.ps1 -FluxNodeExe (Resolve-Path '.\src-tauri\target\debug\fluxnode.exe').Path
   ```

   Build the current branch first. The launcher uses this workstation's `G:\AI-Studio` service installs and checks that the supplied FluxNode executable exists; it does not determine whether that executable was built from the current source.
2. If Comfy Desktop opens on its dashboard, launch the existing **Qwen Image - G Drive** instance. The launcher waits for the API and verifies that its Python runtime descends from the exact Desktop process it started. It requires empty Comfy history and queues before it marks the session safe for model release.
3. Open or create a saved FluxNode project, select **Narrated scene** in the header, enter an image prompt and narration, and choose a saved Lalin voice.
4. Start the workflow. FluxNode reports preflight, image generation, Comfy release, narration, project import, and MP4 export. The image and narration are appended after the last existing timeline clip (with a 0.4-second gap when the project already has clips); both clips are linked and span the narration duration. The CPU-rendered MP4 includes the existing timeline and the appended scene.

The launcher creates and protects the Hub bearer token locally. FluxNode reads it from its process environment; users do not paste tokens or provider JSON into the app. Provider base URLs default to loopback (`127.0.0.1:8188` for Comfy Desktop, `127.0.0.1:8756` for Lalin, and `127.0.0.1:8787` for local-llm-hub). The launcher sets these values and `FLUXNODE_COMFY_CLEAN_SESSION` for the validated Desktop session. It sets HF_HOME only for the Lalin process to G:\AI-Studio\Lalin-Studio\runtime\data\huggingface, so first-time F5 model downloads stay on G drive.

## GPU ownership and release

- The Hub lease API is authenticated. FluxNode acquires a lease before each provider stage, renews it while waiting, and checks the lease identity and device state while verifying release.
- The workflow currently supports one NVIDIA GPU, mapped to Comfy/Lalin `cuda:0`. It stops if the Hub reports zero or multiple devices, unavailable telemetry, an active/orphaned/unknown lease, or less than 9,216 MiB free VRAM by default. `FLUXNODE_GPU_MIN_FREE_VRAM_MB` changes the threshold.
- Before image generation, FluxNode requires both Comfy queue arrays to be present and empty. After its prompt finishes, it checks the queues again and requests Comfy `/free` with `unload_models` and `free_memory`. An HTTP success response alone is not treated as release: the queues must stay idle and Hub telemetry must recover to within 512 MiB of the pre-stage free-VRAM baseline for two readings.
- Only after Comfy release is verified does FluxNode release its Hub lease and verify the device is free, then acquire the lease for Lalin. It submits TTS with model release enabled, waits for a terminal job and explicit release receipt, confirms Lalin used CUDA, then requires the same two-reading VRAM recovery before releasing the Hub lease.
- A timeout, missing receipt, unknown release, changed lease owner, or failed telemetry check stops the next stage and retains the lease for inspection. FluxNode does not kill provider processes or unload a provider while its queue/activity is unknown.
- The Hub is cooperative coordination, not OS-level GPU enforcement. Programs that do not use it can still start GPU work, so unrelated GPU usage may cause the workflow to fail its VRAM checks.

## Recover a retained lease

If the UI reports that a Hub lease was retained, do not release it based on age or because the client timed out. With the launcher's bearer token, inspect `GET /v1/gpu/leases/status` and record the exact `lease_id`, `owner_id`, GPU UUID, state, and reason. Independently confirm the corresponding provider is idle: both Comfy queue arrays are empty and the prompt is terminal, or Lalin reports `activity.state: "idle"` and its job is terminal. Check that Hub telemetry is available and free VRAM has returned to the pre-stage baseline. If any provider state or telemetry is unknown, leave the lease orphaned and keep the next workflow blocked.

Only after those checks, the exact recorded owner can release the exact recorded lease through the authenticated `POST /v1/gpu/leases/{lease_id}/release` route. The body must include that `owner_id` and a `provider_release_receipt` with `provider`, `workload_id`, `status: "idle_confirmed"`, and a UTC `verified_at` timestamp. The Hub validates the receipt format but does not inspect the provider; the operator must supply a truthful receipt based on the checks above. Verify the following status response reports the device `state: "free"` and `lease_state: null`. A Hub-free lease means no cooperative claim remains; it does not prove the physical GPU is unused.

The image stage uses the Qwen model files already installed in this Comfy Desktop instance; Flux weights are not required. The final MP4 uses software H.264 plus AAC, so the render step does not need the GPU.

## Verification status

CPU-only unit, frontend, and build checks cover the API payload parsers, queue and single-device fail-closed checks, release contract, CPU export preset, UI wiring, and project materialization. Live acceptance is recorded separately and must include the actual Comfy prompt ID and PNG, Lalin job ID and WAV/release receipt, Hub VRAM readings between stages, reopened project assets, and `ffprobe` confirmation that the exported MP4 contains video and audio. Fixture tests are not hardware acceptance.

### Backend live acceptance on the local workstation

With the AI-Studio launcher-owned Comfy Desktop session open, Hub and Lalin idle, and at least 9,216 MiB free, run:

```powershell
& .\scripts\acceptance\run-narrated-scene-live.ps1
```

The script checks the current Comfy API process against the launch receipt and Desktop owner, checks the Hub lease, Comfy queues, and Lalin activity, then invokes the same Rust workflow core used by the Tauri command. It saves the generated PNG, WAV, Cargo log, provider IDs, per-stage VRAM figures, and post-run idle/free checks in its G-drive evidence directory. The acceptance runner substitutes only the Tauri progress-event sink and uses an evidence-drive app-data folder. This proves the live Comfy-to-Lalin backend and GPU lease handoff; the app's saved-project import, reopened-project check, and native MP4 export remain separate desktop acceptance steps.

The 2026-10-15 workstation run completed with Comfy prompt `1277f7d7-6e14-4534-8829-742cd1c0454b` and Lalin job `9f8dfa9f335e`. Comfy returned a 512×512 PNG; Lalin returned a 10.055-second mono 24 kHz PCM WAV and confirmed model release. Hub telemetry returned to `free` with no lease, both Comfy queue arrays were empty, and Lalin was idle with CUDA effective. The output files and JSON evidence are under `G:\AI-Studio\verification\2026-10-15-workflow\fluxnode-live-acceptance\20261015-114647`. This was a backend hardware acceptance run; it did not reopen a FluxNode project or produce the UI's timeline MP4 export.
