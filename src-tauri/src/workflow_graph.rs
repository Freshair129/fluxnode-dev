//! Pure ffmpeg argument-vector compiler for FluxNode's NODE WORKFLOW graph.
//!
//! Where `render_graph.rs` compiles the timeline into a multi-track composite,
//! THIS module compiles the node-based VFX workflow graph into a single ffmpeg
//! argv that renders the output of a chosen node (`target_node_id`) to a file.
//! It walks the dependency subgraph feeding the target, processes nodes in
//! dependency (topological) order, and maps each node onto a `-filter_complex`
//! chain that operates on its upstream input stream(s).
//!
//! It is intentionally PURE: no process spawning, no filesystem access, no
//! global state. Everything is derived from the input JSON, so it is fully
//! unit-testable. The caller prepends the ffmpeg binary path and executes the
//! result.
//!
//! ## What is real vs. passthrough
//!
//! * **media_source** — REAL: emits an `-i <asset.sourcePath>` input. Its
//!   output stream is that decoded input.
//! * **transform** — REAL: scale / rotate / translate (pad) / opacity derived
//!   from `node.data`, defaulting to identity.
//! * **color_correct** — REAL: an `eq=` filter (brightness / contrast /
//!   saturation / gamma), with `lift`/`gain` accepted as aliases.
//! * **compositor** — REAL: overlays its multiple connected video inputs into a
//!   single stream (first input is the base, the rest overlaid on top).
//! * **output** — REAL: maps the final stream and encodes it (reusing the
//!   `select_video_encoder` idea, defaulting to `mpeg4`).
//! * **camera** — PASSTHROUGH: ffmpeg cannot do 3D camera projection here.
//! * **shader** — PASSTHROUGH: ffmpeg cannot run arbitrary GLSL.
//! * **ai_generate / ai_upscale** — PASSTHROUGH of their input; real AI is
//!   handled later by the ComfyUI integration. With no input, ai_generate emits
//!   a black `color` lavfi source so the graph stays valid.
//! * **audio_mix** — not part of the video render path; treated as passthrough
//!   if encountered on a video lineage.
//! * Any node with `bypassed: true` is a passthrough (its output == its input).
//! * A missing / disconnected required video input becomes a black `color`
//!   lavfi source (we never panic).

use serde_json::Value;

/// A fully-compiled workflow render plan: the ffmpeg argv AFTER the binary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkflowPlan {
    /// ffmpeg arguments AFTER the binary path, e.g.
    /// `["-y", "-i", src0, "-filter_complex", graph, "-map", "[vout]",
    ///   "-c:v", enc, ..., output_path]`.
    pub args: Vec<String>,
}

// ---------------------------------------------------------------------------
// Small JSON accessors (mirrors render_graph.rs conventions)
// ---------------------------------------------------------------------------

fn obj_f64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(|x| x.as_f64())
}

fn obj_str<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key).and_then(|x| x.as_str())
}

fn obj_bool(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

/// Format an f64 compactly for ffmpeg (trim trailing zeros, keep up to 6
/// decimals). Matches render_graph.rs `num`.
fn num(x: f64) -> String {
    if x.is_finite() {
        let s = format!("{:.6}", x);
        let s = s.trim_end_matches('0');
        let s = s.trim_end_matches('.');
        if s.is_empty() || s == "-" {
            "0".to_string()
        } else {
            s.to_string()
        }
    } else {
        "0".to_string()
    }
}

// ---------------------------------------------------------------------------
// Graph element lookups
// ---------------------------------------------------------------------------

/// All workflow nodes. Empty when absent.
fn workflow_nodes(project: &Value) -> Vec<Value> {
    project
        .get("workflow")
        .and_then(|w| w.get("nodes"))
        .and_then(|n| n.as_array())
        .cloned()
        .unwrap_or_default()
}

/// All workflow edges. Empty when absent.
fn workflow_edges(project: &Value) -> Vec<Value> {
    project
        .get("workflow")
        .and_then(|w| w.get("edges"))
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default()
}

fn node_by_id<'a>(nodes: &'a [Value], id: &str) -> Option<&'a Value> {
    nodes.iter().find(|n| obj_str(n, "id") == Some(id))
}

/// Resolve an asset's source path by asset id.
fn asset_source_path(project: &Value, asset_id: &str) -> Option<String> {
    project
        .get("assets")
        .and_then(|a| a.get("assets"))
        .and_then(|a| a.as_object())
        .and_then(|m| m.get(asset_id))
        .and_then(|asset| obj_str(asset, "sourcePath"))
        .map(|s| s.to_string())
}

