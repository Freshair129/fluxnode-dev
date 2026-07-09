//! Shared security helpers: path containment, atomic writes, and network hardening for
//! caller-supplied paths / URLs.
//!
//! Rationale: several `#[tauri::command]`s accept absolute paths or URLs straight from the
//! frontend (which in turn may reflect user input, project files, or remote manifests). Without
//! containment, a malicious/compromised frontend or project file could read arbitrary files
//! (e.g. `~/.ssh/id_rsa`) or write outside the app's project/asset areas. This module centralizes
//! the guards so every command applies the same policy.
#![allow(dead_code)]

use std::collections::HashSet;
use std::fs::{self, File};
use std::io::{Read as _, Write as _};
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use serde_json::Value;
use tauri::{AppHandle, Manager};

/// Cap for update-package / media downloads (bytes).
pub const MAX_DOWNLOAD_BYTES: u64 = 500 * 1024 * 1024; // 500MB

/// Cap for JSON API responses (update manifests, ComfyUI history polls, etc).
pub const MAX_JSON_RESPONSE_BYTES: u64 = 10 * 1024 * 1024; // 10MB

// ---------------------------------------------------------------------------
// Path containment
// ---------------------------------------------------------------------------

/// Directories the user has explicitly picked via an `rfd` dialog this session (plus their
/// parents). Populated by [`register_picked_path`], consulted by [`ensure_allowed_path`].
static PICKED_ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

fn picked_roots() -> &'static Mutex<HashSet<PathBuf>> {
    PICKED_ROOTS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Registers `path` (and its parent directory) as an allowed root for the remainder of this
/// process's lifetime. Call this whenever an `rfd` dialog returns a path the user explicitly
/// chose (file or folder pickers), so subsequent commands operating on that path/tree — or
/// siblings within it — aren't rejected by [`ensure_allowed_path`].
pub fn register_picked_path(path: &Path) {
    let Ok(mut roots) = picked_roots().lock() else {
        return;
    };
    roots.insert(path.to_path_buf());
    if let Some(parent) = path.parent() {
        roots.insert(parent.to_path_buf());
    }
}

/// Base allow-listed roots that are always trusted: the app's data/config/local-data
/// directories (project autosave/cache/workspace areas all live under these).
fn base_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(dir) = app.path().app_data_dir() {
        roots.push(dir);
    }
    if let Ok(dir) = app.path().app_config_dir() {
        roots.push(dir);
    }
    if let Ok(dir) = app.path().app_local_data_dir() {
        roots.push(dir);
    }
    roots
}

/// The user's configured default-project-directory preference, if any — treated as an
/// additional allowed root so re-opening projects under it doesn't require re-picking every
/// launch. Best-effort: any read/parse failure just yields no extra root.
fn preference_roots(app: &AppHandle) -> Vec<PathBuf> {
    let Ok(path) = crate::app_preferences_path(app) else {
        return Vec::new();
    };
    let Ok(contents) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(value) = serde_json::from_str::<Value>(&contents) else {
        return Vec::new();
    };
    value
        .get("defaultProjectDirectory")
        .and_then(Value::as_str)
        .filter(|dir| !dir.is_empty())
        .map(|dir| vec![PathBuf::from(dir)])
        .unwrap_or_default()
}

/// Canonicalizes `path`, resolving symlinks and `..` segments. For paths that don't exist yet
/// (e.g. a brand-new project file about to be created), walks up to the nearest existing
/// ancestor, canonicalizes *that*, and re-appends the non-existent tail — so writes to a new
/// file/dir under an allowed root aren't rejected just because the leaf doesn't exist yet.
fn canonicalize_best_effort(path: &Path) -> Result<PathBuf, String> {
    if let Ok(real) = path.canonicalize() {
        return Ok(real);
    }

    let mut ancestor = path.to_path_buf();
    loop {
        if !ancestor.pop() {
            return Err(format!("Cannot resolve path: {}", path.display()));
        }
        if let Ok(real_ancestor) = ancestor.canonicalize() {
            let tail = path.strip_prefix(&ancestor).unwrap_or(Path::new(""));
            return Ok(real_ancestor.join(tail));
        }
    }
}

