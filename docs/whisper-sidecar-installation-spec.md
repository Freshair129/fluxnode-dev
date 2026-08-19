# Whisper Sidecar Installation Specification

## Scope

This specification makes the Windows x64 `whisper.cpp` transcription path installable and runtime-verifiable. It deliberately does not change Piper, stable-diffusion.cpp, the transcript contract, or the UI.

## Pinned inputs

| Item | Source | Version / SHA-256 |
|---|---|---|
| `whisper-cli.exe` and runtime DLLs | `ggml-org/whisper.cpp` release archive | `v1.8.6` / `B07EA0B1B4115A38E1A7B07DEBF581F0B77D999925F8ACB8F39D322B0BA0A822` |
| English base model | `ggerganov/whisper.cpp` model repository | `ggml-base.en.bin` / `A03779C86DF3323075F5E796CB2CE5029F00EC8869EEE3FDFB897AFE36C6D002` |

The fetch script must reject a checksum mismatch. Binaries and models remain ignored by Git.

## Installed layout

```
src-tauri/binaries/whisper/
  whisper-cli.exe
  ggml.dll
  ggml-base.dll
  ggml-cpu.dll
  whisper.dll
  SDL2.dll
  ggml-base.en.bin
```

The DLLs are kept beside the executable because the upstream Windows release loads them from the sidecar directory. The Tauri bundle ships this directory as resources, preserving that colocation.

## Resolution order

1. Explicit `FLUXNODE_WHISPER_BIN` and `FLUXNODE_WHISPER_MODEL` paths, when both exist.
2. The staged development directory above.
3. The bundled Tauri resource directory (`whisper/`).

No transcription backend is registered if a complete binary-and-model pair is unavailable.

## Verification and acceptance criteria

1. `powershell -ExecutionPolicy Bypass -File scripts/fetch-whisper.ps1` downloads, validates, and stages every file.
2. `whisper-cli.exe --help` exits successfully from the staged directory.
3. `cargo test whisper` passes the parser and 16 kHz ffmpeg conversion tests; when the sidecar and model are staged it also runs a real CLI smoke test and checks that JSON is emitted.
4. `cargo check` and `npm run build` pass.
5. A release-candidate package must be inspected once to confirm `resources/whisper/` contains the executable, all staged runtime DLLs, and model before this path is described as release-verified.

## Packaging evidence

On 2026-07-19, `npm run tauri:build` produced both Windows x64 installers. The generated MSI
authoring lists `resources/whisper/` with `whisper-cli.exe`, `ggml.dll`, `ggml-base.dll`,
`ggml-cpu.dll`, `whisper.dll`, `SDL2.dll`, and `ggml-base.en.bin`. The command then reported the
separate updater-signing configuration error because `TAURI_SIGNING_PRIVATE_KEY` is absent; the
installers themselves were already created and inspected. This verifies packaging, not a clean
machine install or updater signing.

## Failure behavior

An absent or incomplete installation keeps STT unregistered and the existing action returns `no STT backend registered`; it does not fall back to cloud transcription.
