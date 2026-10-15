#!/usr/bin/env python3
"""Run a bounded native FluxNode IPC, generated-image, persistence, and export smoke.

This launches the acceptance-built Tauri app through tauri-driver. The ComfyUI HTTP server
below is an explicit deterministic fixture: it returns a small CPU-generated PNG and does not
run ComfyUI, Ollama, or any model. The workflow result still travels through FluxNode's real
Tauri commands, project persistence, and FFmpeg render path.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import secrets
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class ComfyFixture(BaseHTTPRequestHandler):
    png = b""
    prompts: list[dict] = []
    request_log: list[str] = []

    def _send(self, status: int, body: bytes, content_type: str = "application/json") -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler callback
        type(self).request_log.append(f"GET {self.path}")
        if self.path == "/system_stats":
            self._send(200, b"{}")
            return
        if self.path.startswith("/history/"):
            prompt_id = self.path.rsplit("/", 1)[-1]
            number = prompt_id.rsplit("-", 1)[-1]
            payload = {
                prompt_id: {
                    "status": {"completed": True, "status_str": "success"},
                    "outputs": {
                        "7": {"images": [{"filename": f"fixture-result-{number}.png", "subfolder": "", "type": "output"}]}
                    },
                }
            }
            self._send(200, json.dumps(payload).encode())
            return
        if self.path.startswith("/view?"):
            self._send(200, type(self).png, "image/png")
            return
        self._send(404, b"{}")

    def do_POST(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler callback
        type(self).request_log.append(f"POST {self.path}")
        if self.path != "/prompt":
            self._send(404, b"{}")
            return
        length = int(self.headers.get("Content-Length", "0"))
        request = json.loads(self.rfile.read(length).decode("utf-8"))
        prompt = request.get("prompt")
        if not isinstance(prompt, dict) or "7" not in prompt:
            self._send(400, b'{"error":"expected the generated FluxNode prompt graph"}')
            return
        type(self).prompts.append(request)
        prompt_id = f"fluxnode-fixture-{len(type(self).prompts)}"
        self._send(200, json.dumps({"prompt_id": prompt_id}).encode())

    def log_message(self, fmt: str, *args: object) -> None:
        return


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class WebDriver:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.session_id: str | None = None

    def request(self, method: str, route: str, body: dict | None = None, timeout: float = 30) -> dict:
        data = None if body is None else json.dumps(body).encode("utf-8")
        request = Request(
            self.base_url + route,
            data=data,
            method=method,
            headers={"Content-Type": "application/json"} if data is not None else {},
        )
        try:
            with urlopen(request, timeout=timeout) as response:
                raw = response.read()
        except HTTPError as error:
            raw = error.read()
            raise RuntimeError(f"WebDriver {method} {route} returned HTTP {error.code}: {raw!r}") from error
        except URLError as error:
            raise RuntimeError(f"WebDriver {method} {route} failed: {error}") from error
        return json.loads(raw.decode("utf-8")) if raw else {}

    def command(self, method: str, suffix: str, body: dict | None = None, timeout: float = 30):
        if not self.session_id:
            raise RuntimeError("WebDriver session is not open")
        response = self.request(method, f"/session/{self.session_id}{suffix}", body, timeout)
        value = response.get("value")
        if isinstance(value, dict) and value.get("error"):
            raise RuntimeError(f"WebDriver command failed: {value}")
        return value

    def execute(self, code: str, args: list | None = None):
        return self.command("POST", "/execute/sync", {"script": code, "args": args or []})

    def invoke(self, command: str, payload: dict | None = None, timeout: float = 40):
        code = """
