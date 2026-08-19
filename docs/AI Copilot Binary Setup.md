# AI Copilot - Sidecar Binary Setup and Verification

The media/voice backends use local sidecars. Whisper is installed by
`scripts/fetch-whisper.ps1` into `src-tauri/binaries/whisper/` with the executable, its runtime
DLLs, and the `ggml-base.en.bin` English model. The directory is bundled as a colocated Tauri
resource so the upstream executable can load its DLLs. The inputs, checksums, and release
acceptance criteria are frozen in
[`whisper-sidecar-installation-spec.md`](whisper-sidecar-installation-spec.md).

Piper and stable-diffusion.cpp are still operator-supplied. Their CLI shapes below are
documentation-checked, not runtime-verified.

## Flag cross-check status

| Backend | Binary | Assumed flags | Status | Fix location if drift |
|---|---|---|---|---|
| whisper.rs | `whisper-cli` (whisper.cpp) | `-m <model> -f <audio> -oj` -> reads `<audio>.json` | staged Windows binary checked with `--help`; runtime smoke test when staged | `parse_whisper_json` |
| piper.rs | `piper` | `--model <voice.onnx> --output_file <wav>`, text on stdin | docs checked | `PiperBackend::synth` |
| sdcpp.rs | `sd` | `-M txt2img\|img2img -m -p [-n] -W -H --steps [-s] -o [-i] [--mask]` | docs checked | `SdCppBackend::generate` |
| comfy.rs | HTTP | ComfyUI `/prompt`, `/history`, `/view` | existing client | `crate::comfy` |

## Windows Whisper setup

```powershell
powershell -ExecutionPolicy Bypass -File scripts/fetch-whisper.ps1

# Expect a sample.wav.json containing transcription[].offsets and text.
src-tauri/binaries/whisper/whisper-cli.exe `
  -m src-tauri/binaries/whisper/ggml-base.en.bin `
  -f sample.wav -oj
```

The script rejects an unexpected SHA-256, stages all runtime dependencies, then verifies
`whisper-cli.exe --help`. The staged artifacts remain untracked by Git.

## Input conversion

whisper.cpp requires 16 kHz mono 16-bit PCM WAV. `whisper.rs` already converts arbitrary
audio/video through the bundled ffmpeg sidecar with `-ar 16000 -ac 1 -c:a pcm_s16le`; its
integration test verifies those stream properties when ffmpeg/ffprobe are staged.

## In-process llama.cpp brain (`--features llama`)

The default brain backend is Ollama (`brain/ollama.rs`) and needs no C++ toolchain. The optional
in-process backend is a stub until a machine has CMake, a C++ compiler, libclang for bindgen, and a
GGUF model. See `src-tauri/Cargo.toml` for the current feature boundary.
