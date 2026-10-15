//! MCP bridge — serves the FluxNode [`Registry`](crate::action::Registry) over the Model
//! Context Protocol via stdio, so external agents/clients can discover and call every FluxNode
//! action as an MCP tool.
//!
//! Design notes:
//! * Tools are **dynamic** — one MCP tool per [`ActionDef`], derived at runtime from
//!   `Registry::defs()`. This rules out `rmcp`'s ergonomic `#[tool]` / `#[tool_router]` macros
//!   (those bake a fixed tool set at compile time), so we implement the lower-level
//!   [`ServerHandler`] trait directly and answer `list_tools` / `call_tool` ourselves.
//! * `Registry::invoke` is **synchronous** and does real backend work (may block), so every call
//!   is dispatched onto [`tokio::task::spawn_blocking`]; the MCP layer above stays fully async.
//! * Errors cross the boundary as `String`s. A tool that fails is reported as a *tool-level* error
//!   (`CallToolResult::error`, so the caller sees the message) rather than a protocol error.
//! * Side-effect gating is explicit: MCP is read-only by default. `--mcp --allow-writes` is a
//!   user-controlled opt-in for Rust-backed `Mutating` and `LongJob` actions.
//! * `FrontendEdit` actions are not advertised or callable over stdio because their executor is
//!   the live frontend store. They require a running-instance bridge, which this transport does
//!   not provide.
//! * A proposal is never reported as a successful tool call. If a gated proposal reaches this
//!   layer unexpectedly, it is returned as a tool-level error.
//!
//! Targeted crate: `rmcp` 0.16.x with features `["server", "transport-io"]`.
//!
//! The stdio process still needs a real MCP client smoke test on each packaged target.
#![allow(dead_code)]

use std::borrow::Cow;
use std::sync::Arc;

use serde_json::{Map, Value};
use tauri::AppHandle;

use rmcp::{
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    transport::stdio,
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
};

use crate::action::{ActionResult, Registry, SideEffect};

const PROPOSAL_KEY: &str = "__fluxnode_proposal__";

/// The MCP server handler. Holds a shared, read-only view of the registry plus the Tauri
/// [`AppHandle`] needed to actually run actions (`Action::run(&self, app, args)`).
#[derive(Clone)]
struct RegistryMcp {
    registry: Arc<Registry>,
    app: AppHandle,
    allow_writes: bool,
}

impl RegistryMcp {
    fn is_advertised(side_effect: SideEffect) -> bool {
        side_effect != SideEffect::FrontendEdit
    }

    /// The headless transport cannot materialize frontend-owned edits. Other writes require an
    /// explicit opt-in when the MCP process is launched.
    fn access_error(name: &str, side_effect: SideEffect, allow_writes: bool) -> Option<String> {
        match side_effect {
            SideEffect::ReadOnly => None,
            SideEffect::FrontendEdit => Some(format!(
                "{name} was not executed: this frontend-owned edit is unavailable over headless MCP."
            )),
            SideEffect::Mutating | SideEffect::LongJob if !allow_writes => Some(format!(
                "{name} was not executed: this MCP process is read-only. Restart it with --mcp --allow-writes only when you explicitly authorize backend changes."
            )),
            SideEffect::Mutating | SideEffect::LongJob => None,
        }
    }

    /// Describe whether an action can execute in this process configuration.
    fn describe(def_desc: &str, side_effect: SideEffect, allow_writes: bool) -> String {
        match side_effect {
            SideEffect::ReadOnly => def_desc.to_string(),
            SideEffect::Mutating if allow_writes => format!("[mutating] {def_desc}"),
            SideEffect::LongJob if allow_writes => format!("[long job] {def_desc}"),
            SideEffect::Mutating | SideEffect::LongJob => {
                format!("[requires --allow-writes; not executed by default] {def_desc}")
            }
            SideEffect::FrontendEdit => {
                format!("[unavailable over headless MCP] {def_desc}")
            }
        }
    }
}

fn action_result_to_tool_result(result: ActionResult) -> CallToolResult {
    match result {
        Ok(value) if value.get(PROPOSAL_KEY).is_some() => CallToolResult::error(vec![
            Content::text(
                "Action was not executed: FluxNode returned a proposal, but this MCP transport has no approval channel. No changes were made.".to_string(),
            ),
        ]),
        Ok(value) => {
            let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| value.to_string());
            CallToolResult::success(vec![Content::text(text)])
        }
        Err(err) => CallToolResult::error(vec![Content::text(err)]),
    }
}

