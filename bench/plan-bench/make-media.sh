#!/usr/bin/env bash
# Regenerate the synthetic test fixtures used by the plan benchmark.
# Uses the bundled ffmpeg sidecar (libx264 is not compiled in — we use mpeg4).
set -euo pipefail
cd "$(dirname "$0")"
FF="${FLUXNODE_FFMPEG_DIR:-../../src-tauri/binaries}/ffmpeg-x86_64-pc-windows-msvc.exe"
mkdir -p media

"$FF" -y -v error -f lavfi -i "testsrc2=size=1280x720:rate=30" -f lavfi -i "sine=frequency=440" \
  -t 8 -c:v mpeg4 -q:v 5 -pix_fmt yuv420p -c:a aac media/clip.mp4
"$FF" -y -v error -f lavfi -i "testsrc2=size=640x360:rate=30" -f lavfi -i "sine=frequency=880" \
  -t 3 -c:v mpeg4 -q:v 5 -pix_fmt yuv420p -c:a aac media/clip2.mp4
"$FF" -y -v error -f lavfi -i "sine=frequency=220:sample_rate=16000" \
  -t 4 -c:a pcm_s16le media/speech.wav

echo "Regenerated: media/clip.mp4 (1280x720, 8s), media/clip2.mp4 (640x360, 3s), media/speech.wav (16kHz, 4s)"