/// Edges feeding `target` (source -> target), preserving array order so the
/// "first" connected layer is deterministic for compositors.
fn incoming_edges<'a>(edges: &'a [Value], target: &str) -> Vec<&'a Value> {
    edges
        .iter()
        .filter(|e| obj_str(e, "target") == Some(target))
        .collect()
}

/// Source node ids feeding `target`, in edge-array order. We restrict to
/// VIDEO-bearing handles (skip audio handles like `targetHandle == "audio"`),
/// because this compiler renders the VIDEO lineage. media_source has separate
/// `video` and `audio` output handles; an edge whose `targetHandle` is `audio`
/// is part of the audio graph and is ignored here.
fn video_predecessors(edges: &[Value], target: &str) -> Vec<String> {
    incoming_edges(edges, target)
        .into_iter()
        .filter(|e| obj_str(e, "targetHandle") != Some("audio"))
        .filter_map(|e| obj_str(e, "source").map(|s| s.to_string()))
        .collect()
}

// ---------------------------------------------------------------------------
// Dependency subgraph + cycle detection (mirrors validation.ts dependency walk)
// ---------------------------------------------------------------------------

/// Resolve the dependency subgraph feeding `target` (inclusive), returned in
/// dependency order (every node appears AFTER all of its predecessors).
///
/// Implemented as a DFS-based topological sort over the reverse reachable set
/// of `target`, with explicit cycle detection. Returns `Err` on a cycle.
fn dependency_order(
    nodes: &[Value],
    edges: &[Value],
    target: &str,
) -> Result<Vec<String>, String> {
    // 1. Collect the set of nodes that `target` depends on (reverse reachable).
    let mut needed: Vec<String> = Vec::new();
    let mut stack = vec![target.to_string()];
    while let Some(id) = stack.pop() {
        if needed.iter().any(|n| n == &id) {
            continue;
        }
        needed.push(id.clone());
        for pred in video_predecessors(edges, &id) {
            // Only follow predecessors that actually exist as nodes.
            if node_by_id(nodes, &pred).is_some() && !needed.contains(&pred) {
                stack.push(pred);
            }
        }
    }

    // 2. Topological sort restricted to `needed`, detecting cycles via DFS
    //    colouring (grey = on stack, black = done).
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        Grey,
        Black,
    }
    let mut state: std::collections::HashMap<String, Mark> = std::collections::HashMap::new();
    let mut order: Vec<String> = Vec::new();

    // Iterative post-order DFS to avoid deep recursion.
    struct Frame {
        id: String,
        preds: Vec<String>,
        idx: usize,
    }

    for root in needed.iter() {
        if matches!(state.get(root), Some(Mark::Black)) {
            continue;
        }
        let preds: Vec<String> = video_predecessors(edges, root)
            .into_iter()
            .filter(|p| needed.contains(p))
            .collect();
        let mut frames: Vec<Frame> = vec![Frame {
            id: root.clone(),
            preds,
            idx: 0,
        }];
        state.insert(root.clone(), Mark::Grey);

        while let Some(frame) = frames.last_mut() {
            if frame.idx < frame.preds.len() {
                let pred = frame.preds[frame.idx].clone();
                frame.idx += 1;
                match state.get(&pred) {
                    Some(Mark::Grey) => {
                        return Err(format!(
                            "workflow graph contains a cycle (node \"{}\")",
                            pred
                        ));
                    }
                    Some(Mark::Black) => {}
                    None => {
                        let preds: Vec<String> = video_predecessors(edges, &pred)
                            .into_iter()
                            .filter(|p| needed.contains(p))
                            .collect();
                        state.insert(pred.clone(), Mark::Grey);
                        frames.push(Frame {
                            id: pred,
                            preds,
                            idx: 0,
                        });
                    }
                }
            } else {
                state.insert(frame.id.clone(), Mark::Black);
                order.push(frame.id.clone());
                frames.pop();
            }
        }
    }

    Ok(order)
}

// ---------------------------------------------------------------------------
// Encoder selection (shared idea with render_graph.rs)
// ---------------------------------------------------------------------------

/// Map an output node's `data.format` (and optional codec) to a concrete
/// ffmpeg video encoder. Defaults to `mpeg4` for unknown / mp4.
pub fn select_video_encoder(output_data: &Value) -> &'static str {
    let codec = obj_str(output_data, "videoCodec")
        .unwrap_or("")
        .to_ascii_lowercase();
    let format = obj_str(output_data, "format")
        .unwrap_or("")
        .to_ascii_lowercase();

    match codec.as_str() {
        "h264" | "avc" => return "h264_nvenc",
        "h265" | "hevc" => return "hevc_nvenc",
        "vp9" => return "libvpx-vp9",
        "prores" => return "prores_ks",
        "av1" => return "libaom-av1",
        _ => {}
    }

    match format.as_str() {
        "webm" => "libvpx-vp9",
        "mov" => "prores_ks",
        _ => "mpeg4",
    }
}

