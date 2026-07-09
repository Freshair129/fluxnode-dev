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
//! * Side-effect gating: all tools are exposed, but `Mutating` / `LongJob` actions get a
//!   `[mutating]` / `[long job]` marker prefixed to their advertised description so clients can warn
//!   before invoking. No auth layer yet.
//!
//! Targeted crate: `rmcp` 0.16.x with features `["server", "transport-io"]`.
#![allow(dead_code)]

use std::borrow::Cow;
use std::sync::Arc;

use serde_json::{Map, Value};
use tauri::AppHandle;

use rmcp::{
    ErrorData as McpError, RoleServer, ServerHandler, ServiceExt,
    model::{
        CallToolRequestParams, CallToolResult, Content, Implementation, ListToolsResult,
        PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo, Tool,
    },
    service::RequestContext,
    transport::stdio,
};

use crate::action::{Registry, SideEffect};

/// The MCP server handler. Holds a shared, read-only view of the registry plus the Tauri
/// [`AppHandle`] needed to actually run actions (`Action::run(&self, app, args)`).
#[derive(Clone)]
struct RegistryMcp {
    registry: Arc<Registry>,
    app: AppHandle,
}

impl RegistryMcp {
    /// Build the advertised description for an action, prefixing a side-effect marker so MCP
    /// clients can warn the user before invoking mutating / long-running tools.
    fn describe(def_desc: &str, side_effect: SideEffect) -> String {
        match side_effect {
            SideEffect::ReadOnly => def_desc.to_string(),
            SideEffect::Mutating => format!("[mutating] {def_desc}"),
            SideEffect::LongJob => format!("[long job] {def_desc}"),
        }
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
            instructions: Some(
                "FluxNode Action Registry exposed over MCP. Each tool maps to one FluxNode \
                 action; descriptions prefixed with [mutating] change state and [long job] kick \
                 off background work."
                    .to_string(),
            ),
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
                    Cow::Owned(Self::describe(def.description, def.side_effect)),
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

        // `Registry::invoke` is sync and may block on real backend work → run off the async
        // executor. Clone the shared handles into the blocking closure.
        let registry = self.registry.clone();
        let app = self.app.clone();
        let name_for_task = name.clone();

        // The MCP server is read-only by design (no confirmation UI exists over this transport):
        // `allow_writes = false` means `Registry::invoke` refuses every `Mutating`/`LongJob`
        // action before it runs, regardless of what the tool schema might suggest.
        let result = tokio::task::spawn_blocking(move || {
            registry.invoke(&app, &name_for_task, args, false)
        })
        .await
        .map_err(|join_err| {
            // The blocking task panicked or was cancelled — that's a server-internal fault.
            McpError::internal_error(format!("action task failed: {join_err}"), None)
        })?;

        match result {
            // Success: return the JSON value as pretty text content. (Clients that want the raw
            // JSON can parse this back; MCP tool output is text/content blocks.)
            Ok(value) => {
                let text = serde_json::to_string_pretty(&value)
                    .unwrap_or_else(|_| value.to_string());
                Ok(CallToolResult::success(vec![Content::text(text)]))
            }
            // Action returned an error String → surface it as a *tool-level* error so the caller
            // sees the message (not a hard protocol error).
            Err(err) => Ok(CallToolResult::error(vec![Content::text(err)])),
        }
    }
}

/// Entry point: serve the registry over MCP on stdio and block until the peer disconnects.
///
/// Run this from a dedicated process / CLI subcommand whose stdout is reserved for the JSON-RPC
/// stream — do **not** call it inside the normal Tauri GUI process (stdout there is not the MCP
/// channel). See the module docs and the lead's integration notes.
pub async fn serve_stdio(registry: Arc<Registry>, app: AppHandle) -> Result<(), String> {
    let handler = RegistryMcp { registry, app };

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
