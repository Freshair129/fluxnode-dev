#!/usr/bin/env bash
# Reproducible Wave-1A local-engine benchmark: same PROMPT.md → Codex vs Ollama.
# Captures raw output + wall-clock + (for Ollama) token/eval metrics.
set -u
cd "$(dirname "$0")"
PROMPT="$(cat PROMPT.md)"
OLLAMA_MODEL="aroow-rust-coder-9b:latest"
LOG="LOG.md"; : > "$LOG"

echo "# Wave-1A local benchmark" >> "$LOG"
echo "_prompt: PROMPT.md (identical input to both engines)_" >> "$LOG"; echo >> "$LOG"

# ---------- Ollama ----------
echo "## Ollama ($OLLAMA_MODEL)" >> "$LOG"
REQ=$(python -c 'import json,sys;print(json.dumps({"model":sys.argv[1],"stream":False,"options":{"temperature":0.1},"messages":[{"role":"user","content":sys.argv[2]}]}))' "$OLLAMA_MODEL" "$PROMPT")
t0=$(date +%s.%N)
RESP=$(curl -s http://127.0.0.1:11434/api/chat -d "$REQ")
t1=$(date +%s.%N)
echo "$RESP" | python -c 'import json,sys;d=json.load(sys.stdin);open("out_ollama.rs","w",encoding="utf-8").write(d.get("message",{}).get("content",""));print("  wall_s: %.1f"%(float(sys.argv[1])-float(sys.argv[2])));print("  eval_count:",d.get("eval_count"));print("  eval_s: %.2f"%(d.get("eval_duration",0)/1e9));print("  load_s: %.2f"%(d.get("load_duration",0)/1e9))' "$t1" "$t0" >> "$LOG" 2>&1
echo >> "$LOG"

# ---------- Codex ----------
echo "## Codex ($(codex --version 2>/dev/null))" >> "$LOG"
t0=$(date +%s.%N)
codex exec --skip-git-repo-check "$PROMPT" </dev/null > out_codex.raw 2>&1
rc=$?
t1=$(date +%s.%N)
echo "  wall_s: $(python -c "print('%.1f'%($t1-$t0))")" >> "$LOG"
echo "  exit: $rc" >> "$LOG"
echo >> "$LOG"

echo "done. outputs: out_ollama.rs, out_codex.raw ; metrics: LOG.md"