// ---------------------------------------------------------------------------
// Per-node filter chain construction
// ---------------------------------------------------------------------------

/// Default canvas used for synthesized black sources (missing inputs) and
/// canvas-relative scaling.
fn default_canvas(project: &Value) -> (u32, u32, f64) {
    let res = project.get("settings").and_then(|s| s.get("resolution"));
    let w = res
        .and_then(|r| obj_f64(r, "width"))
        .filter(|w| *w >= 1.0)
        .map(|w| w.round() as u32)
        .unwrap_or(1920);
    let h = res
        .and_then(|r| obj_f64(r, "height"))
        .filter(|h| *h >= 1.0)
        .map(|h| h.round() as u32)
        .unwrap_or(1080);
    let fps = project
        .get("settings")
        .and_then(|s| obj_f64(s, "frameRate"))
        .filter(|f| *f > 0.0)
        .unwrap_or(30.0);
    (w, h, fps)
}

/// Build the `transform` filter chain (no leading/trailing comma). Reads scale
/// / rotate / translate / opacity from `data`, defaulting to identity. Field
/// names mirror the timeline `ClipTransform`: `scaleX`, `scaleY`, `rotation`
/// (radians), `x`, `y`, plus an `opacity`.
fn transform_chain(data: &Value, canvas_w: u32, canvas_h: u32) -> Vec<String> {
    let mut chain: Vec<String> = Vec::new();

    let scale_x = obj_f64(data, "scaleX").unwrap_or(1.0);
    let scale_y = obj_f64(data, "scaleY").unwrap_or(1.0);
    let rotation = obj_f64(data, "rotation").unwrap_or(0.0);
    let tx = obj_f64(data, "x").unwrap_or(0.0);
    let ty = obj_f64(data, "y").unwrap_or(0.0);
    let opacity = obj_f64(data, "opacity").unwrap_or(1.0);

    // Scale relative to canvas when scale factors are non-identity.
    if (scale_x - 1.0).abs() > 1e-6 || (scale_y - 1.0).abs() > 1e-6 {
        let sw = (canvas_w as f64 * scale_x).round().max(1.0) as i64;
        let sh = (canvas_h as f64 * scale_y).round().max(1.0) as i64;
        chain.push(format!("scale={}:{}", sw, sh));
    }

    // Rotation (radians), only when non-zero.
    if rotation.abs() > 1e-6 {
        chain.push(format!(
            "rotate={}:c=none:ow=rotw({}):oh=roth({})",
            num(rotation),
            num(rotation),
            num(rotation)
        ));
    }

    // Translation via pad onto a same-size canvas at offset (x, y).
    if tx.abs() > 1e-6 || ty.abs() > 1e-6 {
        chain.push(format!(
            "pad={}:{}:{}:{}:color=black@0",
            canvas_w,
            canvas_h,
            num(tx),
            num(ty)
        ));
    }

    // Opacity via alpha multiply when < 1.
    if opacity < 1.0 - 1e-6 {
        chain.push("format=yuva420p".to_string());
        chain.push(format!("colorchannelmixer=aa={}", num(opacity.max(0.0))));
    }

    chain
}

/// Build the `color_correct` `eq=` filter from `data`. Accepts both
/// brightness/contrast/saturation/gamma and the lift/gamma/gain alias used in
/// the FluxNode defaults (lift -> brightness offset, gain -> contrast).
fn color_correct_chain(data: &Value) -> Vec<String> {
    let brightness =
        obj_f64(data, "brightness").unwrap_or_else(|| obj_f64(data, "lift").unwrap_or(0.0));
    let contrast =
        obj_f64(data, "contrast").unwrap_or_else(|| obj_f64(data, "gain").unwrap_or(1.0));
    let saturation = obj_f64(data, "saturation").unwrap_or(1.0);
    let gamma = obj_f64(data, "gamma").unwrap_or(1.0);

    let parts = vec![
        format!("brightness={}", num(brightness)),
        format!("contrast={}", num(contrast)),
        format!("saturation={}", num(saturation)),
        format!("gamma={}", num(gamma)),
    ];

    vec![format!("eq={}", parts.join(":"))]
}

// ---------------------------------------------------------------------------
// Plan compilation
// ---------------------------------------------------------------------------

