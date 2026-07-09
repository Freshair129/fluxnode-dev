//! Ollama brain backend — talks to a local Ollama server (`/api/chat`) with tool-calling.
//!
//! Runtime-testable today: no bundled model, no C++/CUDA build. The in-process llama.cpp backend
//! (GGUF + GBNF grammar) is a future addition behind a feature flag, implementing the same
//! `Brain` trait. Also implements `BrainVram` so the `GpuArbiter` can evict the model from VRAM
//! for the duration of a heavy media job and warm it back afterwards.
#![allow(dead_code)]

use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::time::Duration;

use super::{Brain, BrainReply, ChatTurn, ToolCall};
use crate::media::gpu::BrainVram;

pub struct OllamaBrain {
    endpoint: String,
    model: String,
}

impl OllamaBrain {
    pub fn new(endpoint: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into(),
            model: model.into(),
        }
    }

    /// Local Ollama; pass a tool-calling-capable model (e.g. `qwen3:4b`).
    pub fn local(model: impl Into<String>) -> Self {
        Self::new("http://127.0.0.1:11434", model)
    }

    fn client(timeout: Duration) -> Result<Client, String> {
        Client::builder()
            .timeout(timeout)
            .build()
            .map_err(|e| format!("ollama: client build failed: {e}"))
    }
}

impl Brain for OllamaBrain {
    fn model(&self) -> &str {
        &self.model
    }

    fn chat(&self, messages: &[Value], tools: &[Value]) -> Result<ChatTurn, String> {
        let body = json!({
            "model": self.model,
            "messages": messages,
            "tools": tools,
            "stream": false,
            "options": { "temperature": 0.2 }
        });
        let resp = Self::client(Duration::from_secs(180))?
            .post(format!("{}/api/chat", self.endpoint))
            .json(&body)
            .send()
            .map_err(|e| format!("ollama: request failed: {e}"))?;
        let v: Value = resp
            .json()
            .map_err(|e| format!("ollama: bad json response: {e}"))?;
        let message = v.get("message").cloned().unwrap_or_else(|| json!({}));

        // Tool calls take precedence over any content.
        if let Some(tcs) = message.get("tool_calls").and_then(Value::as_array) {
            if !tcs.is_empty() {
                let calls = tcs
                    .iter()
                    .map(|tc| {
                        let f = tc.get("function").cloned().unwrap_or_default();
                        ToolCall {
                            name: f
                                .get("name")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                                .to_string(),
                            // Ollama returns arguments already as a JSON object.
                            arguments: f.get("arguments").cloned().unwrap_or_else(|| json!({})),
                        }
                    })
                    .collect();
                return Ok(ChatTurn {
                    raw_message: message,
                    reply: BrainReply::ToolCalls(calls),
                });
            }
        }

        let text = message
            .get("content")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        Ok(ChatTurn {
            raw_message: message,
            reply: BrainReply::Text(text),
        })
    }
}

impl BrainVram for OllamaBrain {
    /// Evict the model from VRAM so a heavy media job can use the GPU (`keep_alive: 0`).
    fn unload(&self) {
        if let Ok(client) = Self::client(Duration::from_secs(10)) {
            let _ = client
                .post(format!("{}/api/generate", self.endpoint))
                .json(&json!({ "model": self.model, "keep_alive": 0 }))
                .send();
        }
    }

    /// Warm the model back into VRAM after the media job releases the GPU.
    fn reload(&self) {
        if let Ok(client) = Self::client(Duration::from_secs(30)) {
            let _ = client
                .post(format!("{}/api/generate", self.endpoint))
                .json(&json!({ "model": self.model, "keep_alive": "5m" }))
                .send();
        }
    }
}
