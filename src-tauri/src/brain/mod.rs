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

/// Benchmark/debug tracing: when `FLUXNODE_AGENT_TRACE=1`, every agent-loop event is emitted to
/// stderr as one `AGENT_TRACE {json}` line so external harnesses can score tool plans without
/// touching the loop's return value.
fn trace(event: Value) {
    if std::env::var("FLUXNODE_AGENT_TRACE").is_ok_and(|v| v == "1") {
        eprintln!("AGENT_TRACE {event}");
    }
}

pub const SYSTEM_PROMPT: &str = "You are FluxNode's in-app copilot for a video editor. \
Use the provided tools to inspect and modify the user's project. Call a tool when an action or \
data is needed; otherwise reply concisely. Never invent tool names — only call tools that exist. \
Asset operations (probe, waveform, thumbnail, proxy, transcribe, decode frame) work directly on \
a raw file path — no project needs to be open first. When a tool result says an action requires \
user confirmation, it means the action is valid but gated: tell the user what you want to run \
and ask them to approve it; do not conclude that access is restricted.";

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

/// The result of an agent run: the final text answer plus any gated actions the run *proposed*
/// (write/long-running or timeline edits that were not executed and await user approval). The
/// frontend renders `proposals` as ghost edits to approve; headless callers can ignore them.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AgentOutcome {
    pub answer: String,
    pub proposals: Vec<Value>,
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
) -> Result<AgentOutcome, String> {
    let tools = tools_from_registry(reg);
    let mut messages = vec![
        json!({ "role": "system", "content": SYSTEM_PROMPT }),
        json!({ "role": "user", "content": user_message }),
    ];
    let mut proposals: Vec<Value> = Vec::new();

    for step in 0..max_steps {
        let turn = brain.chat(&messages, &tools)?;
        // Thread the assistant turn back verbatim (keeps tool_calls intact for the model).
        messages.push(turn.raw_message);
        match turn.reply {
            BrainReply::Text(text) => {
                trace(json!({ "event": "final", "step": step, "proposals": proposals.len() }));
                return Ok(AgentOutcome { answer: text, proposals });
            }
            BrainReply::ToolCalls(calls) => {
                for call in calls {
                    trace(json!({
                        "event": "tool_call",
                        "step": step,
                        "name": call.name,
                        "arguments": call.arguments,
                    }));
                    // `Registry::invoke` is the single write gate (see `action::Registry::invoke`):
                    // gated write/edit actions come back as a `__fluxnode_proposal__` value rather
                    // than executing, so every caller (this loop, `action_invoke`, the MCP server)
                    // is gated identically. We collect proposals and feed the model a short
                    // "queued for approval" note so it stops and asks instead of assuming success.
                    let result = reg
                        .invoke(app, &call.name, call.arguments.clone(), allow_writes)
                        .unwrap_or_else(|e| json!({ "error": e }));

                    let (tool_content, proposed) = match result.get("__fluxnode_proposal__") {
                        Some(proposal) => {
                            proposals.push(proposal.clone());
                            (
                                json!({
                                    "status": "proposed",
                                    "note": "Queued for user approval — do not assume it ran; tell the user what you want to do and ask them to approve."
                                })
                                .to_string(),
                                true,
                            )
                        }
                        None => (result.to_string(), false),
                    };

                    trace(json!({
                        "event": "tool_result",
                        "step": step,
                        "name": call.name,
                        "ok": result.get("error").is_none(),
                        "proposed": proposed,
                        "result": tool_content.chars().take(600).collect::<String>(),
                    }));
                    messages.push(json!({
                        "role": "tool",
                        "name": call.name,
                        "content": tool_content,
                    }));
                }
            }
        }
    }
    Err(format!(
        "agent: exceeded max_steps ({max_steps}) without a final answer"
    ))
}