/// Compile the workflow into an ffmpeg argv that renders `target_node_id`'s
/// output to `output_path`.
#[allow(unused_assignments)] // label_counter's final increment is intentionally unread
pub fn build_workflow_plan(
    project: &Value,
    target_node_id: &str,
    output_path: &str,
) -> Result<WorkflowPlan, String> {
    if !project.is_object() {
        return Err("project must be a JSON object".to_string());
    }

    let nodes = workflow_nodes(project);
    let edges = workflow_edges(project);

    if node_by_id(&nodes, target_node_id).is_none() {
        return Err(format!("target node \"{}\" not found", target_node_id));
    }

    let (canvas_w, canvas_h, fps) = default_canvas(project);

    // Dependency order of the subgraph feeding the target (cycle -> Err).
    let order = dependency_order(&nodes, &edges, target_node_id)?;

    // Build the filter graph. Each processed node maps to one or more filter
    // statements producing a final OUTPUT label `n<i>` that downstream nodes
    // reference.
    let mut inputs: Vec<String> = Vec::new();
    let mut graph_parts: Vec<String> = Vec::new();
    let mut node_label: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut label_counter: usize = 0;

    // Synthesize a black lavfi source, returning its output label.
    macro_rules! black_source {
        () => {{
            let label = format!("n{}", label_counter);
            label_counter += 1;
            graph_parts.push(format!(
                "color=c=black:s={}x{}:r={}:d=1[{}]",
                canvas_w,
                canvas_h,
                num(fps),
                label
            ));
            label
        }};
    }

    for node_id in &order {
        let node = match node_by_id(&nodes, node_id) {
            Some(n) => n.clone(),
            None => continue,
        };
        let node_type = obj_str(&node, "type").unwrap_or("");
        let data = node.get("data").cloned().unwrap_or(Value::Null);
        let bypassed = obj_bool(&node, "bypassed");

        // This node's video predecessor output labels (already built, since we
        // process in dependency order).
        let pred_labels: Vec<String> = video_predecessors(&edges, node_id)
            .into_iter()
            .filter_map(|p| node_label.get(&p).cloned())
            .collect();

        // A bypassed node is a pure passthrough of its primary input.
        if bypassed {
            let input = if let Some(first) = pred_labels.first() {
                first.clone()
            } else {
                black_source!()
            };
            node_label.insert(node_id.clone(), input);
            continue;
        }

        match node_type {
            "media_source" => {
                let asset_id = data.get("assetId").and_then(|x| x.as_str()).unwrap_or("");
                match asset_source_path(project, asset_id) {
                    Some(path) => {
                        let input_index = inputs.len();
                        inputs.push(path);
                        // Normalize the decoded input into a labelled stream so
                        // downstream filters always reference [label].
                        let label = format!("n{}", label_counter);
                        label_counter += 1;
                        graph_parts.push(format!("[{}:v]null[{}]", input_index, label));
                        node_label.insert(node_id.clone(), label);
                    }
                    None => {
                        // Missing asset -> black source (never panic).
                        let label = black_source!();
                        node_label.insert(node_id.clone(), label);
                    }
                }
            }
            "transform" => {
                let input = match pred_labels.first() {
                    Some(l) => l.clone(),
                    None => black_source!(),
                };
                let chain = transform_chain(&data, canvas_w, canvas_h);
                let label = format!("n{}", label_counter);
                label_counter += 1;
                if chain.is_empty() {
                    graph_parts.push(format!("[{}]null[{}]", input, label));
                } else {
                    graph_parts.push(format!("[{}]{}[{}]", input, chain.join(","), label));
                }
                node_label.insert(node_id.clone(), label);
            }
            "color_correct" => {
                let input = match pred_labels.first() {
                    Some(l) => l.clone(),
                    None => black_source!(),
                };
                let chain = color_correct_chain(&data);
                let label = format!("n{}", label_counter);
                label_counter += 1;
                graph_parts.push(format!("[{}]{}[{}]", input, chain.join(","), label));
                node_label.insert(node_id.clone(), label);
            }
            "compositor" => {
                // Overlay all connected video inputs into one. First is base.
                if pred_labels.is_empty() {
                    let label = black_source!();
                    node_label.insert(node_id.clone(), label);
                } else if pred_labels.len() == 1 {
                    let label = format!("n{}", label_counter);
                    label_counter += 1;
                    graph_parts.push(format!("[{}]null[{}]", pred_labels[0], label));
                    node_label.insert(node_id.clone(), label);
                } else {
                    let mut accum = pred_labels[0].clone();
                    for layer in pred_labels.iter().skip(1) {
                        let out = format!("n{}", label_counter);
                        label_counter += 1;
                        graph_parts.push(format!(
                            "[{}][{}]overlay=x=0:y=0[{}]",
                            accum, layer, out
                        ));
                        accum = out;
                    }
                    node_label.insert(node_id.clone(), accum);
                }
            }
            "ai_generate" => {
                // PASSTHROUGH: real AI is ComfyUI's job. With an input, pass it
                // through; with none, emit a black source.
                let label = if let Some(first) = pred_labels.first() {
                    let out = format!("n{}", label_counter);
                    label_counter += 1;
                    graph_parts.push(format!("[{}]null[{}]", first, out));
                    out
                } else {
                    black_source!()
                };
                node_label.insert(node_id.clone(), label);
            }
            // camera, shader, ai_upscale, audio_mix, output and unknown types:
            // passthrough of the primary input.
            _ => {
                let input = match pred_labels.first() {
                    Some(l) => l.clone(),
                    None => black_source!(),
                };
                let label = format!("n{}", label_counter);
                label_counter += 1;
                graph_parts.push(format!("[{}]null[{}]", input, label));
                node_label.insert(node_id.clone(), label);
            }
        }
    }

    // Determine the final video stream to map.
    let target_node = node_by_id(&nodes, target_node_id)
        .cloned()
        .unwrap_or(Value::Null);
    let target_type = obj_str(&target_node, "type").unwrap_or("");
    let output_data = target_node.get("data").cloned().unwrap_or(Value::Null);

    // The label produced by the target itself.
    let final_label = match node_label.get(target_node_id).cloned() {
        Some(l) => l,
        None => black_source!(),
    };

    // Relabel the final stream to a stable [vout].
    graph_parts.push(format!("[{}]null[vout]", final_label));

    let filter_complex = graph_parts.join(";");

    // Encoder: meaningful when the target is an output node; otherwise default.
    let encoder = if target_type == "output" {
        select_video_encoder(&output_data)
    } else {
        "mpeg4"
    };

    // ---- Assemble argv ----
    let mut args: Vec<String> = Vec::new();
    args.push("-y".to_string());

    for input in &inputs {
        args.push("-i".to_string());
        args.push(input.clone());
    }

    args.push("-filter_complex".to_string());
    args.push(filter_complex);

    args.push("-map".to_string());
    args.push("[vout]".to_string());

    args.push("-c:v".to_string());
    args.push(encoder.to_string());

    args.push("-r".to_string());
    args.push(num(fps));

    args.push(output_path.to_string());

    Ok(WorkflowPlan { args })
}

