# ComfyUI Batch Studio

ComfyUI Batch Studio is an Electron desktop application for managing a deterministic ComfyUI batch-generation project lifecycle around user-operated Grok Web.

The v1 flow covers project setup, story planning, model selection, Prompt Plan review/editing, workflow compilation, model availability checks, and Preflight readiness.

## Development

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Build:

```bash
npm run build
npm start
```

Regression tests:

```bash
npm test
```

## Core principles

- Grok decides semantic/creative content; Batch Studio validates, stores, and deterministically compiles it.
- Grok Web remains user-operated. Batch Studio does not automate login, DOM scraping, send, attachment upload, or response retrieval.
- Confirmed artifacts are never silently overwritten; edits begin from explicit drafts and previous confirmed versions are preserved in history.
- Workflow generation is template/manifest-driven and does not ask Grok to generate ComfyUI Workflow JSON.
- v1 ends at Preflight (`READY` / `BLOCKED`) and does not queue ComfyUI jobs.

See `docs/README.md` for the specification set.
