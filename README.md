# ComfyUI Batch Studio

Electron desktop application for managing the ComfyUI Batch Studio project lifecycle while keeping Grok Web user-operated and isolated from local capabilities.

## Current implementation

Phase 1 read-only shell:

- Electron `BaseWindow` with separate Local and Grok `WebContentsView` instances.
- Persistent isolated Grok session partition.
- No preload, Node integration, or local IPC exposed to Grok.
- Read-only project folder scan for `project_brief.json`, `story.md`, `models.json`, `prompt_plan.json`, `LoRA_*.json`, and legacy `prompt_tree.md`.
- Japanese local UI with project navigation and artifact presence status.
- Grok show/hide, reload, external-browser open, and local/Grok pane ratio controls.
- Folder open and clipboard APIs exposed only through the local preload bridge.

## Development

Requirements:

- Node.js 22 or newer.
- npm 10 or newer.

Install and run:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm start
```

Type check:

```bash
npm run typecheck
```

See `docs/` for product contracts and architecture.
