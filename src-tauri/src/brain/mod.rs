//! LLM brain + agent loop (Wave 3).
//!
//! The brain drives the Action registry via tool-calling: user text -> model picks tools ->
//! the registry executes them -> results are fed back -> the model answers. The `Brain` trait
//! abstracts the LLM backend so the in-process llama.cpp path can drop in later behind the same
//! interface; the first backend is `ollama` (runtime-testable today).
//!
//! Sync + blocking to match the codebase; async callers wrap in `spawn_blocking`.
#![allow(dead_code)]

#[cfg(feature = "llama")]
pub mod llama;
pub mod ollama;

use crate::action::Registry;
use serde_json::{json, Value};
use tauri::AppHandle;

pub const SYSTEM_PROMPT: &str = "You are FluxNode's in-app copilot for a video editor. \
Use the provided tools to inspect and modify the user's project. Call a tool when an action or \
data is needed; otherwise reply concisely. Never invent tool names — only call tools that exist.";

/// A tool the model asked to call.
pub struct ToolCall {
    pub name: String,
    pub arguments: Value,
}

/// The model's reply for one turn.
pub enum BrainReply {
    Text(String),
    ToolCalls(Vec<ToolCall>),
}

/// One chat turn: the raw assistant message (threaded back verbatim so the model keeps its
/// tool-call context) plus the parsed reply.
pub struct ChatTurn {
    pub raw_message: Value,
    pub reply: BrainReply,
}

/// An LLM backend. Blocking; one `chat` call = one model turn.
pub trait Brain: Send + Sync {
    fn model(&self) -> &str;
    fn chat(&self, messages: &[Value], tools: &[Value]) -> Result<ChatTurn, String>;
}

/// Build OpenAI/Ollama-style tool definitions from the registry metadata (the SSOT).
pub fn tools_from_registry(reg: &Registry) -> Vec<Value> {
    reg.defs()
        .map(|d| {
            json!({
                "type": "function",
                "function": {
                    "name": d.name,
                    "description": d.description,
                    "parameters": d.params,
                }
            })
        })
        .collect()
}

/// Run the agent loop: alternate model turns and tool executions until the model answers with
/// text or `max_steps` is exhausted. Each requested tool is dispatched through the registry, and
/// its JSON result (or `{ "error": ... }`) is fed back to the model.
///
/// Safety: when `allow_writes` is false, `Mutating` / `LongJob` tools are **not executed** — the
/// model gets a "requires user confirmation" result instead, so it can plan but cannot mutate
/// state or start jobs unsupervised. `ReadOnly` tools always run.
pub fn run_agent(
    app: &AppHandle,
    reg: &Registry,
    brain: &dyn Brain,
    user_message: &str,
    max_steps: usize,
    allow_writes: bool,
) -> Result<String, String> {
    let tools = tools_from_registry(reg);
    let mut messages = vec![
        json!({ "role": "system", "content": SYSTEM_PROMPT }),
        json!({ "role": "user", "content": user_message }),
    ];

    for _ in 0..max_steps {
        let turn = brain.chat(&messages, &tools)?;
        // Thread the assistant turn back verbatim (keeps tool_calls intact for the model).
        messages.push(turn.raw_message);
        match turn.reply {
            BrainReply::Text(text) => return Ok(text),
            BrainReply::ToolCalls(calls) => {
                for call in calls {
                    // `Registry::invoke` is the single write gate (see `action::Registry::invoke`)
                    // — it refuses `Mutating`/`LongJob` actions itself when `allow_writes` is
                    // false, so every caller (this loop, `action_invoke`, the MCP server) is
                    // gated identically instead of each reimplementing the check.
                    let result = reg
                        .invoke(app, &call.name, call.arguments.clone(), allow_writes)
                        .unwrap_or_else(|e| json!({ "error": e }));
                    messages.push(json!({
                        "role": "tool",
                        "name": call.name,
                        "content": result.to_string(),
                    }));
                }
            }
        }
    }
    Err(format!(
        "agent: exceeded max_steps ({max_steps}) without a final answer"
    ))
}
