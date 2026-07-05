# AI Copilot — Sidecar Binary Setup & Verification

The media/voice backends shell out to sidecar binaries, mirroring the existing ffmpeg/ffprobe
pattern. As of this commit the repo bundles **only** `ffmpeg` / `ffprobe`
(`src-tauri/binaries/`); whisper / piper / sd are **not present**, so their CLI flags below are
**best-effort assumptions cross-checked against each tool's documented CLI** — not yet runtime
verified. Obtain each binary, drop it in `src-tauri/binaries/` with the platform-triple name
(e.g. `sd-x86_64-pc-windows-msvc.exe`, matching `ffmpeg-x86_64-pc-windows-msvc.exe`), then run the
verify command and reconcile any flag drift in the noted file.

## Flag cross-check status

| Backend | Binary | Assumed flags | vs. documented CLI | Fix location if drift |
|---|---|---|---|---|
| whisper.rs | `whisper-cli` (whisper.cpp) | `-m <model> -f <audio> -oj` → reads `<audio>.json` | ✅ matches (`-oj` = `--output-json`; JSON has `transcription[].offsets{from,to}` ms + `text`) | `parse_whisper_json` |
| piper.rs | `piper` | `--model <voice.onnx> --output_file <wav>`, text on **stdin** | ✅ matches; also needs sibling `<voice>.onnx.json` | `PiperBackend::synth` |
| sdcpp.rs | `sd` (stable-diffusion.cpp) | `-M txt2img\|img2img -m -p [-n] -W -H --steps [-s] -o [-i] [--mask]` | ✅ matches (`-M/-m/-p/-n/-W/-H/--steps/-s/-o/-i` are real; `--mask` for inpaint) | `SdCppBackend::generate` |
| comfy.rs | (HTTP, no binary) | ComfyUI `/prompt`,`/history`,`/view` | ✅ existing client, unchanged | `crate::comfy` |

Confidence: flags align with each project's published CLI. The remaining unknowns are
**build-specific**: some `sd` builds default to txt2img and reject an explicit `-M txt2img`, and
older builds used `--width/--height` instead of `-W/-H`. Confirm against the shipped binary's
`--help`.

## Verify commands (run once the binary is in place)

```sh
# whisper — expect a <sample>.json next to the input with transcription[].offsets + text
whisper-cli -m ggml-base.en.bin -f sample.wav -oj && cat sample.wav.json

# piper — expect out.wav to play the spoken text
echo "nerf crystal maiden again" | piper --model en_US-amy-medium.onnx --output_file out.wav

# sd — expect out.png at 768x512
sd -M txt2img -m model.gguf -p "a ice wizard" -W 768 -H 512 --steps 20 -o out.png
```

If any command's real flags differ, update only the noted backend file — the trait contract and
broker routing are unaffected.

## In-process llama.cpp brain (`--features llama`)

The default brain backend is **Ollama** (`brain/ollama.rs`, runtime-verified) — no build toolchain
needed. The optional in-process backend (`brain/llama.rs`, behind the `llama` feature) is a
**stub** until built on a machine with a C++ toolchain, because `llama-cpp-2` compiles llama.cpp
from source.

Prerequisites to implement/enable it:
- **cmake**, a **C++ compiler** (MSVC `cl` / clang), and **libclang** (LLVM) for bindgen.
- A **GGUF model** (e.g. `qwen3-4b-instruct-q4_k_m.gguf`) — reuse an Ollama blob or download.

Then: add `llama-cpp-2 = { version = "…", optional = true }`, switch the feature to
`llama = ["dep:llama-cpp-2"]`, flesh out `LlamaBrain` (load model → generate under a GBNF grammar
that forces text-or-tool-call JSON → map to `BrainReply`), and build with `cargo build --features
llama`. The `Brain` trait means no other code changes.

## whisper input caveat

whisper.cpp accepts only 16 kHz mono 16-bit PCM WAV. `whisper.rs` has a `TODO(ffmpeg pre-convert)`
for `ffmpeg -i <in> -ar 16000 -ac 1 -c:a pcm_s16le <tmp>.wav` using the already-bundled ffmpeg
sidecar; wire it before transcribing arbitrary audio.