impl ServerHandler for RegistryMcp {
    fn get_info(&self) -> ServerInfo {
        ServerInfo {
            protocol_version: ProtocolVersion::LATEST,
            capabilities: ServerCapabilities::builder().enable_tools().build(),
            server_info: Implementation {
                name: "fluxnode".into(),
                version: env!("CARGO_PKG_VERSION").into(),
                ..Default::default()
            },
            instructions: Some(if self.allow_writes {
                "FluxNode Action Registry over MCP. Rust-backed Mutating and LongJob tools are enabled by the explicit --allow-writes launch flag. FrontendEdit actions are unavailable over this headless transport.".to_string()
            } else {
                "FluxNode Action Registry over MCP. This process is read-only by default. Rust-backed Mutating and LongJob tools require restarting with --mcp --allow-writes after explicit authorization. FrontendEdit actions are unavailable over this headless transport.".to_string()
            }),
        }
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = self
            .registry
            .defs()
            .filter(|def| Self::is_advertised(def.side_effect))
            .map(|def| {
                // `params` is a JSON Schema Value; MCP wants an object schema (Map).
                let schema: Map<String, Value> = match def.params {
                    Value::Object(map) => map,
                    // Non-object schema (or none) → advertise an empty/open object schema.
                    _ => {
                        let mut m = Map::new();
                        m.insert("type".to_string(), Value::String("object".to_string()));
                        m
                    }
                };
                Tool::new(
                    Cow::Owned(def.name.to_string()),
                    Cow::Owned(Self::describe(
                        def.description,
                        def.side_effect,
                        self.allow_writes,
                    )),
                    Arc::new(schema),
                )
            })
            .collect();

        Ok(ListToolsResult {
            tools,
            next_cursor: None,
            ..Default::default()
        })
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, McpError> {
        let name = request.name.to_string();

        // Fast-fail with a protocol error for an unknown tool; the registry would also reject it,
        // but catching it here yields a cleaner "invalid params" to the client.
        if self.registry.get(&name).is_none() {
            return Err(McpError::invalid_params(
                format!("unknown tool: {name}"),
                None,
            ));
        }

        // MCP arguments are an optional JSON object; the registry expects a `Value`.
        let args = request
            .arguments
            .map(Value::Object)
            .unwrap_or(Value::Object(Map::new()));

        let action = self.registry.get(&name).expect("checked above");
        if let Some(error) = Self::access_error(&name, action.def().side_effect, self.allow_writes)
        {
            return Ok(CallToolResult::error(vec![Content::text(error)]));
        }

        // `Registry::invoke` is sync and may block on real backend work → run off the async
        // executor. Clone the shared handles into the blocking closure.
        let registry = self.registry.clone();
        let app = self.app.clone();
        let name_for_task = name.clone();
        let allow_writes = self.allow_writes;

        let result = tokio::task::spawn_blocking(move || {
            registry.invoke(&app, &name_for_task, args, allow_writes)
        })
        .await
        .map_err(|join_err| {
            McpError::internal_error(format!("action task failed: {join_err}"), None)
        })?;

        Ok(action_result_to_tool_result(result))
    }
}

/// Entry point: serve the registry over MCP on stdio and block until the peer disconnects.
///
/// Run this from a dedicated process / CLI subcommand whose stdout is reserved for the JSON-RPC
/// stream — do **not** call it inside the normal Tauri GUI process (stdout there is not the MCP
/// channel). See the module docs and the lead's integration notes.
pub async fn serve_stdio(
    registry: Arc<Registry>,
    app: AppHandle,
    allow_writes: bool,
) -> Result<(), String> {
    let handler = RegistryMcp {
        registry,
        app,
        allow_writes,
    };

    // `serve` performs the MCP initialize handshake over the stdio transport and returns a running
    // service; `waiting` resolves when the peer closes the connection.
    let service = handler
        .serve(stdio())
        .await
        .map_err(|e| format!("mcp serve init failed: {e}"))?;

    service
        .waiting()
        .await
        .map_err(|e| format!("mcp service error: {e}"))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn headless_tools_do_not_advertise_frontend_edits() {
        assert!(RegistryMcp::is_advertised(SideEffect::ReadOnly));
        assert!(RegistryMcp::is_advertised(SideEffect::Mutating));
        assert!(RegistryMcp::is_advertised(SideEffect::LongJob));
        assert!(!RegistryMcp::is_advertised(SideEffect::FrontendEdit));
    }

    #[test]
    fn write_actions_require_an_explicit_mcp_opt_in() {
        assert!(RegistryMcp::access_error("health_ping", SideEffect::ReadOnly, false).is_none());
        assert!(
            RegistryMcp::access_error("save_project_state", SideEffect::Mutating, false)
                .unwrap()
                .contains("--mcp --allow-writes")
        );
        assert!(RegistryMcp::access_error("render_start", SideEffect::LongJob, false).is_some());
        assert!(
            RegistryMcp::access_error("save_project_state", SideEffect::Mutating, true).is_none()
        );
        assert!(
            RegistryMcp::access_error("timeline_add_clip", SideEffect::FrontendEdit, true)
                .unwrap()
                .contains("unavailable over headless MCP")
        );
    }

    #[test]
    fn proposals_are_never_reported_as_successful_tool_calls() {
        let result = action_result_to_tool_result(Ok(json!({
            "__fluxnode_proposal__": { "action": "save_project_state" }
        })));
        let wire_value = serde_json::to_value(result).expect("tool result serializes");

        assert_eq!(wire_value["isError"], true);
        assert!(wire_value["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("No changes were made"));
    }
}
