#!/usr/bin/env python3
"""Exercise FluxNode's stdio MCP transport against a native acceptance executable.

This uses the real JSON-RPC/MCP wire protocol and real Tauri actions. Write checks target only
the caller-provided verification directory and the acceptance app identifier baked into the
test executable. It does not connect to Ollama, ComfyUI, or another user's running app.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import queue
import subprocess
import sys
import threading
import time
from pathlib import Path


def read_lines(stream, output_queue: queue.Queue[str | None]) -> None:
    try:
        for line in iter(stream.readline, ""):
            output_queue.put(line)
    finally:
        output_queue.put(None)


def visible_windows_for_process(process_id: int) -> list[dict]:
    if os.name != "nt":
        return []

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    dword = ctypes.c_ulong
    enum_windows_proc = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    visible_windows: list[dict] = []

    class Rect(ctypes.Structure):
        _fields_ = [
            ("left", ctypes.c_long),
            ("top", ctypes.c_long),
            ("right", ctypes.c_long),
            ("bottom", ctypes.c_long),
        ]

    user32.GetWindowThreadProcessId.argtypes = [ctypes.c_void_p, ctypes.POINTER(dword)]
    user32.GetWindowThreadProcessId.restype = dword
    user32.IsWindowVisible.argtypes = [ctypes.c_void_p]
    user32.IsWindowVisible.restype = ctypes.c_bool
    user32.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetClassNameW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    user32.GetClassNameW.restype = ctypes.c_int
    user32.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(Rect)]
    user32.GetWindowRect.restype = ctypes.c_bool
    get_window_long_ptr = getattr(user32, "GetWindowLongPtrW", user32.GetWindowLongW)
    get_window_long_ptr.argtypes = [ctypes.c_void_p, ctypes.c_int]
    get_window_long_ptr.restype = ctypes.c_ssize_t

    @enum_windows_proc
    def visit(hwnd, _parameter):
        owner = dword()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(owner))
        if owner.value == process_id and user32.IsWindowVisible(hwnd):
            length = user32.GetWindowTextLengthW(hwnd)
            title = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, title, len(title))
            class_name = ctypes.create_unicode_buffer(256)
            user32.GetClassNameW(hwnd, class_name, len(class_name))
            rect = Rect()
            user32.GetWindowRect(hwnd, ctypes.byref(rect))
            visible_windows.append(
                {
                    "hwnd": hex(int(hwnd)),
                    "title": title.value,
                    "class": class_name.value,
                    "rect": [rect.left, rect.top, rect.right, rect.bottom],
                    "width": rect.right - rect.left,
                    "height": rect.bottom - rect.top,
                    "style": hex(get_window_long_ptr(hwnd, -16) & 0xFFFFFFFF),
                }
            )
        return True

    if not user32.EnumWindows(visit, 0):
        raise OSError(ctypes.get_last_error(), "EnumWindows failed")
    return visible_windows


class McpProcess:
    def __init__(self, executable: Path, allow_writes: bool, log_path: Path, env: dict[str, str]):
        argv = [str(executable), "--mcp"]
        if allow_writes:
            argv.append("--allow-writes")
        self.process = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        assert self.process.stdin is not None
        assert self.process.stdout is not None
        assert self.process.stderr is not None
        self.incoming: queue.Queue[str | None] = queue.Queue()
        self.stderr_chunks: list[str] = []
        self.log_path = log_path
        self.reader = threading.Thread(
            target=read_lines, args=(self.process.stdout, self.incoming), daemon=True
        )
        self.stderr_reader = threading.Thread(
            target=self._read_stderr, args=(self.process.stderr,), daemon=True
        )
        self.reader.start()
        self.stderr_reader.start()
        self.next_id = 1

    def _read_stderr(self, stream) -> None:
        for line in iter(stream.readline, ""):
            self.stderr_chunks.append(line)

    def rpc(self, method: str, params: dict | None = None, timeout: float = 30) -> dict:
        request_id = self.next_id
        self.next_id += 1
        request = {"jsonrpc": "2.0", "id": request_id, "method": method}
        if params is not None:
            request["params"] = params
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                line = self.incoming.get(timeout=max(0.05, deadline - time.monotonic()))
            except queue.Empty as error:
                raise TimeoutError(f"MCP {method} timed out") from error
            if line is None:
                raise RuntimeError(
                    f"MCP process exited with code {self.process.poll()} while waiting for {method}"
                )
            try:
                message = json.loads(line)
            except json.JSONDecodeError as error:
                raise AssertionError(f"MCP stdout contained non-JSON output: {line!r}") from error
            if message.get("id") == request_id:
                return message
        raise TimeoutError(f"MCP {method} timed out")

    def notify(self, method: str, params: dict | None = None) -> None:
        request = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            request["params"] = params
        assert self.process.stdin is not None
        self.process.stdin.write(json.dumps(request, separators=(",", ":")) + "\n")
        self.process.stdin.flush()

    def close(self) -> None:
        if self.process.stdin is not None:
            self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/PID", str(self.process.pid), "/T", "/F"],
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                else:
                    self.process.kill()
                self.process.wait(timeout=5)
        self.stderr_reader.join(timeout=1)
        self.log_path.write_text("".join(self.stderr_chunks), encoding="utf-8")


def check_response(response: dict, method: str) -> dict:
    if "error" in response:
        raise AssertionError(f"MCP {method} returned protocol error: {response['error']}")
    if "result" not in response:
        raise AssertionError(f"MCP {method} had no result: {response}")
    return response["result"]


def first_text(result: dict) -> str:
    for item in result.get("content", []):
        if item.get("type") == "text":
            return item.get("text", "")
    return ""


def make_project(project_id: str) -> str:
    return json.dumps(
        {
            "meta": {"id": project_id, "name": "FluxNode MCP acceptance fixture"},
            "output": {"exportDefaults": {"outputDirectory": "exports"}},
            "assets": {"assets": {}},
            "timeline": {"tracks": []},
            "workflow": {"nodes": []},
        },
        separators=(",", ":"),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--acceptance-identifier", required=True)
    args = parser.parse_args()

    application = args.application.resolve(strict=True)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    mcp_root = output / "projects"
    mcp_root.mkdir()
    temp_root = output / "tmp"
    webview_profile = output / "webview-profile"
    temp_root.mkdir()
    webview_profile.mkdir()
    env = dict(os.environ)
    env["WEBVIEW2_USER_DATA_FOLDER"] = str(webview_profile)
    env["TEMP"] = str(temp_root)
    env["TMP"] = str(temp_root)
    receipt = {
        "status": "RUNNING",
        "transport": "native FluxNode executable stdio JSON-RPC / MCP",
        "application": str(application),
        "acceptance_identifier": args.acceptance_identifier,
        "output_root": str(output),
        "checks": [],
        "limits": [
            "No live Ollama or ComfyUI service was used.",
            "The app data isolation depends on the executable having been built with the stated acceptance identifier.",
        ],
    }
    started = time.monotonic()

    def passed(name: str, evidence: dict | None = None) -> None:
        entry = {"name": name, "status": "PASS", "elapsed_seconds": round(time.monotonic() - started, 2)}
        if evidence:
            entry["evidence"] = evidence
        receipt["checks"].append(entry)

    read_only: McpProcess | None = None
    write_enabled: McpProcess | None = None
    try:
        read_only = McpProcess(application, False, output / "mcp-readonly.stderr.log", env)
        initialized = check_response(
            read_only.rpc(
                "initialize",
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "fluxnode-acceptance", "version": "1.0"},
                },
            ),
            "initialize",
        )
        if initialized.get("serverInfo", {}).get("name") != "fluxnode":
            raise AssertionError(f"Unexpected MCP server identity: {initialized}")
        read_only.notify("notifications/initialized")
        passed("Native MCP initialize handshake", {"serverInfo": initialized.get("serverInfo")})
        visible_windows = visible_windows_for_process(read_only.process.pid)
        helper_windows = [
            window for window in visible_windows if window["class"] == "Tao Thread Event Target"
        ]
        application_windows = [
            window for window in visible_windows if window not in helper_windows
        ]
        if application_windows:
            raise AssertionError(f"Headless MCP process created visible application windows: {application_windows}")
        passed(
            "Headless MCP process has no visible application window",
            {
                "visible_windows": visible_windows,
                "recognized_tao_event_helper_count": len(helper_windows),
                "application_window_count": len(application_windows),
            },
        )

        listed = check_response(read_only.rpc("tools/list", {}), "tools/list")
        tool_names = {tool.get("name") for tool in listed.get("tools", [])}
        if "health_ping" not in tool_names or "save_app_preferences" not in tool_names:
            raise AssertionError("Expected read and gated write tools were not listed")
        frontend_tools = sorted(name for name in tool_names if name and name.startswith("timeline_"))
        if frontend_tools:
            raise AssertionError(f"Frontend-owned tools were advertised: {frontend_tools}")
        passed(
            "MCP advertises backend actions and omits frontend-owned timeline actions",
            {"tool_count": len(tool_names), "frontend_tool_count": len(frontend_tools)},
        )

        health = check_response(
            read_only.rpc("tools/call", {"name": "health_ping", "arguments": {}}),
            "tools/call health_ping",
        )
        if health.get("isError") is True:
            raise AssertionError(f"Read-only health action failed: {first_text(health)}")
        passed("Native MCP read-only action executes", {"content": first_text(health)[:240]})

        denied = check_response(
            read_only.rpc(
                "tools/call",
                {
                    "name": "save_app_preferences",
                    "arguments": {
                        "preferences_json": json.dumps(
                            {"defaultProjectDirectory": str(mcp_root)}, separators=(",", ":")
                        )
                    },
                },
            ),
            "tools/call save_app_preferences read-only",
        )
        denial_text = first_text(denied)
        if denied.get("isError") is not True or "read-only" not in denial_text:
            raise AssertionError(f"Write was not denied as an MCP tool error: {denied}")
        passed("MCP write action is denied without explicit opt-in", {"message": denial_text})

        unavailable = check_response(
            read_only.rpc(
                "tools/call",
                {"name": "timeline_add_clip", "arguments": {"trackId": "t", "assetId": "a", "startTime": 0, "duration": 1}},
            ),
            "tools/call timeline_add_clip",
        )
        unavailable_text = first_text(unavailable)
        if unavailable.get("isError") is not True or "unavailable over headless MCP" not in unavailable_text:
            raise AssertionError(f"Frontend-only action was not reported unavailable: {unavailable}")
        passed("A direct call to an unadvertised frontend action reports it unavailable", {"message": unavailable_text})
        read_only.close()
        read_only = None

        write_enabled = McpProcess(application, True, output / "mcp-allow-writes.stderr.log", env)
        check_response(
            write_enabled.rpc(
                "initialize",
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "fluxnode-acceptance", "version": "1.0"},
                },
            ),
            "initialize with writes enabled",
        )
        write_enabled.notify("notifications/initialized")
        allowed = check_response(
            write_enabled.rpc(
                "tools/call",
                {
                    "name": "save_app_preferences",
                    "arguments": {
                        "preferences_json": json.dumps(
                            {
                                "defaultProjectDirectory": str(mcp_root),
                                "comfyUiEndpoint": "http://127.0.0.1:8188",
                                "cloudApiKey": "",
                                "updateChannel": "stable",
                                "updateManifestUrl": None,
                                "allowRemoteComfy": False,
                            },
                            separators=(",", ":"),
                        )
                    },
                },
            ),
            "tools/call save_app_preferences allow-writes",
        )
        if allowed.get("isError") is True:
            raise AssertionError(f"Opt-in preference write failed: {first_text(allowed)}")
        loaded = check_response(
            write_enabled.rpc("tools/call", {"name": "load_app_preferences", "arguments": {}}),
            "tools/call load_app_preferences",
        )
        try:
            loaded_preferences = json.loads(first_text(loaded)).get("preferences", {})
        except json.JSONDecodeError:
            loaded_preferences = {}
        if loaded.get("isError") is True or loaded_preferences.get("defaultProjectDirectory") != str(mcp_root):
            raise AssertionError(f"Opt-in preference write did not persist in isolated app data: {loaded}")
        passed("Explicit MCP write opt-in persists preferences in the acceptance profile")

        project_path = mcp_root / "mcp-fixture.fluxnode"
        created = check_response(
            write_enabled.rpc(
                "tools/call",
                {
                    "name": "create_project_at_path",
                    "arguments": {
                        "path": str(project_path),
                        "project_json": make_project("mcp-acceptance-fixture"),
                    },
                },
                timeout=30,
            ),
            "tools/call create_project_at_path",
        )
        if created.get("isError") is True or not (project_path / "project.json").is_file():
            raise AssertionError(f"Opt-in project creation did not write the verification fixture: {created}")
        passed("Explicit MCP write opt-in creates a project under the verification root")
        receipt["status"] = "PASS"
        receipt["elapsed_seconds"] = round(time.monotonic() - started, 2)
        return 0
    except Exception as error:  # retain machine-readable evidence on failure
        receipt["status"] = "FAIL"
        receipt["error"] = f"{type(error).__name__}: {error}"
        return 1
    finally:
        if read_only is not None:
            read_only.close()
        if write_enabled is not None:
            write_enabled.close()
        receipt["elapsed_seconds"] = round(time.monotonic() - started, 2)
        (output / "receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
        print(json.dumps(receipt, indent=2), flush=True)


if __name__ == "__main__":
    sys.exit(main())
