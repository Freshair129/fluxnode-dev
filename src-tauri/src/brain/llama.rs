//! In-process llama.cpp brain backend (Wave 3 follow-up) — GGUF model loaded directly in the
//! process via `llama-cpp-2`, with GBNF-grammar-constrained tool calling.
//!
//! STATUS: **stub, gated behind `--features llama`.** The real implementation needs a C++ build
//! toolchain (cmake + MSVC/clang + libclang) and a GGUF model, which is why it is not built by
//! default. The `Brain` trait makes this a drop-in: once the toolchain is available,
//!   1. add `llama-cpp-2 = { version = "…", optional = true }` and `llama = ["dep:llama-cpp-2"]`,
//!   2. load the model + context in `LlamaBrain::new`,
//!   3. in `chat`, render `messages` with the model's chat template, generate under a GBNF grammar
//!      that forces either plain text or a `{"tool":<name>,"arguments":{…}}` object, and map the
//!      result to `BrainReply::{Text,ToolCalls}` — the grammar is what makes small local models
//!      reliable at tool calls,
//!   4. implement `BrainVram` by dropping / reloading the context to free VRAM for media jobs.
//!
//! Until then, constructing it returns an error so callers degrade gracefully to the Ollama brain.
#![allow(dead_code)]

use super::{Brain, ChatTurn};
use crate::media::gpu::BrainVram;
use serde_json::Value;

pub struct LlamaBrain {
    model: String,
}

impl LlamaBrain {
    /// Not yet wired — see the module docs. Returns an error so the caller can fall back.
    pub fn new(_model_path: &str) -> Result<Self, String> {
        Err("llama.cpp backend not implemented: build with a C++ toolchain and wire llama-cpp-2 \
             (see brain/llama.rs docs)"
            .to_string())
    }
}

impl Brain for LlamaBrain {
    fn model(&self) -> &str {
        &self.model
    }

    fn chat(&self, _messages: &[Value], _tools: &[Value]) -> Result<ChatTurn, String> {
        Err("llama.cpp backend not implemented".to_string())
    }
}

impl BrainVram for LlamaBrain {
    fn unload(&self) {}
    fn reload(&self) {}
}
