//! Action registry — the single source of truth for every capability FluxNode exposes.
//!
//! Wave 0 contract. See `docs/AI Copilot and Media Adapter Design.md`.
//! The 43 existing `#[tauri::command]` fns are wrapped as `Action`s (Wave 1A); every caller
//! (in-app agent, voice, MCP server, CLI) goes through this registry, and the LLM tool schema /
//! MCP tool list / CLI subcommands are all *derived* from `ActionDef` — never hand-maintained.
#![allow(dead_code)]

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use tauri::AppHandle;

/// Every action returns JSON or a String error, matching the existing command convention
/// (`Result<T, String>` across the whole backend).
pub type ActionResult = Result<Value, String>;

/// How a caller should treat an action's side effects (confirmation gating, job handling).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SideEffect {
    /// Pure read — safe to auto-run (e.g. `asset_probe`, `render_get_status`).
    ReadOnly,
    /// Mutates state — confirm in interactive contexts (e.g. `save_project_state_as`).
    Mutating,
    /// Kicks off a long background job — returns a job handle, progress is polled
    /// (e.g. `generate_video`, `start_export_job`).
    LongJob,
}

/// Static description of an action. This metadata is the contract every caller derives from.
#[derive(Debug, Clone)]
pub struct ActionDef {
    pub name: &'static str,
    pub description: &'static str,
    /// JSON Schema for the params object (fed to the LLM / advertised over MCP).
    pub params: Value,
    pub side_effect: SideEffect,
}

/// One callable capability. Synchronous to match the existing `#[tauri::command]` fns;
/// async callers (brain loop, MCP server) invoke via `tokio::task::spawn_blocking`.
pub trait Action: Send + Sync {
    fn def(&self) -> &ActionDef;
    fn run(&self, app: &AppHandle, args: Value) -> ActionResult;
}

/// The registry. Built once at startup, then shared read-only.
#[derive(Default)]
pub struct Registry {
    actions: HashMap<&'static str, Arc<dyn Action>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&mut self, action: Arc<dyn Action>) {
        self.actions.insert(action.def().name, action);
    }

    pub fn get(&self, name: &str) -> Option<Arc<dyn Action>> {
        self.actions.get(name).cloned()
    }

    /// Iterate every action's metadata — source for LLM tool schema, MCP tools, CLI subcommands.
    pub fn defs(&self) -> impl Iterator<Item = ActionDef> + '_ {
        self.actions.values().map(|a| a.def().clone())
    }

    /// The universal entry point for agent / MCP / CLI: invoke an action by name.
    pub fn invoke(&self, app: &AppHandle, name: &str, args: Value) -> ActionResult {
        let action = self
            .get(name)
            .ok_or_else(|| format!("unknown action: {name}"))?;
        action.run(app, args)
    }
}
