You are writing Rust for the FluxNode project. Follow the existing pattern EXACTLY. Output ONLY Rust code — no prose, no explanation, no markdown fences.

# The Action trait (already defined in crate::action)

```rust
pub type ActionResult = Result<serde_json::Value, String>;

pub enum SideEffect { ReadOnly, Mutating, LongJob }

pub struct ActionDef {
    pub name: &'static str,
    pub description: &'static str,
    pub params: serde_json::Value,   // JSON Schema for the args object
    pub side_effect: SideEffect,
}

pub trait Action: Send + Sync {
    fn def(&self) -> &ActionDef;
    fn run(&self, app: &tauri::AppHandle, args: serde_json::Value) -> ActionResult;
}
```

# Rules

- One struct per wrapped command, implementing `Action`.
- Build the `ActionDef` once (lazily) with a correct JSON-Schema `params` describing the args.
- In `run`, deserialize the fields you need out of `args` (serde_json), call the existing command's inner logic, and return the result as `serde_json::Value` (use `serde_json::json!` or `serde_json::to_value`).
- The existing commands already exist as functions you can call as `crate::<name>(...)`. Assume each returns `Result<T, String>` where T serializes to JSON.
- Errors: propagate the `String` error.
- Add `use` lines you need. Use `once_cell::sync::Lazy` OR a `std::sync::OnceLock` for the static `ActionDef`.

# Worked example (this is the pattern — copy it)

```rust
use crate::action::{Action, ActionDef, ActionResult, SideEffect};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::AppHandle;

pub struct GetAppVersion;

impl Action for GetAppVersion {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "get_app_version",
            description: "Return the running app version string.",
            params: json!({ "type": "object", "properties": {}, "required": [] }),
            side_effect: SideEffect::ReadOnly,
        })
    }
    fn run(&self, _app: &AppHandle, _args: Value) -> ActionResult {
        let v = crate::get_app_version()?;      // existing command, returns Result<String,String>
        Ok(json!({ "version": v }))
    }
}
```

# YOUR TASK

Write Action wrappers, in the same style, for these two existing commands:

1. `crate::inspect_asset_path(path: String) -> Result<String, String>`
   - args: `{ "path": string }`  — side_effect: ReadOnly
   - returns a JSON string; return it under key `"inspection"` (parse it back to Value if it is JSON text, else return as string).

2. `crate::asset_probe(path: String) -> Result<String, String>`
   - args: `{ "path": string }`  — side_effect: ReadOnly
   - returns a JSON string (ffprobe result); return it under key `"probe"`.

Output ONLY the Rust code for these two structs + their impls (plus any `use` lines). Nothing else.