// ===========================================================================
// Tests
// ===========================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn arg_after<'a>(args: &'a [String], flag: &str) -> Option<&'a String> {
        args.iter().position(|a| a == flag).and_then(|i| args.get(i + 1))
    }

    fn count(args: &[String], target: &str) -> usize {
        args.iter().filter(|a| a.as_str() == target).count()
    }

    fn filter_graph(plan: &WorkflowPlan) -> &String {
        arg_after(&plan.args, "-filter_complex").expect("filter_complex present")
    }

    /// media_source -> transform -> color_correct -> output, plus assets.
    fn linear_project() -> Value {
        json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": {
                "assets": {
                    "asset-a": { "type": "video", "sourcePath": "C:/m/a.mp4" }
                }
            },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "asset-a" } },
                    { "id": "xf", "type": "transform", "bypassed": false,
                      "data": { "scaleX": 0.5, "scaleY": 0.5, "rotation": 0.0, "x": 0.0, "y": 0.0, "opacity": 1.0 } },
                    { "id": "cc", "type": "color_correct", "bypassed": false,
                      "data": { "brightness": 0.1, "contrast": 1.2, "saturation": 1.3, "gamma": 0.9 } },
                    { "id": "out", "type": "output", "bypassed": false,
                      "data": { "format": "mp4", "videoCodec": "h264" } }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "sourceHandle": "video", "target": "xf", "targetHandle": "input" },
                    { "id": "e2", "source": "xf", "sourceHandle": "output", "target": "cc", "targetHandle": "input" },
                    { "id": "e3", "source": "cc", "sourceHandle": "output", "target": "out", "targetHandle": "video" }
                ]
            }
        })
    }

    #[test]
    fn linear_chain_emits_input_scale_eq_and_map() {
        let plan = build_workflow_plan(&linear_project(), "out", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(count(&plan.args, "-i"), 1);
        assert_eq!(arg_after(&plan.args, "-i").map(|s| s.as_str()), Some("C:/m/a.mp4"));
        // Transform scale 0.5 of 1920x1080 -> 960x540.
        assert!(g.contains("scale=960:540"), "scale present: {g}");
        // color_correct eq filter.
        assert!(g.contains("eq=brightness=0.1:contrast=1.2:saturation=1.3:gamma=0.9"), "eq: {g}");
        // Final map.
        assert!(plan.args.iter().any(|a| a == "[vout]"), "vout map");
        assert_eq!(count(&plan.args, "-map"), 1);
        // Output node h264 -> nvenc.
        assert_eq!(arg_after(&plan.args, "-c:v").map(|s| s.as_str()), Some("h264_nvenc"));
        // Output path is last.
        assert_eq!(plan.args.last().unwrap(), "out.mp4");
    }

    #[test]
    fn target_node_other_than_output_renders_up_to_that_node() {
        // Render only up to `xf`. cc and out must NOT appear.
        let plan = build_workflow_plan(&linear_project(), "xf", "prev.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(g.contains("scale=960:540"), "transform applied: {g}");
        assert!(!g.contains("eq="), "color_correct excluded: {g}");
        // Default encoder for a non-output preview target.
        assert_eq!(arg_after(&plan.args, "-c:v").map(|s| s.as_str()), Some("mpeg4"));
    }

    #[test]
    fn compositor_with_two_inputs_emits_overlay() {
        let project = json!({
            "settings": { "resolution": { "width": 1280, "height": 720 }, "frameRate": 30.0 },
            "assets": {
                "assets": {
                    "a": { "type": "video", "sourcePath": "C:/m/a.mp4" },
                    "b": { "type": "video", "sourcePath": "C:/m/b.mp4" }
                }
            },
            "workflow": {
                "nodes": [
                    { "id": "s1", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "s2", "type": "media_source", "bypassed": false, "data": { "assetId": "b" } },
                    { "id": "comp", "type": "compositor", "bypassed": false, "data": {} },
                    { "id": "out", "type": "output", "bypassed": false, "data": { "format": "mp4" } }
                ],
                "edges": [
                    { "id": "e1", "source": "s1", "sourceHandle": "video", "target": "comp", "targetHandle": "layer" },
                    { "id": "e2", "source": "s2", "sourceHandle": "video", "target": "comp", "targetHandle": "layer" },
                    { "id": "e3", "source": "comp", "sourceHandle": "composite", "target": "out", "targetHandle": "video" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "out", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(count(&plan.args, "-i"), 2);
        // Two layers -> one overlay onto base.
        assert_eq!(g.matches("overlay=").count(), 1, "one overlay: {g}");
        assert_eq!(arg_after(&plan.args, "-c:v").map(|s| s.as_str()), Some("mpeg4"));
    }

    #[test]
    fn compositor_with_three_inputs_emits_two_overlays() {
        let project = json!({
            "settings": { "resolution": { "width": 1280, "height": 720 }, "frameRate": 30.0 },
            "assets": { "assets": {
                "a": { "type": "video", "sourcePath": "a.mp4" },
                "b": { "type": "video", "sourcePath": "b.mp4" },
                "c": { "type": "video", "sourcePath": "c.mp4" }
            }},
            "workflow": {
                "nodes": [
                    { "id": "s1", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "s2", "type": "media_source", "bypassed": false, "data": { "assetId": "b" } },
                    { "id": "s3", "type": "media_source", "bypassed": false, "data": { "assetId": "c" } },
                    { "id": "comp", "type": "compositor", "bypassed": false, "data": {} }
                ],
                "edges": [
                    { "id": "e1", "source": "s1", "target": "comp", "targetHandle": "layer" },
                    { "id": "e2", "source": "s2", "target": "comp", "targetHandle": "layer" },
                    { "id": "e3", "source": "s3", "target": "comp", "targetHandle": "layer" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "comp", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(g.matches("overlay=").count(), 2, "two overlays: {g}");
    }

    #[test]
    fn color_correct_uses_lift_gain_aliases() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": { "a": { "type": "video", "sourcePath": "a.mp4" } } },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "cc", "type": "color_correct", "bypassed": false,
                      "data": { "lift": 0.02, "gamma": 1.08, "gain": 1.12 } }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "target": "cc", "targetHandle": "input" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "cc", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        // lift -> brightness, gain -> contrast, saturation default 1, gamma 1.08.
        assert!(g.contains("eq=brightness=0.02:contrast=1.12:saturation=1:gamma=1.08"), "{g}");
    }

    #[test]
    fn bypassed_node_is_passthrough() {
        let mut project = linear_project();
        // Bypass the transform node: scale should NOT appear.
        project["workflow"]["nodes"][1]["bypassed"] = json!(true);
        let plan = build_workflow_plan(&project, "out", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(!g.contains("scale=960:540"), "transform bypassed: {g}");
        // color_correct still applies.
        assert!(g.contains("eq="), "eq present: {g}");
        assert_eq!(count(&plan.args, "-i"), 1);
    }

    #[test]
    fn cycle_returns_err() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": {} },
            "workflow": {
                "nodes": [
                    { "id": "a", "type": "transform", "bypassed": false, "data": {} },
                    { "id": "b", "type": "transform", "bypassed": false, "data": {} },
                    { "id": "out", "type": "output", "bypassed": false, "data": {} }
                ],
                "edges": [
                    { "id": "e1", "source": "a", "target": "b", "targetHandle": "input" },
                    { "id": "e2", "source": "b", "target": "a", "targetHandle": "input" },
                    { "id": "e3", "source": "b", "target": "out", "targetHandle": "video" }
                ]
            }
        });
        let result = build_workflow_plan(&project, "out", "out.mp4");
        assert!(result.is_err(), "cycle should error: {:?}", result);
        assert!(result.unwrap_err().contains("cycle"));
    }

    #[test]
    fn missing_input_becomes_black_source() {
        // A transform with no incoming edge -> black lavfi source feeds it.
        let project = json!({
            "settings": { "resolution": { "width": 640, "height": 480 }, "frameRate": 25.0 },
            "assets": { "assets": {} },
            "workflow": {
                "nodes": [
                    { "id": "xf", "type": "transform", "bypassed": false,
                      "data": { "scaleX": 0.5, "scaleY": 0.5 } }
                ],
                "edges": []
            }
        });
        let plan = build_workflow_plan(&project, "xf", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(count(&plan.args, "-i"), 0);
        assert!(g.contains("color=c=black:s=640x480:r=25"), "black source: {g}");
        // Transform still applies (320x240).
        assert!(g.contains("scale=320:240"), "{g}");
    }

    #[test]
    fn missing_asset_becomes_black_source() {
        let project = json!({
            "settings": { "resolution": { "width": 800, "height": 600 }, "frameRate": 30.0 },
            "assets": { "assets": {} },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "ghost" } }
                ],
                "edges": []
            }
        });
        let plan = build_workflow_plan(&project, "src", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(count(&plan.args, "-i"), 0);
        assert!(g.contains("color=c=black:s=800x600"), "{g}");
    }

    #[test]
    fn ai_nodes_passthrough_their_input() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": { "a": { "type": "video", "sourcePath": "a.mp4" } } },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "up", "type": "ai_upscale", "bypassed": false, "data": { "scaleFactor": 4 } },
                    { "id": "gen", "type": "ai_generate", "bypassed": false, "data": { "prompt": "x" } }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "target": "up", "targetHandle": "input" },
                    { "id": "e2", "source": "up", "target": "gen", "targetHandle": "reference" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "gen", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        // Real media input present and passed through (no upscale/gen filter).
        assert_eq!(count(&plan.args, "-i"), 1);
        assert!(!g.contains("scale="), "no real upscale filter: {g}");
        assert!(!g.contains("eq="), "no color filter: {g}");
        assert!(g.contains("null"), "passthrough null present: {g}");
    }

    #[test]
    fn ai_generate_without_input_emits_black_source() {
        let project = json!({
            "settings": { "resolution": { "width": 512, "height": 512 }, "frameRate": 24.0 },
            "assets": { "assets": {} },
            "workflow": {
                "nodes": [
                    { "id": "gen", "type": "ai_generate", "bypassed": false, "data": { "prompt": "x" } }
                ],
                "edges": []
            }
        });
        let plan = build_workflow_plan(&project, "gen", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(count(&plan.args, "-i"), 0);
        assert!(g.contains("color=c=black:s=512x512:r=24"), "{g}");
    }

    #[test]
    fn camera_and_shader_are_passthrough() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": { "a": { "type": "video", "sourcePath": "a.mp4" } } },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "cam", "type": "camera", "bypassed": false, "data": {} },
                    { "id": "sh", "type": "shader", "bypassed": false, "data": { "shaderSource": "glsl" } }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "target": "cam", "targetHandle": "scene" },
                    { "id": "e2", "source": "cam", "target": "sh", "targetHandle": "input" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "sh", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert_eq!(count(&plan.args, "-i"), 1);
        assert!(!g.contains("scale="), "{g}");
        assert!(!g.contains("eq="), "{g}");
        assert!(plan.args.iter().any(|a| a == "[vout]"));
    }

    #[test]
    fn transform_translation_emits_pad() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": { "a": { "type": "video", "sourcePath": "a.mp4" } } },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "xf", "type": "transform", "bypassed": false,
                      "data": { "x": 100.0, "y": 50.0, "rotation": 1.5708, "opacity": 0.5 } }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "target": "xf", "targetHandle": "input" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "xf", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(g.contains("pad=1920:1080:100:50"), "pad translation: {g}");
        assert!(g.contains("rotate=1.5708"), "rotate: {g}");
        assert!(g.contains("colorchannelmixer=aa=0.5"), "opacity: {g}");
    }

    #[test]
    fn identity_transform_is_null_passthrough() {
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": { "a": { "type": "video", "sourcePath": "a.mp4" } } },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "a" } },
                    { "id": "xf", "type": "transform", "bypassed": false, "data": {} }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "target": "xf", "targetHandle": "input" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "xf", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        assert!(!g.contains("scale="), "no scale for identity: {g}");
        assert!(!g.contains("rotate="), "no rotate for identity: {g}");
        assert!(!g.contains("pad="), "no pad for identity: {g}");
    }

    #[test]
    fn audio_handle_edges_are_ignored_in_video_lineage() {
        // An audio edge feeding the output's audio handle must not pull the
        // audio media_source into the video graph.
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": {
                "v": { "type": "video", "sourcePath": "v.mp4" },
                "aud": { "type": "audio", "sourcePath": "aud.wav" }
            }},
            "workflow": {
                "nodes": [
                    { "id": "vsrc", "type": "media_source", "bypassed": false, "data": { "assetId": "v" } },
                    { "id": "asrc", "type": "media_source", "bypassed": false, "data": { "assetId": "aud" } },
                    { "id": "out", "type": "output", "bypassed": false, "data": { "format": "mp4" } }
                ],
                "edges": [
                    { "id": "e1", "source": "vsrc", "target": "out", "targetHandle": "video" },
                    { "id": "e2", "source": "asrc", "target": "out", "targetHandle": "audio" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "out", "out.mp4").unwrap();
        // Only the video source becomes an -i input; the audio source is ignored.
        assert_eq!(count(&plan.args, "-i"), 1);
        assert_eq!(arg_after(&plan.args, "-i").map(|s| s.as_str()), Some("v.mp4"));
    }

    #[test]
    fn unknown_target_node_errors() {
        let plan = build_workflow_plan(&linear_project(), "nope", "out.mp4");
        assert!(plan.is_err());
        assert!(plan.unwrap_err().contains("not found"));
    }

    #[test]
    fn non_object_project_errors() {
        assert!(build_workflow_plan(&json!("nope"), "x", "out.mp4").is_err());
    }

    #[test]
    fn encoder_selection_per_output_data() {
        assert_eq!(select_video_encoder(&json!({ "videoCodec": "h264" })), "h264_nvenc");
        assert_eq!(select_video_encoder(&json!({ "videoCodec": "hevc" })), "hevc_nvenc");
        assert_eq!(select_video_encoder(&json!({ "videoCodec": "vp9" })), "libvpx-vp9");
        assert_eq!(select_video_encoder(&json!({ "videoCodec": "prores" })), "prores_ks");
        assert_eq!(select_video_encoder(&json!({ "videoCodec": "av1" })), "libaom-av1");
        assert_eq!(select_video_encoder(&json!({ "format": "webm" })), "libvpx-vp9");
        assert_eq!(select_video_encoder(&json!({ "format": "mov" })), "prores_ks");
        assert_eq!(select_video_encoder(&json!({ "format": "mp4" })), "mpeg4");
    }

    #[test]
    fn diamond_graph_processes_shared_source_once() {
        // src -> a, src -> b, a -> comp, b -> comp, comp -> out.
        let project = json!({
            "settings": { "resolution": { "width": 1920, "height": 1080 }, "frameRate": 30.0 },
            "assets": { "assets": { "x": { "type": "video", "sourcePath": "x.mp4" } } },
            "workflow": {
                "nodes": [
                    { "id": "src", "type": "media_source", "bypassed": false, "data": { "assetId": "x" } },
                    { "id": "a", "type": "transform", "bypassed": false, "data": { "scaleX": 0.5, "scaleY": 0.5 } },
                    { "id": "b", "type": "color_correct", "bypassed": false, "data": { "brightness": 0.2 } },
                    { "id": "comp", "type": "compositor", "bypassed": false, "data": {} },
                    { "id": "out", "type": "output", "bypassed": false, "data": { "format": "mp4" } }
                ],
                "edges": [
                    { "id": "e1", "source": "src", "target": "a", "targetHandle": "input" },
                    { "id": "e2", "source": "src", "target": "b", "targetHandle": "input" },
                    { "id": "e3", "source": "a", "target": "comp", "targetHandle": "layer" },
                    { "id": "e4", "source": "b", "target": "comp", "targetHandle": "layer" },
                    { "id": "e5", "source": "comp", "target": "out", "targetHandle": "video" }
                ]
            }
        });
        let plan = build_workflow_plan(&project, "out", "out.mp4").unwrap();
        let g = filter_graph(&plan);
        // src is shared but only ONE -i input emitted (processed once).
        assert_eq!(count(&plan.args, "-i"), 1);
        assert!(g.contains("scale=960:540"), "{g}");
        assert!(g.contains("eq=brightness=0.2"), "{g}");
        assert_eq!(g.matches("overlay=").count(), 1, "{g}");
    }
}
