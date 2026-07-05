<think>
The user wants me to write Rust code following the exact pattern shown in the example. I need to create Action wrappers for two existing commands:

1. `inspect_asset_path` - takes a path string, returns inspection result as JSON text
2. `asset_probe` - takes a path string, returns ffprobe result as JSON text

Both should follow the same structure as the GetAppVersion example. I need to:
- Create struct definitions for each action
- Implement Action trait for each
- Use OnceLock for lazy initialization of ActionDef
- Follow the exact style from the worked example
- Output ONLY Rust code, no prose or markdown fences

Let me write this following the pattern exactly.
</think>

```rust
use crate::action::{Action, ActionDef, ActionResult, SideEffect};
use serde_json::{json, Value};
use std::sync::OnceLock;
use tauri::AppHandle;

pub struct InspectAssetPath;

impl Action for InspectAssetPath {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "inspect_asset_path",
            description: "Inspect an asset file path and return metadata.",
            params: json!({ "type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"] }),
            side_effect: SideEffect::ReadOnly,
        })
    }
    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let result = crate::inspect_asset_path(path)?;      // existing command
        Ok(json!({ "inspection": result }))
    }
}

pub struct AssetProbe;

impl Action for AssetProbe {
    fn def(&self) -> &ActionDef {
        static DEF: OnceLock<ActionDef> = OnceLock::new();
        DEF.get_or_init(|| ActionDef {
            name: "asset_probe",
            description: "Run ffprobe on an asset file and return probe results.",
            params: json!({ "type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"] }),
            side_effect: SideEffect::ReadOnly,
        })
    }
    fn run(&self, _app: &AppHandle, args: Value) -> ActionResult {
        let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let result = crate::asset_probe(path)?;             // existing command
        Ok(json!({ "probe": result }))
    }
}
```