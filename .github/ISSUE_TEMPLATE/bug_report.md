---
name: Bug report
about: Report something that's broken in FluxNode
title: "[Bug] "
labels: bug
assignees: ''
---

## Describe the bug

A clear, concise description of what's wrong.

## Steps to reproduce

1. Go to '...'
2. Click on '...'
3. See error

## Expected behavior

What you expected to happen instead.

## Environment

- OS: [e.g. Windows 11, macOS 14, Ubuntu 24.04]
- Run mode: [`npm run tauri:dev` / `tauri:build` installer / `npm run dev` browser mode]
- FluxNode version: [see `package.json`, or Help > About if available]
- Node version: `node -v`
- Rust version (if backend-related): `rustc --version`

## Logs / screenshots

Paste relevant console output, Rust panic output, or screenshots. For crashes, check for a
status file under the project's `.fluxnode/` directory if the crash was mid-render.

## Additional context

Anything else that might help — does this reproduce in browser mode too? Only on a specific
project file? Only with the AI Copilot / agent layer enabled?