/// Canonicalizes `path` and verifies it falls under an allow-listed root: the app's
/// data/config/local-data dirs, the user's configured default project directory, or a directory
/// explicitly picked via an `rfd` dialog this session. Resolving the *real* path first (rather
/// than string-prefix-matching the raw input) closes `..`/symlink escape tricks.
pub fn ensure_allowed_path(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let resolved = canonicalize_best_effort(path)?;

    let mut roots = base_roots(app);
    roots.extend(preference_roots(app));
    if let Ok(picked) = picked_roots().lock() {
        roots.extend(picked.iter().cloned());
    }

    let allowed = roots.iter().any(|root| {
        canonicalize_best_effort(root)
            .map(|root| resolved.starts_with(&root))
            .unwrap_or(false)
    });

    if allowed {
        Ok(resolved)
    } else {
        Err(format!(
            "Access to path is not allowed: {} (pick it via a file/folder dialog first, or configure it as the default project directory)",
            path.display()
        ))
    }
}

/// Extensions `shell_open_path` is willing to hand to the OS shell (in addition to directories).
/// Deliberately conservative — this exists to stop an agent/compromised frontend from using
/// "open" as a generic file-execution primitive.
const SHELL_OPENABLE_EXTENSIONS: &[&str] = &[
    "fluxnode", "json", "mp4", "mov", "mkv", "webm", "wav", "mp3", "flac", "aac", "png", "jpg",
    "jpeg", "webp", "gif", "svg", "txt", "md",
];

/// Containment for `shell_open_path`: the resolved path must be inside an allowed root (see
/// [`ensure_allowed_path`]) AND be either a directory or a file whose extension is in the
/// [`SHELL_OPENABLE_EXTENSIONS`] allow-list.
pub fn ensure_shell_openable(app: &AppHandle, path: &Path) -> Result<PathBuf, String> {
    let resolved = ensure_allowed_path(app, path)?;

    if resolved.is_dir() {
        return Ok(resolved);
    }

    let has_allowed_ext = resolved
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SHELL_OPENABLE_EXTENSIONS
                .iter()
                .any(|allowed| allowed.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false);

    if has_allowed_ext {
        Ok(resolved)
    } else {
        Err(format!(
            "Refusing to open a file with a disallowed extension: {}",
            path.display()
        ))
    }
}

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

/// Writes `bytes` to `path` atomically: writes to a sibling `<name>.tmp` file, `fsync`s it, then
/// renames it over the target. Readers never observe a partially-written file, and a crash
/// mid-write leaves the original file (or no file) intact rather than a truncated one.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("file");
    let tmp_path = path.with_file_name(format!("{file_name}.tmp"));

    {
        let mut file = File::create(&tmp_path)?;
        file.write_all(bytes)?;
        file.sync_all()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Network hardening: response caps, HTTPS enforcement, filename sanitization
// ---------------------------------------------------------------------------

/// Reads at most `limit` bytes from `response`. Checks `Content-Length` first when present (fast
/// rejection), then bounds the actual read regardless of what the header claims — a
/// malicious/broken server can lie about `Content-Length` or stream indefinitely, and this is
/// what actually prevents an unbounded-memory OOM.
pub fn read_capped_bytes(response: reqwest::blocking::Response, limit: u64) -> Result<Vec<u8>, String> {
    if let Some(len) = response.content_length() {
        if len > limit {
            return Err(format!(
                "response body too large ({len} bytes, limit {limit} bytes)"
            ));
        }
    }

    let mut reader = response.take(limit + 1);
    let mut buf = Vec::new();
    reader
        .read_to_end(&mut buf)
        .map_err(|error| format!("failed to read response body: {error}"))?;

    if buf.len() as u64 > limit {
        return Err(format!("response body exceeded limit of {limit} bytes"));
    }

    Ok(buf)
}

/// Rejects any URL that isn't `https://`. Used for the update manifest + download URLs, which
/// are fetched unauthenticated and written to disk / parsed as trusted data.
pub fn ensure_https_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("Invalid URL: {error}"))?;
    if parsed.scheme() != "https" {
        return Err(format!(
            "URL must use https:// for this operation (got '{}://')",
            parsed.scheme()
        ));
    }
    Ok(())
}