const [command, payload] = arguments;
const done = arguments[arguments.length - 1];
if (!window.__TAURI_INTERNALS__ || typeof window.__TAURI_INTERNALS__.invoke !== 'function') {
  done({ok: false, error: 'Tauri invoke bridge is unavailable'});
} else {
  window.__TAURI_INTERNALS__.invoke(command, payload || {})
    .then(value => done({ok: true, value}))
    .catch(error => done({ok: false, error: String(error)}));
}
"""
        result = self.command(
            "POST",
            "/execute/async",
            {"script": code, "args": [command, payload or {}]},
            timeout=timeout,
        )
        if not isinstance(result, dict) or result.get("ok") is not True:
            raise RuntimeError(f"Tauri command {command} failed: {result}")
        return result.get("value")


def wait_for_javascript(wd: WebDriver, script: str, description: str, timeout: float = 30) -> object:
    deadline = time.monotonic() + timeout
    latest: object = None
    while time.monotonic() < deadline:
        latest = wd.execute(script)
        if latest:
            return latest
        time.sleep(0.2)
    raise TimeoutError(f"Timed out waiting for {description}; last value: {latest!r}")


def click_workflow_button(wd: WebDriver, label: str) -> dict:
    result = wd.execute(
        """
const article = document.querySelector('[data-meridian-node-id="fixture-ai-generate"]');
if (!article) return {ok: false, reason: 'AI Generate node is not rendered'};
const button = [...article.querySelectorAll('button')].find(item => item.innerText.trim() === arguments[0]);
if (!button) return {ok: false, reason: `button not found: ${arguments[0]}`};
if (button.disabled) return {ok: false, reason: `button disabled: ${arguments[0]}`};
button.click();
return {ok: true, label: button.innerText.trim()};
""",
        [label],
    )
    if not isinstance(result, dict) or result.get("ok") is not True:
        raise AssertionError(f"Could not click workflow UI button {label!r}: {result}")
    return result


def workflow_result_nodes(project: dict) -> list[dict]:
    return [
        node
        for node in project.get("workflow", {}).get("nodes", [])
        if node.get("type") == "media_source"
        and node.get("data", {}).get("sourceWorkflowNodeId") == "fixture-ai-generate"
    ]


def wait_for_persisted_result_count(wd: WebDriver, expected_count: int, timeout: float = 30) -> dict:
    deadline = time.monotonic() + timeout
    latest: dict | None = None
    while time.monotonic() < deadline:
        raw = wd.invoke("load_project_state")
        latest = json.loads(raw) if isinstance(raw, str) else None
        if latest is not None and len(workflow_result_nodes(latest)) == expected_count:
            return latest
        time.sleep(0.25)
    observed = len(workflow_result_nodes(latest)) if latest is not None else None
    raise TimeoutError(f"Project WAL did not recover {expected_count} generated result(s); observed {observed}")


def project_fixture(output: Path, node: Path) -> dict:
    generator = Path(__file__).with_name("default_project_fixture.mjs")
    generated = subprocess.run(
        [str(node), str(generator), str(output / "exports")],
        check=False,
        capture_output=True,
        text=True,
        timeout=45,
    )
    if generated.returncode != 0:
        raise RuntimeError(f"Default project fixture generation failed: {generated.stderr[-3000:]}")
    try:
        project = json.loads(generated.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"Default project fixture generator did not emit JSON: {generated.stdout[:1000]!r}") from error
    if not isinstance(project, dict) or project.get("meta", {}).get("id") != "fluxnode-native-acceptance":
        raise RuntimeError("Default project fixture generator returned an unexpected project")
    return project


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--driver", type=Path, required=True)
    parser.add_argument("--edge-driver", type=Path, required=True)
    parser.add_argument("--ffmpeg", type=Path, required=True)
    parser.add_argument("--ffprobe", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--acceptance-identifier", required=True)
    args = parser.parse_args()

    application = args.application.resolve(strict=True)
    driver_exe = args.driver.resolve(strict=True)
    edge_driver = args.edge_driver.resolve(strict=True)
    ffmpeg = args.ffmpeg.resolve(strict=True)
    ffprobe = args.ffprobe.resolve(strict=True)
    node = args.node.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    tmp = output / "tmp"
    profile = output / "webview-profile"
    tmp.mkdir()
    profile.mkdir()
    (output / "projects").mkdir()
    (output / "exports").mkdir()

    png_path = output / "fixture-red-64.png"
    generation = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=red:size=64x64:rate=1", "-frames:v", "1", "-threads", "1", "-y", str(png_path)],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if generation.returncode != 0:
        raise RuntimeError(f"CPU PNG fixture creation failed: {generation.stderr[-3000:]}")
    png_bytes = png_path.read_bytes()
    ComfyFixture.png = png_bytes

    comfy_server = ThreadingHTTPServer(("127.0.0.1", 0), ComfyFixture)
    comfy_port = comfy_server.server_address[1]
    comfy_thread = threading.Thread(target=comfy_server.serve_forever, daemon=True)
    comfy_thread.start()
    driver_port = free_port()
    native_port = free_port()
    env = dict(os.environ)
    env.update(TEMP=str(tmp), TMP=str(tmp), WEBVIEW2_USER_DATA_FOLDER=str(profile))
    env["FLUXNODE_FFMPEG_DIR"] = str(ffmpeg.parent)

    driver_log = (output / "tauri-driver.log").open("w", encoding="utf-8")
    driver = subprocess.Popen(
        [str(driver_exe), "--port", str(driver_port), "--native-port", str(native_port), "--native-driver", str(edge_driver)],
        stdin=subprocess.DEVNULL,
        stdout=driver_log,
        stderr=subprocess.STDOUT,
        env=env,
        cwd=output,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    wd = WebDriver(f"http://127.0.0.1:{driver_port}")
    receipt = {
        "status": "RUNNING",
        "acceptance_identifier": args.acceptance_identifier,
        "application": str(application),
        "application_sha256": hashlib.sha256(application.read_bytes()).hexdigest(),
        "output_root": str(output),
        "fixture": {"kind": "synthetic ComfyUI HTTP response fixture", "png": str(png_path), "png_sha256": hashlib.sha256(png_bytes).hexdigest(), "server": f"http://127.0.0.1:{comfy_port}"},
        "transport": "real Tauri WebDriver session and native IPC invoke; no mock browser IPC",
        "checks": [],
        "limits": ["No live ComfyUI, Ollama, model, or GPU generation was used; the app called a local deterministic ComfyUI-shaped fixture."],
    }
    started = time.monotonic()

    def passed(name: str, evidence: dict | None = None) -> None:
        check = {"name": name, "status": "PASS", "elapsed_seconds": round(time.monotonic() - started, 2)}
        if evidence:
            check["evidence"] = evidence
        receipt["checks"].append(check)
        print(f"PASS: {name}", flush=True)

    session: str | None = None
    try:
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            if driver.poll() is not None:
                raise RuntimeError(f"tauri-driver exited with {driver.returncode}; see tauri-driver.log")
            try:
                status = wd.request("GET", "/status", timeout=2)
                if status.get("value", {}).get("ready") is True:
                    break
            except Exception:
                time.sleep(0.25)
        else:
            raise TimeoutError("tauri-driver did not become ready")

        created = wd.request("POST", "/session", {"capabilities": {"alwaysMatch": {
            "tauri:options": {"application": str(application), "webviewOptions": {"userDataFolder": str(profile)}}
        }}}, timeout=120)
        session = created.get("value", {}).get("sessionId")
        if not session:
            raise RuntimeError(f"tauri-driver returned no session id: {created}")
        wd.session_id = session
        if not profile.is_dir():
            raise AssertionError("isolated WebView2 profile was not created")
        state = wait_for_javascript(
            wd,
            "return document.readyState === 'complete' && document.querySelector('#root') ? {ready: document.readyState, title: document.title, root: true} : false",
            "FluxNode React root in the native WebView",
            timeout=45,
        )
        if not isinstance(state, dict) or not state.get("root"):
            raise AssertionError(f"FluxNode UI root did not load in the native WebView: {state}")
        passed("Native Tauri app opened with isolated WebView profile", state)
        (output / "startup.png").write_bytes(base64.b64decode(wd.command("GET", "/screenshot")))

        project_dir = output / "projects" / "fixture-project.fluxnode"
        project_dir.mkdir()
        project = project_fixture(output, node)
        project_json = json.dumps(project, separators=(",", ":"))
        preferences = {
            "defaultProjectDirectory": str(output / "projects"),
            "comfyUiEndpoint": f"http://127.0.0.1:{comfy_port}",
            "cloudApiKey": "",
            "updateChannel": "stable",
            "updateManifestUrl": None,
            "allowRemoteComfy": False,
        }
        wd.invoke("save_app_preferences", {"preferencesJson": json.dumps(preferences, separators=(",", ":"))})
        saved_preferences = wd.invoke("load_app_preferences")
        try:
            persisted_preferences = json.loads(saved_preferences) if isinstance(saved_preferences, str) else saved_preferences
        except json.JSONDecodeError as error:
            raise AssertionError(f"native preferences response was not JSON: {saved_preferences!r}") from error
        if not isinstance(persisted_preferences, dict) or persisted_preferences.get("defaultProjectDirectory") != str(output / "projects"):
            raise AssertionError(f"acceptance project root did not persist in isolated app preferences: {persisted_preferences!r}")
        passed("Native preferences scope project access to the isolated verification root")
        health = wd.invoke("comfy_ping", {"endpoint": f"http://127.0.0.1:{comfy_port}"})
        if health is not True:
            raise AssertionError(f"native Comfy health command did not reach the local fixture: {health!r}")
        if f"GET /system_stats" not in ComfyFixture.request_log:
            raise AssertionError(f"native Comfy health command did not request /system_stats: {ComfyFixture.request_log!r}")
        passed("Native Comfy health command reached the isolated HTTP fixture", {"request_log": list(ComfyFixture.request_log)})
        wd.invoke("save_project_state_as", {"path": str(project_dir), "projectJson": project_json})
        opened = wd.invoke("open_project_at_path", {"path": str(project_dir)})
        if not isinstance(opened, str) or json.loads(opened).get("meta", {}).get("id") != project["meta"]["id"]:
            raise AssertionError("native project did not persist and reopen from the verification root")
        passed("Project is saved and reopened through native Tauri commands", {"project_dir": str(project_dir)})
        wd.execute("window.location.reload(); return true")
        wait_for_javascript(
            wd,
            "return document.readyState === 'complete' && !!document.querySelector('#root') && !!window.__TAURI_INTERNALS__",
            "native app reload after fixture project open",
            timeout=45,
        )
        wait_for_javascript(
            wd,
            "return !!document.querySelector('[aria-label=\"Close welcome modal\"]')",
            "lazy-loaded first-run welcome controls",
            timeout=45,
        )
        welcome_click = wd.execute(
            "const close = document.querySelector('[aria-label=\"Close welcome modal\"]'); if (!close) return {clicked: false}; close.click(); return {clicked: true, label: close.getAttribute('aria-label')}"
        )
        if not isinstance(welcome_click, dict) or welcome_click.get("clicked") is not True:
            raise AssertionError("first-run welcome modal did not close through its native UI control")
        welcome_state = wait_for_javascript(
            wd,
            "if (document.querySelector('#welcome-modal-title')) return false; const tab = document.querySelector('[aria-label=\"Workflow view\"]'); return {dialogRemoved: true, seen: localStorage.getItem('fluxnode.welcomeSeen'), workflowTabPresent: !!tab}",
            "first-run welcome modal dismissal",
        )
        if not isinstance(welcome_state, dict) or welcome_state.get("seen") != "1":
            raise AssertionError(f"welcome dialog disappeared without recording first-run completion: {welcome_state!r}")
        passed("First-run welcome modal was dismissed using its native UI control", welcome_state)
        workflow_view_selected = wd.execute(
            "const tab = document.querySelector('[aria-label=\"Workflow view\"]'); if (!tab) return false; tab.click(); return true"
        )
        if not workflow_view_selected:
            raise AssertionError("could not select Workflow view using the native workspace control")
        view_state = wait_for_javascript(
            wd,
            "const tab = document.querySelector('[aria-label=\"Workflow view\"]'); return !!tab && tab.getAttribute('aria-pressed') === 'true' ? {workflowSelected: true} : false",
            "Workflow view selected in the native workspace",
        )
        passed("Workflow view selected using the native workspace tab", view_state)
        try:
            node_ready = wait_for_javascript(
                wd,
                "const node = document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]'); return !!node ? {nodePresent: true} : false",
                "fixture AI Generate node rendered in native UI",
                timeout=45,
            )
        except TimeoutError as error:
            snapshot = wd.execute(
                "const tab = document.querySelector('[aria-label=\"Workflow view\"]'); return {welcomeTitlePresent: !!document.querySelector('#welcome-modal-title'), welcomeSeen: localStorage.getItem('fluxnode.welcomeSeen'), headerPresent: !!document.querySelector('[aria-label=\"Application header\"]'), workflowTabPresent: !!tab, workflowTabPressed: tab?.getAttribute('aria-pressed'), nodeIds: [...document.querySelectorAll('[data-meridian-node-id]')].map(node => node.getAttribute('data-meridian-node-id')), title: document.title}"
            )
            raise AssertionError(f"{error}; native WebView snapshot={snapshot!r}") from error
        if not node_ready:
            raise AssertionError("fixture AI Generate node did not appear after native project reload")

        results: list[dict] = []
        for result_number in (1, 2):
            switched_to_workflow = wd.execute(
                "const tab = document.querySelector('[aria-label=\"Workflow view\"]'); if (!tab) return false; if (tab.getAttribute('aria-pressed') !== 'true') tab.click(); return true"
            )
            if not switched_to_workflow:
                raise AssertionError(f"could not return to Workflow view for result {result_number}")
            wait_for_javascript(
                wd,
                "const tab = document.querySelector('[aria-label=\"Workflow view\"]'); const node = document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]'); return !!tab && tab.getAttribute('aria-pressed') === 'true' && !!node",
                f"Workflow view and AI Generate node ready for result {result_number}",
            )
            wd.execute("document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]').click(); return true")
            try:
                wait_for_javascript(
                    wd,
                    "return [...document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]').querySelectorAll('button')].some(item => item.innerText.trim() === 'Generate')",
                    "AI Generate control enabled in native workflow UI",
                )
            except TimeoutError as error:
                snapshot = wd.execute(
                    "const article = document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]'); return {articleText: article?.innerText, buttons: [...(article?.querySelectorAll('button') ?? [])].map(button => ({text: button.innerText.trim(), disabled: button.disabled})), selectedNodeText: document.querySelector('[aria-label=\"Workflow status and actions\"]')?.innerText?.slice(0, 400), workflowNodeIds: [...document.querySelectorAll('[data-meridian-node-id]')].map(node => node.getAttribute('data-meridian-node-id'))}"
                )
                raise AssertionError(f"{error}; workflow UI snapshot={snapshot!r}") from error

            if result_number == 2:
                dedupe_state = wait_for_javascript(
                    wd,
                    "const article = document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]'); const button = [...article.querySelectorAll('button')].find(item => item.innerText.trim() === 'Added to timeline'); return button ? {found: true, disabled: button.disabled} : false",
                    "same-result Add to timeline control after selecting the source node",
                )
                if not isinstance(dedupe_state, dict) or dedupe_state.get("disabled") is not True:
                    raise AssertionError(f"same-result materialization was not disabled by the UI: {dedupe_state}")
                persisted_first = wait_for_persisted_result_count(wd, 1)
                if len(workflow_result_nodes(persisted_first)) != 1:
                    raise AssertionError("reselecting the same workflow result duplicated the persisted timeline entry")
                passed("Native UI disables a repeated add for the already materialized result")

            click_workflow_button(wd, "Generate")
            add_state = wait_for_javascript(
                wd,
                "const article = document.querySelector('[data-meridian-node-id=\"fixture-ai-generate\"]'); const button = [...article.querySelectorAll('button')].find(item => item.innerText.trim() === 'Add to timeline'); const preview = article.querySelector('img[alt^=\"Rendered preview\"]'); return button ? {found: true, disabled: button.disabled, title: button.title, previewPresent: !!preview, previewDataUrlPrefix: preview?.getAttribute('src')?.slice(0, 40)} : false",
                f"generated result {result_number} and enabled Add to timeline control",
                timeout=60,
            )
            if not isinstance(add_state, dict) or add_state.get("disabled") is not False:
                direct_raw = wd.invoke(
                    "comfy_generate",
                    {
                        "projectJson": project_json,
                        "nodeId": "fixture-ai-generate",
                        "endpoint": f"http://127.0.0.1:{comfy_port}",
                        "timeoutSecs": 120,
                    },
                    timeout=45,
                )
                try:
                    direct_frame = json.loads(direct_raw) if isinstance(direct_raw, str) else direct_raw
                except json.JSONDecodeError as error:
                    raise AssertionError(f"native Comfy result was not JSON: {direct_raw!r}") from error
                direct_summary = {
                    "mimeType": direct_frame.get("mimeType") if isinstance(direct_frame, dict) else None,
                    "sourceResultId": direct_frame.get("sourceResultId") if isinstance(direct_frame, dict) else None,
                    "sourceFileName": direct_frame.get("sourceFileName") if isinstance(direct_frame, dict) else None,
                    "dataUrlPrefix": direct_frame.get("dataUrl", "")[:40] if isinstance(direct_frame, dict) else None,
                }
                receipt["native_comfy_result_probe"] = direct_summary
                raise AssertionError(f"result {result_number} was not ready for materialization: ui={add_state}, native_comfy_result={direct_summary}")
            click_workflow_button(wd, "Add to timeline")
            persisted = wait_for_persisted_result_count(wd, result_number, timeout=45)
            result_nodes = workflow_result_nodes(persisted)
            if len(result_nodes) != result_number:
                raise AssertionError(f"expected {result_number} materialized results, got {len(result_nodes)}")
            current_result = result_nodes[-1]
            result_id = current_result.get("data", {}).get("sourceWorkflowResultId")
            asset_id = current_result.get("data", {}).get("assetId")
            asset = persisted.get("assets", {}).get("assets", {}).get(asset_id)
            if result_id != f"fluxnode-fixture-{result_number}" or not asset:
                raise AssertionError(f"workflow lineage or asset association was not persisted: {current_result}")
            asset_path = Path(asset.get("sourcePath", ""))
            if not asset_path.is_file() or asset_path.read_bytes() != png_bytes:
                raise AssertionError(f"materialized image does not match the generated fixture: {asset_path}")
            if asset_path.name != f"{asset_id}-fixture-result-{result_number}.png":
                raise AssertionError(f"Comfy source filename was not preserved safely: {asset_path.name}")
            results.append({"result_id": result_id, "asset_id": asset_id, "source_path": str(asset_path)})
            passed(f"Native UI Generate/Add controls persist result {result_number}", results[-1])

        if len(ComfyFixture.prompts) != 2:
            raise AssertionError(f"expected two fixture Comfy submissions from UI clicks, got {len(ComfyFixture.prompts)}")

        wd.execute("window.location.reload(); return true")
        wait_for_javascript(
            wd,
            "return document.readyState === 'complete' && !!document.querySelector('#root') && !!window.__TAURI_INTERNALS__",
            "native app reload after workflow materialization",
            timeout=45,
        )
        reopened_raw = wd.invoke("open_project_at_path", {"path": str(project_dir)})
        reopened_project = json.loads(reopened_raw) if isinstance(reopened_raw, str) else None
        reopened_nodes = workflow_result_nodes(reopened_project or {})
        if len(reopened_nodes) != 2:
            raise AssertionError(f"two generated results did not survive project reopen: {len(reopened_nodes)}")
        tracks = reopened_project.get("timeline", {}).get("tracks", [])
        clips = [clip for track in tracks for clip in track.get("clips", [])]
        if len(clips) != 2:
            raise AssertionError(f"expected two clips in the reopened project, got {len(clips)}")
        for node, result in zip(reopened_nodes, results, strict=True):
            asset = reopened_project["assets"]["assets"].get(result["asset_id"])
            if not asset or asset.get("sourcePath") != result["source_path"] or not Path(asset["sourcePath"]).is_file():
                raise AssertionError(f"materialized asset association did not survive reopen: {result['asset_id']}")
            if node.get("data", {}).get("sourceWorkflowResultId") != result["result_id"]:
                raise AssertionError(f"workflow result lineage did not survive reopen: {result['asset_id']}")
        project_json = json.dumps(reopened_project, separators=(",", ":"))
        passed("Generated assets, workflow lineage, and timeline clips survive app reload and native project reopen", {"results": results})

        job_id = "native-fixture-export"
        preset = {"id": "fixture-mpeg4", "format": "mp4", "videoCodec": "mpeg4", "audioCodec": "aac", "quality": "medium", "resolution": {"width": 160, "height": 120}, "frameRate": 5}
        start_result = wd.invoke("render_start", {"jobId": job_id, "projectJson": project_json, "presetJson": json.dumps(preset, separators=(",", ":"))}, timeout=30)
        start = json.loads(start_result)
        status: dict | None = None
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            status = json.loads(wd.invoke("render_get_status", {"jobId": job_id}, timeout=30))
            if status.get("status") in {"completed", "failed", "cancelled"}:
                break
            time.sleep(0.5)
        if not status or status.get("status") != "completed":
            raise AssertionError(f"native FFmpeg export did not complete: {status}")
        export_path = Path(start["outputPath"])
        if not export_path.is_file() or export_path.stat().st_size < 500:
            raise AssertionError(f"native FFmpeg export is missing or empty: {export_path}")
        probe = subprocess.run([str(ffprobe), "-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height", "-of", "json", str(export_path)], check=True, capture_output=True, text=True, timeout=30)
        probe_json = json.loads(probe.stdout)
        stream = next((item for item in probe_json.get("streams", []) if item.get("codec_name") == "mpeg4"), None)
        duration = float(probe_json.get("format", {}).get("duration", "0"))
        if not stream or (stream.get("width"), stream.get("height")) != (160, 120) or duration < 1.5:
            raise AssertionError(f"native FFmpeg output metadata was unexpected: {probe_json}")
        decoded_pixel = subprocess.run(
            [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-ss", "0.5", "-i", str(export_path), "-frames:v", "1", "-vf", "scale=1:1:flags=neighbor", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
            check=True,
            capture_output=True,
            timeout=30,
        ).stdout
        if len(decoded_pixel) != 3:
            raise AssertionError(f"FFmpeg did not decode a sample output pixel: {decoded_pixel!r}")
        pixel_rgb = list(decoded_pixel)
        if pixel_rgb[0] < pixel_rgb[1] + 80 or pixel_rgb[0] < pixel_rgb[2] + 80:
            raise AssertionError(f"export does not contain the synthetic red source image at 0.5s: RGB={pixel_rgb}")
        receipt["export"] = {"path": str(export_path), "size": export_path.stat().st_size, "ffprobe": probe_json, "decoded_pixel_rgb_at_0_5s": pixel_rgb}
        passed("Reopened generated-image timeline exports through native FFmpeg", receipt["export"])
        receipt["status"] = "PASS"
        return 0
    except Exception as error:
        receipt["status"] = "FAIL"
        receipt["error"] = f"{type(error).__name__}: {error}"
        return 1
    finally:
        if session:
            try:
                (output / "final.png").write_bytes(base64.b64decode(wd.command("GET", "/screenshot")))
                wd.command("DELETE", "", timeout=30)
            except Exception as error:
                receipt.setdefault("cleanup_errors", []).append(str(error))
        if driver.poll() is None:
            driver.terminate()
            try:
                driver.wait(timeout=15)
            except subprocess.TimeoutExpired:
                subprocess.run(["taskkill", "/PID", str(driver.pid), "/T", "/F"], check=False, capture_output=True, text=True)
                driver.wait(timeout=15)
        comfy_server.shutdown()
        comfy_server.server_close()
        comfy_thread.join(timeout=3)
        driver_log.close()
        receipt["fixture_requests"] = ComfyFixture.request_log
        receipt["fixture_prompt_count"] = len(ComfyFixture.prompts)
        receipt["elapsed_seconds"] = round(time.monotonic() - started, 2)
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps(receipt, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
