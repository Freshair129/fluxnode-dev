//! Ollama brain backend — talks to a local Ollama server (`/api/chat`) with tool-calling.
//!
//! Runtime-testable today: no bundled model, no C++/CUDA build. The in-process llama.cpp backend
//! (GGUF + GBNF grammar) is a future addition behind a feature flag, implementing the same
//! `Brain` trait. Also implements `BrainVram` so the `GpuArbiter` can evict the model from VRAM
//! for the duration of a heavy media job and warm it back afterwards.
#![allow(dead_code)]

use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::thread;
use std::time::{Duration, Instant};

use super::{Brain, BrainReply, ChatTurn, ToolCall};
use crate::media::gpu::BrainVram;

pub struct OllamaBrain {
    endpoint: String,
    model: String,
}

impl OllamaBrain {
    pub fn new(endpoint: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            endpoint: endpoint.into().trim_end_matches('/').to_string(),
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

    fn read_running_models(&self, client: &Client) -> Result<Vec<String>, String> {
        let response = client
            .get(format!("{}/api/ps", self.endpoint.trim_end_matches('/')))
            .send()
            .map_err(|error| format!("ollama: could not inspect running models: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("ollama: /api/ps returned {status}"));
        }
        let value: Value = response
            .json()
            .map_err(|error| format!("ollama: /api/ps returned invalid JSON: {error}"))?;
        running_model_names(&value)
    }

    fn wait_for_model_state(
        &self,
        client: &Client,
        should_be_running: bool,
        timeout: Duration,
    ) -> Result<(), String> {
        let deadline = Instant::now() + timeout;
        loop {
            let running = self.read_running_models(client)?;
            let is_running = running
                .iter()
                .any(|name| same_model_identity(name, &self.model));
            if is_running == should_be_running {
                return Ok(());
            }
            if Instant::now() >= deadline {
                let expected = if should_be_running {
                    "to appear"
                } else {
                    "to disappear"
                };
                return Err(format!(
                    "ollama: configured model '{}' did not {expected} in /api/ps before timeout",
                    self.model
                ));
            }
            thread::sleep(Duration::from_millis(250));
        }
    }

    fn generate_empty_prompt(&self, keep_alive: Value, timeout: Duration) -> Result<Value, String> {
        let client = Self::client(timeout)?;
        let response = client
            .post(format!(
                "{}/api/generate",
                self.endpoint.trim_end_matches('/')
            ))
            .json(&json!({
                "model": self.model,
                "prompt": "",
                "keep_alive": keep_alive,
                "stream": false,
            }))
            .send()
            .map_err(|error| format!("ollama: model handoff request failed: {error}"))?;
        let status = response.status();
        if !status.is_success() {
            return Err(format!("ollama: model handoff request returned {status}"));
        }
        response
            .json()
            .map_err(|error| format!("ollama: model handoff returned invalid JSON: {error}"))
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
            .post(format!("{}/api/chat", self.endpoint.trim_end_matches('/')))
            .json(&body)
            .send()
            .map_err(|e| format!("ollama: request failed: {e}"))?;
        let status = resp.status();
        let body = resp
            .text()
            .map_err(|e| format!("ollama: could not read chat response: {e}"))?;
        parse_chat_response(status, &body)
    }
}

fn parse_chat_response(status: reqwest::StatusCode, body: &str) -> Result<ChatTurn, String> {
    let value: Value = serde_json::from_str(body)
        .map_err(|error| format!("ollama: bad json response: {error}"))?;
    if !status.is_success() {
        let detail = value
            .get("error")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|error| !error.is_empty());
        return Err(match detail {
            Some(detail) => format!("ollama: chat returned {status}: {detail}"),
            None => format!("ollama: chat returned {status}"),
        });
    }
    if let Some(error) = value.get("error") {
        let detail = error
            .as_str()
            .map(str::trim)
            .filter(|error| !error.is_empty())
            .unwrap_or("server reported an error");
        return Err(format!("ollama: chat returned an error: {detail}"));
    }
    let message = value
        .get("message")
        .filter(|message| message.is_object())
        .cloned()
        .ok_or_else(|| "ollama: chat response is missing its message object".to_string())?;

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

impl BrainVram for OllamaBrain {
    fn managed_endpoint_identity(&self) -> String {
        self.endpoint.trim_end_matches('/').to_ascii_lowercase()
    }

    fn managed_model_identity(&self) -> String {
        normalize_model_identity(&self.model)
    }

    /// Unload only this FluxNode-selected model, and only if /api/ps says it was resident.
    fn unload(&self) -> Result<bool, String> {
        let client = Self::client(Duration::from_secs(10))?;
        let running = self.read_running_models(&client)?;
        if !running
            .iter()
            .any(|name| same_model_identity(name, &self.model))
        {
            return Ok(false);
        }

        let response = self.generate_empty_prompt(json!(0), Duration::from_secs(10))?;
        validate_generate_ack(&response, &self.model, Some("unload"))?;
        self.wait_for_model_state(&client, false, Duration::from_secs(10))?;
        Ok(true)
    }

    /// Reload this same selected model and wait until Ollama reports that exact model running.
    fn reload(&self) -> Result<(), String> {
        let client = Self::client(Duration::from_secs(30))?;
        let response = self.generate_empty_prompt(json!("5m"), Duration::from_secs(30))?;
        validate_generate_ack(&response, &self.model, None)?;
        self.wait_for_model_state(&client, true, Duration::from_secs(30))
    }
}

fn normalize_model_identity(name: &str) -> String {
    let name = name.trim().to_ascii_lowercase();
    let last_slash = name.rfind('/');
    let has_tag = name.rfind(':').is_some_and(|colon| {
        last_slash.is_none_or(|slash| colon > slash) && colon + 1 < name.len()
    });
    if has_tag {
        name
    } else {
        format!("{name}:latest")
    }
}

pub(crate) fn same_model_identity(left: &str, right: &str) -> bool {
    normalize_model_identity(left) == normalize_model_identity(right)
}

fn running_model_names(response: &Value) -> Result<Vec<String>, String> {
    let models = response
        .get("models")
        .and_then(Value::as_array)
        .ok_or_else(|| "ollama: /api/ps response is missing its models array".to_string())?;
    models
        .iter()
        .map(|model| {
            let identity = model
                .get("name")
                .and_then(non_empty_string)
                .or_else(|| model.get("model").and_then(non_empty_string))
                .ok_or_else(|| {
                    "ollama: /api/ps returned a model without a valid name".to_string()
                })?;
            Ok(identity.to_string())
        })
        .collect()
}

fn non_empty_string(value: &Value) -> Option<&str> {
    value
        .as_str()
        .filter(|identity| !identity.trim().is_empty())
}

fn validate_generate_ack(
    response: &Value,
    expected_model: &str,
    expected_done_reason: Option<&str>,
) -> Result<(), String> {
    let model = response
        .get("model")
        .and_then(Value::as_str)
        .ok_or_else(|| "ollama: handoff response is missing model identity".to_string())?;
    if !same_model_identity(model, expected_model) {
        return Err(format!(
            "ollama: handoff response acknowledged '{model}', expected '{expected_model}'"
        ));
    }
    if response.get("done").and_then(Value::as_bool) != Some(true) {
        return Err("ollama: handoff response did not acknowledge completion".to_string());
    }
    if let Some(expected) = expected_done_reason {
        if response.get("done_reason").and_then(Value::as_str) != Some(expected) {
            return Err(format!(
                "ollama: unload response did not acknowledge done_reason '{expected}'"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn running_model_identity_matches_latest_alias_without_matching_other_models() {
        let running = running_model_names(&json!({
            "models": [
                { "name": "another-model:latest" },
                { "model": "mellum:latest" }
            ]
        }))
        .expect("/api/ps fixture should parse");

        assert!(running
            .iter()
            .any(|name| same_model_identity(name, "mellum")));
        assert!(!running
            .iter()
            .any(|name| same_model_identity(name, "mellum:7b")));
        assert!(!running
            .iter()
            .any(|name| same_model_identity(name, "qwen3.5:4b")));
        assert!(same_model_identity(
            "registry.example:5000/team/model",
            "registry.example:5000/team/model:latest"
        ));
        assert!(!same_model_identity(
            "registry.example:5000/team/model:latest",
            "registry.example:5000/team/model:4b"
        ));
    }

    #[test]
    fn handoff_ack_requires_expected_model_and_completed_request() {
        assert!(validate_generate_ack(
            &json!({"model":"mellum:latest","done":true,"done_reason":"unload"}),
            "mellum",
            Some("unload")
        )
        .is_ok());
        assert!(validate_generate_ack(
            &json!({"model":"other:latest","done":true,"done_reason":"unload"}),
            "mellum",
            Some("unload")
        )
        .is_err());
        assert!(validate_generate_ack(
            &json!({"model":"mellum:latest","done":false}),
            "mellum",
            None
        )
        .is_err());
    }

    #[test]
    fn malformed_running_model_response_is_an_error() {
        assert!(running_model_names(&json!({})).is_err());
        assert!(running_model_names(&json!({"models":[{}]})).is_err());
    }

    #[test]
    fn running_model_name_falls_back_only_to_a_valid_model_identity() {
        let running = running_model_names(&json!({
            "models": [
                { "name": "", "model": "mellum:latest" },
                { "name": 12, "model": "qwen3:4b" }
            ]
        }))
        .expect("valid fallback identities should parse");
        assert_eq!(running, ["mellum:latest", "qwen3:4b"]);
        assert!(running_model_names(&json!({
            "models": [{ "name": "  ", "model": "" }]
        }))
        .is_err());
    }

    #[test]
    fn chat_parser_rejects_http_and_payload_errors_without_registering_empty_success() {
        let server_error = parse_chat_response(
            reqwest::StatusCode::INTERNAL_SERVER_ERROR,
            r#"{"error":"model is unloading"}"#,
        )
        .err()
        .expect("HTTP 500 must not become an empty chat reply");
        assert!(server_error.contains("500"));
        assert!(server_error.contains("model is unloading"));

        assert!(parse_chat_response(reqwest::StatusCode::OK, r#"{"error":"failed"}"#).is_err());
        let missing_message = parse_chat_response(reqwest::StatusCode::OK, "{}")
            .err()
            .expect("missing message must fail");
        assert!(missing_message.contains("message object"));
        assert!(parse_chat_response(reqwest::StatusCode::OK, r#"{"message":null}"#).is_err());
        assert!(parse_chat_response(reqwest::StatusCode::OK, r#"{"message":"bad"}"#).is_err());
    }

    #[test]
    fn chat_parser_preserves_empty_text_and_tool_call_responses() {
        let empty = parse_chat_response(
            reqwest::StatusCode::OK,
            r#"{"message":{"role":"assistant","thinking":"reasoning only"}}"#,
        )
        .expect("thinking-only assistant messages are valid");
        assert!(matches!(empty.reply, BrainReply::Text(ref text) if text.is_empty()));

        let tool = parse_chat_response(
            reqwest::StatusCode::OK,
            r#"{"message":{"role":"assistant","tool_calls":[{"function":{"name":"health_ping","arguments":{}}}]}}"#,
        )
        .expect("valid tool call must be retained");
        assert!(
            matches!(tool.reply, BrainReply::ToolCalls(ref calls) if calls.len() == 1 && calls[0].name == "health_ping")
        );
    }
}