/// Derives a safe, fixed-charset basename for a downloaded file from its source URL, discarding
/// any path separators/`..`/query-string tricks a malicious server (or a MITM on a downgraded
/// connection) might smuggle into the URL to escape the updates directory.
pub fn sanitize_download_filename(url: &str, fallback: &str) -> String {
    let candidate = url
        .rsplit('/')
        .next()
        .unwrap_or("")
        .split(['?', '#'])
        .next()
        .unwrap_or("");

    let cleaned: String = candidate
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
        .collect();
    let cleaned = cleaned.trim_start_matches('.');

    if cleaned.is_empty() || cleaned.len() > 128 {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

/// Hex-encodes the SHA-256 digest of `bytes`, for verifying downloaded update packages against
/// a manifest-supplied checksum.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

// ---------------------------------------------------------------------------
// SSRF guard for user-supplied ComfyUI endpoints
// ---------------------------------------------------------------------------

/// Validates a ComfyUI `endpoint` URL: must parse as `http`/`https` with a host that is
/// loopback or a private-LAN address, unless `allow_remote` (the `allowRemoteComfy` preference)
/// is set. Without this, a caller (including the in-app agent / MCP surface, which can pass an
/// `endpoint` param straight through) could point FluxNode's HTTP client at an arbitrary host —
/// e.g. a cloud metadata service (`169.254.169.254`) or an internal-only service — turning the
/// "ping/generate against my local ComfyUI" feature into a generic SSRF primitive.
pub fn ensure_safe_comfy_endpoint(endpoint: &str, allow_remote: bool) -> Result<(), String> {
    let url = reqwest::Url::parse(endpoint).map_err(|error| format!("Invalid ComfyUI endpoint URL: {error}"))?;
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err("ComfyUI endpoint must be http:// or https://".to_string());
    }
    if allow_remote {
        return Ok(());
    }

    let host = url
        .host_str()
        .ok_or_else(|| "ComfyUI endpoint is missing a host".to_string())?;

    if is_loopback_or_private_host(host) {
        Ok(())
    } else {
        Err(format!(
            "ComfyUI endpoint host '{host}' is not loopback/private; enable 'allowRemoteComfy' in preferences to use a remote ComfyUI server"
        ))
    }
}

fn is_loopback_or_private_host(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    match host.parse::<IpAddr>() {
        // Deliberately loopback + RFC1918 private ranges ONLY — NOT link-local
        // (169.254.0.0/16). Link-local includes the well-known cloud metadata endpoint
        // (169.254.169.254 on AWS/GCP/Azure); treating it as "safe LAN" would defeat the
        // entire point of this guard by allowing the classic SSRF-to-metadata-service attack.
        Ok(IpAddr::V4(v4)) => v4.is_loopback() || v4.is_private(),
        Ok(IpAddr::V6(v6)) => v6.is_loopback(),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_download_filename_takes_only_the_final_segment() {
        // Only the last path segment survives, so `../` traversal segments earlier in the URL
        // never reach the filesystem.
        assert_eq!(
            sanitize_download_filename("https://example.com/a/b/../../evil.sh", "fallback.bin"),
            "evil.sh"
        );
        assert_eq!(
            sanitize_download_filename("https://example.com/dl/fluxnode-1.2.3.exe", "fallback.bin"),
            "fluxnode-1.2.3.exe"
        );
        assert_eq!(sanitize_download_filename("https://example.com/", "fallback.bin"), "fallback.bin");
    }

    #[test]
    fn sanitize_download_filename_strips_disallowed_characters() {
        // '%'-encoded slashes are not real path separators, so they land in the "last segment"
        // as literal characters — the charset whitelist then strips them.
        assert_eq!(
            sanitize_download_filename("https://example.com/dl/..%2f..%2fetc%2fpasswd", "fallback.bin"),
            "2f..2fetc2fpasswd"
        );
    }

    #[test]
    fn https_enforced() {
        assert!(ensure_https_url("https://example.com/manifest.json").is_ok());
        assert!(ensure_https_url("http://example.com/manifest.json").is_err());
    }

    #[test]
    fn comfy_endpoint_loopback_allowed_remote_rejected() {
        assert!(ensure_safe_comfy_endpoint("http://127.0.0.1:8188", false).is_ok());
        assert!(ensure_safe_comfy_endpoint("http://localhost:8188", false).is_ok());
        assert!(ensure_safe_comfy_endpoint("http://192.168.1.20:8188", false).is_ok());
        assert!(ensure_safe_comfy_endpoint("http://169.254.169.254/", false).is_err());
        assert!(ensure_safe_comfy_endpoint("http://evil.example.com/", false).is_err());
        assert!(ensure_safe_comfy_endpoint("http://evil.example.com/", true).is_ok());
        assert!(ensure_safe_comfy_endpoint("ftp://127.0.0.1/", false).is_err());
    }
}
